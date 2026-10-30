import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const newId = () => randomUUID();

/** Stable hash of a JSON value with sorted keys, for comparing idempotent requests. */
export function fingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonical((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
