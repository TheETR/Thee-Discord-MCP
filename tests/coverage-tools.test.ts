import { describe, expect, it } from "vitest";

import { confirmationDigest, messageCursorQuery, pruneQuery } from "../src/coverage-tools.js";

describe("coverage tool helpers", () => {
  it("builds Discord prune queries with comma-delimited role IDs", () => {
    expect(pruneQuery(14, ["123456789012345678", "234567890123456789"]))
      .toBe("days=14&include_roles=123456789012345678%2C234567890123456789");
  });

  it("builds one message cursor and rejects ambiguous pagination", () => {
    expect(messageCursorQuery({ limit: 25, before: "123456789012345678" }))
      .toBe("limit=25&before=123456789012345678");
    expect(() => messageCursorQuery({
      limit: 25,
      before: "123456789012345678",
      after: "234567890123456789"
    })).toThrow(/only one/);
  });

  it("binds high-impact confirmations to the exact input set", () => {
    expect(confirmationDigest(["123456789012345678"]))
      .toMatch(/^[A-F0-9]{12}$/);
    expect(confirmationDigest(["123456789012345678"]))
      .not.toBe(confirmationDigest(["234567890123456789"]));
  });
});
