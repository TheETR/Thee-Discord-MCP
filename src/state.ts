import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface GuildState {
  roles: Record<string, string>;
  channels: Record<string, string>;
  messages: Record<string, string>;
}

export type BlueprintJournalStatus = "in_progress" | "completed" | "failed";
export type BlueprintJournalActionStatus = "pending" | "running" | "completed" | "failed";

export interface BlueprintJournalAction {
  action: "create" | "update" | "send" | "modify";
  resource: "guild" | "role" | "category" | "channel" | "message";
  key: string;
  id?: string;
  status: BlueprintJournalActionStatus;
  startedAt?: string;
  finishedAt?: string;
  resultId?: string;
  error?: string;
}

export interface BlueprintJournalAttempt {
  id: string;
  status: BlueprintJournalStatus;
  attempt: number;
  blueprintDigest: string;
  planDigest: string;
  snapshotDigest: string;
  startedAt: string;
  updatedAt: string;
  actions: BlueprintJournalAction[];
  finalAppliedPlanDigest?: string;
}

export interface BlueprintJournal extends BlueprintJournalAttempt {
  guildId: string;
  recoveredFrom?: string;
  supersedes?: string;
  history: BlueprintJournalAttempt[];
}

interface StateFile {
  version: 2;
  guilds: Record<string, GuildState>;
  blueprintJournals: Record<string, BlueprintJournal>;
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

const digest = /^[a-f0-9]{16}$/;
const journalId = /^[a-f0-9-]{36}$/;
const journalStatuses = new Set<BlueprintJournalStatus>(["in_progress", "completed", "failed"]);
const actionStatuses = new Set<BlueprintJournalActionStatus>(["pending", "running", "completed", "failed"]);
const actionNames = new Set<BlueprintJournalAction["action"]>(["create", "update", "send", "modify"]);
const resourceNames = new Set<BlueprintJournalAction["resource"]>(["guild", "role", "category", "channel", "message"]);

function requiredString(record: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000 || (pattern && !pattern.test(value))) {
    throw new Error(`Invalid blueprint journal ${key}.`);
  }
  return value;
}

function parseJournalAction(value: unknown): BlueprintJournalAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid blueprint journal action.");
  }
  const record = value as Record<string, unknown>;
  const action = requiredString(record, "action") as BlueprintJournalAction["action"];
  const resource = requiredString(record, "resource") as BlueprintJournalAction["resource"];
  const status = requiredString(record, "status") as BlueprintJournalActionStatus;
  if (!actionNames.has(action) || !resourceNames.has(resource) || !actionStatuses.has(status)) {
    throw new Error("Invalid blueprint journal action enum.");
  }
  const parsed: BlueprintJournalAction = {
    action,
    resource,
    key: requiredString(record, "key", resourceKey),
    status
  };
  for (const key of ["id", "resultId"] as const) {
    if (record[key] !== undefined) parsed[key] = requiredString(record, key, snowflake);
  }
  for (const key of ["startedAt", "finishedAt"] as const) {
    if (record[key] !== undefined) parsed[key] = requiredString(record, key);
  }
  if (record.error !== undefined) parsed.error = requiredString(record, "error");
  return parsed;
}

function parseJournalAttempt(value: unknown): BlueprintJournalAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid blueprint journal attempt.");
  }
  const record = value as Record<string, unknown>;
  const status = requiredString(record, "status") as BlueprintJournalStatus;
  if (!journalStatuses.has(status)) throw new Error("Invalid blueprint journal status.");
  if (!Number.isInteger(record.attempt) || (record.attempt as number) < 1 || (record.attempt as number) > 1_000_000) {
    throw new Error("Invalid blueprint journal attempt number.");
  }
  if (!Array.isArray(record.actions) || record.actions.length > 1_000) {
    throw new Error("Invalid blueprint journal action list.");
  }
  const parsed: BlueprintJournalAttempt = {
    id: requiredString(record, "id", journalId),
    status,
    attempt: record.attempt as number,
    blueprintDigest: requiredString(record, "blueprintDigest", digest),
    planDigest: requiredString(record, "planDigest", digest),
    snapshotDigest: requiredString(record, "snapshotDigest", digest),
    startedAt: requiredString(record, "startedAt"),
    updatedAt: requiredString(record, "updatedAt"),
    actions: record.actions.map(parseJournalAction)
  };
  if (record.finalAppliedPlanDigest !== undefined) {
    parsed.finalAppliedPlanDigest = requiredString(record, "finalAppliedPlanDigest", digest);
  }
  return parsed;
}

function parseJournal(value: unknown, expectedGuildId: string): BlueprintJournal {
  const attempt = parseJournalAttempt(value);
  const record = value as Record<string, unknown>;
  const guildId = requiredString(record, "guildId", snowflake);
  if (guildId !== expectedGuildId) throw new Error("Blueprint journal guild key mismatch.");
  if (!Array.isArray(record.history) || record.history.length > 20) {
    throw new Error("Invalid blueprint journal history.");
  }
  const parsed: BlueprintJournal = {
    ...attempt,
    guildId,
    history: record.history.map(parseJournalAttempt)
  };
  for (const key of ["recoveredFrom", "supersedes"] as const) {
    if (record[key] !== undefined) parsed[key] = requiredString(record, key, journalId);
  }
  return parsed;
}

function parseStateFile(value: unknown): StateFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unsupported state file format.");
  }
  const candidate = value as Record<string, unknown>;
  if ((candidate.version !== 1 && candidate.version !== 2) || typeof candidate.guilds !== "object" || candidate.guilds === null || Array.isArray(candidate.guilds)) {
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
  const rawJournals = candidate.version === 2 ? candidate.blueprintJournals : {};
  if (typeof rawJournals !== "object" || rawJournals === null || Array.isArray(rawJournals)) {
    throw new Error("Invalid blueprint journal map.");
  }
  const blueprintJournals = Object.fromEntries(Object.entries(rawJournals).map(([guildId, journal]) => {
    if (!snowflake.test(guildId)) throw new Error("Invalid blueprint journal guild key.");
    return [guildId, parseJournal(journal, guildId)];
  }));
  return { version: 2, guilds, blueprintJournals };
}

export class StateStore {
  private data: StateFile = { version: 2, guilds: {}, blueprintJournals: {} };

  constructor(
    private readonly path: string,
    private readonly root: string = dirname(path)
  ) {}

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
    await this.assertExistingParentChainSafe();
    await mkdir(dirname(this.path), { recursive: true });
    await this.assertParentDirectorySafe();
    await this.assertTargetIsNotLink();
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await this.assertParentDirectorySafe();
      await this.assertTargetIsNotLink();
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  blueprintJournal(guildId: string): BlueprintJournal | undefined {
    return this.data.blueprintJournals[guildId];
  }

  setBlueprintJournal(guildId: string, journal: BlueprintJournal): void {
    if (!snowflake.test(guildId) || journal.guildId !== guildId) {
      throw new Error("Blueprint journal guild mismatch.");
    }
    this.data.blueprintJournals[guildId] = journal;
  }

  private relativeParent(): { root: string; parent: string; relativePath: string } {
    const root = resolve(this.root);
    const parent = dirname(resolve(this.path));
    const relativePath = relative(root, parent);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("State file parent must remain inside the configured package root.");
    }
    return { root, parent, relativePath };
  }

  private async assertExistingParentChainSafe(): Promise<void> {
    const { root, relativePath } = this.relativeParent();
    let current = root;
    for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
      current = resolve(current, segment);
      try {
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) {
          throw new Error("Refusing to save state through a symbolic-link or junction parent.");
        }
        if (!metadata.isDirectory()) throw new Error("State file parent contains a non-directory component.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
  }

  private async assertParentDirectorySafe(): Promise<void> {
    const { root, parent, relativePath } = this.relativeParent();
    let current = root;
    for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
      current = resolve(current, segment);
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error("Refusing to save state through a symbolic-link or junction parent.");
      }
      if (!metadata.isDirectory()) throw new Error("State file parent contains a non-directory component.");
    }

    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    const realRelative = relative(realRoot, realParent);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      throw new Error("State file parent resolves outside the configured package root.");
    }
  }

  private async assertTargetIsNotLink(): Promise<void> {
    try {
      const metadata = await lstat(this.path);
      if (metadata.isSymbolicLink()) throw new Error("Refusing to replace state through a symbolic link.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
