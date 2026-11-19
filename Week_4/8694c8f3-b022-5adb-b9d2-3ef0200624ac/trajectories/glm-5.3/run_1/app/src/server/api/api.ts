import type { RequestCtx } from '../router.js';
import { readJson } from '../errors.js';
import type { DbPool } from '../db.js';
import type { Storage } from '../storage.js';
import type { Collab } from '../collab.js';

export type Endpoint = (ctx: RequestCtx) => Promise<void> | void;

export interface ApiDeps {
  pool: DbPool;
  storage: Storage;
  collab: Collab;
}

export interface RouteSpec {
  method: string;
  path: string;
  handler: Endpoint;
}

export function jsonOk (ctx: RequestCtx, status: number, body: unknown): void {
  ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  ctx.res.end(JSON.stringify(body));
}

export function noContent (ctx: RequestCtx): void {
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function readBody<T>(ctx: RequestCtx, limit: number): Promise<T> {
  return await readJson(ctx.req, limit) as T;
}
