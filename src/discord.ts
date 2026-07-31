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

  async assertScopedRoute(guildId: string, route: string): Promise<void> {
    this.policy.assertGuild(guildId);
    const normalized = route.startsWith("/") ? route : `/${route}`;
    if (normalized === `/guilds/${guildId}` || normalized.startsWith(`/guilds/${guildId}/`)) return;

    const channelMatch = normalized.match(/^\/channels\/(\d{17,20})(?:\/|$)/);
    if (channelMatch?.[1]) {
      await this.assertChannelGuild(channelMatch[1], guildId);
      return;
    }

    throw new Error("Raw routes must be scoped to the selected guild or one of its channels.");
  }
}
