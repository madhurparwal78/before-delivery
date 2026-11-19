import { createHash } from "node:crypto";

/** JSON with keys sorted at every depth and no whitespace, so key order in a body never matters. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 of METHOD, path and the canonical body: the identity of a request for replay and conflict decisions. */
export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}
