import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, invalidField, tooLarge, unsupportedMediaType } from '../shared/errors';
import { config } from './config';

export interface JsonRequest extends Request {
  jsonBody: Record<string, unknown>;
  rawBody: Buffer;
}

export function body(req: Request): Record<string, unknown> {
  return (req as JsonRequest).jsonBody;
}

export function rawBody(req: Request): Buffer {
  return (req as JsonRequest).rawBody;
}

function bodyLimitFor(req: Request): number {
  if (req.path === '/api/grading/seed') return config.bodyLimits.grading;
  if (req.method === 'POST' && /\/imports$/.test(req.path)) return config.bodyLimits.upload;
  return config.bodyLimits.json;
}

function expectsRawBody(req: Request): boolean {
  return req.method === 'POST' && /\/imports$/.test(req.path);
}

function readRawBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge(limit));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

/** The server boundary: body size, content type and JSON parsing, before anything else. */
export const boundary: RequestHandler = (req, _res, next) => {
  const limit = bodyLimitFor(req);
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    next(tooLarge(limit));
    return;
  }
  readRawBody(req, limit).then(
    (buffer) => {
      const request = req as JsonRequest;
      request.rawBody = buffer;
      request.jsonBody = {};
      if (buffer.length === 0 || expectsRawBody(req)) {
        next();
        return;
      }
      const contentType = String(req.headers['content-type'] ?? '');
      if (!contentType.toLowerCase().startsWith('application/json')) {
        next(unsupportedMediaType());
        return;
      }
      try {
        const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          next(invalidField('body'));
          return;
        }
        request.jsonBody = parsed as Record<string, unknown>;
        next();
      } catch {
        next(invalidField('body'));
      }
    },
    (error: unknown) => next(error),
  );
};

export function handler(run: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    run(req, res).catch((error: unknown) => next(error));
  };
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.status).json(error.body());
    return;
  }
  res.status(500).json({ error: 'server_error' });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (!(error instanceof AppError)) {
    process.stderr.write(`request failed: ${String(error)}\n`);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  sendError(res, error);
}
