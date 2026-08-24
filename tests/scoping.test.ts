import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { DiscordClient, discordRestOptions } from "../src/discord.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const botId = "345678901234567890";
const dmUserId = "456789012345678901";

function client() {
  const config: AppConfig = {
    token: "test-token-that-is-long-enough",
    allowedGuildIds: new Set([guildId]),
    allowedUserIds: new Set([]),
    mode: "read-only",
    destructiveEnabled: false,
    confirmationTtlSeconds: 300,
    maxBulkActions: 100,
    stateFile: ".data/test-state.json",
    auditReasonPrefix: "test"
  };
  const instance = new DiscordClient(config);
  vi.spyOn(instance, "request").mockImplementation(async (_method, route) => {
    if (route.startsWith("/channels/")) return { guild_id: guildId } as never;
    if (route.startsWith("/webhooks/")) return { guild_id: guildId } as never;
    if (route.startsWith("/invites/")) return { guild: { id: guildId } } as never;
    if (route === "/users/@me") return { id: botId } as never;
    throw new Error(`Unexpected route: ${route}`);
  });
  return instance;
}

describe("raw Discord route scoping", () => {
  it("passes bounded timeout and retry settings to the Discord REST client", () => {
    const config: AppConfig = {
      token: "test-token-that-is-long-enough",
      allowedGuildIds: new Set([guildId]),
      allowedUserIds: new Set([]),
      mode: "read-only",
      destructiveEnabled: false,
      confirmationTtlSeconds: 300,
      requestTimeoutMs: 25_000,
      requestRetries: 2,
      maxBulkActions: 100,
      stateFile: ".data/test-state.json",
      auditReasonPrefix: "test"
    };
    expect(discordRestOptions(config)).toMatchObject({ version: "10", timeout: 25_000, retries: 2 });
  });

  it("accepts verified guild-owned top-level resources", async () => {
    const instance = client();
    await expect(instance.assertScopedRoute(guildId, `/stage-instances/${channelId}`)).resolves.toBe(`/stage-instances/${channelId}`);
    await expect(instance.assertScopedRoute(guildId, "/stage-instances", "POST", { channel_id: channelId })).resolves.toBe("/stage-instances");
    await expect(instance.assertScopedRoute(guildId, "/webhooks/456789012345678901")).resolves.toBe("/webhooks/456789012345678901");
    await expect(instance.assertScopedRoute(guildId, "/invites/example-code")).resolves.toBe("/invites/example-code");
    await expect(instance.assertScopedRoute(guildId, `/applications/${botId}/guilds/${guildId}/commands`)).resolves.toBe(`/applications/${botId}/guilds/${guildId}/commands`);
  });

  it("normalizes a missing leading slash before authorization and execution", async () => {
    const instance = client();
    await expect(instance.assertScopedRoute(guildId, `guilds/${guildId}?with_counts=true`)).resolves.toBe(`/guilds/${guildId}?with_counts=true`);
  });

  it.each([
    `https://discord.com/api/v10/guilds/${guildId}`,
    `//guilds/${guildId}`,
    `/guilds/${guildId}/../users/@me`,
    `/guilds/${guildId}/%2e%2e/users/@me`,
    `/guilds/${guildId}/channels%2fother`,
    `/guilds/${guildId}//channels`,
    `/guilds/${guildId}/channels/`,
    `/guilds/${guildId}#ignored`
  ])("rejects non-canonical or structurally ambiguous route %s", async (route) => {
    await expect(client().assertScopedRoute(guildId, route)).rejects.toThrow(/Raw route/);
  });

  it("rejects a request body that points at another guild", async () => {
    await expect(client().assertScopedRoute(guildId, `/guilds/${guildId}/channels`, "POST", {
      source_guild_id: "999999999999999999"
    })).rejects.toThrow(/not selected guild/);
  });

  it("accepts only the exact allowlisted one-to-one DM recipient", async () => {
    const config: AppConfig = {
      token: "test-token-that-is-long-enough",
      allowedGuildIds: new Set([guildId]),
      allowedUserIds: new Set([dmUserId]),
      mode: "read-only",
      destructiveEnabled: false,
      confirmationTtlSeconds: 300,
      maxBulkActions: 100,
      stateFile: ".data/test-state.json",
      auditReasonPrefix: "test"
    };
    const instance = new DiscordClient(config);
    vi.spyOn(instance, "request").mockResolvedValue({ type: 1, recipients: [{ id: dmUserId }] } as never);
    await expect(instance.assertDmChannel(channelId, dmUserId)).resolves.toBeUndefined();
    await expect(instance.assertDmChannel(channelId, "999999999999999999")).rejects.toThrow(/DISCORD_ALLOWED_USER_IDS/);
  });

  it("rejects routes that are not provably scoped to the allowlisted guild", async () => {
    const instance = client();
    await expect(instance.assertScopedRoute(guildId, "/users/@me")).rejects.toThrow(/verified guild-owned resource/);
    await expect(instance.assertScopedRoute(guildId, `/applications/999999999999999999/guilds/${guildId}/commands`)).rejects.toThrow(/does not belong/);
  });
});
