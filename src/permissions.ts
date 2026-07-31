import { PermissionFlagsBits } from "discord-api-types/v10";

const permissionEntries = Object.entries(PermissionFlagsBits).filter(
  (entry): entry is [string, bigint] => typeof entry[1] === "bigint"
);
const permissionMap = new Map(permissionEntries.map(([name, value]) => [name.toLowerCase(), value]));

export function permissionBits(names: readonly string[] | undefined): string {
  let bits = 0n;
  for (const name of names ?? []) {
    const value = permissionMap.get(name.replace(/[ _-]/g, "").toLowerCase());
    if (value === undefined) {
      throw new Error(`Unknown Discord permission: ${name}`);
    }
    bits |= value;
  }
  return bits.toString();
}

export function knownPermissionNames(): string[] {
  return permissionEntries.map(([name]) => name).sort();
}
