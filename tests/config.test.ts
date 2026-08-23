import { describe, expect, it } from "vitest";

import { resolveStateFile } from "../src/config.js";

describe("state path confinement", () => {
  it("accepts package-local state paths", () => {
    expect(resolveStateFile(".data/state.json")).toMatch(/[\\/]\.data[\\/]state\.json$/);
  });

  it.each(["../state.json"])(
    "rejects a state path outside the package: %s",
    (path) => expect(() => resolveStateFile(path)).toThrow(/inside the package directory/)
  );
});
