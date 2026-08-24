import { randomUUID } from "node:crypto";

import type { AppConfig } from "./config.js";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface WriteCheck {
  operation: string;
  risk?: "ordinary" | "privileged" | "destructive";
  destructive?: boolean;
  confirmation?: string;
  expectedConfirmation?: string;
}

interface PendingConfirmation {
  base: string;
  expiresAt: number;
}

interface SafetyPolicyOptions {
  now?: () => number;
  nonce?: () => string;
}

const MAX_PENDING_CONFIRMATIONS = 1024;

export class SafetyPolicy {
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();
  private readonly now: () => number;
  private readonly nonce: () => string;

  constructor(private readonly config: AppConfig, options: SafetyPolicyOptions = {}) {
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce ?? randomUUID;
  }

  assertGuild(guildId: string): void {
    if (!this.config.allowedGuildIds.has(guildId)) {
      throw new PolicyError(`Guild ${guildId} is not in DISCORD_ALLOWED_GUILD_IDS.`);
    }
  }

  assertUser(userId: string): void {
    if (!this.config.allowedUserIds.has(userId)) {
      throw new PolicyError(`User ${userId} is not in DISCORD_ALLOWED_USER_IDS.`);
    }
  }

  issueConfirmation(base: string): string {
    const now = this.now();
    this.removeExpiredConfirmations(now);
    while (this.pendingConfirmations.size >= MAX_PENDING_CONFIRMATIONS) {
      const oldest = this.pendingConfirmations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.pendingConfirmations.delete(oldest);
    }

    const token = `${base} [nonce:${this.nonce()}]`;
    if (this.pendingConfirmations.has(token)) {
      throw new PolicyError("Could not issue a unique confirmation. Run the dry-run again.");
    }
    this.pendingConfirmations.set(token, {
      base,
      expiresAt: now + this.config.confirmationTtlSeconds * 1000
    });
    return token;
  }

  assertWrite(check: WriteCheck): void {
    if (this.config.mode === "read-only") {
      throw new PolicyError(`${check.operation} is blocked because DISCORD_MODE=read-only.`);
    }

    const risk = check.risk ?? (check.destructive ? "destructive" : "ordinary");
    if (risk === "ordinary") return;

    if (this.config.mode !== "full") {
      throw new PolicyError(`${check.operation} is ${risk} and requires DISCORD_MODE=full.`);
    }

    if (risk === "destructive" && !this.config.destructiveEnabled) {
      throw new PolicyError(`${check.operation} is blocked because DISCORD_ENABLE_DESTRUCTIVE is not true.`);
    }

    const expected = check.expectedConfirmation ?? `CONFIRM ${check.operation}`;
    if (check.confirmation === undefined) {
      throw new PolicyError("Confirmation required. Run the same operation with dryRun=true to obtain a one-time confirmation.");
    }

    const pending = this.pendingConfirmations.get(check.confirmation);
    if (pending === undefined) {
      throw new PolicyError("Confirmation is invalid or already used. Run the same operation with dryRun=true for a fresh confirmation.");
    }

    this.pendingConfirmations.delete(check.confirmation);
    if (pending.expiresAt <= this.now()) {
      throw new PolicyError("Confirmation expired. Run the same operation with dryRun=true for a fresh confirmation.");
    }
    if (pending.base !== expected) {
      throw new PolicyError("Confirmation does not match this operation or payload. Run this exact operation with dryRun=true.");
    }
  }

  private removeExpiredConfirmations(now: number): void {
    for (const [token, confirmation] of this.pendingConfirmations) {
      if (confirmation.expiresAt <= now) this.pendingConfirmations.delete(token);
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
