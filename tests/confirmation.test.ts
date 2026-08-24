import { describe, expect, it } from "vitest";

import { changeDigest } from "../src/confirmation.js";

describe("changeDigest", () => {
  it("is stable across object key order", () => {
    expect(changeDigest({ channel_id: "123", enabled: true })).toBe(
      changeDigest({ enabled: true, channel_id: "123" })
    );
  });

  it("changes when a nested target or value changes", () => {
    expect(changeDigest({ overwrite: { id: "123", allow: "1" } })).not.toBe(
      changeDigest({ overwrite: { id: "999", allow: "1" } })
    );
    expect(changeDigest({ overwrite: { id: "123", allow: "1" } })).not.toBe(
      changeDigest({ overwrite: { id: "123", allow: "8" } })
    );
  });
});
