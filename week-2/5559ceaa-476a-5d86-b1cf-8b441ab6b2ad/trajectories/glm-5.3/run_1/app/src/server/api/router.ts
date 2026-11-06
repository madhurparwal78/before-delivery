import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { User } from "../../shared/types.js";

export const JSON_LIMIT = 2_000_000;
export const ZIP_LIMIT = 5_000_000;

export interface RouteCtx {
  pool: Pool;
  body: unknown;
  raw: Buffer;
  user: User | null;
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type Handler = (ctx: RouteCtx) => Promise<Respond>;

export interface Respond {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];
  private wildcard: { method: string; prefix: string; handler: Handler } | null = null;

  add(method: string, pattern: string, handler: Handler): void {
    if (pattern.endsWith("*")) {
      if (this.wildcard) throw new Error("only one wildcard route allowed");
      this.wildcard = { method, prefix: pattern.slice(0, -1), handler };
      return;
    }
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | { methodMismatch: true } | null {
    const parts = path.split("/").filter(Boolean);
    let sawPathMatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const rp = r.parts[i] as string;
        const pp = parts[i] as string;
        if (rp.startsWith("<") && rp.endsWith(">")) params[rp.slice(1, -1)] = decodeURIComponent(pp);
        else if (rp !== pp) { ok = false; break; }
      }
      if (!ok) continue;
      sawPathMatch = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    if (this.wildcard && path.startsWith(this.wildcard.prefix)) {
      sawPathMatch = true;
      if (this.wildcard.method === method) return { handler: this.wildcard.handler, params: {} };
    }
    return sawPathMatch ? { methodMismatch: true } : null;
  }

  has(path: string): boolean {
    return this.match("GET", path) !== null;
  }
}

export function json(status: number, body?: unknown, headers?: Record<string, string>): Respond {
  const out: Respond = { status };
  if (body !== undefined) out.body = body;
  if (headers !== undefined) out.headers = headers;
  return out;
}

export function sessionCookie(token: string): string {
  return `rb_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `rb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
