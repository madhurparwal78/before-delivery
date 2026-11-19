import { Request, Response, NextFunction } from 'express';
import { env } from './env';
import { timingSafe } from './passwords';

export const BODY_MAX = 262144;
export const GRADING_MAX = 5000000;

export interface AuthedRequest extends Request {
  personId?: string;
  teamIds?: string[];
  personName?: string;
  personRole?: Record<string, string>;
}

export function sendError(res: Response, code: number, body: Record<string, unknown>): void {
  res.status(code).json(body);
}

export function fieldErrors(res: Response, errors: Record<string, string>): void {
  sendError(res, 422, { errors });
}

export function readBody(limit: number): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        sendError(res, 413, { error: 'body_too_large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) {
        (req as AuthedRequest).body = {};
        next();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        sendError(res, 422, { errors: { body: 'Send a JSON body' } });
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendError(res, 422, { errors: { body: 'Send a JSON body' } });
        return;
      }
      (req as AuthedRequest).body = parsed as Record<string, unknown>;
      next();
    });
    req.on('error', () => {
      if (!done) { done = true; sendError(res, 400, { error: 'bad_request' }); }
    });
  };
}

export function jsonOrError(res: Response, body: unknown, code = 200): void {
  res.status(code).json(body);
}

export function gradingAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env().grading) {
    sendError(res, 404, { error: 'not_found' });
    return;
  }
  const hdr = req.header('x-everyweek-grading');
  if (hdr !== '1' || !timingSafe(hdr ?? '', '1')) {
    sendError(res, 404, { error: 'not_found' });
    return;
  }
  next();
}

export async function notFound(res: Response): Promise<void> {
  sendError(res, 404, { error: 'not_found' });
}
