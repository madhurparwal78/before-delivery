// Shared route context and response helpers.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { S3 } from './s3.js';
import type { RentalHouse } from './rental-house.js';
import { writeJson, writeProblem, problems, type Problem } from './api-core.js';
import type { Json } from '../shared/problems.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: { [name: string]: string };
  jsonBody: unknown;
  rawBody: Buffer | null;
  idempotencyKey: string | null;
  db: Database;
  config: Config;
  s3: S3;
  house: RentalHouse;
  service: Services;
  scratch: { [key: string]: unknown };
}

export interface Services {
  sse: import('./sse.js').SseHub;
}

export class RouteError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.code);
  }
}

export function fail(problem: Problem): never {
  throw new RouteError(problem);
}

export interface Route {
  method: string;
  path: string;
  handler: (ctx: Ctx) => Promise<void>;
  keyed: boolean;
  conditional: boolean;
  rawBody: boolean;
}

export function route(
  method: string,
  path: string,
  handler: (ctx: Ctx) => Promise<void>,
  options: Partial<Pick<Route, 'keyed' | 'conditional' | 'rawBody'>> = {},
): Route {
  return { method, path, handler, keyed: options.keyed ?? false, conditional: options.conditional ?? false, rawBody: options.rawBody ?? false };
}

export function respond(ctx: Ctx, status: number, body: Json, headers: Record<string, string> = {}): void {
  writeJson(ctx.res, status, body, headers);
}

export function respondNoContent(ctx: Ctx): void {
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

export function respondBytes(ctx: Ctx, status: number, bytes: Buffer, contentType: string, headers: Record<string, string> = {}): void {
  ctx.res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    ...headers,
  });
  ctx.res.end(bytes);
}

export { writeProblem, problems };
