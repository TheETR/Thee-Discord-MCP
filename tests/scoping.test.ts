import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { DiscordClient } from "../src/discord.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const botId = "345678901234567890";

function client() {
  const config: AppConfig = {
    token: "test-token-that-is-long-enough",
    allowedGuildIds: new Set([guildId]),
    mode: "read-only",
    destructiveEnabled: false,
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
  it("accepts verified guild-owned top-level resources", async () => {
    const instance = client();
    await expect(instance.assertScopedRoute(guildId, `/stage-instances/${channelId}`)).resolves.toBeUndefined();
    await expect(instance.assertScopedRoute(guildId, "/stage-instances", "POST", { channel_id: channelId })).resolves.toBeUndefined();
    await expect(instance.assertScopedRoute(guildId, "/webhooks/456789012345678901")).resolves.toBeUndefined();
    await expect(instance.assertScopedRoute(guildId, "/invites/example-code")).resolves.toBeUndefined();
    await expect(instance.assertScopedRoute(guildId, `/applications/${botId}/guilds/${guildId}/commands`)).resolves.toBeUndefined();
  });

  it("rejects routes that are not provably scoped to the allowlisted guild", async () => {
    const instance = client();
    await expect(instance.assertScopedRoute(guildId, "/users/@me")).rejects.toThrow(/verified guild-owned resource/);
    await expect(instance.assertScopedRoute(guildId, `/applications/999999999999999999/guilds/${guildId}/commands`)).rejects.toThrow(/does not belong/);
  });
});
