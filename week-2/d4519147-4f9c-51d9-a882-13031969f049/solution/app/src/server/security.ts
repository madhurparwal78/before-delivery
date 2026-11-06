import type { IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

function isInvitation(path: string): boolean {
  return path.startsWith("/api/invites/") || path.startsWith("/invite/");
}

/** The headers every response carries, decided by its path. */
export function securityHeaders(url: string): Record<string, string> {
  const path = url.split("?")[0] ?? "/";
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": isInvitation(path) ? "no-referrer" : "same-origin",
    "Permissions-Policy": PERMISSIONS,
  };
  if (path.startsWith("/api/") || isInvitation(path)) headers["Cache-Control"] = "no-store";
  if (path.startsWith("/api/downloads/")) headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
  return headers;
}

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

export function documentPolicy(nonce: string): string {
  return `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
}

const publicOrigin = new URL(config.publicUrl).origin;

/** The Origin rule for state-changing requests. */
export function passesOriginRule(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // The server itself speaks plain HTTP; an https public address is matched through APP_PUBLIC_URL.
    const addressed = req.headers.host ? `http://${req.headers.host}` : null;
    return origin === addressed || origin === publicOrigin;
  }
  const site = req.headers["sec-fetch-site"];
  return site !== "cross-site" && site !== "same-site";
}

export function clientIp(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}
