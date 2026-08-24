import type { RawFile } from "@discordjs/rest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { changeDigest } from "./confirmation.js";
import type { DiscordClient } from "./discord.js";
import { jsonResult } from "./results.js";

const Snowflake = z.string().regex(/^\d{17,20}$/);
const JsonObject = z.record(z.string(), z.unknown());
const DryRun = z.boolean().default(true);
type Method = "POST" | "PUT" | "PATCH" | "DELETE";

interface WriteInput {
  method: Method;
  route: string;
  operation: string;
  dryRun: boolean;
  body?: unknown;
  files?: RawFile[];
  appendToFormData?: boolean;
  reason?: string;
  destructive?: boolean;
  confirm?: string;
  expectedConfirmation?: string;
}

async function runWrite(client: DiscordClient, input: WriteInput) {
  if (input.dryRun) {
    const expectedConfirmation = input.expectedConfirmation === undefined
      ? undefined
      : client.policy.issueConfirmation(input.expectedConfirmation);
    return jsonResult({
      dryRun: true,
      method: input.method,
      route: input.route,
      ...(input.body === undefined ? {} : { body: redactDataUris(input.body) }),
      ...(input.files === undefined ? {} : {
        files: input.files.map((file) => ({ name: file.name, contentType: file.contentType, byteLength: byteLength(file.data) }))
      }),
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
    ...(input.files === undefined ? {} : { files: input.files }),
    ...(input.appendToFormData === undefined ? {} : { appendToFormData: input.appendToFormData }),
    ...(input.reason === undefined ? {} : { reason: input.reason })
  }));
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required for this action.`);
  return value;
}

function nonEmptyBody(body: Record<string, unknown>, action: string): Record<string, unknown> {
  if (Object.keys(body).length === 0) throw new Error(`${action} requires at least one field to change.`);
  return body;
}

function byteLength(data: RawFile["data"]): number | undefined {
  if (typeof data === "string") return Buffer.byteLength(data);
  if (typeof data === "boolean" || typeof data === "number") return undefined;
  return data.byteLength;
}

export function parseDataUri(value: string, allowedMimeTypes: readonly string[], maxBytes: number) {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match?.[1] || !match[2] || !allowedMimeTypes.includes(match[1])) {
    throw new Error(`Expected a base64 data URI with one of: ${allowedMimeTypes.join(", ")}.`);
  }
  const data = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  if (data.byteLength === 0 || data.byteLength > maxBytes) {
    throw new Error(`Decoded file must be between 1 and ${maxBytes} bytes.`);
  }
  return { mimeType: match[1], data };
}

export function redactDataUris(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDataUris);
  if (typeof value === "string" && value.startsWith("data:")) {
    const separator = value.indexOf(";");
    return `<data-uri:${separator > 5 ? value.slice(5, separator) : "unknown"}>`;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDataUris(item)]));
}

export function buildPollMessageBody(input: {
  question: string;
  answers: string[];
  durationHours: number;
  allowMultiselect: boolean;
  content?: string;
}) {
  return {
    ...(input.content === undefined ? {} : { content: input.content }),
    poll: {
      question: { text: input.question },
      answers: input.answers.map((answer) => ({ poll_media: { text: answer } })),
      duration: input.durationHours,
      allow_multiselect: input.allowMultiselect,
      layout_type: 1
    }
  };
}

export function buildMessageSearchQuery(input: {
  content?: string;
  channelIds?: string[];
  authorIds?: string[];
  mentions?: string[];
  roleIds?: string[];
  has?: string[];
  authorTypes?: string[];
  embedTypes?: string[];
  limit: number;
  offset: number;
  minId?: string;
  maxId?: string;
  sortBy: string;
  sortOrder: string;
  includeNsfw: boolean;
}): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value !== undefined) params.set(key, String(value));
  };
  const append = (key: string, values: string[] | undefined) => values?.forEach((value) => params.append(key, value));
  set("content", input.content);
  append("channel_id", input.channelIds);
  append("author_id", input.authorIds);
  append("mentions", input.mentions);
  append("mentions_role_id", input.roleIds);
  append("has", input.has);
  append("author_type", input.authorTypes);
  append("embed_type", input.embedTypes);
  set("limit", input.limit);
  set("offset", input.offset);
  set("min_id", input.minId);
  set("max_id", input.maxId);
  set("sort_by", input.sortBy);
  set("sort_order", input.sortOrder);
  set("include_nsfw", input.includeNsfw);
  return params.toString();
}

export function registerExtraTools(args: { server: McpServer; client: DiscordClient }) {
  const { server, client } = args;

  server.registerTool(
    "discord_stage_instance",
    {
      description: "Read, start, update, or end the live Stage instance associated with an allowed guild channel.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get", "create", "modify", "delete"]),
        channelId: Snowflake,
        topic: z.string().trim().min(1).max(120).optional(),
        privacyLevel: z.literal(2).optional(),
        sendStartNotification: z.boolean().optional(),
        scheduledEventId: Snowflake.optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, topic, privacyLevel, sendStartNotification, scheduledEventId, reason, confirm, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      const route = `/stage-instances/${channelId}`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      if (action === "create") {
        if (scheduledEventId !== undefined) {
          await client.request("GET", `/guilds/${guildId}/scheduled-events/${scheduledEventId}`);
        }
        return runWrite(client, {
          method: "POST",
          route: "/stage-instances",
          operation: "create stage instance",
          body: {
            channel_id: channelId,
            topic: required(topic, "topic"),
            privacy_level: privacyLevel ?? 2,
            ...(sendStartNotification === undefined ? {} : { send_start_notification: sendStartNotification }),
            ...(scheduledEventId === undefined ? {} : { guild_scheduled_event_id: scheduledEventId })
          },
          reason,
          dryRun
        });
      }
      if (action === "modify") {
        return runWrite(client, {
          method: "PATCH",
          route,
          operation: "modify stage instance",
          body: nonEmptyBody({
            ...(topic === undefined ? {} : { topic }),
            ...(privacyLevel === undefined ? {} : { privacy_level: privacyLevel })
          }, "modify"),
          reason,
          dryRun
        });
      }
      const expected = `DELETE STAGE INSTANCE ${channelId}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete stage instance", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_soundboard",
    {
      description: "List, create, edit, delete, or play Discord soundboard sounds with file-size validation.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list_default", "list_guild", "get", "create", "modify", "delete", "send"]),
        soundId: Snowflake.optional(),
        channelId: Snowflake.optional(),
        sourceGuildId: Snowflake.optional(),
        name: z.string().trim().min(2).max(32).optional(),
        soundDataUri: z.string().max(750_000).optional(),
        volume: z.number().min(0).max(1).nullable().optional(),
        emojiId: Snowflake.nullable().optional(),
        emojiName: z.string().max(100).nullable().optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, soundId, channelId, sourceGuildId, name, soundDataUri, volume, emojiId, emojiName, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "list_default") return jsonResult(await client.request("GET", "/soundboard-default-sounds"));
      const root = `/guilds/${guildId}/soundboard-sounds`;
      if (action === "list_guild") return jsonResult(await client.request("GET", root));
      if (action === "create") {
        if (emojiId != null && emojiName != null) {
          throw new Error("Provide only one of emojiId or emojiName.");
        }
        const sound = required(soundDataUri, "soundDataUri");
        parseDataUri(sound, ["audio/mpeg", "audio/ogg"], 512 * 1024);
        return runWrite(client, {
          method: "POST",
          route: root,
          operation: "create soundboard sound",
          body: {
            name: required(name, "name"),
            sound,
            ...(volume === undefined ? {} : { volume }),
            ...(emojiId === undefined ? {} : { emoji_id: emojiId }),
            ...(emojiName === undefined ? {} : { emoji_name: emojiName })
          },
          reason,
          dryRun
        });
      }
      if (action === "send") {
        const selectedChannel = required(channelId, "channelId");
        await client.assertChannelGuild(selectedChannel, guildId);
        if (sourceGuildId !== undefined) client.policy.assertGuild(sourceGuildId);
        return runWrite(client, {
          method: "POST",
          route: `/channels/${selectedChannel}/send-soundboard-sound`,
          operation: "send soundboard sound",
          body: { sound_id: required(soundId, "soundId"), ...(sourceGuildId === undefined ? {} : { source_guild_id: sourceGuildId }) },
          dryRun
        });
      }
      const selectedSound = required(soundId, "soundId");
      const route = `${root}/${selectedSound}`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      if (action === "modify") {
        if (emojiId != null && emojiName != null) {
          throw new Error("Provide only one of emojiId or emojiName.");
        }
        return runWrite(client, {
          method: "PATCH",
          route,
          operation: "modify soundboard sound",
          body: nonEmptyBody({
            ...(name === undefined ? {} : { name }),
            ...(volume === undefined ? {} : { volume }),
            ...(emojiId === undefined ? {} : { emoji_id: emojiId }),
            ...(emojiName === undefined ? {} : { emoji_name: emojiName })
          }, "modify"),
          reason,
          dryRun
        });
      }
      const expected = `DELETE SOUNDBOARD SOUND ${selectedSound}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete soundboard sound", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_sticker",
    {
      description: "List, inspect, create, edit, or delete guild stickers, including validated multipart uploads.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "get", "create", "modify", "delete"]),
        stickerId: Snowflake.optional(),
        name: z.string().trim().min(2).max(30).optional(),
        description: z.string().max(100).nullable().optional(),
        tags: z.string().trim().min(1).max(200).optional(),
        fileDataUri: z.string().max(750_000).optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, stickerId, name, description, tags, fileDataUri, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const root = `/guilds/${guildId}/stickers`;
      if (action === "list") return jsonResult(await client.request("GET", root));
      if (action === "create") {
        const parsed = parseDataUri(required(fileDataUri, "fileDataUri"), ["image/png", "image/apng", "application/json"], 512 * 1024);
        const extension = parsed.mimeType === "application/json" ? "json" : parsed.mimeType === "image/apng" ? "apng" : "png";
        return runWrite(client, {
          method: "POST",
          route: root,
          operation: "create guild sticker",
          body: { name: required(name, "name"), description: description ?? "", tags: required(tags, "tags") },
          files: [{ data: parsed.data, name: `sticker.${extension}`, contentType: parsed.mimeType }],
          appendToFormData: true,
          reason,
          dryRun
        });
      }
      const selectedSticker = required(stickerId, "stickerId");
      const route = `${root}/${selectedSticker}`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      if (action === "modify") {
        return runWrite(client, {
          method: "PATCH",
          route,
          operation: "modify guild sticker",
          body: nonEmptyBody({
            ...(name === undefined ? {} : { name }),
            ...(description === undefined ? {} : { description }),
            ...(tags === undefined ? {} : { tags })
          }, "modify"),
          reason,
          dryRun
        });
      }
      const expected = `DELETE GUILD STICKER ${selectedSticker}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete guild sticker", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_poll",
    {
      description: "Create a poll, list voters for one answer, or end a bot-authored poll early.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["create", "list_voters", "end"]),
        channelId: Snowflake,
        messageId: Snowflake.optional(),
        answerId: z.number().int().min(1).optional(),
        question: z.string().trim().min(1).max(300).optional(),
        answers: z.array(z.string().trim().min(1).max(55)).min(2).max(10).optional(),
        durationHours: z.number().int().min(1).max(768).default(24),
        allowMultiselect: z.boolean().default(false),
        content: z.string().max(2000).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        after: Snowflake.optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, channelId, messageId, answerId, question, answers, durationHours, allowMultiselect, content, limit, after, confirm, dryRun }) => {
      await client.assertChannelGuild(channelId, guildId);
      if (action === "create") {
        return runWrite(client, {
          method: "POST",
          route: `/channels/${channelId}/messages`,
          operation: "create poll",
          body: buildPollMessageBody({ question: required(question, "question"), answers: required(answers, "answers"), durationHours, allowMultiselect, ...(content === undefined ? {} : { content }) }),
          dryRun
        });
      }
      const selectedMessage = required(messageId, "messageId");
      if (action === "list_voters") {
        const params = new URLSearchParams({ limit: String(limit) });
        if (after !== undefined) params.set("after", after);
        return jsonResult(await client.request("GET", `/channels/${channelId}/polls/${selectedMessage}/answers/${required(answerId, "answerId")}?${params}`));
      }
      const expected = `END POLL ${channelId}/${selectedMessage}`;
      return runWrite(client, { method: "POST", route: `/channels/${channelId}/polls/${selectedMessage}/expire`, operation: "end poll", dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_message_search",
    {
      description: "Search indexed messages in an allowed guild. Requires the privileged Message Content intent.",
      inputSchema: {
        guildId: Snowflake,
        content: z.string().max(1024).optional(),
        channelIds: z.array(Snowflake).max(500).optional(),
        authorIds: z.array(Snowflake).max(100).optional(),
        mentions: z.array(Snowflake).max(100).optional(),
        roleIds: z.array(Snowflake).max(100).optional(),
        has: z.array(z.enum(["image", "sound", "video", "file", "sticker", "embed", "link", "poll", "snapshot"])).max(9).optional(),
        authorTypes: z.array(z.enum(["user", "bot", "webhook", "-user", "-bot", "-webhook"])).max(6).optional(),
        embedTypes: z.array(z.enum(["image", "video", "gif", "sound", "article"])).max(5).optional(),
        limit: z.number().int().min(1).max(25).default(25),
        offset: z.number().int().min(0).max(9975).default(0),
        minId: Snowflake.optional(),
        maxId: Snowflake.optional(),
        sortBy: z.enum(["timestamp", "relevance"]).default("timestamp"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        includeNsfw: z.boolean().default(false)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ guildId, content, channelIds, authorIds, mentions, roleIds, has, authorTypes, embedTypes, limit, offset, minId, maxId, sortBy, sortOrder, includeNsfw }) => {
      client.policy.assertGuild(guildId);
      for (const channelId of channelIds ?? []) await client.assertChannelGuild(channelId, guildId);
      if ([content, channelIds?.length, authorIds?.length, mentions?.length, roleIds?.length, has?.length, authorTypes?.length, embedTypes?.length].every((value) => !value)) {
        throw new Error("Search requires at least one content, channel, author, mention, role, or has filter.");
      }
      const query = buildMessageSearchQuery({
        ...(content === undefined ? {} : { content }),
        ...(channelIds === undefined ? {} : { channelIds }),
        ...(authorIds === undefined ? {} : { authorIds }),
        ...(mentions === undefined ? {} : { mentions }),
        ...(roleIds === undefined ? {} : { roleIds }),
        ...(has === undefined ? {} : { has }),
        ...(authorTypes === undefined ? {} : { authorTypes }),
        ...(embedTypes === undefined ? {} : { embedTypes }),
        limit,
        offset,
        ...(minId === undefined ? {} : { minId }),
        ...(maxId === undefined ? {} : { maxId }),
        sortBy,
        sortOrder,
        includeNsfw
      });
      return jsonResult(await client.request("GET", `/guilds/${guildId}/messages/search?${query}`));
    }
  );

  server.registerTool(
    "discord_guild_template",
    {
      description: "List, inspect, create, sync, edit, or delete guild templates without creating a new guild.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["list", "get", "create", "sync", "modify", "delete"]),
        code: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/).optional(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(120).nullable().optional(),
        reason: z.string().max(400).optional(),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, code, name, description, reason, confirm, dryRun }) => {
      client.policy.assertGuild(guildId);
      const root = `/guilds/${guildId}/templates`;
      if (action === "list") return jsonResult(await client.request("GET", root));
      if (action === "get") {
        const template = await client.request<{ source_guild_id?: string }>("GET", `/guilds/templates/${required(code, "code")}`);
        if (template.source_guild_id !== guildId) throw new Error("Template does not belong to the selected guild.");
        return jsonResult(template);
      }
      if (action === "create") {
        return runWrite(client, { method: "POST", route: root, operation: "create guild template", body: { name: required(name, "name"), ...(description === undefined ? {} : { description }) }, reason, dryRun });
      }
      const selectedCode = required(code, "code");
      const route = `${root}/${selectedCode}`;
      if (action === "sync") return runWrite(client, { method: "PUT", route, operation: "sync guild template", reason, dryRun });
      if (action === "modify") {
        return runWrite(client, { method: "PATCH", route, operation: "modify guild template", body: nonEmptyBody({ ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) }, "modify"), reason, dryRun });
      }
      const expected = `DELETE GUILD TEMPLATE ${selectedCode}`;
      return runWrite(client, { method: "DELETE", route, operation: "delete guild template", reason, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_application_command",
    {
      description: "List and manage this application's guild-scoped or global slash, user, and message commands.",
      inputSchema: {
        scope: z.enum(["guild", "global"]).default("guild"),
        guildId: Snowflake.optional(),
        action: z.enum(["list", "get", "upsert", "modify", "delete", "bulk_overwrite"]),
        commandId: Snowflake.optional(),
        body: JsonObject.optional(),
        commands: z.array(JsonObject).max(200).optional(),
        withLocalizations: z.boolean().default(false),
        confirm: z.string().optional(),
        dryRun: DryRun
      }
    },
    async ({ scope, guildId, action, commandId, body, commands, withLocalizations, confirm, dryRun }) => {
      const application = await client.request<{ id: string }>("GET", "/oauth2/applications/@me");
      const selectedGuild = scope === "guild" ? required(guildId, "guildId") : undefined;
      if (selectedGuild !== undefined) client.policy.assertGuild(selectedGuild);
      const root = selectedGuild === undefined
        ? `/applications/${application.id}/commands`
        : `/applications/${application.id}/guilds/${selectedGuild}/commands`;
      const scopeLabel = selectedGuild === undefined ? "global" : "guild";
      if (action === "list") return jsonResult(await client.request("GET", `${root}?with_localizations=${withLocalizations}`));
      if (action === "upsert") return runWrite(client, { method: "POST", route: root, operation: `upsert ${scopeLabel} command`, body: required(body, "body"), dryRun });
      if (action === "bulk_overwrite") {
        const selectedCommands = required(commands, "commands");
        const expected = `${selectedGuild === undefined ? "OVERWRITE GLOBAL COMMANDS" : `OVERWRITE GUILD COMMANDS ${selectedGuild}`} ${changeDigest(selectedCommands)}`;
        return runWrite(client, { method: "PUT", route: root, operation: `bulk overwrite ${scopeLabel} commands`, body: selectedCommands, dryRun, destructive: true, confirm, expectedConfirmation: expected });
      }
      const selectedCommand = required(commandId, "commandId");
      const route = `${root}/${selectedCommand}`;
      if (action === "get") return jsonResult(await client.request("GET", route));
      if (action === "modify") return runWrite(client, { method: "PATCH", route, operation: `modify ${scopeLabel} command`, body: required(body, "body"), dryRun });
      const expected = `DELETE ${scopeLabel.toUpperCase()} COMMAND ${selectedCommand}`;
      return runWrite(client, { method: "DELETE", route, operation: `delete ${scopeLabel} command`, dryRun, destructive: true, confirm, expectedConfirmation: expected });
    }
  );

  server.registerTool(
    "discord_widget",
    {
      description: "Read or modify the public guild widget and return a widget image URL without downloading binary data.",
      inputSchema: {
        guildId: Snowflake,
        action: z.enum(["get_settings", "get_widget", "modify_settings", "image_url"]),
        enabled: z.boolean().optional(),
        channelId: Snowflake.nullable().optional(),
        style: z.enum(["shield", "banner1", "banner2", "banner3", "banner4"]).default("shield"),
        reason: z.string().max(400).optional(),
        dryRun: DryRun
      }
    },
    async ({ guildId, action, enabled, channelId, style, reason, dryRun }) => {
      client.policy.assertGuild(guildId);
      if (action === "get_settings") return jsonResult(await client.request("GET", `/guilds/${guildId}/widget`));
      if (action === "get_widget") return jsonResult(await client.request("GET", `/guilds/${guildId}/widget.json`));
      if (action === "image_url") return jsonResult({ url: `https://discord.com/api/guilds/${guildId}/widget.png?style=${style}` });
      if (typeof channelId === "string") await client.assertChannelGuild(channelId, guildId);
      return runWrite(client, {
        method: "PATCH",
        route: `/guilds/${guildId}/widget`,
        operation: "modify guild widget",
        body: nonEmptyBody({ ...(enabled === undefined ? {} : { enabled }), ...(channelId === undefined ? {} : { channel_id: channelId }) }, "modify_settings"),
        reason,
        dryRun
      });
    }
  );
}
