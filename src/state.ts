import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface GuildState {
  roles: Record<string, string>;
  channels: Record<string, string>;
  messages: Record<string, string>;
}

interface StateFile {
  version: 1;
  guilds: Record<string, GuildState>;
}

const emptyGuildState = (): GuildState => ({ roles: {}, channels: {}, messages: {} });
const snowflake = /^\d{17,20}$/;
const resourceKey = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

function parseStringMap(value: unknown, label: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} state map.`);
  }
  const entries = Object.entries(value);
  if (entries.some(([key, id]) => !resourceKey.test(key) || typeof id !== "string" || !snowflake.test(id))) {
    throw new Error(`Invalid ${label} state entry.`);
  }
  return Object.fromEntries(entries);
}

function parseStateFile(value: unknown): StateFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unsupported state file format.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.guilds !== "object" || candidate.guilds === null || Array.isArray(candidate.guilds)) {
    throw new Error("Unsupported state file format.");
  }
  const guilds = Object.fromEntries(Object.entries(candidate.guilds).map(([guildId, guild]) => {
    if (!snowflake.test(guildId) || typeof guild !== "object" || guild === null || Array.isArray(guild)) {
      throw new Error("Invalid guild state entry.");
    }
    const record = guild as Record<string, unknown>;
    return [guildId, {
      roles: parseStringMap(record.roles, "role"),
      channels: parseStringMap(record.channels, "channel"),
      messages: parseStringMap(record.messages, "message")
    }];
  }));
  return { version: 1, guilds };
}

export class StateStore {
  private data: StateFile = { version: 1, guilds: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const metadata = await lstat(this.path);
      if (metadata.isSymbolicLink()) throw new Error("Refusing to load state through a symbolic link.");
      const raw = await readFile(this.path, "utf8");
      this.data = parseStateFile(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  guild(guildId: string): GuildState {
    return (this.data.guilds[guildId] ??= emptyGuildState());
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const metadata = await lstat(this.path);
      if (metadata.isSymbolicLink()) throw new Error("Refusing to replace state through a symbolic link.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
