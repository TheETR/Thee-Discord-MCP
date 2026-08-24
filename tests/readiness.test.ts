import { describe, expect, it } from "vitest";

import { permissionBits } from "../src/permissions.js";
import { evaluateReleaseReadiness, type ReleaseReadinessInput } from "../src/readiness.js";

const guildId = "123456789012345678";
const applicationId = "234567890123456789";

function readyInput(): ReleaseReadinessInput {
  return {
    bot: { id: applicationId, username: "ELALEM" },
    application: {
      id: applicationId,
      name: "ELALEM",
      bot_public: true,
      terms_of_service_url: "https://example.com/terms",
      privacy_policy_url: "https://example.com/privacy",
      flags: (1 << 19),
      install_params: { scopes: ["bot", "applications.commands"] }
    },
    guild: { id: guildId, name: "ELALEM" },
    member: { user: { id: applicationId }, roles: ["345678901234567890"] },
    roles: [
      { id: guildId, permissions: "0" },
      { id: "345678901234567890", permissions: permissionBits(["Administrator"]) }
    ],
    guildCommands: [{ name: "help" }],
    globalCommands: []
  };
}

describe("public release readiness", () => {
  it("passes automated checks without claiming manual acceptance", () => {
    const result = evaluateReleaseReadiness(readyInput());
    expect(result.automatedChecksPassed).toBe(true);
    expect(result.manualChecksRequired).toEqual(["normal_member_acceptance", "server_profile_traits"]);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "public_bot", status: "pass" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "administration_permissions", status: "pass" }));
  });

  it("reports concrete public-release blockers and missing feature permissions", () => {
    const input = readyInput();
    input.application.bot_public = false;
    delete input.application.privacy_policy_url;
    input.application.install_params = { scopes: ["bot"] };
    input.roles[1] = { id: "345678901234567890", permissions: permissionBits(["ViewChannel"]) };
    input.guildCommands = [];

    const result = evaluateReleaseReadiness(input);
    expect(result.automatedChecksPassed).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "public_bot", status: "fail" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "legal_urls", status: "fail" }));
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "install_scopes",
      status: "fail",
      details: expect.objectContaining({ missing: ["applications.commands"] })
    }));
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "administration_permissions",
      status: "warn",
      details: expect.objectContaining({ missing: expect.arrayContaining(["ManageChannels", "ManageRoles"]) })
    }));
  });

  it("audits only the current token's application identity", () => {
    const input = readyInput();
    input.application.id = "999999999999999999";
    const result = evaluateReleaseReadiness(input);
    expect(result.automatedChecksPassed).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "current_application_identity",
      status: "fail"
    }));
    expect(result.note).toMatch(/active bot token/);
  });
});
