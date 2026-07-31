import { REST } from "@discordjs/rest";

import type { AppConfig } from "./config.js";
import { SafetyPolicy } from "./safety.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DiscordRequestOptions {
  body?: unknown;
  reason?: string;
}

export class DiscordClient {
  private readonly rest: REST;
  readonly policy: SafetyPolicy;

  constructor(private readonly config: AppConfig) {
    this.rest = new REST({ version: "10" }).setToken(config.token);
    this.policy = new SafetyPolicy(config);
  }

  reason(reason?: string): string {
    return [this.config.auditReasonPrefix, reason].filter(Boolean).join(": ").slice(0, 512);
  }

  async request<T = unknown>(method: Method, route: string, options: DiscordRequestOptions = {}): Promise<T> {
    const requestOptions = {
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.reason === undefined ? {} : { reason: this.reason(options.reason) })
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

  async assertScopedRoute(guildId: string, route: string, method: Method = "GET", body?: unknown): Promise<void> {
    this.policy.assertGuild(guildId);
    const normalized = route.startsWith("/") ? route : `/${route}`;
    const pathname = normalized.split("?", 1)[0] ?? normalized;
    if (pathname === `/guilds/${guildId}` || pathname.startsWith(`/guilds/${guildId}/`)) return;

    const channelMatch = pathname.match(/^\/channels\/(\d{17,20})(?:\/|$)/);
    if (channelMatch?.[1]) {
      await this.assertChannelGuild(channelMatch[1], guildId);
      return;
    }

    const stageMatch = pathname.match(/^\/stage-instances\/(\d{17,20})$/);
    if (stageMatch?.[1]) {
      await this.assertChannelGuild(stageMatch[1], guildId);
      return;
    }

    if (pathname === "/stage-instances" && method === "POST") {
      const channelId = isRecord(body) && typeof body.channel_id === "string" ? body.channel_id : undefined;
      if (!channelId) throw new Error("Creating a stage instance requires body.channel_id.");
      await this.assertChannelGuild(channelId, guildId);
      return;
    }

    const webhookMatch = pathname.match(/^\/webhooks\/(\d{17,20})$/);
    if (webhookMatch?.[1]) {
      const webhook = await this.request<{ guild_id?: string }>("GET", `/webhooks/${webhookMatch[1]}`);
      if (webhook.guild_id !== guildId) throw new Error("Webhook does not belong to the selected guild.");
      return;
    }

    const inviteMatch = pathname.match(/^\/invites\/([^/]+)$/);
    if (inviteMatch?.[1]) {
      const invite = await this.request<{ guild?: { id?: string } }>("GET", `/invites/${encodeURIComponent(inviteMatch[1])}`);
      if (invite.guild?.id !== guildId) throw new Error("Invite does not belong to the selected guild.");
      return;
    }

    const commandMatch = pathname.match(/^\/applications\/(\d{17,20})\/guilds\/(\d{17,20})\/commands(?:\/|$)/);
    if (commandMatch?.[1] && commandMatch[2] === guildId) {
      const bot = await this.request<{ id: string }>("GET", "/users/@me");
      if (bot.id !== commandMatch[1]) throw new Error("Application command route does not belong to this bot.");
      return;
    }

    throw new Error("Raw routes must resolve to the selected guild, one of its channels, or a verified guild-owned resource.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
