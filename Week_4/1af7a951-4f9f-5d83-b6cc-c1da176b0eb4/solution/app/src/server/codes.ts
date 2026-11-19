import { createHash, randomBytes } from "node:crypto";

/** Access codes and session tokens are stored only as SHA-256 digests. */
export function digest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** An unguessable code of 24 URL-safe characters (144 random bits). */
export function newSecret(): string {
  return randomBytes(18).toString("base64url");
}
