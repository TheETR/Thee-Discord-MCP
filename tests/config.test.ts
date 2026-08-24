import { describe, expect, it } from "vitest";

import { loadConfig, resolveStateFile } from "../src/config.js";

describe("state path confinement", () => {
  it("accepts package-local state paths", () => {
    expect(resolveStateFile(".data/state.json")).toMatch(/[\\/]\.data[\\/]state\.json$/);
  });

  it.each(["../state.json"])(
    "rejects a state path outside the package: %s",
    (path) => expect(() => resolveStateFile(path)).toThrow(/inside the package directory/)
  );
});

describe("confirmation expiry configuration", () => {
  const environment = {
    DISCORD_BOT_TOKEN: "test-token-that-is-long-enough",
    DISCORD_ALLOWED_GUILD_IDS: "123456789012345678"
  };

  it("defaults confirmation lifetime to five minutes", () => {
    expect(loadConfig(environment).confirmationTtlSeconds).toBe(300);
  });

  it("accepts bounded custom confirmation lifetimes", () => {
    expect(loadConfig({
      ...environment,
      DISCORD_CONFIRMATION_TTL_SECONDS: "45"
    }).confirmationTtlSeconds).toBe(45);
  });

  it.each(["29", "3601"])("rejects an unsafe confirmation lifetime: %s", (value) => {
    expect(() => loadConfig({
      ...environment,
      DISCORD_CONFIRMATION_TTL_SECONDS: value
    })).toThrow(/DISCORD_CONFIRMATION_TTL_SECONDS/);
  });
});

describe("Discord request resilience configuration", () => {
  const environment = {
    DISCORD_BOT_TOKEN: "test-token-that-is-long-enough",
    DISCORD_ALLOWED_GUILD_IDS: "123456789012345678"
  };

  it("uses bounded retry and timeout defaults", () => {
    const config = loadConfig(environment);
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.requestRetries).toBe(3);
  });

  it("accepts bounded custom retry and timeout values", () => {
    const config = loadConfig({
      ...environment,
      DISCORD_REQUEST_TIMEOUT_MS: "25000",
      DISCORD_REQUEST_RETRIES: "4"
    });
    expect(config.requestTimeoutMs).toBe(25_000);
    expect(config.requestRetries).toBe(4);
  });

  it.each([
    ["DISCORD_REQUEST_TIMEOUT_MS", "999"],
    ["DISCORD_REQUEST_TIMEOUT_MS", "60001"],
    ["DISCORD_REQUEST_RETRIES", "-1"],
    ["DISCORD_REQUEST_RETRIES", "6"]
  ])("rejects an unsafe %s value", (name, value) => {
    expect(() => loadConfig({ ...environment, [name]: value })).toThrow(name);
  });
});
