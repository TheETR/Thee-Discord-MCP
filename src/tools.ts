import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { registerAdvancedTools } from "./advanced-tools.js";
import { applyBlueprint, fetchBlueprintSnapshot, planBlueprint, ServerBlueprintSchema } from "./blueprint.js";
import type { AppConfig } from "./config.js";
import { redactConfig } from "./config.js";
import type { DiscordClient } from "./discord.js";
import { registerExtraTools } from "./extra-tools.js";
import { knownPermissionNames, permissionBits } from "./permissions.js";
import { jsonResult } from "./results.js";
import type { StateStore } from "./state.js";

const Snowflake = z.string().regex(/^\d{17,20}$/);
const JsonObject = z.record(z.string(), z.unknown());
const DryRun = z.boolean().default(true);

async function optionalRequest(client: DiscordClient, method: "GET", route: string) {
  try {
    return { ok: true, data: await client.request(method, route) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerTools(args: {
  server: McpServer;
  client: DiscordClient;
  config: AppConfig;
  store: StateStore;
}) {
  const { server, client, config, store } = args;

  registerAdvancedTools({ server, client });
  registerExtraTools({ server, client });

  server.registerTool(
    "discord_health",
    {
      description: "Validate the Discord bot token and show the MCP safety configuration without exposing secrets.",
      inputSchema: {}
    },
    async () => {
      const bot = await client.request<Record<string, unknown>>("GET", "/users/@me");
      return jsonResult({ bot, config: redactConfig(config) });
    }
  );

  server.registerTool(
    "discord_known_permissions",
    {
      description: "List permission names accepted by blueprint and overwrite tools.",
      inputSchema: {}
    },
    async () => jsonResult({ permissions: knownPermissionNames() })
  );

  server.registerTool(
    "discord_get_guild",
    {
      description: "Read a guild and its approximate member/presence counts.",
      inputSchema: { guildId: Snowflake }
    },
    async ({ guildId }) => {
      client.policy.assertGuild(guildId);
      return jsonResult(await client.request("GET", `/guilds/${guildId}?with_counts=true`));
    }
  );

  server.registerTool(
    "discord_export_snapshot",
    {
      description: "Export guild metadata, roles, channels, AutoMod, onboarding, and welcome screen for planning or backup.",
      inputSchema: {
        guildId: Snowflake,
        includeMembers: z.boolean().default(false),
        memberLimit: z.number().int().min(1).max(1000).default(100)
      }
    },
    async ({ guildId, includeMembers, memberLimit }) => {
      client.policy.assertGuild(guildId);
      const snapshot = await fetchBlueprintSnapshot(client, guildId);
      const [automod, onboarding, welcomeScreen, webhooks] = await Promise.all([
        optionalRequest(client, "GET", `/guilds/${guildId}/auto-moderation/rules`),
        optionalRequest(client, "GET", `/guilds/${guildId}/onboarding`),
        optionalRequest(client, "GET", `/guilds/${guildId}/welcome-screen`),
        optionalRequest(client, "GET", `/guilds/${guildId}/webhooks`)
      ]);
      const members = includeMembers
        ? await optionalRequest(client, "GET", `/guilds/${guildId}/members?limit=${memberLimit}`)
        : { ok: false, error: "Member export not requested." };
      return jsonResult({ ...snapshot, automod, onboarding, welcomeScreen, webhooks, members });
    }
  );

  server.registerTool(
    "discord_list_messages",
    {
      description: "Read recent messages from a channel in an allowed guild.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        limit: z.number().int().min(1).max(100).default(50),
        before: Snowflake.optional(),
        after: Snowflake.optional()
      }
    },
    async ({ guildId, channelId, limit, before, after }) => {
      await client.assertChannelGuild(channelId, guildId);
      const query = new URLSearchParams({ limit: String(limit) });
      if (before) query.set("before", before);
      if (after) query.set("after", after);
      return jsonResult(await client.request("GET", `/channels/${channelId}/messages?${query}`));
    }
  );

  server.registerTool(
    "discord_members",
    {
      description: "Get one member or list members. Bulk listing may require the Guild Members privileged intent.",
      inputSchema: {
        guildId: Snowflake,
        userId: Snowflake.optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        after: Snowflake.optional()
      }
    },
    async ({ guildId, userId, limit, after }) => {
      client.policy.assertGuild(guildId);
      if (userId) return jsonResult(await client.request("GET", `/guilds/${guildId}/members/${userId}`));
      const query = new URLSearchParams({ limit: String(limit) });
      if (after) query.set("after", after);
      return jsonResult(await client.request("GET", `/guilds/${guildId}/members?${query}`));
    }
  );

  server.registerTool(
    "discord_upsert_channel",
    {
      description: "Create or modify any guild channel, category, forum, media, stage, voice, or announcement channel using Discord API fields.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake.optional(),
        body: JsonObject,
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, body, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (channelId) await client.assertChannelGuild(channelId, guildId);
      const plan = { operation: channelId ? "modify channel" : "create channel", guildId, channelId, body, reason };
      if (dryRun) return jsonResult({ dryRun: true, plan });
      client.policy.assertWrite({ operation: plan.operation });
      const result = channelId
        ? await client.request("PATCH", `/channels/${channelId}`, { body, reason })
        : await client.request("POST", `/guilds/${guildId}/channels`, { body, reason });
      return jsonResult(result);
    }
  );

  server.registerTool(
    "discord_reorder_channels",
    {
      description: "Bulk reorder channels and optionally move them between categories.",
      inputSchema: {
        guildId: Snowflake,
        positions: z.array(z.object({
          id: Snowflake,
          position: z.number().int().min(0).optional(),
          parent_id: Snowflake.nullable().optional(),
          lock_permissions: z.boolean().optional()
        })).min(1).max(100),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, positions, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (dryRun) return jsonResult({ dryRun: true, positions });
      client.policy.assertWrite({ operation: "reorder channels" });
      return jsonResult(await client.request("PATCH", `/guilds/${guildId}/channels`, { body: positions, reason }));
    }
  );

  server.registerTool(
    "discord_set_channel_permission",
    {
      description: "Create or replace a role/member permission overwrite on a channel.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        targetId: Snowflake,
        targetType: z.enum(["role", "member"]),
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, targetId, targetType, allow, deny, reason, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const body = { type: targetType === "role" ? 0 : 1, allow: permissionBits(allow), deny: permissionBits(deny) };
      if (dryRun) return jsonResult({ dryRun: true, channelId, targetId, body });
      client.policy.assertWrite({ operation: "set channel permission overwrite" });
      await client.request("PUT", `/channels/${channelId}/permissions/${targetId}`, { body, reason });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    "discord_delete_channel",
    {
      description: "Delete a channel. Requires full mode, destructive enablement, and an exact confirmation string.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        confirm: z.string(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, confirm, reason, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const expected = `DELETE CHANNEL ${channelId}`;
      if (dryRun) return jsonResult({ dryRun: true, expectedConfirmation: expected });
      client.policy.assertWrite({ operation: "delete channel", destructive: true, confirmation: confirm, expectedConfirmation: expected });
      return jsonResult(await client.request("DELETE", `/channels/${channelId}`, { reason }));
    }
  );

  server.registerTool(
    "discord_upsert_role",
    {
      description: "Create or modify a guild role. Role hierarchy still limits what the bot can manage.",
      inputSchema: {
        guildId: Snowflake,
        roleId: Snowflake.optional(),
        body: JsonObject,
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, roleId, body, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      const operation = roleId ? "modify role" : "create role";
      if (dryRun) return jsonResult({ dryRun: true, operation, roleId, body });
      client.policy.assertWrite({ operation });
      const route = roleId ? `/guilds/${guildId}/roles/${roleId}` : `/guilds/${guildId}/roles`;
      return jsonResult(await client.request(roleId ? "PATCH" : "POST", route, { body, reason }));
    }
  );

  server.registerTool(
    "discord_reorder_roles",
    {
      description: "Bulk reorder roles below the bot's highest role.",
      inputSchema: {
        guildId: Snowflake,
        positions: z.array(z.object({ id: Snowflake, position: z.number().int().min(1) })).min(1).max(100),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, positions, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (dryRun) return jsonResult({ dryRun: true, positions });
      client.policy.assertWrite({ operation: "reorder roles" });
      return jsonResult(await client.request("PATCH", `/guilds/${guildId}/roles`, { body: positions, reason }));
    }
  );

  server.registerTool(
    "discord_delete_role",
    {
      description: "Delete a role with an exact confirmation string.",
      inputSchema: {
        guildId: Snowflake,
        roleId: Snowflake,
        confirm: z.string(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, roleId, confirm, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      const expected = `DELETE ROLE ${roleId}`;
      if (dryRun) return jsonResult({ dryRun: true, expectedConfirmation: expected });
      client.policy.assertWrite({ operation: "delete role", destructive: true, confirmation: confirm, expectedConfirmation: expected });
      await client.request("DELETE", `/guilds/${guildId}/roles/${roleId}`, { reason });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    "discord_member_roles",
    {
      description: "Add and remove multiple roles from a guild member.",
      inputSchema: {
        guildId: Snowflake,
        userId: Snowflake,
        addRoleIds: z.array(Snowflake).default([]),
        removeRoleIds: z.array(Snowflake).default([]),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, userId, addRoleIds, removeRoleIds, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      const actionCount = addRoleIds.length + removeRoleIds.length;
      client.policy.assertBulkSize(actionCount);
      if (dryRun) return jsonResult({ dryRun: true, userId, addRoleIds, removeRoleIds });
      client.policy.assertWrite({ operation: "modify member roles" });
      for (const roleId of addRoleIds) {
        await client.request("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
      }
      for (const roleId of removeRoleIds) {
        await client.request("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
      }
      return jsonResult({ ok: true, actionCount });
    }
  );

  server.registerTool(
    "discord_moderate_member",
    {
      description: "Modify, timeout, kick, ban, or unban a guild member. Removal actions require exact confirmation.",
      inputSchema: {
        guildId: Snowflake,
        userId: Snowflake,
        action: z.enum(["modify", "kick", "ban", "unban"]),
        body: JsonObject.default({}),
        deleteMessageSeconds: z.number().int().min(0).max(604800).default(0),
        confirm: z.string().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, userId, action, body, deleteMessageSeconds, confirm, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      const destructive = action !== "modify";
      const expected = `${action.toUpperCase()} MEMBER ${userId}`;
      if (dryRun) return jsonResult({ dryRun: true, action, body, expectedConfirmation: destructive ? expected : undefined });
      client.policy.assertWrite({ operation: `${action} member`, destructive, confirmation: confirm, expectedConfirmation: expected });
      if (action === "modify") {
        return jsonResult(await client.request("PATCH", `/guilds/${guildId}/members/${userId}`, { body, reason }));
      }
      if (action === "kick") {
        await client.request("DELETE", `/guilds/${guildId}/members/${userId}`, { reason });
      } else if (action === "ban") {
        await client.request("PUT", `/guilds/${guildId}/bans/${userId}`, { body: { delete_message_seconds: deleteMessageSeconds }, reason });
      } else {
        await client.request("DELETE", `/guilds/${guildId}/bans/${userId}`, { reason });
      }
      return jsonResult({ ok: true, action, userId });
    }
  );

  server.registerTool(
    "discord_message",
    {
      description: "Send, edit, delete, pin, or unpin a message in an allowed guild channel.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        action: z.enum(["send", "edit", "delete", "pin", "unpin"]),
        messageId: Snowflake.optional(),
        content: z.string().max(2000).optional(),
        confirm: z.string().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, action, messageId, content, confirm, reason, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      if (action !== "send" && !messageId) throw new Error(`${action} requires messageId.`);
      if ((action === "send" || action === "edit") && !content) throw new Error(`${action} requires content.`);
      const destructive = action === "delete";
      const expected = messageId ? `DELETE MESSAGE ${channelId}/${messageId}` : undefined;
      if (dryRun) return jsonResult({ dryRun: true, action, channelId, messageId, content, expectedConfirmation: expected });
      client.policy.assertWrite({ operation: `${action} message`, destructive, confirmation: confirm, expectedConfirmation: expected });
      if (action === "send") return jsonResult(await client.request("POST", `/channels/${channelId}/messages`, { body: { content }, reason }));
      if (action === "edit") return jsonResult(await client.request("PATCH", `/channels/${channelId}/messages/${messageId}`, { body: { content }, reason }));
      if (action === "delete") await client.request("DELETE", `/channels/${channelId}/messages/${messageId}`, { reason });
      if (action === "pin") await client.request("PUT", `/channels/${channelId}/pins/${messageId}`, { reason });
      if (action === "unpin") await client.request("DELETE", `/channels/${channelId}/pins/${messageId}`, { reason });
      return jsonResult({ ok: true, action, messageId });
    }
  );

  server.registerTool(
    "discord_current_bot_profile",
    {
      description: "Read or modify this operator bot's username, avatar, and banner. Image fields accept Discord data URIs.",
      inputSchema: {
        action: z.enum(["get", "modify"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ action, body, reason, dryRun }) => {
      if (action === "get") return jsonResult(await client.request("GET", "/users/@me"));
      const safeBody = {
        ...body,
        avatar: body.avatar ? "<redacted image data>" : undefined,
        banner: body.banner ? "<redacted image data>" : undefined
      };
      if (dryRun) return jsonResult({ dryRun: true, action, body: safeBody });
      client.policy.assertWrite({ operation: "modify current bot profile" });
      return jsonResult(await client.request("PATCH", "/users/@me", { body, reason }));
    }
  );

  server.registerTool(
    "discord_current_application",
    {
      description: "Read or modify the current Discord application profile and installation metadata.",
      inputSchema: {
        action: z.enum(["get", "modify"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ action, body, reason, dryRun }) => {
      if (action === "get") return jsonResult(await client.request("GET", "/oauth2/applications/@me"));
      const safeBody = {
        ...body,
        icon: body.icon ? "<redacted image data>" : undefined,
        cover_image: body.cover_image ? "<redacted image data>" : undefined
      };
      if (dryRun) return jsonResult({ dryRun: true, action, body: safeBody });
      client.policy.assertWrite({ operation: "modify current application" });
      return jsonResult(await client.request("PATCH", "/applications/@me", { body, reason }));
    }
  );

  server.registerTool(
    "discord_modify_guild",
    {
      description: "Modify guild-level settings such as name, description, locale, verification, rules channel, and safety channels.",
      inputSchema: {
        guildId: Snowflake,
        body: JsonObject,
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, body, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (dryRun) return jsonResult({ dryRun: true, body });
      client.policy.assertWrite({ operation: "modify guild" });
      return jsonResult(await client.request("PATCH", `/guilds/${guildId}`, { body, reason }));
    }
  );

  server.registerTool(
    "discord_automod",
    {
      description: "List, create, modify, or delete Discord AutoMod rules.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "create", "modify", "delete"]),
        ruleId: Snowflake.optional(),
        body: JsonObject.default({}),
        confirm: z.string().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, ruleId, body, confirm, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list") return jsonResult(await client.request("GET", `/guilds/${guildId}/auto-moderation/rules`));
      if ((action === "modify" || action === "delete") && !ruleId) throw new Error(`${action} requires ruleId.`);
      const destructive = action === "delete";
      const expected = ruleId ? `DELETE AUTOMOD ${ruleId}` : undefined;
      if (dryRun) return jsonResult({ dryRun: true, action, ruleId, body, expectedConfirmation: expected });
      client.policy.assertWrite({ operation: `${action} automod`, destructive, confirmation: confirm, expectedConfirmation: expected });
      const base = `/guilds/${guildId}/auto-moderation/rules`;
      if (action === "create") return jsonResult(await client.request("POST", base, { body, reason }));
      if (action === "modify") return jsonResult(await client.request("PATCH", `${base}/${ruleId}`, { body, reason }));
      await client.request("DELETE", `${base}/${ruleId}`, { reason });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    "discord_onboarding",
    {
      description: "Get or replace guild onboarding configuration. Discord enforces Community onboarding constraints.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "update"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, body, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "get") return jsonResult(await client.request("GET", `/guilds/${guildId}/onboarding`));
      if (dryRun) return jsonResult({ dryRun: true, body });
      client.policy.assertWrite({ operation: "modify onboarding" });
      return jsonResult(await client.request("PUT", `/guilds/${guildId}/onboarding`, { body, reason }));
    }
  );

  server.registerTool(
    "discord_welcome_screen",
    {
      description: "Get or modify the Community welcome screen.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "update"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, body, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "get") return jsonResult(await client.request("GET", `/guilds/${guildId}/welcome-screen`));
      if (dryRun) return jsonResult({ dryRun: true, body });
      client.policy.assertWrite({ operation: "modify welcome screen" });
      return jsonResult(await client.request("PATCH", `/guilds/${guildId}/welcome-screen`, { body, reason }));
    }
  );

  server.registerTool(
    "discord_emoji",
    {
      description: "List, create, modify, or delete guild emojis. Create accepts a Discord data URI in body.image.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "create", "modify", "delete"]),
        emojiId: Snowflake.optional(),
        body: JsonObject.default({}),
        confirm: z.string().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, emojiId, body, confirm, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list") return jsonResult(await client.request("GET", `/guilds/${guildId}/emojis`));
      if ((action === "modify" || action === "delete") && !emojiId) throw new Error(`${action} requires emojiId.`);
      const destructive = action === "delete";
      const expected = emojiId ? `DELETE EMOJI ${emojiId}` : undefined;
      if (dryRun) return jsonResult({ dryRun: true, action, emojiId, body: { ...body, image: body.image ? "<redacted image data>" : undefined }, expectedConfirmation: expected });
      client.policy.assertWrite({ operation: `${action} emoji`, destructive, confirmation: confirm, expectedConfirmation: expected });
      const base = `/guilds/${guildId}/emojis`;
      if (action === "create") return jsonResult(await client.request("POST", base, { body, reason }));
      if (action === "modify") return jsonResult(await client.request("PATCH", `${base}/${emojiId}`, { body, reason }));
      await client.request("DELETE", `${base}/${emojiId}`, { reason });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    "discord_audit_log",
    {
      description: "Read Discord audit log entries for the allowed guild.",
      inputSchema: {
        guildId: Snowflake,
        limit: z.number().int().min(1).max(100).default(50),
        userId: Snowflake.optional(),
        actionType: z.number().int().optional(),
        before: Snowflake.optional()
      }
    },
    async ({ guildId, limit, userId, actionType, before }) => {
      client.policy.assertGuild(guildId);
      const query = new URLSearchParams({ limit: String(limit) });
      if (userId) query.set("user_id", userId);
      if (actionType !== undefined) query.set("action_type", String(actionType));
      if (before) query.set("before", before);
      return jsonResult(await client.request("GET", `/guilds/${guildId}/audit-logs?${query}`));
    }
  );

  server.registerTool(
    "discord_plan_blueprint",
    {
      description: "Compare a version-1 server blueprint with the live guild and return a non-destructive action plan.",
      inputSchema: { guildId: Snowflake, blueprint: ServerBlueprintSchema }
    },
    async ({ guildId, blueprint }) => {
      client.policy.assertGuild(guildId);
      const snapshot = await fetchBlueprintSnapshot(client, guildId);
      return jsonResult(planBlueprint(blueprint, snapshot, store.guild(guildId)));
    }
  );

  server.registerTool(
    "discord_apply_blueprint",
    {
      description: "Idempotently create/update roles, categories, channels, forum tags, permissions, messages, pins, and guild settings from one blueprint. It never deletes unmanaged resources.",
      inputSchema: {
        guildId: Snowflake,
        blueprint: ServerBlueprintSchema,
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, blueprint, reason, dryRun }) => jsonResult(await applyBlueprint({
      client,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun,
      ...(reason === undefined ? {} : { reason })
    }))
  );

  server.registerTool(
    "discord_raw_guild_request",
    {
      description: "Advanced escape hatch for Discord REST endpoints not covered above. Routes are restricted to the allowed guild, verified channels, webhooks, invites, stage instances, and this bot's guild commands.",
      inputSchema: {
        guildId: Snowflake,
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        route: z.string().min(1).max(500),
        body: JsonObject.optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, method, route, body, reason, confirm, dryRun }) => {
      await client.assertScopedRoute(guildId, route, method, body);
      const isWrite = method !== "GET";
      const expected = `RAW ${method} ${route}`;
      if (isWrite && dryRun) {
        return jsonResult({ dryRun: true, method, route, body, expectedConfirmation: expected });
      }
      if (isWrite) {
        client.policy.assertWrite({
          operation: `raw ${method} request`,
          destructive: true,
          confirmation: confirm,
          expectedConfirmation: expected
        });
      }
      return jsonResult(await client.request(method, route, {
        ...(body === undefined ? {} : { body }),
        ...(reason === undefined ? {} : { reason })
      }));
    }
  );
}
