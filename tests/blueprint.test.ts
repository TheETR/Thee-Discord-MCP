import { ChannelType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";

import { planBlueprint, renderMessageContent, type GuildSnapshot } from "../src/blueprint.js";
import type { GuildState } from "../src/state.js";

const guildId = "123456789012345678";
const roleId = "223456789012345678";
const channelId = "323456789012345678";

const state: GuildState = {
  roles: { moderator: roleId },
  channels: { general: channelId },
  messages: {}
};

const snapshot: GuildSnapshot = {
  guild: { id: guildId, name: "ELALEM" },
  roles: [{
    id: roleId,
    name: "Moderator",
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: "0"
  }],
  channels: [{
    id: channelId,
    name: "general",
    type: ChannelType.GuildText,
    topic: "General conversation",
    position: 2,
    nsfw: false,
    rate_limit_per_user: 0
  }]
};

describe("blueprint planner", () => {
  it("is idempotent for matching roles and channels", () => {
    const result = planBlueprint({
      version: 1,
      roles: [{ key: "moderator", name: "Moderator" }],
      channels: [{
        key: "general",
        name: "general",
        type: "text",
        topic: "General conversation",
        position: 2,
        nsfw: false,
        slowmodeSeconds: 0
      }]
    }, snapshot, state);

    expect(result.actions).toEqual([]);
  });

  it("compares a desired property against the same snapshot property", () => {
    const result = planBlueprint({
      version: 1,
      channels: [{
        key: "general",
        name: "general",
        type: "text",
        topic: "general"
      }]
    }, snapshot, state);

    expect(result.actions).toEqual([
      expect.objectContaining({
        action: "update",
        resource: "channel",
        key: "general",
        changes: { topic: "general" }
      })
    ]);
  });

  it("plans an untracked welcome message only once", () => {
    const blueprint = {
      version: 1 as const,
      channels: [{
        key: "general",
        name: "general",
        type: "text" as const,
        messages: [{ key: "welcome-v1", content: "Welcome.", pin: true }]
      }]
    };

    expect(planBlueprint(blueprint, snapshot, state).actions).toEqual([
      expect.objectContaining({ action: "send", resource: "message", key: "welcome-v1" })
    ]);

    expect(planBlueprint(blueprint, snapshot, {
      ...state,
      messages: { "welcome-v1": "423456789012345678" }
    }).actions).toEqual([]);
  });

  it("renders blueprint channel keys as clickable Discord mentions", () => {
    expect(renderMessageContent("Go to {{channel:general}}.", state)).toBe(
      `Go to <#${channelId}>.`
    );
    expect(() => renderMessageContent("{{channel:missing}}", state)).toThrow(/unresolved/);
  });
});
