import { REST, type RESTOptions, type RawFile } from "@discordjs/rest";

import type { AppConfig } from "./config.js";
import { SafetyPolicy } from "./safety.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const STRUCTURAL_ROUTE_CHARACTER = /[\\/\u0000-\u001f\u007f]/;
const BODY_GUILD_KEYS = new Set(["guild_id", "guildId", "source_guild_id", "sourceGuildId"]);
const BODY_CHANNEL_KEYS = new Set(["channel_id", "channelId", "parent_id", "parentId"]);

export function canonicalizeDiscordRoute(route: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(route) || route.startsWith("//")) {
    throw new Error("Raw routes must be relative Discord API paths, not absolute URLs.");
  }
  if (route.includes("\\") || route.includes("#") || /[\u0000-\u001f\u007f]/.test(route)) {
    throw new Error("Raw route contains a forbidden separator, fragment, or control character.");
  }

  const normalized = route.startsWith("/") ? route : `/${route}`;
  const questionMark = normalized.indexOf("?");
  const pathname = questionMark === -1 ? normalized : normalized.slice(0, questionMark);
  const query = questionMark === -1 ? "" : normalized.slice(questionMark);
  const segments = pathname.split("/").slice(1);

  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error("Raw route must use a canonical path without duplicate or trailing slashes.");
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Raw route contains invalid percent encoding.");
    }
    if (decoded === "." || decoded === ".." || STRUCTURAL_ROUTE_CHARACTER.test(decoded)) {
      throw new Error("Raw route contains an encoded path separator, dot segment, or control character.");
    }
  }

  return `${pathname}${query}`;
}

export interface DiscordRequestOptions {
  body?: unknown;
  reason?: string;
  auth?: boolean;
  files?: RawFile[];
  appendToFormData?: boolean;
}

export function discordRestOptions(config: AppConfig): Partial<RESTOptions> {
  return {
    version: "10",
    timeout: config.requestTimeoutMs ?? 15_000,
    retries: config.requestRetries ?? 3
  };
}

export class DiscordClient {
  private readonly rest: REST;
  readonly policy: SafetyPolicy;

  constructor(private readonly config: AppConfig) {
    this.rest = new REST(discordRestOptions(config)).setToken(config.token);
    this.policy = new SafetyPolicy(config);
  }

  reason(reason?: string): string {
    return [this.config.auditReasonPrefix, reason].filter(Boolean).join(": ").slice(0, 512);
  }

  async request<T = unknown>(method: Method, route: string, options: DiscordRequestOptions = {}): Promise<T> {
    const requestOptions = {
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.reason === undefined ? {} : { reason: this.reason(options.reason) }),
      ...(options.auth === undefined ? {} : { auth: options.auth }),
      ...(options.files === undefined ? {} : { files: options.files }),
      ...(options.appendToFormData === undefined ? {} : { appendToFormData: options.appendToFormData })
    };

    switch (method) {
      case "GET":
        return (await this.rest.get(route as never, requestOptions)) as T;
      case "POST":
        return (await this.rest.post(route as never, requestOptions)) as T;
      case "PUT":
        return (await this.rest.put(route as never, requestOptions)) as T;
      case "PATCH":
        return (await this.rest.patch(route as never, requestOptions)) as T;
      case "DELETE":
        return (await this.rest.delete(route as never, requestOptions)) as T;
    }
  }

  async assertChannelGuild(channelId: string, guildId: string): Promise<void> {
    this.policy.assertGuild(guildId);
    const channel = await this.request<{ guild_id?: string }>("GET", `/channels/${channelId}`);
    if (channel.guild_id !== guildId) {
      throw new Error(`Channel ${channelId} does not belong to allowed guild ${guildId}.`);
    }
  }

  async assertDmChannel(channelId: string, userId: string): Promise<void> {
    this.policy.assertUser(userId);
    const channel = await this.request<{ type?: number; recipients?: Array<{ id?: string }> }>("GET", `/channels/${channelId}`);
    const recipientIds = (channel.recipients ?? []).map((recipient) => recipient.id).filter((id): id is string => Boolean(id));
    if (channel.type !== 1 || recipientIds.length !== 1 || recipientIds[0] !== userId) {
      throw new Error(`Channel ${channelId} is not the allowlisted one-to-one DM for user ${userId}.`);
    }
  }

  async assertScopedRoute(guildId: string, route: string, method: Method = "GET", body?: unknown): Promise<string> {
    this.policy.assertGuild(guildId);
    const normalized = canonicalizeDiscordRoute(route);
    const pathname = normalized.split("?", 1)[0] ?? normalized;
    await this.assertRawBodyScope(guildId, body);
    if (pathname === `/guilds/${guildId}` || pathname.startsWith(`/guilds/${guildId}/`)) return normalized;

    const channelMatch = pathname.match(/^\/channels\/(\d{17,20})(?:\/|$)/);
    if (channelMatch?.[1]) {
      await this.assertChannelGuild(channelMatch[1], guildId);
      return normalized;
    }

    const stageMatch = pathname.match(/^\/stage-instances\/(\d{17,20})$/);
    if (stageMatch?.[1]) {
      await this.assertChannelGuild(stageMatch[1], guildId);
      return normalized;
    }

    if (pathname === "/stage-instances" && method === "POST") {
      const channelId = isRecord(body) && typeof body.channel_id === "string" ? body.channel_id : undefined;
      if (!channelId) throw new Error("Creating a stage instance requires body.channel_id.");
      await this.assertChannelGuild(channelId, guildId);
      return normalized;
    }

    const webhookMatch = pathname.match(/^\/webhooks\/(\d{17,20})$/);
    if (webhookMatch?.[1]) {
      const webhook = await this.request<{ guild_id?: string }>("GET", `/webhooks/${webhookMatch[1]}`);
      if (webhook.guild_id !== guildId) throw new Error("Webhook does not belong to the selected guild.");
      return normalized;
    }

    const inviteMatch = pathname.match(/^\/invites\/([^/]+)$/);
    if (inviteMatch?.[1]) {
      const invite = await this.request<{ guild?: { id?: string } }>("GET", `/invites/${encodeURIComponent(inviteMatch[1])}`);
      if (invite.guild?.id !== guildId) throw new Error("Invite does not belong to the selected guild.");
      return normalized;
    }

    const commandMatch = pathname.match(/^\/applications\/(\d{17,20})\/guilds\/(\d{17,20})\/commands(?:\/|$)/);
    if (commandMatch?.[1] && commandMatch[2] === guildId) {
      const bot = await this.request<{ id: string }>("GET", "/users/@me");
      if (bot.id !== commandMatch[1]) throw new Error("Application command route does not belong to this bot.");
      return normalized;
    }

    throw new Error("Raw routes must resolve to the selected guild, one of its channels, or a verified guild-owned resource.");
  }

  private async assertRawBodyScope(guildId: string, value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const item of value) await this.assertRawBodyScope(guildId, item);
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, item] of Object.entries(value)) {
      if (BODY_GUILD_KEYS.has(key) && typeof item === "string" && item !== guildId) {
        throw new Error(`Raw request body references guild ${item}, not selected guild ${guildId}.`);
      }
      if (BODY_CHANNEL_KEYS.has(key) && typeof item === "string") {
        await this.assertChannelGuild(item, guildId);
      }
      await this.assertRawBodyScope(guildId, item);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
