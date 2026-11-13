import type { ServerResponse } from "node:http";
import { err, type Ctx } from "./core.js";
import type { Request } from "./http.js";

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

export function pdf(res: ServerResponse, status: number, bytes: Buffer): void {
  res.writeHead(status, {
    "content-type": "application/pdf",
    "content-length": bytes.length,
    "cache-control": "no-store",
  });
  res.end(bytes);
}

export function requireAuth(req: Request, ctx: Ctx): NonNullable<Ctx["actor"]> {
  if (!ctx.actor) throw err(401, "unauthenticated");
  return ctx.actor;
}
