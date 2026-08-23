import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { PolicyError, SafetyPolicy } from "../src/safety.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    token: "test-token-that-is-long-enough",
    allowedGuildIds: new Set(["123456789012345678"]),
    allowedUserIds: new Set(["234567890123456789"]),
    mode: "read-only",
    destructiveEnabled: false,
    confirmationTtlSeconds: 300,
    maxBulkActions: 100,
    stateFile: ".data/test-state.json",
    auditReasonPrefix: "test",
    ...overrides
  };
}

describe("SafetyPolicy", () => {
  it("rejects guilds outside the allowlist", () => {
    const policy = new SafetyPolicy(config());
    expect(() => policy.assertGuild("999999999999999999")).toThrow(PolicyError);
  });

  it("keeps direct messages disabled outside the explicit user allowlist", () => {
    const policy = new SafetyPolicy(config());
    expect(() => policy.assertUser("999999999999999999")).toThrow(/DISCORD_ALLOWED_USER_IDS/);
    expect(() => policy.assertUser("234567890123456789")).not.toThrow();
  });

  it("blocks every write in read-only mode", () => {
    const policy = new SafetyPolicy(config());
    expect(() => policy.assertWrite({ operation: "create channel" })).toThrow(/read-only/);
  });

  it("allows non-destructive writes in safe-write mode", () => {
    const policy = new SafetyPolicy(config({ mode: "safe-write" }));
    expect(() => policy.assertWrite({ operation: "create channel" })).not.toThrow();
  });

  it("requires full mode and exact confirmation for privileged writes without destructive opt-in", () => {
    const safeWrite = new SafetyPolicy(config({ mode: "safe-write" }));
    const safeWriteConfirmation = safeWrite.issueConfirmation("REPLACE PERMISSIONS 123");
    expect(() => safeWrite.assertWrite({
      operation: "replace permissions",
      risk: "privileged",
      confirmation: safeWriteConfirmation,
      expectedConfirmation: "REPLACE PERMISSIONS 123"
    })).toThrow(/privileged.*full/);

    const full = new SafetyPolicy(config({ mode: "full", destructiveEnabled: false }));
    const fullConfirmation = full.issueConfirmation("REPLACE PERMISSIONS 123");
    expect(() => full.assertWrite({
      operation: "replace permissions",
      risk: "privileged",
      confirmation: fullConfirmation,
      expectedConfirmation: "REPLACE PERMISSIONS 123"
    })).not.toThrow();
  });

  it("requires full mode, destructive opt-in, and exact confirmation", () => {
    const policy = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    const confirmation = policy.issueConfirmation("DELETE CHANNEL 123");
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation: "wrong",
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/invalid or already used/);

    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 123"
    })).not.toThrow();
  });

  it("consumes confirmations exactly once", () => {
    const policy = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    const confirmation = policy.issueConfirmation("DELETE CHANNEL 123");
    const check = {
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 123"
    };
    expect(() => policy.assertWrite(check)).not.toThrow();
    expect(() => policy.assertWrite(check)).toThrow(/invalid or already used/);
  });

  it("rejects a confirmation issued for a different payload and consumes it", () => {
    const policy = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    const confirmation = policy.issueConfirmation("DELETE CHANNEL 123");
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 456"
    })).toThrow(/does not match/);
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/invalid or already used/);
  });

  it("rejects expired confirmations", () => {
    let now = 1_000;
    const policy = new SafetyPolicy(
      config({ mode: "full", destructiveEnabled: true, confirmationTtlSeconds: 30 }),
      { now: () => now, nonce: () => "expiry-test" }
    );
    const confirmation = policy.issueConfirmation("DELETE CHANNEL 123");
    now += 30_000;
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/expired/);
  });

  it("invalidates confirmations across policy restarts", () => {
    const first = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    const confirmation = first.issueConfirmation("DELETE CHANNEL 123");
    const restarted = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    expect(() => restarted.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation,
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/invalid or already used/);
  });

  it("does not accept the static confirmation base without a dry-run nonce", () => {
    const policy = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation: "DELETE CHANNEL 123",
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/invalid or already used/);
  });

  it("enforces the blueprint action ceiling", () => {
    const policy = new SafetyPolicy(config({ maxBulkActions: 2 }));
    expect(() => policy.assertBulkSize(3)).toThrow(/exceeding/);
  });
});
