import { existsSync } from "node:fs";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

function findProjectRoot(start: string): string {
  const root = parse(start).root;
  let current = start;
  while (current !== root) {
    if (existsSync(resolve(current, "package.json"))) return current;
    current = dirname(current);
  }
  throw new Error("Could not locate TheeDiscordMCP package root.");
}

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });

export const ModeSchema = z.enum(["read-only", "safe-write", "full"]);
export type Mode = z.infer<typeof ModeSchema>;

export function resolveStateFile(path: string): string {
  const resolved = resolve(projectRoot, path);
  const projectRelative = relative(projectRoot, resolved);
  if (projectRelative === "" || projectRelative.startsWith("..") || isAbsolute(projectRelative)) {
    throw new Error("DISCORD_STATE_FILE must resolve to a file inside the package directory.");
  }
  return resolved;
}

const EnvironmentSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(20),
  DISCORD_ALLOWED_GUILD_IDS: z.string().min(1),
  DISCORD_ALLOWED_USER_IDS: z.string().default(""),
  DISCORD_MODE: ModeSchema.default("read-only"),
  DISCORD_ENABLE_DESTRUCTIVE: z.string().default("false"),
  DISCORD_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  DISCORD_MAX_BULK_ACTIONS: z.coerce.number().int().min(1).max(1000).default(100),
  DISCORD_STATE_FILE: z.string().default(".data/state.json"),
  DISCORD_AUDIT_REASON_PREFIX: z.string().min(1).max(200).default("TheeDiscordMCP")
});

export interface AppConfig {
  token: string;
  allowedGuildIds: ReadonlySet<string>;
  allowedUserIds: ReadonlySet<string>;
  mode: Mode;
  destructiveEnabled: boolean;
  confirmationTtlSeconds: number;
  maxBulkActions: number;
  stateFile: string;
  auditReasonPrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const guildIds = parsed.data.DISCORD_ALLOWED_GUILD_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (guildIds.length === 0 || guildIds.some((id) => !/^\d{17,20}$/.test(id))) {
    throw new Error("DISCORD_ALLOWED_GUILD_IDS must contain comma-separated Discord snowflakes.");
  }

  const userIds = parsed.data.DISCORD_ALLOWED_USER_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (userIds.some((id) => !/^\d{17,20}$/.test(id))) {
    throw new Error("DISCORD_ALLOWED_USER_IDS must contain comma-separated Discord snowflakes.");
  }

  return {
    token: parsed.data.DISCORD_BOT_TOKEN,
    allowedGuildIds: new Set(guildIds),
    allowedUserIds: new Set(userIds),
    mode: parsed.data.DISCORD_MODE,
    destructiveEnabled: parsed.data.DISCORD_ENABLE_DESTRUCTIVE.toLowerCase() === "true",
    confirmationTtlSeconds: parsed.data.DISCORD_CONFIRMATION_TTL_SECONDS,
    maxBulkActions: parsed.data.DISCORD_MAX_BULK_ACTIONS,
    stateFile: resolveStateFile(parsed.data.DISCORD_STATE_FILE),
    auditReasonPrefix: parsed.data.DISCORD_AUDIT_REASON_PREFIX
  };
}

export function redactConfig(config: AppConfig) {
  return {
    allowedGuildIds: [...config.allowedGuildIds],
    allowedUserIds: [...config.allowedUserIds],
    mode: config.mode,
    destructiveEnabled: config.destructiveEnabled,
    confirmationTtlSeconds: config.confirmationTtlSeconds,
    maxBulkActions: config.maxBulkActions,
    stateFile: config.stateFile,
    auditReasonPrefix: config.auditReasonPrefix
  };
}
