import { createHash } from "node:crypto";
import { canonicalNumber, roundHalfEven } from "./numbers.js";

/** Canonical JSON per the brief: no whitespace, code-point-sorted keys, JS number format. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => {
    const la = [...a].length, lb = [...b].length;
    for (let i = 0; i < Math.min(la, lb); i++) {
      const ca = a.codePointAt(i)!, cb = b.codePointAt(i)!;
      if (ca !== cb) return ca - cb;
      if (ca > 0xffff) i++;
    }
    return la - lb;
  });
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    keys.map((k) => canonicalString(k) + ":" + canonicalJson(obj[k])).join(",") +
    "}"
  );
}

function canonicalString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c <= 0x1f) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  return out + '"';
}

/** Geometry digest: lowercase hex SHA-256 of the canonical solid JSON bytes. */
export function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const mm = (n: number) => roundHalfEven(n, 3);
