import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { redactWebhookSecrets, registerAdvancedTools } from "./advanced-tools.js";
import { applyBlueprint, fetchBlueprintSnapshot, planBlueprint, ServerBlueprintSchema } from "./blueprint.js";
import { changeDigest } from "./confirmation.js";
import type { AppConfig } from "./config.js";
import { redactConfig } from "./config.js";
import { registerCoverageTools } from "./coverage-tools.js";
import type { DiscordClient } from "./discord.js";
import { registerExtraTools } from "./extra-tools.js";
import { knownPermissionNames, permissionBits } from "./permissions.js";
import { evaluateReleaseReadiness } from "./readiness.js";
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

export function sanitizeSnapshotWebhooks(value: unknown): unknown {
  return redactWebhookSecrets(value);
}

export function bulkDeleteConfirmation(channelId: string, messageIds: string[]): string {
  const body = { messages: messageIds };
  return `BULK DELETE MESSAGES ${channelId} ${messageIds.length} MESSAGES ${changeDigest(body)}`;
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
  registerCoverageTools({ server, client });

  server.registerTool(
    "discord_health",
    {
      description: "Validate the active bot runtime or audit the authenticated application's public-release readiness without exposing secrets or owner data.",
      inputSchema: {
        action: z.enum(["runtime", "release_readiness"]).default("runtime"),
        guildId: Snowflake.optional()
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ action, guildId }) => {
      const bot = await client.request<Record<string, unknown>>("GET", "/users/@me");
      if (action === "runtime") return jsonResult({ bot, config: redactConfig(config) });
      if (guildId === undefined) throw new Error("guildId is required for the release_readiness action.");
      client.policy.assertGuild(guildId);
      const applicationId = String(bot.id ?? "");
      if (!/^\d{17,20}$/.test(applicationId)) throw new Error("Discord returned an invalid current bot ID.");
      const [application, guild, member, roles, guildCommands, globalCommands] = await Promise.all([
        client.request<Record<string, unknown>>("GET", "/oauth2/applications/@me"),
        client.request<Record<string, unknown>>("GET", `/guilds/${guildId}`),
        client.request<Record<string, unknown>>("GET", `/guilds/${guildId}/members/@me`),
        client.request<Array<Record<string, unknown>>>("GET", `/guilds/${guildId}/roles`),
        client.request<Array<Record<string, unknown>>>("GET", `/applications/${applicationId}/guilds/${guildId}/commands`),
        client.request<Array<Record<string, unknown>>>("GET", `/applications/${applicationId}/commands`)
      ]);
      return jsonResult(evaluateReleaseReadiness({
        bot,
        application,
        guild,
        member,
        roles,
        guildCommands,
        globalCommands
      }));
    }
  );

  server.registerTool(
    "discord_known_permissions",
    {
      description: "List permission names accepted by blueprint and overwrite tools.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => jsonResult({ permissions: knownPermissionNames() })
  );

  server.registerTool(
    "discord_get_guild",
    {
      description: "Read a guild and its approximate member/presence counts.",
      inputSchema: { guildId: Snowflake },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      return jsonResult({
        ...snapshot,
        automod,
        onboarding,
        welcomeScreen,
        webhooks: sanitizeSnapshotWebhooks(webhooks),
        members
      });
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
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      description: "Create or modify any guild channel type. Bodies containing permission_overwrites are privileged and require full mode plus the dry-run confirmation.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake.optional(),
        body: JsonObject,
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (channelId) await client.assertChannelGuild(channelId, guildId);
      const plan = { operation: channelId ? "modify channel" : "create channel", guildId, channelId, body, reason };
      const privileged = Object.hasOwn(body, "permission_overwrites");
      const expected = privileged ? `UPSERT CHANNEL ${guildId}/${channelId ?? "NEW"} ${changeDigest(body)}` : undefined;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          plan,
          expectedConfirmation: expected === undefined ? undefined : client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({ operation: plan.operation, risk: privileged ? "privileged" : "ordinary", confirmation: confirm, expectedConfirmation: expected });
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
      description: "Create or replace a role/member permission overwrite. Requires full mode and the exact payload-bound confirmation returned by dry-run.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        targetId: Snowflake,
        targetType: z.enum(["role", "member"]),
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, targetId, targetType, allow, deny, reason, confirm, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const body = { type: targetType === "role" ? 0 : 1, allow: permissionBits(allow), deny: permissionBits(deny) };
      const expected = `SET CHANNEL PERMISSION ${channelId}/${targetId} ${changeDigest(body)}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          channelId,
          targetId,
          body,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({ operation: "set channel permission overwrite", risk: "privileged", confirmation: confirm, expectedConfirmation: expected });
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
      if (dryRun) return jsonResult({ dryRun: true, expectedConfirmation: client.policy.issueConfirmation(expected) });
      client.policy.assertWrite({ operation: "delete channel", destructive: true, confirmation: confirm, expectedConfirmation: expected });
      return jsonResult(await client.request("DELETE", `/channels/${channelId}`, { reason }));
    }
  );

  server.registerTool(
    "discord_upsert_role",
    {
      description: "Create or modify a guild role. Changing permissions is privileged and requires full mode plus the dry-run confirmation; role hierarchy still applies.",
      inputSchema: {
        guildId: Snowflake,
        roleId: Snowflake.optional(),
        body: JsonObject,
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, roleId, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const operation = roleId ? "modify role" : "create role";
      const privileged = Object.hasOwn(body, "permissions");
      const expected = privileged ? `UPSERT ROLE ${guildId}/${roleId ?? "NEW"} ${changeDigest(body)}` : undefined;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          operation,
          roleId,
          body,
          expectedConfirmation: expected === undefined ? undefined : client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({ operation, risk: privileged ? "privileged" : "ordinary", confirmation: confirm, expectedConfirmation: expected });
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
      if (dryRun) return jsonResult({ dryRun: true, expectedConfirmation: client.policy.issueConfirmation(expected) });
      client.policy.assertWrite({ operation: "delete role", destructive: true, confirmation: confirm, expectedConfirmation: expected });
      await client.request("DELETE", `/guilds/${guildId}/roles/${roleId}`, { reason });
      return jsonResult({ ok: true });
    }
  );

  server.registerTool(
    "discord_member_roles",
    {
      description: "Add and remove multiple roles from a guild member. Role assignment is privileged and requires the one-time confirmation returned by dry-run.",
      inputSchema: {
        guildId: Snowflake,
        userId: Snowflake,
        addRoleIds: z.array(Snowflake).default([]),
        removeRoleIds: z.array(Snowflake).default([]),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, userId, addRoleIds, removeRoleIds, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const actionCount = addRoleIds.length + removeRoleIds.length;
      client.policy.assertBulkSize(actionCount);
      const expected = `MODIFY MEMBER ROLES ${guildId}/${userId} ${changeDigest({ addRoleIds, removeRoleIds })}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          userId,
          addRoleIds,
          removeRoleIds,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({
        operation: "modify member roles",
        risk: "privileged",
        confirmation: confirm,
        expectedConfirmation: expected
      });
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
      const expected = action === "ban"
        ? `BAN MEMBER ${userId} ${changeDigest({ body, deleteMessageSeconds })}`
        : `${action.toUpperCase()} MEMBER ${userId}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          body,
          expectedConfirmation: destructive ? client.policy.issueConfirmation(expected) : undefined
        });
      }
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
      description: "Inspect, send, edit, delete, bulk delete, crosspost, list pins, pin, or unpin messages in an allowed guild channel.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        action: z.enum(["get", "send", "edit", "delete", "bulk_delete", "crosspost", "list_pins", "pin", "unpin"]),
        messageId: Snowflake.optional(),
        messageIds: z.array(Snowflake).min(2).max(100).optional(),
        content: z.string().max(2000).optional(),
        body: JsonObject.optional(),
        limit: z.number().int().min(1).max(50).default(50),
        before: z.string().max(100).optional(),
        confirm: z.string().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, action, messageId, messageIds, content, body, limit, before, confirm, reason, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const channelRoot = `/channels/${channelId}`;
      if (action === "list_pins") {
        const query = new URLSearchParams({ limit: String(limit) });
        if (before !== undefined) query.set("before", before);
        return jsonResult(await client.request("GET", `${channelRoot}/messages/pins?${query}`));
      }
      if (action === "bulk_delete") {
        if (messageIds === undefined) throw new Error("bulk_delete requires messageIds.");
        const selectedMessages = messageIds;
        client.policy.assertBulkSize(selectedMessages.length);
        const bulkBody = { messages: selectedMessages };
        const expected = bulkDeleteConfirmation(channelId, selectedMessages);
        if (dryRun) {
          return jsonResult({
            dryRun: true,
            action,
            channelId,
            body: bulkBody,
            expectedConfirmation: client.policy.issueConfirmation(expected)
          });
        }
        client.policy.assertWrite({
          operation: "bulk delete messages",
          destructive: true,
          confirmation: confirm,
          expectedConfirmation: expected
        });
        await client.request("POST", `${channelRoot}/messages/bulk-delete`, { body: bulkBody, reason });
        return jsonResult({ ok: true, action, messageCount: selectedMessages.length });
      }
      if (action !== "send" && messageId === undefined) throw new Error(`${action} requires messageId.`);
      const messageRoute = `${channelRoot}/messages/${messageId ?? ""}`;
      if (action === "get") return jsonResult(await client.request("GET", messageRoute));
      const payload = { ...(body ?? {}), ...(content === undefined ? {} : { content }) };
      if ((action === "send" || action === "edit") && Object.keys(payload).length === 0) {
        throw new Error(`${action} requires content or a non-empty body.`);
      }
      const destructive = action === "delete" || action === "crosspost";
      const expected = action === "delete"
        ? `DELETE MESSAGE ${channelId}/${messageId}`
        : action === "crosspost"
          ? `CROSSPOST MESSAGE ${channelId}/${messageId}`
          : undefined;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          channelId,
          messageId,
          body: payload,
          expectedConfirmation: expected === undefined ? undefined : client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({ operation: `${action} message`, destructive, confirmation: confirm, expectedConfirmation: expected });
      if (action === "send") return jsonResult(await client.request("POST", `${channelRoot}/messages`, { body: payload, reason }));
      if (action === "edit") return jsonResult(await client.request("PATCH", messageRoute, { body: payload, reason }));
      if (action === "crosspost") return jsonResult(await client.request("POST", `${messageRoute}/crosspost`, { reason }));
      if (action === "delete") await client.request("DELETE", messageRoute, { reason });
      if (action === "pin") await client.request("PUT", `${channelRoot}/messages/pins/${messageId}`, { reason });
      if (action === "unpin") await client.request("DELETE", `${channelRoot}/messages/pins/${messageId}`, { reason });
      return jsonResult({ ok: true, action, messageId });
    }
  );

  server.registerTool(
    "discord_current_bot_profile",
    {
      description: "Read or modify this operator bot's username, avatar, and banner. Modifications are privileged and require the one-time confirmation returned by dry-run.",
      inputSchema: {
        action: z.enum(["get", "modify"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ action, body, reason, confirm, dryRun }) => {
      if (action === "get") return jsonResult(await client.request("GET", "/users/@me"));
      const safeBody = {
        ...body,
        avatar: body.avatar ? "<redacted image data>" : undefined,
        banner: body.banner ? "<redacted image data>" : undefined
      };
      const expected = `MODIFY BOT PROFILE ${changeDigest(body)}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          body: safeBody,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({
        operation: "modify current bot profile",
        risk: "privileged",
        confirmation: confirm,
        expectedConfirmation: expected
      });
      return jsonResult(await client.request("PATCH", "/users/@me", { body, reason }));
    }
  );

  server.registerTool(
    "discord_current_application",
    {
      description: "Read or modify the current Discord application profile and installation metadata. Modifications are privileged and require the one-time confirmation returned by dry-run.",
      inputSchema: {
        action: z.enum(["get", "modify"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ action, body, reason, confirm, dryRun }) => {
      if (action === "get") return jsonResult(await client.request("GET", "/oauth2/applications/@me"));
      const safeBody = {
        ...body,
        icon: body.icon ? "<redacted image data>" : undefined,
        cover_image: body.cover_image ? "<redacted image data>" : undefined
      };
      const expected = `MODIFY APPLICATION ${changeDigest(body)}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          body: safeBody,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({
        operation: "modify current application",
        risk: "privileged",
        confirmation: confirm,
        expectedConfirmation: expected
      });
      return jsonResult(await client.request("PATCH", "/applications/@me", { body, reason }));
    }
  );

  server.registerTool(
    "discord_modify_guild",
    {
      description: "Modify guild-level settings. This is privileged and requires full mode plus the exact payload-bound confirmation returned by dry-run.",
      inputSchema: {
        guildId: Snowflake,
        body: JsonObject,
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const expected = `MODIFY GUILD ${guildId} ${changeDigest(body)}`;
      if (dryRun) return jsonResult({ dryRun: true, body, expectedConfirmation: client.policy.issueConfirmation(expected) });
      client.policy.assertWrite({ operation: "modify guild", risk: "privileged", confirmation: confirm, expectedConfirmation: expected });
      return jsonResult(await client.request("PATCH", `/guilds/${guildId}`, { body, reason }));
    }
  );

  server.registerTool(
    "discord_automod",
    {
      description: "List, create, modify, or delete Discord AutoMod rules. Create and modify are privileged; delete retains destructive gating.",
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
      const expected = destructive
        ? `DELETE AUTOMOD ${ruleId}`
        : `UPSERT AUTOMOD ${guildId}/${ruleId ?? "NEW"} ${changeDigest(body)}`;
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          ruleId,
          body,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      client.policy.assertWrite({
        operation: `${action} automod`,
        risk: destructive ? "destructive" : "privileged",
        confirmation: confirm,
        expectedConfirmation: expected
      });
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
      description: "Get or replace guild onboarding configuration. Replacement is privileged and requires the one-time confirmation returned by dry-run.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "update"]),
        body: JsonObject.default({}),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "get") return jsonResult(await client.request("GET", `/guilds/${guildId}/onboarding`));
      const expected = `REPLACE ONBOARDING ${guildId} ${changeDigest(body)}`;
      if (dryRun) return jsonResult({ dryRun: true, body, expectedConfirmation: client.policy.issueConfirmation(expected) });
      client.policy.assertWrite({
        operation: "modify onboarding",
        risk: "privileged",
        confirmation: confirm,
        expectedConfirmation: expected
      });
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
      if (dryRun) {
        return jsonResult({
          dryRun: true,
          action,
          emojiId,
          body: { ...body, image: body.image ? "<redacted image data>" : undefined },
          expectedConfirmation: expected === undefined ? undefined : client.policy.issueConfirmation(expected)
        });
      }
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
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      inputSchema: { guildId: Snowflake, blueprint: ServerBlueprintSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
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
      description: "Idempotently create/update resources from one blueprint without deleting unmanaged resources. Guild settings, role permissions, or overwrites make the plan privileged and require full mode plus dry-run confirmation.",
      inputSchema: {
        guildId: Snowflake,
        blueprint: ServerBlueprintSchema,
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, blueprint, reason, confirm, dryRun }) => jsonResult(await applyBlueprint({
      client,
      store,
      guildId,
      blueprintInput: blueprint,
      dryRun,
      ...(confirm === undefined ? {} : { confirm }),
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
      const canonicalRoute = await client.assertScopedRoute(guildId, route, method, body);
      const isWrite = method !== "GET";
      const expected = `RAW ${method} ${canonicalRoute} ${changeDigest(body ?? null)}`;
      if (isWrite && dryRun) {
        return jsonResult({
          dryRun: true,
          method,
          route: canonicalRoute,
          body,
          expectedConfirmation: client.policy.issueConfirmation(expected)
        });
      }
      if (isWrite) {
        client.policy.assertWrite({
          operation: `raw ${method} request`,
          destructive: true,
          confirmation: confirm,
          expectedConfirmation: expected
        });
      }
      return jsonResult(await client.request(method, canonicalRoute, {
        ...(body === undefined ? {} : { body }),
        ...(reason === undefined ? {} : { reason })
      }));
    }
  );
}
