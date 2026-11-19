// Review link liveness and expiry, decided by the server clock.
import { randomBytes } from "node:crypto";
import { config } from "../config.js";

type LinkStatus = "live" | "revoked" | "expired";

interface LinkTimes {
  expires_at: Date;
  revoked_at: Date | null;
}

export function linkStatus(link: LinkTimes, now: Date = new Date()): LinkStatus {
  if (link.revoked_at !== null) return "revoked";
  if (now.getTime() >= link.expires_at.getTime()) return "expired";
  return "live";
}

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function expiryFrom(mintedAt: Date): Date {
  return new Date(mintedAt.getTime() + config.reviewLinkTtlSeconds * 1000);
}

export function linkUrl(token: string): string {
  return `${config.publicUrl}/review/${token}`;
}
