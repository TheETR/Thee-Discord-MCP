import { describe, expect, it } from "vitest";

import { buildMessageSearchQuery, buildPollMessageBody, parseDataUri, redactDataUris } from "../src/extra-tools.js";

describe("extra tool helpers", () => {
  it("parses an allowed data URI and enforces the decoded size", () => {
    const parsed = parseDataUri("data:image/png;base64,aGVsbG8=", ["image/png"], 5);
    expect(parsed.mimeType).toBe("image/png");
    expect(parsed.data.toString("utf8")).toBe("hello");
    expect(() => parseDataUri("data:image/png;base64,aGVsbG8=", ["image/png"], 4)).toThrow(/between 1 and 4 bytes/);
  });

  it("rejects unexpected data URI media types", () => {
    expect(() => parseDataUri("data:text/plain;base64,aGVsbG8=", ["image/png"], 100)).toThrow(/image\/png/);
  });

  it("redacts upload data from dry-run previews", () => {
    expect(redactDataUris({ sound: "data:audio/ogg;base64,aGVsbG8=", nested: ["safe"] })).toEqual({
      sound: "<data-uri:audio/ogg>",
      nested: ["safe"]
    });
  });

  it("builds the Discord poll message payload", () => {
    expect(buildPollMessageBody({
      question: "Which room?",
      answers: ["Gaming", "Music"],
      durationHours: 24,
      allowMultiselect: false,
      content: "Vote below"
    })).toEqual({
      content: "Vote below",
      poll: {
        question: { text: "Which room?" },
        answers: [{ poll_media: { text: "Gaming" } }, { poll_media: { text: "Music" } }],
        duration: 24,
        allow_multiselect: false,
        layout_type: 1
      }
    });
  });

  it("preserves repeated message-search filters", () => {
    const query = new URLSearchParams(buildMessageSearchQuery({
      content: "release notes",
      channelIds: ["11111111111111111", "22222222222222222"],
      authorTypes: ["bot", "webhook"],
      has: ["link"],
      limit: 25,
      offset: 0,
      sortBy: "relevance",
      sortOrder: "desc",
      includeNsfw: false
    }));
    expect(query.get("content")).toBe("release notes");
    expect(query.getAll("channel_id")).toEqual(["11111111111111111", "22222222222222222"]);
    expect(query.getAll("author_type")).toEqual(["bot", "webhook"]);
    expect(query.getAll("has")).toEqual(["link"]);
  });
});
