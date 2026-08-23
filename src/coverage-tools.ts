import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DiscordClient } from "./discord.js";
import { parseDataUri, redactDataUris } from "./extra-tools.js";
import { jsonResult } from "./results.js";

const Snowflake = z.string().regex(/^\d{17,20}$/);
const JsonObject = z.record(z.string(), z.unknown());
const DryRun = z.boolean().default(true);
const RoleConnectionMetadata = z.object({
  type: z.number().int().min(1).max(8),
  key: z.string().regex(/^[a-z0-9_]{1,50}$/),
  name: z.string().trim().min(1).max(100),
  name_localizations: z.record(z.string(), z.string().min(1).max(100)).optional(),
  description: z.string().trim().min(1).max(200),
  description_localizations: z.record(z.string(), z.string().min(1).max(200)).optional()
});
type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

interface WriteRequest {
  method: WriteMethod;
  route: string;
  operation: string;
  dryRun: boolean;
  body?: unknown;
  reason?: string;
  destructive?: boolean;
  confirm?: string;
  expectedConfirmation?: string;
}

async function runWrite(client: DiscordClient, input: WriteRequest) {
  if (input.dryRun) {
    const expectedConfirmation = input.expectedConfirmation === undefined
      ? undefined
      : client.policy.issueConfirmation(input.expectedConfirmation);
    return jsonResult({
      dryRun: true,
      method: input.method,
      route: input.route,
      ...(input.body === undefined ? {} : { body: redactDataUris(input.body) }),
      ...(expectedConfirmation === undefined ? {} : { expectedConfirmation })
    });
  }
  client.policy.assertWrite({
    operation: input.operation,
    destructive: input.destructive,
    confirmation: input.confirm,
    expectedConfirmation: input.expectedConfirmation
  });
  return jsonResult(await client.request(input.method, input.route, {
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.reason === undefined ? {} : { reason: input.reason })
  }));
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this action.`);
  return value;
}

function nonEmptyBody(value: Record<string, unknown> | undefined, action: string): Record<string, unknown> {
  if (value === undefined || Object.keys(value).length === 0) throw new Error(`${action} requires a non-empty body.`);
  return value;
}

export function pruneQuery(days: number, includeRoleIds: string[]): string {
  const query = new URLSearchParams({ days: String(days) });
  if (includeRoleIds.length > 0) query.set("include_roles", includeRoleIds.join(","));
  return query.toString();
}

export function messageCursorQuery(input: {
  limit: number;
  before?: string;
  after?: string;
  around?: string;
}): string {
  const cursors = [input.before, input.after, input.around].filter(Boolean);
  if (cursors.length > 1) throw new Error("Provide only one of before, after, or around.");
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.before !== undefined) query.set("before", input.before);
  if (input.after !== undefined) query.set("after", input.after);
  if (input.around !== undefined) query.set("around", input.around);
  return query.toString();
}

export function confirmationDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12).toUpperCase();
}

export function registerCoverageTools(args: { server: McpServer; client: DiscordClient }) {
  const { server, client } = args;

  server.registerTool(
    "discord_guild_operations",
    {
      description: "Inspect extended guild state and run guarded administration operations such as pruning, incident actions, integrations, and bulk bans.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum([
          "get_preview",
          "get_role",
          "get_role_member_counts",
          "get_prune_count",
          "begin_prune",
          "list_voice_regions",
          "list_integrations",
          "delete_integration",
          "get_vanity_url",
          "bulk_ban",
          "modify_incident_actions"
        ]),
        roleId: Snowflake.optional(),
        integrationId: Snowflake.optional(),
        days: z.number().int().min(1).max(30).default(7),
        includeRoleIds: z.array(Snowflake).max(100).default([]),
        computePruneCount: z.boolean().default(false),
        userIds: z.array(Snowflake).min(1).max(200).optional(),
        deleteMessageSeconds: z.number().int().min(0).max(604800).default(0),
        invitesDisabledUntil: z.string().datetime().nullable().optional(),
        dmsDisabledUntil: z.string().datetime().nullable().optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({
      guildId,
      action,
      roleId,
      integrationId,
      days,
      includeRoleIds,
      computePruneCount,
      userIds,
      deleteMessageSeconds,
      invitesDisabledUntil,
      dmsDisabledUntil,
      reason,
      confirm,
      dryRun
    }) => {
      client.policy.assertGuild(guildId);
      const root = `/guilds/${guildId}`;
      if (action === "get_preview") return jsonResult(await client.request("GET", `${root}/preview`));
      if (action === "get_role") return jsonResult(await client.request("GET", `${root}/roles/${required(roleId, "roleId")}`));
      if (action === "get_role_member_counts") return jsonResult(await client.request("GET", `${root}/roles/member-counts`));
      if (action === "get_prune_count") {
        return jsonResult(await client.request("GET", `${root}/prune?${pruneQuery(days, includeRoleIds)}`));
      }
      if (action === "list_voice_regions") return jsonResult(await client.request("GET", `${root}/regions`));
      if (action === "list_integrations") return jsonResult(await client.request("GET", `${root}/integrations`));
      if (action === "get_vanity_url") return jsonResult(await client.request("GET", `${root}/vanity-url`));
      if (action === "begin_prune") {
        const pruneBody = { days, compute_prune_count: computePruneCount, include_roles: includeRoleIds };
        const expected = `PRUNE GUILD ${guildId} ${days} DAYS ${confirmationDigest(pruneBody)}`;
        return runWrite(client, {
          method: "POST",
          route: `${root}/prune`,
          operation: "begin guild prune",
          body: pruneBody,
          reason,
          dryRun,
          destructive: true,
          confirm,
          expectedConfirmation: expected
        });
      }
      if (action === "delete_integration") {
        const selectedIntegration = required(integrationId, "integrationId");
        const expected = `DELETE GUILD INTEGRATION ${selectedIntegration}`;
        return runWrite(client, {
          method: "DELETE",
          route: `${root}/integrations/${selectedIntegration}`,
          operation: "delete guild integration",
          reason,
          dryRun,
          destructive: true,
          confirm,
          expectedConfirmation: expected
        });
      }
      if (action === "bulk_ban") {
        const selectedUsers = required(userIds, "userIds");
        client.policy.assertBulkSize(selectedUsers.length);
        const bulkBanBody = { user_ids: selectedUsers, delete_message_seconds: deleteMessageSeconds };
        const expected = `BULK BAN ${guildId} ${selectedUsers.length} USERS ${confirmationDigest(bulkBanBody)}`;
        return runWrite(client, {
          method: "POST",
          route: `${root}/bulk-ban`,
          operation: "bulk ban members",
          body: bulkBanBody,
          reason,
          dryRun,
          destructive: true,
          confirm,
          expectedConfirmation: expected
        });
      }
      if (invitesDisabledUntil === undefined && dmsDisabledUntil === undefined) {
        throw new Error("modify_incident_actions requires invitesDisabledUntil or dmsDisabledUntil.");
      }
      const incidentBody = {
        ...(invitesDisabledUntil === undefined ? {} : { invites_disabled_until: invitesDisabledUntil }),
        ...(dmsDisabledUntil === undefined ? {} : { dms_disabled_until: dmsDisabledUntil })
      };
      const expected = `UPDATE INCIDENT ACTIONS ${guildId} ${confirmationDigest(incidentBody)}`;
      return runWrite(client, {
        method: "PUT",
        route: `${root}/incident-actions`,
        operation: "modify guild incident actions",
        body: incidentBody,
        reason,
        dryRun,
        destructive: true,
        confirm,
        expectedConfirmation: expected
      });
    }
  );

  server.registerTool(
    "discord_channel_operations",
    {
      description: "Inspect a channel, follow an announcement channel, trigger typing, or set a voice-channel status.",
      inputSchema: {
        guildId: Snowflake,
        channelId: Snowflake,
        action: z.enum(["get", "follow_announcement", "trigger_typing", "set_voice_status"]),
        targetChannelId: Snowflake.optional(),
        status: z.string().max(500).nullable().optional(),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, channelId, action, targetChannelId, status, reason, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      if (action === "get") return jsonResult(await client.request("GET", `/channels/${channelId}`));
      if (action === "follow_announcement") {
        const target = required(targetChannelId, "targetChannelId");
        await client.assertChannelGuild(target, guildId);
        return runWrite(client, {
          method: "POST",
          route: `/channels/${channelId}/followers`,
          operation: "follow announcement channel",
          body: { webhook_channel_id: target },
          reason,
          dryRun
        });
      }
      if (action === "trigger_typing") {
        return runWrite(client, { method: "POST", route: `/channels/${channelId}/typing`, operation: "trigger typing indicator", dryRun });
      }
      return runWrite(client, {
        method: "PUT",
        route: `/channels/${channelId}/voice-status`,
        operation: "set voice channel status",
        body: { status: status ?? null },
        reason,
        dryRun
      });
    }
  );

  server.registerTool(
    "discord_dm",
    {
      description: "Use a one-to-one DM only for recipients explicitly listed in DISCORD_ALLOWED_USER_IDS. The feature is disabled by default.",
      inputSchema: {
        action: z.enum(["open", "list", "get", "send", "edit", "delete"]),
        userId: Snowflake,
        channelId: Snowflake.optional(),
        messageId: Snowflake.optional(),
        body: JsonObject.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        before: Snowflake.optional(),
        after: Snowflake.optional(),
        around: Snowflake.optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ action, userId, channelId, messageId, body, limit, before, after, around, confirm, dryRun }) => {
      client.policy.assertUser(userId);
      if (action === "open") {
        return runWrite(client, {
          method: "POST",
          route: "/users/@me/channels",
          operation: "open allowlisted direct message",
          body: { recipient_id: userId },
          dryRun
        });
      }
      const selectedChannel = required(channelId, "channelId");
      await client.assertDmChannel(selectedChannel, userId);
      if (action === "list") {
        const query = messageCursorQuery({
          limit,
          ...(before === undefined ? {} : { before }),
          ...(after === undefined ? {} : { after }),
          ...(around === undefined ? {} : { around })
        });
        return jsonResult(await client.request("GET", `/channels/${selectedChannel}/messages?${query}`));
      }
      const selectedMessage = action === "send" ? undefined : required(messageId, "messageId");
      const route = selectedMessage === undefined
        ? `/channels/${selectedChannel}/messages`
        : `/channels/${selectedChannel}/messages/${selectedMessage}`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      if (action === "send") {
        return runWrite(client, { method: "POST", route, operation: "send allowlisted direct message", body: nonEmptyBody(body, "send"), dryRun });
      }
      if (action === "edit") {
        return runWrite(client, { method: "PATCH", route, operation: "edit allowlisted direct message", body: nonEmptyBody(body, "edit"), dryRun });
      }
      const expected = `DELETE DM MESSAGE ${selectedChannel}/${selectedMessage}`;
      return runWrite(client, {
        method: "DELETE",
        route,
        operation: "delete allowlisted direct message",
        dryRun,
        destructive: true,
        confirm,
        expectedConfirmation: expected
      });
    }
  );

  server.registerTool(
    "discord_application_assets",
    {
      description: "Manage this application's emojis and linked-role metadata schema.",
      inputSchema: {
        action: z.enum([
          "list_emojis",
          "get_emoji",
          "create_emoji",
          "modify_emoji",
          "delete_emoji",
          "get_role_connection_metadata",
          "update_role_connection_metadata"
        ]),
        emojiId: Snowflake.optional(),
        name: z.string().trim().min(2).max(32).optional(),
        imageDataUri: z.string().max(400_000).optional(),
        metadata: z.array(RoleConnectionMetadata).max(5).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ action, emojiId, name, imageDataUri, metadata, confirm, dryRun }) => {
      const application = await client.request<{ id: string }>("GET", "/oauth2/applications/@me");
      const emojiRoot = `/applications/${application.id}/emojis`;
      const metadataRoute = `/applications/${application.id}/role-connections/metadata`;
      if (action === "list_emojis") return jsonResult(await client.request("GET", emojiRoot));
      if (action === "get_role_connection_metadata") return jsonResult(await client.request("GET", metadataRoute));
      if (action === "update_role_connection_metadata") {
        const selectedMetadata = required(metadata, "metadata");
        const expected = `REPLACE ROLE CONNECTION METADATA ${application.id} ${confirmationDigest(selectedMetadata)}`;
        return runWrite(client, {
          method: "PUT",
          route: metadataRoute,
          operation: "update application role connection metadata",
          body: selectedMetadata,
          dryRun,
          destructive: true,
          confirm,
          expectedConfirmation: expected
        });
      }
      if (action === "create_emoji") {
        const image = required(imageDataUri, "imageDataUri");
        parseDataUri(image, ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"], 256 * 1024);
        return runWrite(client, {
          method: "POST",
          route: emojiRoot,
          operation: "create application emoji",
          body: { name: required(name, "name"), image },
          dryRun
        });
      }
      const selectedEmoji = required(emojiId, "emojiId");
      const route = `${emojiRoot}/${selectedEmoji}`;
      if (action === "get_emoji") return jsonResult(await client.request("GET", route));
      if (action === "modify_emoji") {
        return runWrite(client, {
          method: "PATCH",
          route,
          operation: "modify application emoji",
          body: { name: required(name, "name") },
          dryRun
        });
      }
      const expected = `DELETE APPLICATION EMOJI ${selectedEmoji}`;
      return runWrite(client, {
        method: "DELETE",
        route,
        operation: "delete application emoji",
        dryRun,
        destructive: true,
        confirm,
        expectedConfirmation: expected
      });
    }
  );
}
