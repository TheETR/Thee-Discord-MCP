import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DiscordClient } from "./discord.js";
import { permissionBits } from "./permissions.js";
import { jsonResult } from "./results.js";

const Snowflake = z.string().regex(/^\d{17,20}$/);
const JsonObject = z.record(z.string(), z.unknown());
const DryRun = z.boolean().default(true);
type Method = "POST" | "PUT" | "PATCH" | "DELETE";

interface WriteRequest {
  method: Method;
  route: string;
  operation: string;
  dryRun: boolean;
  body?: unknown;
  reason?: string;
  destructive?: boolean;
  confirm?: string;
  expectedConfirmation?: string;
  auth?: boolean;
  displayRoute?: string;
}

async function runWrite(client: DiscordClient, input: WriteRequest) {
  const preview = {
    dryRun: true,
    method: input.method,
    route: input.displayRoute ?? input.route,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.expectedConfirmation === undefined ? {} : { expectedConfirmation: input.expectedConfirmation })
  };
  if (input.dryRun) return jsonResult(preview);
  client.policy.assertWrite({
    operation: input.operation,
    destructive: input.destructive,
    confirmation: input.confirm,
    expectedConfirmation: input.expectedConfirmation
  });
  return jsonResult(await client.request(input.method, input.route, {
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.auth === undefined ? {} : { auth: input.auth })
  }));
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this action.`);
  return value;
}

export function queryString(entries: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

export function redactWebhookSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWebhookSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "token" || key === "url" ? "<redacted>" : redactWebhookSecrets(item)
  ]));
}

export function membershipScreeningBody(input: {
  enabled?: boolean;
  description?: string | null;
  rules?: string[];
  label: string;
  required: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.description === undefined ? {} : { description: input.description })
  };
  if (input.rules !== undefined) {
    body.form_fields = JSON.stringify([{
      field_type: "TERMS",
      label: input.label,
      required: input.required,
      values: input.rules
    }]);
  }
  return body;
}

export function registerAdvancedTools(args: { server: McpServer; client: DiscordClient }) {
  const { server, client } = args;

  server.registerTool(
    "discord_capabilities",
    {
      description: "Describe named Discord operations and their safety requirements without making a network request.",
      inputSchema: {}
    },
    async () => jsonResult({
      transport: "stdio",
      inventory: {
        mcpTools: 49,
        schemaDeclaredOperations: 166,
        grouping: "Related operations share an action-based MCP tool instead of becoming separate tools."
      },
      safety: ["guild allowlist", "read-only/safe-write/full modes", "dry-run by default", "exact destructive confirmations", "bulk limits", "audit reasons"],
      families: {
        directory: ["list_channels", "find_channels", "list_roles", "search_members", "list_bans", "get_ban"],
        messages: ["get", "send", "edit", "delete", "crosspost", "list_pins", "pin", "unpin", "bulk_delete"],
        reactions: ["add", "remove_own", "remove_user", "list_users", "clear_all", "clear_emoji"],
        webhooks: ["list_channel", "list_guild", "get", "create", "modify", "delete", "execute"],
        invites: ["list_channel", "list_guild", "get", "create", "delete"],
        scheduled_events: ["list", "get", "create", "modify", "delete", "list_users"],
        forum_threads: ["list_active", "list_archived", "list_archived_private", "list_joined_private", "create", "create_from_message", "modify", "delete", "get_member", "list_members", "join", "leave", "add_member", "remove_member"],
        voice_members: ["get", "move", "disconnect", "set_mute", "set_deaf"],
        permission_overwrites: ["list", "upsert", "delete"],
        membership_screening: ["get", "update"],
        stage_instances: ["get", "create", "modify", "delete"],
        soundboard: ["list_default", "list_guild", "get", "create", "modify", "delete", "send"],
        stickers: ["list", "get", "create", "modify", "delete"],
        polls: ["create", "list_voters", "end"],
        message_search: ["search"],
        guild_templates: ["list", "get", "create", "sync", "modify", "delete"],
        application_commands: ["list", "get", "upsert", "modify", "delete", "bulk_overwrite"],
        widget: ["get_settings", "get_widget", "modify_settings", "image_url"],
        guild_operations: ["get_preview", "get_role", "get_role_member_counts", "get_prune_count", "begin_prune", "list_voice_regions", "list_integrations", "delete_integration", "get_vanity_url", "bulk_ban", "modify_incident_actions"],
        channel_operations: ["get", "follow_announcement", "trigger_typing", "set_voice_status"],
        direct_messages: ["open", "list", "get", "send", "edit", "delete"],
        application_assets: ["list_emojis", "get_emoji", "create_emoji", "modify_emoji", "delete_emoji", "get_role_connection_metadata", "update_role_connection_metadata"]
      },
      note: "The raw guild request remains available for allowlist-scoped Discord REST endpoints not yet named."
    })
  );

  server.registerTool(
    "discord_membership_screening",
    {
      description: "Read or replace the Membership Screening rules shown on Discord's Access page. Updates use Discord's unstable endpoint and require full mode plus exact confirmation.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "update"]),
        enabled: z.boolean().optional(),
        description: z.string().max(300).nullable().optional(),
        rules: z.array(z.string().trim().min(1).max(512)).min(1).max(16).optional(),
        label: z.string().trim().min(1).max(300).default("Read and agree to the server rules"),
        required: z.boolean().default(true),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, enabled, description, rules, label, required: isRequired, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const route = `/guilds/${guildId}/member-verification`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      const body = membershipScreeningBody({
        ...(enabled === undefined ? {} : { enabled }),
        ...(description === undefined ? {} : { description }),
        ...(rules === undefined ? {} : { rules }),
        label,
        required: isRequired
      });
      if (Object.keys(body).length === 0) {
        throw new Error("update requires enabled, description, or rules.");
      }
      const expected = `UPDATE SERVER RULES ${guildId}`;
      return runWrite(client, {
        method: "PATCH",
        route,
        operation: "update membership screening",
        body,
        reason,
        dryRun,
        destructive: true,
        confirm,
        expectedConfirmation: expected
      });
    }
  );

  server.registerTool(
    "discord_directory",
    {
      description: "Browse guild channels and roles, search members, or inspect bans with guild allowlist enforcement.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list_channels", "find_channels", "list_roles", "search_members", "list_bans", "get_ban"]),
        query: z.string().max(100).optional(),
        channelType: z.number().int().min(0).max(16).optional(),
        parentId: Snowflake.optional(),
        userId: Snowflake.optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        before: Snowflake.optional(),
        after: Snowflake.optional()
      }
    },
    async ({ guildId, action, query, channelType, parentId, userId, limit, before, after }) => {
      client.policy.assertGuild(guildId);
      if (action === "list_roles") return jsonResult(await client.request("GET", `/guilds/${guildId}/roles`));
      if (action === "search_members") {
        const search = required(query, "query");
        return jsonResult(await client.request("GET", `/guilds/${guildId}/members/search${queryString({ query: search, limit: Math.min(limit, 1000) })}`));
      }
      if (action === "list_bans") {
        return jsonResult(await client.request("GET", `/guilds/${guildId}/bans${queryString({ limit: Math.min(limit, 1000), before, after })}`));
      }
      if (action === "get_ban") {
        return jsonResult(await client.request("GET", `/guilds/${guildId}/bans/${required(userId, "userId")}`));
      }
      const channels = await client.request<Array<Record<string, unknown>>>("GET", `/guilds/${guildId}/channels`);
      if (action === "list_channels") return jsonResult(channels);
      const needle = query?.trim().toLowerCase();
      return jsonResult(channels.filter((channel) => {
        if (needle && !String(channel.name ?? "").toLowerCase().includes(needle)) return false;
        if (channelType !== undefined && channel.type !== channelType) return false;
        if (parentId !== undefined && channel.parent_id !== parentId) return false;
        return true;
      }));
    }
  );

  server.registerTool(
    "discord_reaction",
    {
      description: "Add, inspect, or remove reactions on a guild message, including guarded moderation cleanup.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["add", "remove_own", "remove_user", "list_users", "clear_all", "clear_emoji"]),
        channelId: Snowflake,
        messageId: Snowflake,
        emoji: z.string().min(1).max(200).optional(),
        userId: Snowflake.optional(),
        reactionType: z.number().int().min(0).max(1).default(0),
        limit: z.number().int().min(1).max(100).default(100),
        after: Snowflake.optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, messageId, emoji, userId, reactionType, limit, after, confirm, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const messageRoute = `/channels/${channelId}/messages/${messageId}`;
      if (action === "clear_all") {
        const expected = `CLEAR ALL REACTIONS ${channelId}/${messageId}`;
        return runWrite(client, { method: "DELETE", route: `${messageRoute}/reactions`, operation: "clear all message reactions", dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      const selectedEmoji = required(emoji, "emoji");
      const route = `${messageRoute}/reactions/${encodeURIComponent(selectedEmoji)}`;
      if (action === "list_users") {
        return jsonResult(await client.request("GET", `${route}${queryString({ type: reactionType, limit, after })}`));
      }
      if (action === "remove_user") {
        const selectedUser = required(userId, "userId");
        const expected = `REMOVE REACTION ${selectedUser} ${channelId}/${messageId}`;
        return runWrite(client, { method: "DELETE", route: `${route}/${selectedUser}`, operation: "remove user reaction", dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      if (action === "clear_emoji") {
        const expected = `CLEAR EMOJI REACTIONS ${selectedEmoji} ${channelId}/${messageId}`;
        return runWrite(client, { method: "DELETE", route, operation: "clear emoji reactions", dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      return runWrite(client, {
        method: action === "add" ? "PUT" : "DELETE",
        route: `${route}/@me`,
        operation: `${action} reaction`,
        dryRun
      });
    }
  );

  server.registerTool(
    "discord_webhook",
    {
      description: "Manage guild-owned webhooks and execute one without returning its token or URL.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list_channel", "list_guild", "get", "create", "modify", "delete", "execute"]),
        channelId: Snowflake.optional(),
        webhookId: Snowflake.optional(),
        token: z.string().min(20).max(300).optional(),
        name: z.string().min(1).max(80).optional(),
        body: JsonObject.optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, webhookId, token, name, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list_guild") return jsonResult(redactWebhookSecrets(await client.request("GET", `/guilds/${guildId}/webhooks`)));
      if (action === "list_channel" || action === "create") {
        const selectedChannel = required(channelId, "channelId");
        await client.assertChannelGuild(selectedChannel, guildId);
        if (action === "list_channel") return jsonResult(redactWebhookSecrets(await client.request("GET", `/channels/${selectedChannel}/webhooks`)));
        const result = await runWrite(client, {
          method: "POST",
          route: `/channels/${selectedChannel}/webhooks`,
          operation: "create webhook",
          body: { name: required(name, "name") },
          reason,
          dryRun
        });
        if (dryRun) return result;
        const parsed = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as unknown;
        return jsonResult(redactWebhookSecrets(parsed));
      }
      const selectedWebhook = required(webhookId, "webhookId");
      await client.assertScopedRoute(guildId, `/webhooks/${selectedWebhook}`);
      if (action === "get") return jsonResult(redactWebhookSecrets(await client.request("GET", `/webhooks/${selectedWebhook}`)));
      if (action === "modify") {
        if (typeof body?.channel_id === "string") await client.assertChannelGuild(body.channel_id, guildId);
        const result = await runWrite(client, { method: "PATCH", route: `/webhooks/${selectedWebhook}`, operation: "modify webhook", body: required(body, "body"), reason, dryRun });
        if (dryRun) return result;
        const parsed = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as unknown;
        return jsonResult(redactWebhookSecrets(parsed));
      }
      if (action === "delete") {
        const expected = `DELETE WEBHOOK ${selectedWebhook}`;
        return runWrite(client, { method: "DELETE", route: `/webhooks/${selectedWebhook}`, operation: "delete webhook", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      const webhookToken = dryRun ? "<redacted>" : required(token, "token");
      return runWrite(client, {
        method: "POST",
        route: `/webhooks/${selectedWebhook}/${encodeURIComponent(webhookToken)}?wait=true`,
        displayRoute: `/webhooks/${selectedWebhook}/<redacted>?wait=true`,
        operation: "execute webhook",
        body: required(body, "body"),
        dryRun,
        auth: false
      });
    }
  );

  server.registerTool(
    "discord_invite",
    {
      description: "List, inspect, create, or delete guild invites with scoped channel verification.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list_channel", "list_guild", "get", "create", "delete"]),
        channelId: Snowflake.optional(),
        code: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/).optional(),
        body: JsonObject.optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, code, body, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list_guild") return jsonResult(await client.request("GET", `/guilds/${guildId}/invites`));
      if (action === "list_channel" || action === "create") {
        const selectedChannel = required(channelId, "channelId");
        await client.assertChannelGuild(selectedChannel, guildId);
        if (action === "list_channel") return jsonResult(await client.request("GET", `/channels/${selectedChannel}/invites`));
        return runWrite(client, { method: "POST", route: `/channels/${selectedChannel}/invites`, operation: "create invite", body: body ?? {}, reason, dryRun });
      }
      const selectedCode = required(code, "code");
      await client.assertScopedRoute(guildId, `/invites/${selectedCode}`);
      if (action === "get") return jsonResult(await client.request("GET", `/invites/${selectedCode}`));
      const expected = `DELETE INVITE ${selectedCode}`;
      return runWrite(client, { method: "DELETE", route: `/invites/${selectedCode}`, operation: "delete invite", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_scheduled_event",
    {
      description: "List and manage guild scheduled events, including subscriber lookup.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "get", "create", "modify", "delete", "list_users"]),
        eventId: Snowflake.optional(),
        body: JsonObject.optional(),
        withUserCount: z.boolean().default(true),
        limit: z.number().int().min(1).max(100).default(100),
        before: Snowflake.optional(),
        after: Snowflake.optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, eventId, body, withUserCount, limit, before, after, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const root = `/guilds/${guildId}/scheduled-events`;
      if (action === "list") return jsonResult(await client.request("GET", `${root}${queryString({ with_user_count: withUserCount })}`));
      if (action === "create") return runWrite(client, { method: "POST", route: root, operation: "create scheduled event", body: required(body, "body"), reason, dryRun });
      const selectedEvent = required(eventId, "eventId");
      const route = `${root}/${selectedEvent}`;
      if (action === "get") return jsonResult(await client.request("GET", `${route}${queryString({ with_user_count: withUserCount })}`));
      if (action === "list_users") return jsonResult(await client.request("GET", `${route}/users${queryString({ limit, before, after, with_member: true })}`));
      if (action === "modify") return runWrite(client, { method: "PATCH", route, operation: "modify scheduled event", body: required(body, "body"), reason, dryRun });
      const expected = `DELETE SCHEDULED EVENT ${selectedEvent}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete scheduled event", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_forum_thread",
    {
      description: "Create and manage forum posts and text-channel threads, all archive types, and thread membership.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum([
          "list_active",
          "list_archived",
          "list_archived_private",
          "list_joined_private",
          "create",
          "create_from_message",
          "modify",
          "delete",
          "get_member",
          "list_members",
          "join",
          "leave",
          "add_member",
          "remove_member"
        ]),
        forumId: Snowflake.optional(),
        threadId: Snowflake.optional(),
        messageId: Snowflake.optional(),
        userId: Snowflake.optional(),
        body: JsonObject.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        before: z.string().max(100).optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, forumId, threadId, messageId, userId, body, limit, before, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list_active") return jsonResult(await client.request("GET", `/guilds/${guildId}/threads/active`));
      if (["list_archived", "list_archived_private", "list_joined_private", "create", "create_from_message"].includes(action)) {
        const selectedParent = required(forumId, "forumId");
        await client.assertChannelGuild(selectedParent, guildId);
        if (action === "list_archived") return jsonResult(await client.request("GET", `/channels/${selectedParent}/threads/archived/public${queryString({ limit, before })}`));
        if (action === "list_archived_private") return jsonResult(await client.request("GET", `/channels/${selectedParent}/threads/archived/private${queryString({ limit, before })}`));
        if (action === "list_joined_private") return jsonResult(await client.request("GET", `/channels/${selectedParent}/users/@me/threads/archived/private${queryString({ limit, before })}`));
        const route = action === "create_from_message"
          ? `/channels/${selectedParent}/messages/${required(messageId, "messageId")}/threads`
          : `/channels/${selectedParent}/threads`;
        return runWrite(client, { method: "POST", route, operation: action === "create" ? "create thread or forum post" : "create thread from message", body: required(body, "body"), reason, dryRun });
      }
      const selectedThread = required(threadId, "threadId");
      await client.assertChannelGuild(selectedThread, guildId);
      const memberRoot = `/channels/${selectedThread}/thread-members`;
      if (action === "list_members") return jsonResult(await client.request("GET", `${memberRoot}${queryString({ with_member: true, limit })}`));
      if (action === "join") return runWrite(client, { method: "PUT", route: `${memberRoot}/@me`, operation: "join thread", dryRun });
      if (action === "leave") return runWrite(client, { method: "DELETE", route: `${memberRoot}/@me`, operation: "leave thread", dryRun });
      if (action === "modify") return runWrite(client, { method: "PATCH", route: `/channels/${selectedThread}`, operation: "modify forum post", body: required(body, "body"), reason, dryRun });
      if (action === "delete") {
        const expected = `DELETE FORUM POST ${selectedThread}`;
        return runWrite(client, { method: "DELETE", route: `/channels/${selectedThread}`, operation: "delete forum post", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      const selectedUser = required(userId, "userId");
      const memberRoute = `${memberRoot}/${selectedUser}`;
      if (action === "get_member") return jsonResult(await client.request("GET", `${memberRoute}?with_member=true`));
      if (action === "add_member") return runWrite(client, { method: "PUT", route: memberRoute, operation: "add thread member", dryRun });
      const expected = `REMOVE THREAD MEMBER ${selectedThread}/${selectedUser}`;
      return runWrite(client, { method: "DELETE", route: memberRoute, operation: "remove thread member", dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_voice_member",
    {
      description: "Inspect or change a guild member's voice placement, server mute, or server deaf state.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "move", "disconnect", "set_mute", "set_deaf"]),
        userId: Snowflake,
        targetChannelId: Snowflake.optional(),
        enabled: z.boolean().optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, userId, targetChannelId, enabled, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "get") return jsonResult(await client.request("GET", `/guilds/${guildId}/voice-states/${userId}`));
      let body: Record<string, unknown>;
      if (action === "move") {
        const channel = required(targetChannelId, "targetChannelId");
        await client.assertChannelGuild(channel, guildId);
        body = { channel_id: channel };
      } else if (action === "disconnect") {
        body = { channel_id: null };
      } else if (action === "set_mute") {
        body = { mute: required(enabled, "enabled") };
      } else {
        body = { deaf: required(enabled, "enabled") };
      }
      const destructive = action === "disconnect";
      const expected = destructive ? `DISCONNECT MEMBER ${userId}` : undefined;
      return runWrite(client, {
        method: "PATCH",
        route: `/guilds/${guildId}/members/${userId}`,
        operation: `${action} voice member`,
        body,
        reason,
        dryRun,
        destructive,
        confirm,
        expectedConfirmation: expected
      });
    }
  );

  server.registerTool(
    "discord_permission_overwrite",
    {
      description: "List, upsert, or delete a channel permission overwrite using named Discord permissions.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "upsert", "delete"]),
        channelId: Snowflake,
        targetId: Snowflake.optional(),
        targetType: z.enum(["role", "member"]).optional(),
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, targetId, targetType, allow, deny, reason, confirm, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      if (action === "list") {
        const channel = await client.request<Record<string, unknown>>("GET", `/channels/${channelId}`);
        return jsonResult({ channelId, permissionOverwrites: channel.permission_overwrites ?? [] });
      }
      const selectedTarget = required(targetId, "targetId");
      const route = `/channels/${channelId}/permissions/${selectedTarget}`;
      if (action === "upsert") {
        return runWrite(client, {
          method: "PUT",
          route,
          operation: "upsert permission overwrite",
          body: { type: required(targetType, "targetType") === "role" ? 0 : 1, allow: permissionBits(allow), deny: permissionBits(deny) },
          reason,
          dryRun
        });
      }
      const expected = `DELETE CHANNEL PERMISSION ${channelId}/${selectedTarget}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete permission overwrite", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );
}
