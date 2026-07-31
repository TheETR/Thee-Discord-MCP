import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { PolicyError, SafetyPolicy } from "../src/safety.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    token: "test-token-that-is-long-enough",
    allowedGuildIds: new Set(["123456789012345678"]),
    mode: "read-only",
    destructiveEnabled: false,
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

  it("blocks every write in read-only mode", () => {
    const policy = new SafetyPolicy(config());
    expect(() => policy.assertWrite({ operation: "create channel" })).toThrow(/read-only/);
  });

  it("allows non-destructive writes in safe-write mode", () => {
    const policy = new SafetyPolicy(config({ mode: "safe-write" }));
    expect(() => policy.assertWrite({ operation: "create channel" })).not.toThrow();
  });

  it("requires full mode, destructive opt-in, and exact confirmation", () => {
    const policy = new SafetyPolicy(config({ mode: "full", destructiveEnabled: true }));
    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation: "wrong",
      expectedConfirmation: "DELETE CHANNEL 123"
    })).toThrow(/Confirmation mismatch/);

    expect(() => policy.assertWrite({
      operation: "delete channel",
      destructive: true,
      confirmation: "DELETE CHANNEL 123",
      expectedConfirmation: "DELETE CHANNEL 123"
    })).not.toThrow();
  });

  it("enforces the blueprint action ceiling", () => {
    const policy = new SafetyPolicy(config({ maxBulkActions: 2 }));
    expect(() => policy.assertBulkSize(3)).toThrow(/exceeding/);
  });
});
