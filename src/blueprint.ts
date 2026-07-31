import { ChannelFlags, ChannelType } from "discord-api-types/v10";
import { z } from "zod";

import type { DiscordClient } from "./discord.js";
import { permissionBits } from "./permissions.js";
import type { GuildState, StateStore } from "./state.js";

const SnowflakeSchema = z.string().regex(/^\d{17,20}$/);

const PermissionOverwriteSchema = z.object({
  target: z.string().min(1),
  type: z.enum(["role", "member"]).default("role"),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([])
});

const ForumTagSchema = z.object({
  name: z.string().min(1).max(20),
  moderated: z.boolean().default(false),
  emojiId: SnowflakeSchema.nullable().optional(),
  emojiName: z.string().nullable().optional()
});

const BlueprintMessageSchema = z.object({
  key: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
  pin: z.boolean().default(false)
});

const RoleBlueprintSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  color: z.number().int().min(0).max(0xffffff).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.array(z.string()).optional()
});

const CategoryBlueprintSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  position: z.number().int().min(0).optional(),
  overwrites: z.array(PermissionOverwriteSchema).optional()
});

export const BlueprintChannelTypeSchema = z.enum([
  "text",
  "announcement",
  "voice",
  "stage",
  "forum",
  "media"
]);

const ChannelBlueprintSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  type: BlueprintChannelTypeSchema,
  categoryKey: z.string().optional(),
  topic: z.string().max(4096).optional(),
  position: z.number().int().min(0).optional(),
  nsfw: z.boolean().optional(),
  slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
  bitrate: z.number().int().min(8000).optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
  forumTags: z.array(ForumTagSchema).max(20).optional(),
  defaultSortOrder: z.enum(["latest_activity", "creation_date"]).optional(),
  defaultForumLayout: z.enum(["not_set", "list", "gallery"]).optional(),
  requireTag: z.boolean().optional(),
  overwrites: z.array(PermissionOverwriteSchema).optional(),
  messages: z.array(BlueprintMessageSchema).optional()
});

const GuildBlueprintSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(120).nullable().optional(),
  preferredLocale: z.string().optional(),
  verificationLevel: z.number().int().min(0).max(4).optional(),
  defaultMessageNotifications: z.number().int().min(0).max(1).optional(),
  explicitContentFilter: z.number().int().min(0).max(2).optional(),
  rulesChannelKey: z.string().optional(),
  publicUpdatesChannelKey: z.string().optional(),
  safetyAlertsChannelKey: z.string().optional()
});

export const ServerBlueprintSchema = z.object({
  version: z.literal(1),
  guild: GuildBlueprintSchema.optional(),
  roles: z.array(RoleBlueprintSchema).default([]),
  categories: z.array(CategoryBlueprintSchema).default([]),
  channels: z.array(ChannelBlueprintSchema).default([])
});

export type ServerBlueprint = z.infer<typeof ServerBlueprintSchema>;
type RoleBlueprint = z.infer<typeof RoleBlueprintSchema>;
type CategoryBlueprint = z.infer<typeof CategoryBlueprintSchema>;
type ChannelBlueprint = z.infer<typeof ChannelBlueprintSchema>;
type PermissionOverwrite = z.infer<typeof PermissionOverwriteSchema>;

interface SnapshotRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
}

interface SnapshotChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  position?: number;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  bitrate?: number;
  user_limit?: number;
}

export interface GuildSnapshot {
  guild: Record<string, unknown> & { id: string; name: string };
  roles: SnapshotRole[];
  channels: SnapshotChannel[];
}

export interface BlueprintAction {
  action: "create" | "update" | "send" | "modify";
  resource: "guild" | "role" | "category" | "channel" | "message";
  key: string;
  id?: string;
  changes?: Record<string, unknown>;
}

const channelTypes: Record<z.infer<typeof BlueprintChannelTypeSchema>, number> = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia
};

function roleBody(role: RoleBlueprint): Record<string, unknown> {
  return withoutUndefined({
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions ? permissionBits(role.permissions) : undefined
  });
}

function roleDiff(role: RoleBlueprint, existing: SnapshotRole): Record<string, unknown> {
  const desired = roleBody(role);
  return changedFields(desired, existing as unknown as Record<string, unknown>);
}

function channelDiff(channel: ChannelBlueprint | CategoryBlueprint, existing: SnapshotChannel): Record<string, unknown> {
  const desired = withoutUndefined({
    name: channel.name,
    position: channel.position,
    ...(isChannel(channel)
      ? {
          topic: channel.topic,
          nsfw: channel.nsfw,
          rate_limit_per_user: channel.slowmodeSeconds,
          bitrate: channel.bitrate,
          user_limit: channel.userLimit
        }
      : {})
  });
  return changedFields(desired, existing as unknown as Record<string, unknown>);
}

function isChannel(value: ChannelBlueprint | CategoryBlueprint): value is ChannelBlueprint {
  return "type" in value;
}

function changedFields(
  desired: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(desired).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(existing[key])
    )
  );
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function byTrackedOrName<T extends { id: string; name: string }>(
  values: readonly T[],
  trackedId: string | undefined,
  name: string,
  predicate: (value: T) => boolean = () => true
): T | undefined {
  return values.find((value) => value.id === trackedId && predicate(value)) ?? values.find((value) => value.name === name && predicate(value));
}

export function planBlueprint(
  blueprintInput: unknown,
  snapshot: GuildSnapshot,
  state: GuildState
): { blueprint: ServerBlueprint; actions: BlueprintAction[] } {
  const blueprint = ServerBlueprintSchema.parse(blueprintInput);
  const actions: BlueprintAction[] = [];

  if (blueprint.guild && Object.keys(blueprint.guild).length > 0) {
    actions.push({ action: "modify", resource: "guild", key: snapshot.guild.id });
  }

  for (const role of blueprint.roles) {
    const existing = byTrackedOrName(snapshot.roles, state.roles[role.key], role.name);
    if (!existing) {
      actions.push({ action: "create", resource: "role", key: role.key, changes: roleBody(role) });
      continue;
    }
    const changes = roleDiff(role, existing);
    if (Object.keys(changes).length > 0) {
      actions.push({ action: "update", resource: "role", key: role.key, id: existing.id, changes });
    }
  }

  for (const category of blueprint.categories) {
    const existing = byTrackedOrName(
      snapshot.channels,
      state.channels[category.key],
      category.name,
      (channel) => channel.type === ChannelType.GuildCategory
    );
    if (!existing) {
      actions.push({ action: "create", resource: "category", key: category.key });
      continue;
    }
    const changes = channelDiff(category, existing);
    if (Object.keys(changes).length > 0) {
      actions.push({ action: "update", resource: "category", key: category.key, id: existing.id, changes });
    }
  }

  for (const channel of blueprint.channels) {
    const type = channelTypes[channel.type];
    const existing = byTrackedOrName(
      snapshot.channels,
      state.channels[channel.key],
      channel.name,
      (candidate) => candidate.type === type
    );
    if (!existing) {
      actions.push({ action: "create", resource: "channel", key: channel.key });
    } else {
      const changes = channelDiff(channel, existing);
      if (Object.keys(changes).length > 0) {
        actions.push({ action: "update", resource: "channel", key: channel.key, id: existing.id, changes });
      }
    }

    for (const message of channel.messages ?? []) {
      if (!state.messages[message.key]) {
        actions.push({ action: "send", resource: "message", key: message.key });
      }
    }
  }

  return { blueprint, actions };
}

export async function fetchBlueprintSnapshot(client: DiscordClient, guildId: string): Promise<GuildSnapshot> {
  client.policy.assertGuild(guildId);
  const [guild, roles, channels] = await Promise.all([
    client.request<GuildSnapshot["guild"]>("GET", `/guilds/${guildId}?with_counts=true`),
    client.request<SnapshotRole[]>("GET", `/guilds/${guildId}/roles`),
    client.request<SnapshotChannel[]>("GET", `/guilds/${guildId}/channels`)
  ]);
  return { guild, roles, channels };
}

async function resolveOverwrites(
  overwrites: readonly PermissionOverwrite[] | undefined,
  guildId: string,
  state: GuildState
): Promise<Record<string, unknown>[] | undefined> {
  if (!overwrites) return undefined;
  return overwrites.map((overwrite) => {
    const id = overwrite.target === "@everyone"
      ? guildId
      : state.roles[overwrite.target] ?? overwrite.target;
    if (!/^\d{17,20}$/.test(id)) {
      throw new Error(`Permission target '${overwrite.target}' was not resolved to a role/member ID.`);
    }
    return {
      id,
      type: overwrite.type === "role" ? 0 : 1,
      allow: permissionBits(overwrite.allow),
      deny: permissionBits(overwrite.deny)
    };
  });
}

function forumTags(channel: ChannelBlueprint): Record<string, unknown>[] | undefined {
  return channel.forumTags?.map((tag) => withoutUndefined({
    name: tag.name,
    moderated: tag.moderated,
    emoji_id: tag.emojiId,
    emoji_name: tag.emojiName
  }));
}

function channelBody(channel: ChannelBlueprint, state: GuildState): Record<string, unknown> {
  return withoutUndefined({
    name: channel.name,
    type: channelTypes[channel.type],
    parent_id: channel.categoryKey ? state.channels[channel.categoryKey] : undefined,
    topic: channel.topic,
    position: channel.position,
    nsfw: channel.nsfw,
    rate_limit_per_user: channel.slowmodeSeconds,
    bitrate: channel.bitrate,
    user_limit: channel.userLimit,
    available_tags: forumTags(channel),
    default_sort_order: channel.defaultSortOrder === "latest_activity" ? 1 : channel.defaultSortOrder === "creation_date" ? 0 : undefined,
    default_forum_layout: channel.defaultForumLayout === "list" ? 1 : channel.defaultForumLayout === "gallery" ? 2 : channel.defaultForumLayout === "not_set" ? 0 : undefined,
    flags: channel.requireTag === undefined ? undefined : channel.requireTag ? ChannelFlags.RequireTag : 0
  });
}

export function renderMessageContent(content: string, state: GuildState): string {
  return content.replace(/\{\{channel:([a-zA-Z0-9_-]+)\}\}/g, (_match, key: string) => {
    const channelId = state.channels[key];
    if (!channelId) throw new Error(`Message references unresolved channel key '${key}'.`);
    return `<#${channelId}>`;
  });
}

export async function applyBlueprint(args: {
  client: DiscordClient;
  store: StateStore;
  guildId: string;
  blueprintInput: unknown;
  dryRun: boolean;
  reason?: string;
}) {
  const { client, store, guildId, dryRun, reason } = args;
  client.policy.assertGuild(guildId);
  const snapshot = await fetchBlueprintSnapshot(client, guildId);
  const guildState = store.guild(guildId);
  const { blueprint, actions } = planBlueprint(args.blueprintInput, snapshot, guildState);
  client.policy.assertBulkSize(actions.length);

  if (dryRun) return { dryRun: true, actionCount: actions.length, actions };
  client.policy.assertWrite({ operation: "apply blueprint" });

  for (const role of blueprint.roles) {
    const existing = byTrackedOrName(snapshot.roles, guildState.roles[role.key], role.name);
    const body = roleBody(role);
    const resolved = existing
      ? await client.request<SnapshotRole>("PATCH", `/guilds/${guildId}/roles/${existing.id}`, { body, reason })
      : await client.request<SnapshotRole>("POST", `/guilds/${guildId}/roles`, { body, reason });
    guildState.roles[role.key] = resolved.id;
  }

  for (const category of blueprint.categories) {
    const existing = byTrackedOrName(
      snapshot.channels,
      guildState.channels[category.key],
      category.name,
      (channel) => channel.type === ChannelType.GuildCategory
    );
    const body = withoutUndefined({
      name: category.name,
      type: ChannelType.GuildCategory,
      position: category.position,
      permission_overwrites: await resolveOverwrites(category.overwrites, guildId, guildState)
    });
    const resolved = existing
      ? await client.request<SnapshotChannel>("PATCH", `/channels/${existing.id}`, { body, reason })
      : await client.request<SnapshotChannel>("POST", `/guilds/${guildId}/channels`, { body, reason });
    guildState.channels[category.key] = resolved.id;
  }

  for (const channel of blueprint.channels) {
    const type = channelTypes[channel.type];
    const existing = byTrackedOrName(
      snapshot.channels,
      guildState.channels[channel.key],
      channel.name,
      (candidate) => candidate.type === type
    );
    const body = {
      ...channelBody(channel, guildState),
      permission_overwrites: await resolveOverwrites(channel.overwrites, guildId, guildState)
    };
    const resolved = existing
      ? await client.request<SnapshotChannel>("PATCH", `/channels/${existing.id}`, { body, reason })
      : await client.request<SnapshotChannel>("POST", `/guilds/${guildId}/channels`, { body, reason });
    guildState.channels[channel.key] = resolved.id;

    for (const message of channel.messages ?? []) {
      if (guildState.messages[message.key]) continue;
      const sent = await client.request<{ id: string }>("POST", `/channels/${resolved.id}/messages`, {
        body: { content: renderMessageContent(message.content, guildState) },
        reason
      });
      guildState.messages[message.key] = sent.id;
      if (message.pin) {
        await client.request("PUT", `/channels/${resolved.id}/pins/${sent.id}`, { reason });
      }
    }
  }

  if (blueprint.guild) {
    const guildBody = withoutUndefined({
      name: blueprint.guild.name,
      description: blueprint.guild.description,
      preferred_locale: blueprint.guild.preferredLocale,
      verification_level: blueprint.guild.verificationLevel,
      default_message_notifications: blueprint.guild.defaultMessageNotifications,
      explicit_content_filter: blueprint.guild.explicitContentFilter,
      rules_channel_id: blueprint.guild.rulesChannelKey ? guildState.channels[blueprint.guild.rulesChannelKey] : undefined,
      public_updates_channel_id: blueprint.guild.publicUpdatesChannelKey ? guildState.channels[blueprint.guild.publicUpdatesChannelKey] : undefined,
      safety_alerts_channel_id: blueprint.guild.safetyAlertsChannelKey ? guildState.channels[blueprint.guild.safetyAlertsChannelKey] : undefined
    });
    if (Object.keys(guildBody).length > 0) {
      await client.request("PATCH", `/guilds/${guildId}`, { body: guildBody, reason });
    }
  }

  await store.save();
  return { dryRun: false, actionCount: actions.length, actions, state: guildState };
}
