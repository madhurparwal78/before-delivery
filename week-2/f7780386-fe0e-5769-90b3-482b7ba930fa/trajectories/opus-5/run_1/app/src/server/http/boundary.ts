import type { NextFunction, Request, Response } from 'express';
import busboy from 'busboy';

import { MAX_JSON_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOAD_REQUEST_BYTES } from '../../shared/domain.js';
import { HttpError } from './errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rejects cross-origin writes. No cross-origin sharing headers are ever sent. */
export function sameOriginOnly(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (origin !== undefined && origin !== '' && UNSAFE_METHODS.has(req.method)) {
    const host = req.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || host === undefined || originHost !== host) {
      next(new HttpError(403, 'cross_origin'));
      return;
    }
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  next();
}

function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = req.get('content-length');
    if (declared !== undefined && Number(declared) > limit) {
      reject(new HttpError(413, 'payload_too_large'));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > limit) {
        settled = true;
        reject(new HttpError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export interface ParsedBody {
  raw: Buffer;
  value: Record<string, unknown>;
  multipart: boolean;
}

function isMultipart(req: Request): boolean {
  return (req.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data');
}

/**
 * Reads the request body once, within the limit that applies to its media
 * type. Uploads are buffered rather than parsed here, so the raw bytes are
 * still available to hash for an idempotency key.
 */
export async function parseRequestBody(req: Request): Promise<ParsedBody> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return { raw: Buffer.alloc(0), value: {}, multipart: false };
  }
  if (isMultipart(req)) {
    return { raw: await readBody(req, MAX_UPLOAD_REQUEST_BYTES), value: {}, multipart: true };
  }

  const declaredType = req.get('content-type');
  const contentType = (declaredType ?? '').split(';')[0]?.trim().toLowerCase();
  if (declaredType !== undefined && contentType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type');
  }

  const raw = await readBody(req, MAX_JSON_BYTES);
  if (raw.byteLength === 0) {
    return { raw, value: {}, multipart: false };
  }
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(422, 'validation_failed', { errors: { body: 'invalid' } });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(422, 'validation_failed', { errors: { body: 'invalid' } });
  }
  return { raw, value: parsed as Record<string, unknown>, multipart: false };
}

export interface UploadedFile {
  filename: string;
  bytes: Buffer;
  truncated: boolean;
  present: boolean;
}

export interface MultipartBody {
  fields: Record<string, string>;
  file: UploadedFile | null;
}

/** Parses the buffered upload body; the file part carries its own size limit. */
export function parseMultipart(req: Request, raw: Buffer): Promise<MultipartBody> {
  return new Promise((resolve, reject) => {
    if (!isMultipart(req)) {
      reject(new HttpError(415, 'unsupported_media_type'));
      return;
    }

    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        // The name is kept exactly as sent so a path-like one can be refused
        // rather than silently trimmed to its last segment.
        preservePath: true,
        limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 20 },
      });
    } catch {
      reject(new HttpError(415, 'unsupported_media_type'));
      return;
    }

    const fields: Record<string, string> = {};
    let file: UploadedFile | null = null;
    let settled = false;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('end', () => {
        file = {
          filename: info.filename ?? '',
          bytes: Buffer.concat(chunks),
          truncated,
          present: true,
        };
      });
    });

    parser.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    parser.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ fields, file });
    });

    parser.end(raw);
  });
}
