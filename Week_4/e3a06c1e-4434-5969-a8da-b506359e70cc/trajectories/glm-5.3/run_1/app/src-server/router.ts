// Reads the API surface into typed request/response helpers shared by all routes.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db';
import type { SessionMember } from './auth';
import type { SessionHub } from './hub';
import type { Storage } from './storage';
import type { BillingWorker } from './billing';
import type { KillBillClient } from './killbill';
import type { Config } from './config';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  db: Db;
  hub: SessionHub;
  storage: Storage;
  billing: BillingWorker;
  kb: KillBillClient;
  cfg: Config;
  member: SessionMember | null;
  /** set by requireMember */
  setMember(m: SessionMember): void;
};

export type Handler = (ctx: Ctx) => Promise<void>;

export type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
};

export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const source = path.replace(/:([A-Za-z_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route: r, params };
  }
  return null;
}

export function json(ctx: Ctx, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  ctx.res.end(data);
}

export function bytes(ctx: Ctx, status: number, data: Buffer, contentType: string): void {
  ctx.res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
  ctx.res.end(data);
}

export async function body(ctx: Ctx): Promise<Record<string, unknown>> {
  const { readJson } = await import('./body');
  return readJson(ctx.req);
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
