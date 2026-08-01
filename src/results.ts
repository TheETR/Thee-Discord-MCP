import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function normalizeDiscordPayload(value: unknown): unknown {
  if (value === undefined || value === null) return { ok: true };
  if (value instanceof ArrayBuffer) {
    return value.byteLength === 0 ? { ok: true } : { binary: true, byteLength: value.byteLength };
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength === 0 ? { ok: true } : { binary: true, byteLength: value.byteLength };
  }
  return value;
}

export function jsonResult(value: unknown): CallToolResult {
  const normalized = normalizeDiscordPayload(value);
  return {
    content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
    structuredContent: isPlainRecord(normalized) ? normalized : { value: normalized }
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
