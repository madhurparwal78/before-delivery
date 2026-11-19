// Time-based one-time codes (RFC 6238) for the seeded identities' Keycloak credentials.

import { createHmac } from "node:crypto";
import { config } from "./config.js";

export function currentCode(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / config.limits.FLAN_TOTP_PERIOD_S);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(secret, "utf8")).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
