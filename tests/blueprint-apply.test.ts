import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChannelType } from "discord-api-types/v10";
import { afterEach, describe, expect, it } from "vitest";

import { applyBlueprint } from "../src/blueprint.js";
import { ServerBlueprintSchema } from "../src/blueprint.js";
import { changeDigest } from "../src/confirmation.js";
import type { AppConfig } from "../src/config.js";
import type { DiscordClient } from "../src/discord.js";
import { SafetyPolicy } from "../src/safety.js";
import { StateStore } from "../src/state.js";

const guildId = "123456789012345678";
const channelId = "223456789012345678";
const messageId = "323456789012345678";
const directories: string[] = [];

function config(stateFile: string): AppConfig {
  return {
    token: "test-token-that-is-long-enough",
    allowedGuildIds: new Set([guildId]),
    allowedUserIds: new Set(),
    mode: "safe-write",
    destructiveEnabled: false,
    confirmationTtlSeconds: 300,
    maxBulkActions: 100,
    stateFile,
    auditReasonPrefix: "test"
  };
}

class FakeBlueprintClient {
  readonly calls: Array<{ method: string; route: string; body?: unknown }> = [];
  readonly policy: SafetyPolicy;
  readonly roles: Array<Record<string, unknown>> = [];
  readonly channels: Array<Record<string, unknown>> = [];
  readonly messages: Array<Record<string, unknown>> = [];
  failNextChannelCreate = false;

  constructor(stateFile: string) {
    this.policy = new SafetyPolicy(config(stateFile));
  }

  async request<T>(
    method: string,
    route: string,
    options: { body?: unknown } = {}
  ): Promise<T> {
    this.calls.push({ method, route, ...(options.body === undefined ? {} : { body: options.body }) });
    if (method === "GET" && route === `/guilds/${guildId}?with_counts=true`) {
      return { id: guildId, name: "Test Guild" } as T;
    }
    if (method === "GET" && route === `/guilds/${guildId}/roles`) return this.roles as T;
    if (method === "GET" && route === `/guilds/${guildId}/channels`) return this.channels as T;
    if (method === "GET" && /^\/channels\/\d+\/messages\?limit=100$/.test(route)) {
      return this.messages as T;
    }
    if (method === "POST" && route === `/guilds/${guildId}/channels`) {
      if (this.failNextChannelCreate) {
        this.failNextChannelCreate = false;
        throw new Error("simulated Discord channel failure");
      }
      const body = options.body as Record<string, unknown>;
      const channel = {
        id: channelId,
        name: body.name,
        type: body.type ?? ChannelType.GuildText,
        ...body
      };
      this.channels.push(channel);
      return channel as T;
    }
    if (method === "POST" && route === `/channels/${channelId}/messages`) {
      const body = options.body as Record<string, unknown>;
      const message = { id: messageId, nonce: body.nonce, content: body.content };
      this.messages.push(message);
      return message as T;
    }
    if (method === "PUT" && route === `/channels/${channelId}/pins/${messageId}`) {
      return { ok: true } as T;
    }
    throw new Error(`Unexpected fake Discord request: ${method} ${route}`);
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "thee-discord-blueprint-"));
  directories.push(root);
  const stateFile = join(root, "state.json");
  const store = new StateStore(stateFile, root);
  const fake = new FakeBlueprintClient(stateFile);
  const blueprint = {
    version: 1 as const,
    channels: [{
      key: "general",
      name: "general",
      type: "text" as const,
      messages: [{ key: "welcome", content: "Welcome.", pin: true }]
    }]
  };
  return { root, stateFile, store, fake, blueprint };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("blueprint execution journal", () => {
  it("persists per-action results and avoids replaying an already applied plan", async () => {
    const { root, stateFile, store, fake, blueprint } = await fixture();
    const first = await applyBlueprint({
      client: fake as unknown as DiscordClient,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun: false
    });

    expect(first.actionCount).toBe(2);
    expect(first.journal).toMatchObject({
      status: "completed",
      actions: [
        expect.objectContaining({ resource: "channel", status: "completed", resultId: channelId }),
        expect.objectContaining({ resource: "message", status: "completed", resultId: messageId })
      ]
    });
    expect(first.journal.finalAppliedPlanDigest).toMatch(/^[a-f0-9]{16}$/);

    const writesAfterFirstRun = fake.calls.filter((call) => call.method !== "GET").length;
    const second = await applyBlueprint({
      client: fake as unknown as DiscordClient,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun: false
    });
    expect(second.actionCount).toBe(0);
    expect(fake.calls.filter((call) => call.method !== "GET")).toHaveLength(writesAfterFirstRun);

    const reloaded = new StateStore(stateFile, root);
    await reloaded.load();
    expect(reloaded.blueprintJournal(guildId)).toMatchObject({ status: "completed", attempt: 2 });
  });

  it("records a failure and links the next matching attempt as recovery", async () => {
    const { root, stateFile, store, fake, blueprint } = await fixture();
    fake.failNextChannelCreate = true;
    await expect(applyBlueprint({
      client: fake as unknown as DiscordClient,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun: false
    })).rejects.toThrow(/simulated Discord channel failure/);

    const failed = store.blueprintJournal(guildId);
    expect(failed).toMatchObject({
      status: "failed",
      attempt: 1,
      actions: expect.arrayContaining([
        expect.objectContaining({ resource: "channel", status: "failed" }),
        expect.objectContaining({ resource: "message", status: "pending" })
      ])
    });

    const recovered = await applyBlueprint({
      client: fake as unknown as DiscordClient,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun: false
    });
    expect(recovered.recoveredFrom).toBe(failed?.id);
    expect(recovered.journal).toMatchObject({ status: "completed", attempt: 2 });

    const reloaded = new StateStore(stateFile, root);
    await reloaded.load();
    expect(reloaded.blueprintJournal(guildId)?.history).toEqual([
      expect.objectContaining({ id: failed?.id, status: "failed" })
    ]);
  });

  it("recovers a message by deterministic nonce instead of sending a duplicate", async () => {
    const { store, fake, blueprint } = await fixture();
    fake.channels.push({
      id: channelId,
      name: "general",
      type: ChannelType.GuildText
    });
    store.guild(guildId).channels.general = channelId;
    const parsed = ServerBlueprintSchema.parse(blueprint);
    const nonce = changeDigest({
      guildId,
      blueprintDigest: changeDigest(parsed),
      messageKey: "welcome"
    });
    fake.messages.push({ id: messageId, nonce, content: "Welcome." });

    const result = await applyBlueprint({
      client: fake as unknown as DiscordClient,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun: false
    });

    expect(result.actionCount).toBe(1);
    expect(result.journal.actions).toEqual([
      expect.objectContaining({ resource: "message", status: "completed", resultId: messageId })
    ]);
    expect(fake.calls).not.toContainEqual(expect.objectContaining({
      method: "POST",
      route: `/channels/${channelId}/messages`
    }));
    expect(store.guild(guildId).messages.welcome).toBe(messageId);
  });
});
