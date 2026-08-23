import { randomUUID } from "node:crypto";

import { ChannelFlags, ChannelType } from "discord-api-types/v10";
import { z } from "zod";

import { changeDigest } from "./confirmation.js";
import type { DiscordClient } from "./discord.js";
import { permissionBits } from "./permissions.js";
import type {
  BlueprintJournal,
  BlueprintJournalAttempt,
  GuildState,
  StateStore
} from "./state.js";

const SnowflakeSchema = z.string().regex(/^\d{17,20}$/);
const ResourceKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);

const PermissionOverwriteSchema = z.object({
  target: z.union([z.literal("@everyone"), SnowflakeSchema, ResourceKeySchema]),
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
  key: ResourceKeySchema,
  content: z.string().min(1).max(2000),
  pin: z.boolean().default(false)
});

const RoleBlueprintSchema = z.object({
  key: ResourceKeySchema,
  name: z.string().min(1).max(100),
  color: z.number().int().min(0).max(0xffffff).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.array(z.string()).optional()
});

const CategoryBlueprintSchema = z.object({
  key: ResourceKeySchema,
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
  key: ResourceKeySchema,
  name: z.string().min(1).max(100),
  type: BlueprintChannelTypeSchema,
  categoryKey: ResourceKeySchema.optional(),
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
  rulesChannelKey: ResourceKeySchema.optional(),
  publicUpdatesChannelKey: ResourceKeySchema.optional(),
  safetyAlertsChannelKey: ResourceKeySchema.optional()
});

export const ServerBlueprintSchema = z.object({
  version: z.literal(1),
  guild: GuildBlueprintSchema.optional(),
  roles: z.array(RoleBlueprintSchema).default([]),
  categories: z.array(CategoryBlueprintSchema).default([]),
  channels: z.array(ChannelBlueprintSchema).default([])
}).superRefine((blueprint, context) => {
  const assertUnique = (entries: Array<{ key: string }>, label: string, path: (string | number)[]) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate ${label} key '${entry.key}'.`,
          path: [...path, index, "key"]
        });
      }
      seen.add(entry.key);
    });
  };

  assertUnique(blueprint.roles, "role", ["roles"]);
  assertUnique([...blueprint.categories, ...blueprint.channels], "channel/category", ["channels"]);
  assertUnique(
    blueprint.channels.flatMap((channel) => channel.messages ?? []),
    "message",
    ["channels"]
  );
});

export type ServerBlueprint = z.infer<typeof ServerBlueprintSchema>;
type RoleBlueprint = z.infer<typeof RoleBlueprintSchema>;
type CategoryBlueprint = z.infer<typeof CategoryBlueprintSchema>;
type ChannelBlueprint = z.infer<typeof ChannelBlueprintSchema>;
type GuildBlueprint = z.infer<typeof GuildBlueprintSchema>;
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
  permission_overwrites?: Array<Record<string, unknown>>;
  available_tags?: Array<Record<string, unknown>>;
  default_sort_order?: number | null;
  default_forum_layout?: number;
  flags?: number;
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

function normalizeOverwrites(value: Array<Record<string, unknown>> | undefined) {
  return (value ?? []).map((overwrite) => ({
    id: String(overwrite.id),
    type: Number(overwrite.type),
    allow: String(overwrite.allow ?? "0"),
    deny: String(overwrite.deny ?? "0")
  })).sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

function guildBodyForPlan(guild: GuildBlueprint, state: GuildState): Record<string, unknown> {
  const plannedChannel = (key: string | undefined) => key === undefined
    ? undefined
    : state.channels[key] ?? `unresolved:${key}`;
  return withoutUndefined({
    name: guild.name,
    description: guild.description,
    preferred_locale: guild.preferredLocale,
    verification_level: guild.verificationLevel,
    default_message_notifications: guild.defaultMessageNotifications,
    explicit_content_filter: guild.explicitContentFilter,
    rules_channel_id: plannedChannel(guild.rulesChannelKey),
    public_updates_channel_id: plannedChannel(guild.publicUpdatesChannelKey),
    safety_alerts_channel_id: plannedChannel(guild.safetyAlertsChannelKey)
  });
}

function guildBodyForApply(guild: GuildBlueprint, state: GuildState): Record<string, unknown> {
  const resolvedChannel = (key: string | undefined) => {
    if (key === undefined) return undefined;
    const id = state.channels[key];
    if (id === undefined) throw new Error(`Guild setting references unresolved channel key '${key}'.`);
    return id;
  };
  return withoutUndefined({
    name: guild.name,
    description: guild.description,
    preferred_locale: guild.preferredLocale,
    verification_level: guild.verificationLevel,
    default_message_notifications: guild.defaultMessageNotifications,
    explicit_content_filter: guild.explicitContentFilter,
    rules_channel_id: resolvedChannel(guild.rulesChannelKey),
    public_updates_channel_id: resolvedChannel(guild.publicUpdatesChannelKey),
    safety_alerts_channel_id: resolvedChannel(guild.safetyAlertsChannelKey)
  });
}

function planOverwrites(
  overwrites: readonly PermissionOverwrite[] | undefined,
  guildId: string,
  state: GuildState
) {
  return overwrites?.map((overwrite) => ({
    id: overwrite.target === "@everyone"
      ? guildId
      : state.roles[overwrite.target] ?? (/^\d{17,20}$/.test(overwrite.target) ? overwrite.target : `unresolved:${overwrite.target}`),
    type: overwrite.type === "role" ? 0 : 1,
    allow: permissionBits(overwrite.allow),
    deny: permissionBits(overwrite.deny)
  }));
}

function normalizeForumTags(value: Array<Record<string, unknown>> | undefined) {
  return (value ?? []).map((tag) => ({
    name: tag.name,
    moderated: tag.moderated ?? false,
    emoji_id: tag.emoji_id ?? null,
    emoji_name: tag.emoji_name ?? null
  }));
}

function channelDiff(
  channel: ChannelBlueprint | CategoryBlueprint,
  existing: SnapshotChannel,
  guildId: string,
  state: GuildState
): Record<string, unknown> {
  const desiredOverwrites = planOverwrites(channel.overwrites, guildId, state);
  const desired = withoutUndefined({
    name: channel.name,
    position: channel.position,
    permission_overwrites: desiredOverwrites === undefined ? undefined : normalizeOverwrites(desiredOverwrites),
    ...(isChannel(channel)
      ? {
          parent_id: channel.categoryKey
            ? state.channels[channel.categoryKey] ?? `unresolved:${channel.categoryKey}`
            : undefined,
          topic: channel.topic,
          nsfw: channel.nsfw,
          rate_limit_per_user: channel.slowmodeSeconds,
          bitrate: channel.bitrate,
          user_limit: channel.userLimit,
          available_tags: channel.forumTags === undefined ? undefined : normalizeForumTags(forumTags(channel)),
          default_sort_order: channel.defaultSortOrder === "latest_activity" ? 1 : channel.defaultSortOrder === "creation_date" ? 0 : undefined,
          default_forum_layout: channel.defaultForumLayout === "list" ? 1 : channel.defaultForumLayout === "gallery" ? 2 : channel.defaultForumLayout === "not_set" ? 0 : undefined,
          flags: channel.requireTag === undefined
            ? undefined
            : channel.requireTag
              ? (existing.flags ?? 0) | ChannelFlags.RequireTag
              : (existing.flags ?? 0) & ~ChannelFlags.RequireTag
        }
      : {})
  });
  const normalizedExisting = {
    ...existing,
    permission_overwrites: normalizeOverwrites(existing.permission_overwrites),
    available_tags: normalizeForumTags(existing.available_tags)
  };
  return changedFields(desired, normalizedExisting as unknown as Record<string, unknown>);
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
    const changes = changedFields(guildBodyForPlan(blueprint.guild, state), snapshot.guild);
    if (Object.keys(changes).length > 0) {
      actions.push({ action: "modify", resource: "guild", key: snapshot.guild.id, changes });
    }
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
    const changes = channelDiff(category, existing, snapshot.guild.id, state);
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
      const changes = channelDiff(channel, existing, snapshot.guild.id, state);
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

function channelBody(
  channel: ChannelBlueprint,
  state: GuildState,
  existing?: SnapshotChannel
): Record<string, unknown> {
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
    flags: channel.requireTag === undefined
      ? undefined
      : channel.requireTag
        ? (existing?.flags ?? 0) | ChannelFlags.RequireTag
        : (existing?.flags ?? 0) & ~ChannelFlags.RequireTag
  });
}

export function renderMessageContent(content: string, state: GuildState): string {
  return content.replace(/\{\{channel:([a-zA-Z0-9_-]+)\}\}/g, (_match, key: string) => {
    const channelId = state.channels[key];
    if (!channelId) throw new Error(`Message references unresolved channel key '${key}'.`);
    return `<#${channelId}>`;
  });
}

export function blueprintExecutionDigests(
  blueprint: ServerBlueprint,
  snapshot: GuildSnapshot,
  actions: BlueprintAction[]
) {
  const projectedSnapshot = {
    guild: {
      id: snapshot.guild.id,
      name: snapshot.guild.name,
      description: snapshot.guild.description ?? null,
      preferred_locale: snapshot.guild.preferred_locale ?? null,
      verification_level: snapshot.guild.verification_level ?? null,
      default_message_notifications: snapshot.guild.default_message_notifications ?? null,
      explicit_content_filter: snapshot.guild.explicit_content_filter ?? null,
      rules_channel_id: snapshot.guild.rules_channel_id ?? null,
      public_updates_channel_id: snapshot.guild.public_updates_channel_id ?? null,
      safety_alerts_channel_id: snapshot.guild.safety_alerts_channel_id ?? null
    },
    roles: snapshot.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions
    })).sort((left, right) => left.id.localeCompare(right.id)),
    channels: snapshot.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parent_id: channel.parent_id ?? null,
      topic: channel.topic ?? null,
      position: channel.position ?? null,
      nsfw: channel.nsfw ?? false,
      rate_limit_per_user: channel.rate_limit_per_user ?? 0,
      bitrate: channel.bitrate ?? null,
      user_limit: channel.user_limit ?? null,
      permission_overwrites: normalizeOverwrites(channel.permission_overwrites),
      available_tags: normalizeForumTags(channel.available_tags),
      default_sort_order: channel.default_sort_order ?? null,
      default_forum_layout: channel.default_forum_layout ?? null,
      flags: channel.flags ?? 0
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
  return {
    blueprintDigest: changeDigest(blueprint),
    snapshotDigest: changeDigest(projectedSnapshot),
    planDigest: changeDigest(actions)
  };
}

function journalAttempt(journal: BlueprintJournal): BlueprintJournalAttempt {
  return {
    id: journal.id,
    status: journal.status,
    attempt: journal.attempt,
    blueprintDigest: journal.blueprintDigest,
    planDigest: journal.planDigest,
    snapshotDigest: journal.snapshotDigest,
    startedAt: journal.startedAt,
    updatedAt: journal.updatedAt,
    actions: journal.actions.map((action) => ({ ...action })),
    ...(journal.finalAppliedPlanDigest === undefined
      ? {}
      : { finalAppliedPlanDigest: journal.finalAppliedPlanDigest })
  };
}

function journalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

export async function applyBlueprint(args: {
  client: DiscordClient;
  store: StateStore;
  guildId: string;
  blueprintInput: unknown;
  dryRun: boolean;
  confirm?: string;
  reason?: string;
}) {
  const { client, store, guildId, dryRun, reason } = args;
  client.policy.assertGuild(guildId);
  const snapshot = await fetchBlueprintSnapshot(client, guildId);
  const guildState = store.guild(guildId);
  const { blueprint, actions } = planBlueprint(args.blueprintInput, snapshot, guildState);
  client.policy.assertBulkSize(actions.length);
  const digests = blueprintExecutionDigests(blueprint, snapshot, actions);

  const privileged = blueprint.roles.some((role) => role.permissions !== undefined)
    || blueprint.categories.some((category) => category.overwrites !== undefined)
    || blueprint.channels.some((channel) => channel.overwrites !== undefined)
    || blueprint.guild !== undefined;
  const expectedConfirmation = privileged
    ? `APPLY PRIVILEGED BLUEPRINT ${guildId} ${changeDigest(digests)}`
    : undefined;

  if (dryRun) {
    return {
      dryRun: true,
      actionCount: actions.length,
      actions,
      preconditions: digests,
      expectedConfirmation: expectedConfirmation === undefined
        ? undefined
        : client.policy.issueConfirmation(expectedConfirmation)
    };
  }
  client.policy.assertWrite({
    operation: "apply blueprint",
    risk: privileged ? "privileged" : "ordinary",
    confirmation: args.confirm,
    expectedConfirmation
  });

  const previous = store.blueprintJournal(guildId);
  const now = new Date().toISOString();
  const recovering = previous !== undefined
    && previous.status !== "completed"
    && previous.blueprintDigest === digests.blueprintDigest;
  const history = previous === undefined
    ? []
    : [...previous.history, journalAttempt(previous)].slice(-20);
  const journal: BlueprintJournal = {
    id: randomUUID(),
    guildId,
    status: "in_progress",
    attempt: (previous?.attempt ?? 0) + 1,
    ...digests,
    startedAt: now,
    updatedAt: now,
    actions: actions.map((action) => ({
      action: action.action,
      resource: action.resource,
      key: action.key,
      ...(action.id === undefined ? {} : { id: action.id }),
      status: "pending"
    })),
    history,
    ...(recovering ? { recoveredFrom: previous.id } : {}),
    ...(!recovering && previous !== undefined ? { supersedes: previous.id } : {})
  };
  store.setBlueprintJournal(guildId, journal);
  await store.save();

  const plannedAction = (resource: BlueprintAction["resource"], key: string) => {
    const action = actions.find((candidate) => candidate.resource === resource && candidate.key === key);
    if (action === undefined) return undefined;
    const entry = journal.actions.find((candidate) => candidate.resource === resource && candidate.key === key);
    if (entry === undefined) throw new Error(`Journal entry missing for ${resource}:${key}.`);
    return { action, entry };
  };

  const runPlanned = async <T>(
    planned: NonNullable<ReturnType<typeof plannedAction>>,
    operation: () => Promise<{ value: T; resultId?: string }>
  ): Promise<T> => {
    planned.entry.status = "running";
    planned.entry.startedAt = new Date().toISOString();
    journal.updatedAt = planned.entry.startedAt;
    await store.save();
    try {
      const result = await operation();
      planned.entry.status = "completed";
      planned.entry.finishedAt = new Date().toISOString();
      if (result.resultId !== undefined) planned.entry.resultId = result.resultId;
      journal.updatedAt = planned.entry.finishedAt;
      await store.save();
      return result.value;
    } catch (error) {
      planned.entry.status = "failed";
      planned.entry.finishedAt = new Date().toISOString();
      planned.entry.error = journalError(error);
      journal.status = "failed";
      journal.updatedAt = planned.entry.finishedAt;
      await store.save();
      throw error;
    }
  };

  for (const role of blueprint.roles) {
    const existing = byTrackedOrName(snapshot.roles, guildState.roles[role.key], role.name);
    const planned = plannedAction("role", role.key);
    if (planned === undefined) {
      if (existing !== undefined) guildState.roles[role.key] = existing.id;
      continue;
    }
    const body = roleBody(role);
    await runPlanned(planned, async () => {
      const resolved = existing
        ? await client.request<SnapshotRole>("PATCH", `/guilds/${guildId}/roles/${existing.id}`, { body, reason })
        : await client.request<SnapshotRole>("POST", `/guilds/${guildId}/roles`, { body, reason });
      guildState.roles[role.key] = resolved.id;
      return { value: resolved, resultId: resolved.id };
    });
  }

  for (const category of blueprint.categories) {
    const existing = byTrackedOrName(
      snapshot.channels,
      guildState.channels[category.key],
      category.name,
      (channel) => channel.type === ChannelType.GuildCategory
    );
    const planned = plannedAction("category", category.key);
    if (planned === undefined) {
      if (existing !== undefined) guildState.channels[category.key] = existing.id;
      continue;
    }
    const body = withoutUndefined({
      name: category.name,
      type: ChannelType.GuildCategory,
      position: category.position,
      permission_overwrites: await resolveOverwrites(category.overwrites, guildId, guildState)
    });
    await runPlanned(planned, async () => {
      const resolved = existing
        ? await client.request<SnapshotChannel>("PATCH", `/channels/${existing.id}`, { body, reason })
        : await client.request<SnapshotChannel>("POST", `/guilds/${guildId}/channels`, { body, reason });
      guildState.channels[category.key] = resolved.id;
      return { value: resolved, resultId: resolved.id };
    });
  }

  for (const channel of blueprint.channels) {
    const type = channelTypes[channel.type];
    const existing = byTrackedOrName(
      snapshot.channels,
      guildState.channels[channel.key],
      channel.name,
      (candidate) => candidate.type === type
    );
    const channelAction = plannedAction("channel", channel.key);
    let resolved = existing;
    if (channelAction !== undefined) {
      const body = {
        ...channelBody(channel, guildState, existing),
        permission_overwrites: await resolveOverwrites(channel.overwrites, guildId, guildState)
      };
      resolved = await runPlanned(channelAction, async () => {
        const result = existing
          ? await client.request<SnapshotChannel>("PATCH", `/channels/${existing.id}`, { body, reason })
          : await client.request<SnapshotChannel>("POST", `/guilds/${guildId}/channels`, { body, reason });
        guildState.channels[channel.key] = result.id;
        return { value: result, resultId: result.id };
      });
    } else if (existing !== undefined) {
      guildState.channels[channel.key] = existing.id;
    }
    if (resolved === undefined) throw new Error(`Channel '${channel.key}' was not resolved during blueprint execution.`);

    for (const message of channel.messages ?? []) {
      const messageAction = plannedAction("message", message.key);
      if (messageAction === undefined) continue;
      await runPlanned(messageAction, async () => {
        const nonce = changeDigest({ guildId, blueprintDigest: digests.blueprintDigest, messageKey: message.key });
        const recent = await client.request<Array<{ id: string; nonce?: string | number | null }>>(
          "GET",
          `/channels/${resolved.id}/messages?limit=100`
        );
        let sent = recent.find((candidate) => String(candidate.nonce ?? "") === nonce);
        if (sent === undefined) {
          sent = await client.request<{ id: string; nonce?: string | number | null }>(
            "POST",
            `/channels/${resolved.id}/messages`,
            {
              body: {
                content: renderMessageContent(message.content, guildState),
                nonce,
                enforce_nonce: true
              },
              reason
            }
          );
        }
        guildState.messages[message.key] = sent.id;
        if (message.pin) {
          await client.request("PUT", `/channels/${resolved.id}/pins/${sent.id}`, { reason });
        }
        return { value: sent, resultId: sent.id };
      });
    }
  }

  if (blueprint.guild) {
    const guildBody = guildBodyForApply(blueprint.guild, guildState);
    const guildAction = plannedAction("guild", guildId);
    if (Object.keys(guildBody).length > 0 && guildAction !== undefined) {
      await runPlanned(guildAction, async () => ({
        value: await client.request("PATCH", `/guilds/${guildId}`, { body: guildBody, reason }),
        resultId: guildId
      }));
    }
  }

  const incomplete = journal.actions.filter((action) => action.status !== "completed");
  if (incomplete.length > 0) {
    journal.status = "failed";
    journal.updatedAt = new Date().toISOString();
    await store.save();
    throw new Error(`Blueprint execution left ${incomplete.length} journal actions incomplete.`);
  }
  journal.status = "completed";
  journal.updatedAt = new Date().toISOString();
  journal.finalAppliedPlanDigest = changeDigest({
    ...digests,
    actions: journal.actions.map(({ action, resource, key, status, resultId }) => ({
      action,
      resource,
      key,
      status,
      ...(resultId === undefined ? {} : { resultId })
    }))
  });
  await store.save();
  return {
    dryRun: false,
    actionCount: actions.length,
    actions,
    preconditions: digests,
    state: guildState,
    journal: journalAttempt(journal),
    ...(journal.recoveredFrom === undefined ? {} : { recoveredFrom: journal.recoveredFrom })
  };
}
