import express, { type Request, type Response } from 'express';
import { withContentionRetry } from './db.js';
import { ApiError } from './errors.js';
import { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT, noStore, sendError } from './http.js';
import { requireCaller, type AuthedRequest } from './api-core.js';
import type { PoolClient } from 'pg';

export interface RouteContext {
  config: import('./config.js').Config;
  killbill: import('./kb.js').KillBillClient;
  storage: import('./storage.js').StorageClient;
}

export type Handler = (req: AuthedRequest, res: Response, ctx: RouteContext) => Promise<void>;

export interface RouteDef {
  method: string;
  pattern: string;
  handler: Handler;
  /** public paths skip the session step of the precedence rule */
  public?: boolean;
  /** inspector paths: any method other than GET answers 405 read_only */
  inspector?: boolean;
  /** requires an Idempotency-Key header */
  idempotent?: boolean;
  /** JSON body limit override (uploads) */
  upload?: boolean;
}

export function contentTypeOk(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

export function isJsonContentType(req: Request): boolean {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

/**
 * A handler may answer inside its transaction; the response is buffered and
 * flushed only after the transaction commits, so a following request can
 * never race the commit.
 */
export function bufferResponse(res: Response): { flush: () => void } {
  const state = { status: undefined as number | undefined, body: undefined as unknown, hasBody: false };
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  const originalStatus = res.status.bind(res);
  res.status = ((code: number) => {
    state.status = code;
    return res;
  }) as typeof res.status;
  res.json = ((data: unknown) => {
    state.body = data;
    state.hasBody = true;
    return res;
  }) as typeof res.json;
  res.send = ((data: unknown) => {
    state.body = data;
    state.hasBody = true;
    return res;
  }) as typeof res.send;
  res.end = ((data?: unknown) => {
    if (data !== undefined) {
      state.body = data;
      state.hasBody = true;
    } else if (!state.hasBody) {
      state.body = undefined;
      state.hasBody = true;
    }
    return res as unknown as typeof res;
  }) as typeof res.end;
  return {
    flush: () => {
      res.status = originalStatus;
      res.json = originalJson;
      res.send = originalSend;
      res.end = originalEnd;
      if (state.status !== undefined) res.statusCode = state.status;
      if (state.hasBody) {
        if (typeof state.body === 'string' || Buffer.isBuffer(state.body)) originalSend(state.body as never);
        else if (state.body === undefined) originalEnd();
        else originalJson(state.body);
      } else {
        originalEnd();
      }
    },
  };
}

/**
 * Wraps a handler with the common pipeline of the precedence rule and one
 * error shape for every API error.
 */
export function wrap(handler: Handler, def: RouteDef, ctx: RouteContext): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    const buffered = bufferResponse(res);
    try {
      if (def.inspector) {
        if (req.method !== 'GET') {
          sendError(res, 405, 'read_only', 'Inspector links are read-only.');
          return;
        }
        noStore(res);
        await handler(authed, res, ctx);
        return;
      }
      if (!def.public) {
        authed.caller = await requireCaller(authed);
      }
      noStore(res);
      await handler(authed, res, ctx);
    } catch (err) {
      if (res.headersSent) {
        buffered.flush();
        return;
      }
      if (err instanceof ApiError) {
        sendError(res, err.status, err.code, err.message, err.extra);
        return;
      }
      sendError(res, 500, 'internal', 'Lineboard hit an unexpected problem. Try again.');
    } finally {
      buffered.flush();
    }
  };
}

export function parseJsonBody(raw: Buffer | undefined): unknown {
  if (raw === undefined || raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('bad_request');
  }
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withContentionRetry(fn);
}



export { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT };
