import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiFailure, failures } from './errors.js';
import { sessionUser, type SessionUser } from './session.js';

export const JSON_BODY_LIMIT = 64000;
export const UPLOAD_LIMIT = 5200000;
export const FILE_LIMIT = 5000000;

export interface Ctx {
  req: Request;
  res: Response;
  now: Date;
  body: Record<string, unknown>;
  user: SessionUser | null;
}

export interface Reply {
  status: number;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<Reply | null>;

export function nosniff(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/** Only same-origin use is supported, so no cross-origin headers are sent. */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== 'null') {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === req.headers.host;
    } catch {
      sameHost = false;
    }
    if (!sameHost) {
      sendFailure(res, failures.crossOrigin());
      return;
    }
  }
  next();
}

export async function readRawBody(req: Request, limit: number): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) {
    throw limit === JSON_BODY_LIMIT ? failures.payloadTooLarge() : failures.fileTooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > limit) {
      throw limit === JSON_BODY_LIMIT ? failures.payloadTooLarge() : failures.fileTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const raw = await readRawBody(req, JSON_BODY_LIMIT);
  if (raw.byteLength === 0) return {};
  if (!isJsonContentType(req.headers['content-type'])) throw failures.unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw failures.invalidJson();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw failures.invalidJson();
  }
  return parsed as Record<string, unknown>;
}

export function sendFailure(res: Response, failure: ApiFailure): void {
  res.status(failure.status).type('application/json; charset=utf-8').send(JSON.stringify(failure.body));
}

function sendUnexpected(res: Response): void {
  sendFailure(
    res,
    new ApiFailure('validation', 'The request could not be completed.', { errors: {} }),
  );
}

export function route(handler: Handler, options: { parseBody?: boolean } = {}): RequestHandler {
  return (req: Request, res: Response): void => {
    void (async () => {
      const now = new Date();
      try {
        const body = options.parseBody === false ? {} : await parseJsonBody(req);
        const user = await sessionUser(req, now);
        const reply = await handler({ req, res, now, body, user });
        if (reply === null) return;
        if (reply.status === 204) {
          res.status(204).end();
          return;
        }
        res.status(reply.status).type('application/json; charset=utf-8').send(JSON.stringify(reply.body));
      } catch (error) {
        if (error instanceof ApiFailure) sendFailure(res, error);
        else sendUnexpected(res);
      }
    })();
  };
}

/** A single path parameter, which Express may hand over as an array. */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export const ok = (body: unknown): Reply => ({ status: 200, body });
export const created = (body: unknown): Reply => ({ status: 201, body });
export const noContent = (): Reply => ({ status: 204, body: null });
