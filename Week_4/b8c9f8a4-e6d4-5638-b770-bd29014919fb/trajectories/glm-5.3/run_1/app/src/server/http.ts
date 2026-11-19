import express from 'express';
import type { Request, Response, NextFunction } from 'express';

export const JSON_BODY_LIMIT = 65_536;
export const CAPTURE_BODY_LIMIT = 262_144;
export const UPLOAD_REQUEST_LIMIT = 8_200_000;

export interface ErrorBody { error: string; message: string; [k: string]: unknown; }

/** The one error shape. sendError always uses this body. */
export function sendError(res: Response, status: number, error: string, message: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error, message, ...extra } satisfies ErrorBody);
}

export function sendValidation(res: Response, errors: Record<string, string>): void {
  res.status(422).json({ error: 'validation', message: 'Some fields need attention', errors });
}

/** Refuse a state-changing request whose Origin names another origin. */
export function sameOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) { next(); return; }
  const host = req.headers.host;
  if (host && originHost(origin) === host) { next(); return; }
  sendError(res, 403, 'cross_origin', 'Requests from another origin are not accepted');
}

function originHost(origin: string): string {
  try { return new URL(origin).host; } catch { return ''; }
}

/** Reading a bounded body for uploads without express's built-in limits. */
export function readRawBody(req: Request, limit: number): Promise<{ buffer: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (tooLarge: boolean) => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('close');
      resolve({ buffer: Buffer.concat(chunks), tooLarge });
    };
    if (Number.isFinite(declared) && declared > limit) { finish(true); return; }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { finish(true); return; }
      chunks.push(chunk);
    });
    req.on('end', () => finish(false));
    req.on('error', reject);
    req.on('close', () => finish(size > limit));
  });
}
