import { describe, expect, it } from "vitest";

import { jsonResult, normalizeDiscordPayload } from "../src/results.js";

describe("Discord response normalization", () => {
  it("turns empty REST response buffers into a stable success object", () => {
    const response = new ArrayBuffer(0);
    expect(normalizeDiscordPayload(response)).toEqual({ ok: true });
    expect(jsonResult(response).structuredContent).toEqual({ ok: true });
  });

  it("wraps arrays for MCP structured content", () => {
    expect(jsonResult([{ id: "1" }]).structuredContent).toEqual({ value: [{ id: "1" }] });
  });

  it("preserves plain Discord objects", () => {
    expect(jsonResult({ id: "1" }).structuredContent).toEqual({ id: "1" });
  });
});
