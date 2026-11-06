import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { fail, sendError } from '../errors.js';

export const MAX_BODY_BYTES = 16384;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'express-serve-static-core' {
  interface Request {
    jsonBody?: Record<string, unknown>;
    rawBody?: Buffer;
  }
}

/**
 * The body, content-type and origin rules of the server boundary, applied to
 * every request before anything else looks at it.
 */
export function boundary(req: Request, res: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;

  req.on('data', (chunk: Buffer) => {
    if (refused) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      /* The answer is sent while the rest of the body is drained, so that the
         caller reads the 413 instead of a closed connection. */
      refused = true;
      chunks.length = 0;
      res.setHeader('Connection', 'close');
      sendError(res, fail('payload_too_large'));
      req.resume();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (refused) return;
    const raw = Buffer.concat(chunks);
    req.rawBody = raw;

    if (raw.length > 0) {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        sendError(res, fail('unsupported_media_type'));
        return;
      }
    }

    if (STATE_CHANGING.has(req.method)) {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== config().publicOrigin) {
        sendError(res, fail('cross_origin'));
        return;
      }
    }

    if (raw.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        sendError(res, fail('validation', { fields: { body: 'Send a JSON object.' } }));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendError(res, fail('validation', { fields: { body: 'Send a JSON object.' } }));
        return;
      }
      req.jsonBody = parsed as Record<string, unknown>;
    } else {
      req.jsonBody = {};
    }
    next();
  });

  req.on('error', () => {
    if (!refused && !res.headersSent) {
      sendError(res, fail('validation', { fields: { body: 'Send a JSON object.' } }));
    }
  });
}

/** Paths that are never served: they render the not-found page. */
const NEVER_SERVED = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)run\.json$/i,
  /(^|\/)src(\/|$)/i,
  /\.(ts|tsx|map|sql|pem|key|crt|lock)$/i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)tsconfig[^/]*\.json$/i,
  /(^|\/)vite\.config\./i,
];

export const isNeverServed = (pathname: string): boolean =>
  NEVER_SERVED.some((pattern) => pattern.test(pathname));
