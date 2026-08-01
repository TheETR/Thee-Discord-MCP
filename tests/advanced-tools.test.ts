import { describe, expect, it } from "vitest";

import { membershipScreeningBody, queryString, redactWebhookSecrets } from "../src/advanced-tools.js";

describe("advanced tool helpers", () => {
  it("encodes query parameters and omits undefined values", () => {
    expect(queryString({ query: "hello world", limit: 25, after: undefined, with_member: true }))
      .toBe("?query=hello+world&limit=25&with_member=true");
  });

  it("redacts webhook credentials recursively", () => {
    expect(redactWebhookSecrets({
      id: "123",
      token: "secret",
      url: "https://discord.com/api/webhooks/123/secret",
      nested: [{ token: "another", name: "safe" }]
    })).toEqual({
      id: "123",
      token: "<redacted>",
      url: "<redacted>",
      nested: [{ token: "<redacted>", name: "safe" }]
    });
  });

  it("leaves non-secret webhook metadata intact", () => {
    expect(redactWebhookSecrets([{ id: "123", name: "ELALEM Guide", channel_id: "456" }]))
      .toEqual([{ id: "123", name: "ELALEM Guide", channel_id: "456" }]);
  });

  it("serializes Membership Screening terms in Discord's expected form_fields string", () => {
    const body = membershipScreeningBody({
      enabled: true,
      description: null,
      rules: ["Treat people with respect.", "Keep discussions in the right channels."],
      label: "Read and agree to the server rules",
      required: true
    });
    expect(body.enabled).toBe(true);
    expect(body.description).toBeNull();
    expect(JSON.parse(String(body.form_fields))).toEqual([{
      field_type: "TERMS",
      label: "Read and agree to the server rules",
      required: true,
      values: ["Treat people with respect.", "Keep discussions in the right channels."]
    }]);
  });
});
