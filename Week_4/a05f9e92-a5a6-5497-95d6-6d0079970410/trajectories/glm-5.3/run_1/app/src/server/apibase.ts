// API router: dispatch, error order, rate checks, idempotent replays.

import { IncomingMessage, ServerResponse } from 'node:http';
import { Db, clock } from './db.js';
import { ApiError, writeError, unauthenticated, forbidden, notFound, operatorOnly, rateLimited } from './errors.js';
import { Session, loadSession, readSessionCookie, requireSession, actingAs } from './auth.js';
import { checkRate } from './ratelimit.js';
import { Ctx } from './server.js';

export interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  ctx: Ctx;
  url: URL;
  method: string;
  path: string;
  session: Session | null;
  body: unknown;
  rawBody: Buffer | null;
}

export function isWrite(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** Read a JSON body up to the transport limit. */
export function readBody(req: IncomingMessage, limit: number): Promise<{ buffer: Buffer | null; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        // The response is sent by the caller; pause the stream so the socket
        // stays open long enough to answer 413.
        req.pause();
        resolve({ buffer: null, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve({ buffer: Buffer.concat(chunks), tooLarge: false });
    });
    req.on('error', () => {
      if (!done) resolve({ buffer: Buffer.concat(chunks), tooLarge: false });
    });
  });
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
