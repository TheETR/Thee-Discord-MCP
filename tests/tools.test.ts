import { describe, expect, it } from "vitest";

import { sanitizeSnapshotWebhooks } from "../src/tools.js";

describe("snapshot webhook redaction", () => {
  it("redacts credentials nested inside optional-request envelopes", () => {
    const result = sanitizeSnapshotWebhooks({
      ok: true,
      data: [{
        id: "123456789012345678",
        token: "sensitive-token",
        url: "https://discord.com/api/webhooks/123456789012345678/sensitive-token",
        nested: { token: "another-secret", name: "ELALEM Guide" }
      }]
    });

    expect(result).toEqual({
      ok: true,
      data: [{
        id: "123456789012345678",
        token: "<redacted>",
        url: "<redacted>",
        nested: { token: "<redacted>", name: "ELALEM Guide" }
      }]
    });
    expect(JSON.stringify(result)).not.toContain("sensitive-token");
    expect(JSON.stringify(result)).not.toContain("another-secret");
  });
});
