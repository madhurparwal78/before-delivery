import type { IncomingMessage, ServerResponse } from "node:http";

export type Role = "owner" | "kiln_tech" | "member";

export type Person = {
  id: string;
  studio_id: string;
  email: string;
  name: string;
  handle: string;
  role: Role;
  membership: "member" | "drop_off" | null;
  card_status: "none" | "on_file";
  active: boolean;
};

export type Studio = {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  pickup_window_days: number;
};

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  rawBody: Buffer;
  body: Record<string, unknown>;
  person: Person | null;
  studio: Studio | null;
  sessionToken: string | null;
};

export const JSON_LIMIT = 100000;
export const PHOTO_REQUEST_LIMIT = 5100000;
export const PHOTO_FILE_LIMIT = 5000000;

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function setCookie(res: ServerResponse, name: string, value: string, opts: { secure: boolean }): void {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const all = Array.isArray(existing) ? existing.concat(parts.join("; ")) : typeof existing === "string" ? [existing, parts.join("; ")] : parts.join("; ");
  res.setHeader("Set-Cookie", all);
}

export function clearCookie(res: ServerResponse, name: string): void {
  const existing = res.getHeader("Set-Cookie");
  const cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const all = Array.isArray(existing) ? existing.concat(cookie) : typeof existing === "string" ? [existing, cookie] : cookie;
  res.setHeader("Set-Cookie", all);
}
