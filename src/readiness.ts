import { permissionBits } from "./permissions.js";

type ReadinessStatus = "pass" | "fail" | "warn" | "manual";

export interface ReadinessCheck {
  id: string;
  status: ReadinessStatus;
  summary: string;
  details?: unknown;
}

export interface ReleaseReadinessInput {
  bot: Record<string, unknown>;
  application: Record<string, unknown>;
  guild: Record<string, unknown>;
  member: Record<string, unknown>;
  roles: Array<Record<string, unknown>>;
  guildCommands: Array<Record<string, unknown>>;
  globalCommands: Array<Record<string, unknown>>;
}

const MESSAGE_CONTENT_FLAGS = (1n << 18n) | (1n << 19n);
const ADMINISTRATOR = BigInt(permissionBits(["Administrator"]));
const REQUIRED_INSTALL_SCOPES = ["bot", "applications.commands"];
const ADMINISTRATION_PERMISSIONS = [
  "ViewChannel",
  "ReadMessageHistory",
  "SendMessages",
  "SendMessagesInThreads",
  "AddReactions",
  "ManageMessages",
  "ManageThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "PinMessages",
  "ManageChannels",
  "ManageRoles",
  "ModerateMembers",
  "KickMembers",
  "BanMembers",
  "MoveMembers",
  "MuteMembers",
  "DeafenMembers",
  "Speak",
  "UseSoundboard",
  "UseExternalSounds",
  "SetVoiceChannelStatus",
  "ManageGuild",
  "ViewAuditLog",
  "CreateEvents",
  "ManageEvents",
  "CreateInstantInvite",
  "ManageWebhooks",
  "CreateGuildExpressions",
  "ManageGuildExpressions"
] as const;

export function guildMemberRoute(guildId: string, userId: string): string {
  return `/guilds/${guildId}/members/${userId}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function installScopes(application: Record<string, unknown>): string[] {
  const scopes = new Set<string>();
  for (const scope of stringArray(record(application.install_params)?.scopes)) scopes.add(scope);
  const integrationTypes = record(application.integration_types_config);
  for (const config of Object.values(integrationTypes ?? {})) {
    const oauth = record(record(config)?.oauth2_install_params);
    for (const scope of stringArray(oauth?.scopes)) scopes.add(scope);
  }
  return [...scopes].sort();
}

function bigint(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  } catch {
    // Invalid external data is treated as no permission/flag bits.
  }
  return 0n;
}

function effectiveGuildPermissions(input: ReleaseReadinessInput): bigint {
  const guildId = typeof input.guild.id === "string" ? input.guild.id : "";
  const memberRoleIds = new Set([guildId, ...stringArray(input.member.roles)]);
  return input.roles.reduce((permissions, role) => {
    return memberRoleIds.has(String(role.id ?? "")) ? permissions | bigint(role.permissions) : permissions;
  }, 0n);
}

function hasPermission(permissions: bigint, name: string): boolean {
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) return true;
  const required = BigInt(permissionBits([name]));
  return (permissions & required) === required;
}

function commandNames(commands: Array<Record<string, unknown>>): string[] {
  return commands
    .map((command) => command.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

export function evaluateReleaseReadiness(input: ReleaseReadinessInput) {
  const checks: ReadinessCheck[] = [];
  const scopes = installScopes(input.application);
  const missingScopes = REQUIRED_INSTALL_SCOPES.filter((scope) => !scopes.includes(scope));
  const permissions = effectiveGuildPermissions(input);
  const missingPermissions = ADMINISTRATION_PERMISSIONS.filter((name) => !hasPermission(permissions, name));
  const applicationFlags = bigint(input.application.flags);
  const guildCommandNames = commandNames(input.guildCommands);
  const globalCommandNames = commandNames(input.globalCommands);

  checks.push({
    id: "current_application_identity",
    status: input.application.id === input.bot.id ? "pass" : "fail",
    summary: input.application.id === input.bot.id
      ? "The bot token and current application identity match."
      : "The bot token does not match the current application identity."
  });
  checks.push({
    id: "public_bot",
    status: input.application.bot_public === true ? "pass" : "fail",
    summary: input.application.bot_public === true
      ? "Public bot installation is enabled."
      : "Public bot installation is not enabled for this application."
  });
  checks.push({
    id: "legal_urls",
    status: typeof input.application.terms_of_service_url === "string"
      && typeof input.application.privacy_policy_url === "string" ? "pass" : "fail",
    summary: "Terms of Service and Privacy Policy URLs must both be configured.",
    details: {
      termsOfService: typeof input.application.terms_of_service_url === "string",
      privacyPolicy: typeof input.application.privacy_policy_url === "string"
    }
  });
  checks.push({
    id: "install_scopes",
    status: missingScopes.length === 0 ? "pass" : "fail",
    summary: missingScopes.length === 0
      ? "Default installation exposes bot and application-command scopes."
      : "Default installation is missing required OAuth scopes.",
    details: { configured: scopes, missing: missingScopes }
  });
  checks.push({
    id: "message_content_intent",
    status: (applicationFlags & MESSAGE_CONTENT_FLAGS) !== 0n ? "pass" : "warn",
    summary: (applicationFlags & MESSAGE_CONTENT_FLAGS) !== 0n
      ? "Application flags report Message Content access."
      : "Message Content access is not visible in application flags; verify it in the Developer Portal."
  });
  checks.push({
    id: "application_commands",
    status: guildCommandNames.length + globalCommandNames.length > 0 ? "pass" : "warn",
    summary: guildCommandNames.length + globalCommandNames.length > 0
      ? "At least one guild or global application command is registered."
      : "No guild or global application commands are registered.",
    details: { guild: guildCommandNames, global: globalCommandNames }
  });
  checks.push({
    id: "guild_membership",
    status: input.member.user !== undefined ? "pass" : "warn",
    summary: input.member.user !== undefined
      ? "The current bot is a member of the selected guild."
      : "Guild membership was returned without an embedded user; verify the bot identity manually."
  });
  checks.push({
    id: "administration_permissions",
    status: missingPermissions.length === 0 ? "pass" : "warn",
    summary: missingPermissions.length === 0
      ? "The bot's guild roles cover the complete named administration surface."
      : "Some feature-dependent administration permissions are missing.",
    details: { missing: missingPermissions }
  });
  checks.push({
    id: "normal_member_acceptance",
    status: "manual",
    summary: "Test onboarding, command containment, EMSALI direct chat, music, voice, and mobile role display with a normal member account."
  });
  checks.push({
    id: "server_profile_traits",
    status: "manual",
    summary: "Server Profile traits are user-only Discord settings and must be reviewed in the Discord client."
  });

  const automatedChecksPassed = checks.every((check) => check.status !== "fail");
  return {
    auditedApplication: {
      id: input.application.id,
      name: input.application.name,
      botId: input.bot.id,
      botUsername: input.bot.username
    },
    guild: { id: input.guild.id, name: input.guild.name },
    automatedChecksPassed,
    manualChecksRequired: checks.filter((check) => check.status === "manual").map((check) => check.id),
    checks,
    note: "This audits only the application authenticated by the active bot token. A separate public product bot must be checked using that application's own token and Developer Portal settings."
  };
}
