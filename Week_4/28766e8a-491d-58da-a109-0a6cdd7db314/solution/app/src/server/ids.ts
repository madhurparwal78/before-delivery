// Server ids: a prefix and 12 lowercase letters or digits. Ids made later sort later, so the
// page's connectors are routed in creation order (brief: Ids, Grading routes).
import { randomBytes } from "node:crypto";

let last = 0;

export function newId(prefix: string): string {
  last = Math.max(last + 1, Date.now() * 1000);
  const tail = randomBytes(2).reduce((s, b) => s + (b % 36).toString(36), "");
  return `${prefix}${last.toString(36).padStart(10, "0")}${tail}`;
}

export function token(): string {
  return randomBytes(32).toString("base64url");
}
