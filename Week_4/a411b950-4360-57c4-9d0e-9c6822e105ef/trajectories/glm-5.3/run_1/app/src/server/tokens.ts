import { randomBytes } from "node:crypto";

/** Listening link and proposal tokens carry at least 128 bits of randomness. */
export function randomTokenString(): string {
  return randomBytes(24).toString("base64url");
}

/** Console session tokens. */
export function randomSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
