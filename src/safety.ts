import type { AppConfig } from "./config.js";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface WriteCheck {
  operation: string;
  destructive?: boolean;
  confirmation?: string;
  expectedConfirmation?: string;
}

export class SafetyPolicy {
  constructor(private readonly config: AppConfig) {}

  assertGuild(guildId: string): void {
    if (!this.config.allowedGuildIds.has(guildId)) {
      throw new PolicyError(`Guild ${guildId} is not in DISCORD_ALLOWED_GUILD_IDS.`);
    }
  }

  assertWrite(check: WriteCheck): void {
    if (this.config.mode === "read-only") {
      throw new PolicyError(`${check.operation} is blocked because DISCORD_MODE=read-only.`);
    }

    if (!check.destructive) return;

    if (this.config.mode !== "full") {
      throw new PolicyError(`${check.operation} is destructive and requires DISCORD_MODE=full.`);
    }

    if (!this.config.destructiveEnabled) {
      throw new PolicyError(`${check.operation} is blocked because DISCORD_ENABLE_DESTRUCTIVE is not true.`);
    }

    const expected = check.expectedConfirmation ?? `CONFIRM ${check.operation}`;
    if (check.confirmation !== expected) {
      throw new PolicyError(`Confirmation mismatch. Pass confirm exactly as: ${expected}`);
    }
  }

  assertBulkSize(actionCount: number): void {
    if (actionCount > this.config.maxBulkActions) {
      throw new PolicyError(
        `Blueprint contains ${actionCount} actions, exceeding DISCORD_MAX_BULK_ACTIONS=${this.config.maxBulkActions}.`
      );
    }
  }

  get mode() {
    return this.config.mode;
  }

  get destructiveEnabled() {
    return this.config.destructiveEnabled;
  }
}
