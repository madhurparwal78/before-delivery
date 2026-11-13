import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { JSON_BODY_LIMIT_BYTES, UPLOAD_REQUEST_LIMIT_BYTES } from '../config.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ParsedBody {
  raw: Buffer;
  json: Record<string, unknown> | unknown[];
}

declare module 'express-serve-static-core' {
  interface Request {
    parsedBody?: ParsedBody;
  }
}

/**
 * Reads the body up to the limit. A body that is too large is drained rather than cut off,
 * so the 413 answer still reaches the client.
 */
function readRaw(request: Request, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return Promise.reject(new AppError('payload_too_large'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflowed = false;
    request.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      total += chunk.length;
      if (total > limit) {
        overflowed = true;
        chunks.length = 0;
        reject(new AppError('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!overflowed) resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => reject(error));
  });
}

function isJsonType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export function isMultipartType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0]?.trim().toLowerCase() === 'multipart/form-data';
}

const UPLOAD_PATH = '/curator/media';

/** 413 and 415 come first, so the body is read before anything else is judged. */
export async function parseBody(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    if (!STATE_CHANGING.has(request.method)) {
      next();
      return;
    }
    const contentType = request.headers['content-type'];
    if (request.path.endsWith(UPLOAD_PATH)) {
      if (!isMultipartType(contentType)) throw new AppError('unsupported_media_type');
      request.parsedBody = { raw: await readRaw(request, UPLOAD_REQUEST_LIMIT_BYTES), json: {} };
      next();
      return;
    }
    const raw = await readRaw(request, JSON_BODY_LIMIT_BYTES);
    if (raw.length === 0 && !contentType) {
      request.parsedBody = { raw, json: {} };
      next();
      return;
    }
    if (!isJsonType(contentType)) throw new AppError('unsupported_media_type');
    if (raw.length === 0) {
      request.parsedBody = { raw, json: {} };
      next();
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new AppError('validation_failed', { fields: {} });
    }
    if (typeof json !== 'object' || json === null) throw new AppError('validation_failed', { fields: {} });
    request.parsedBody = { raw, json: json as Record<string, unknown> };
    next();
  } catch (error) {
    next(error);
  }
}

/** A state-changing request from another origin is refused; no CORS headers are ever sent. */
export function sameOrigin(request: Request, _response: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(request.method)) {
    next();
    return;
  }
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    const expected = `${request.protocol}://${request.headers.host ?? ''}`;
    if (origin !== expected) {
      next(new AppError('forbidden_origin'));
      return;
    }
  }
  next();
}

export function body(request: Request): Record<string, unknown> {
  const json = request.parsedBody?.json;
  return json && !Array.isArray(json) ? json : {};
}
