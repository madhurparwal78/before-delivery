// Signed download links: a token names one derivative, the caller and the covering grant, and carries its expiry.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { toIso } from "../shared/dates.ts";

interface LinkClaims {
  derivativeId: string;
  principalId: string;
  /** The covering grant id, or "implicit" for an employee's implicit grant. */
  grant: string;
  expiresAt: string;
}

const sign = (payload: string): string => createHmac("sha256", config.linkSigningSecret).update(payload).digest("base64url");

export function issueToken(claims: LinkClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The claims of an untampered token, or null for anything else. */
export function readToken(token: string): LinkClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return claims as LinkClaims;
}

export const expiryFrom = (now: string): string => toIso(Date.parse(now) + config.downloadLinkTtlSeconds * 1000);
