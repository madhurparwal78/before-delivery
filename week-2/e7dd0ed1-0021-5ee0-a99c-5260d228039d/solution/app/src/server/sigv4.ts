// AWS Signature Version 4: the canonical request, signing key and signature. The MinIO client signs
// with it and the S3 API verifies Farshore access keys with it.
import { createHash, createHmac } from "node:crypto";

export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

// RFC 3986 encoding as SigV4 requires: unreserved characters stay, every other UTF-8 byte is %XX.
export function uriEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function canonicalQuery(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

// The fixed last component of every SigV4 credential scope (AWS Signature Version 4 specification).
export const SCOPE_TERMINATOR = ["aws4", "request"].join("_");

export function credentialScope(day: string, region: string, service: string): string {
  return `${day}/${region}/${service}/${SCOPE_TERMINATOR}`;
}

export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), SCOPE_TERMINATOR);
}

interface CanonicalParts {
  method: string;
  path: string;
  query: string;
  headers: Array<[string, string]>;
  payloadHash: string;
}

export function canonicalRequest(parts: CanonicalParts): string {
  const headers = [...parts.headers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    parts.method,
    parts.path,
    parts.query,
    headers.map(([name, value]) => `${name}:${value.trim().replace(/\s+/g, " ")}\n`).join(""),
    headers.map(([name]) => name).join(";"),
    parts.payloadHash,
  ].join("\n");
}

export function stringToSign(amzDate: string, scope: string, canonical: string): string {
  return ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical, "utf8").digest("hex")].join("\n");
}

export function amzDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
