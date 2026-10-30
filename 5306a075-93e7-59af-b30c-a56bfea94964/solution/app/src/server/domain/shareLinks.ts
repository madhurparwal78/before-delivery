// Share-link activity (brief: Business rules › Share links), decided only here.
import { randomBytes } from "node:crypto";
import type { ShareLink } from "../../shared/api.js";
import { iso } from "./time.js";

export interface ShareLinkRow {
  id: string; token: string; created_at: Date; expires_in_seconds: number | null; expires_at: Date | null; revoked_at: Date | null;
}

/** 256 random bits in URL-safe base64. */
export const newShareToken = (): string => randomBytes(32).toString("base64url");

/** Active while not revoked and server time is strictly before expiresAt. */
export function shareLinkStatus(link: ShareLinkRow, now: number): ShareLink["status"] {
  if (link.revoked_at !== null) return "revoked";
  if (link.expires_at !== null && now >= link.expires_at.getTime()) return "expired";
  return "active";
}

/** A fresh window: createdAt now (whole seconds) and expiresAt = createdAt + lifetime. */
export function linkWindow(lifetimeSeconds: number | null, now: number): { createdAt: Date; expiresAt: Date | null } {
  const createdAt = new Date(Math.floor(now / 1000) * 1000);
  return { createdAt, expiresAt: lifetimeSeconds === null ? null : new Date(createdAt.getTime() + lifetimeSeconds * 1000) };
}

export function toShareLink(link: ShareLinkRow, baseUrl: string, now: number): ShareLink {
  return {
    id: link.id, token: link.token, url: `${baseUrl}/r/${link.token}`, createdAt: iso(link.created_at),
    expiresInSeconds: link.expires_in_seconds, expiresAt: link.expires_at && iso(link.expires_at),
    revokedAt: link.revoked_at && iso(link.revoked_at), status: shareLinkStatus(link, now),
  };
}
