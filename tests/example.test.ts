import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { renderMessageContent, ServerBlueprintSchema } from "../src/blueprint.js";
import { permissionBits } from "../src/permissions.js";

describe("ELALEM example blueprint", () => {
  it("parses, resolves permission names, and renders all channel references", async () => {
    const raw = await readFile("examples/elalem.blueprint.json", "utf8");
    const blueprint = ServerBlueprintSchema.parse(JSON.parse(raw));

    for (const role of blueprint.roles) permissionBits(role.permissions);
    for (const item of [...blueprint.categories, ...blueprint.channels]) {
      for (const overwrite of item.overwrites ?? []) {
        permissionBits(overwrite.allow);
        permissionBits(overwrite.deny);
      }
    }

    const channels = Object.fromEntries(
      blueprint.channels.map((channel, index) => [
        channel.key,
        String(100000000000000000n + BigInt(index))
      ])
    );

    for (const channel of blueprint.channels) {
      for (const message of channel.messages ?? []) {
        expect(renderMessageContent(message.content, { roles: {}, channels, messages: {} }))
          .not.toContain("{{channel:");
      }
    }

    const forums = blueprint.channels.filter((channel) => channel.type === "forum");
    expect(forums).toHaveLength(2);
    expect(forums.every((channel) => channel.requireTag)).toBe(true);
  });
});
