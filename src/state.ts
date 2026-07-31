import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

export class StateStore {
  private data: StateFile = { version: 1, guilds: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as StateFile;
      if (parsed.version !== 1 || typeof parsed.guilds !== "object") {
        throw new Error("Unsupported state file format.");
      }
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  guild(guildId: string): GuildState {
    return (this.data.guilds[guildId] ??= emptyGuildState());
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}
