import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors.js';

export const JSON_BODY_LIMIT = 1_000_000;
export const UPLOAD_BODY_LIMIT = 20_000_000;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function baseType(header: string | undefined): string {
  if (!header) return '';
  const semicolon = header.indexOf(';');
  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

/**
 * Reads a request body up to `limit` bytes inclusive, answering 413 beyond it.
 * Oversized bodies are rejected without buffering the whole stream.
 */
function readBody(req: Request, limit: number, tooLarge: ApiError): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(tooLarge);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

export interface UploadBody {
  readonly fields: Readonly<Record<string, string>>;
  readonly file: { readonly filename: string; readonly bytes: Buffer } | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    jsonBody?: unknown;
    uploadBody?: UploadBody;
  }
}

/** Splits a multipart/form-data body into its text fields and its single file part. */
function parseMultipart(body: Buffer, boundary: string): UploadBody {
  const fields: Record<string, string> = {};
  let file: UploadBody['file'] = null;
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');

  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const headers = body.slice(partStart, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const contentEnd = next === -1 ? body.length : next - 2;
    const content = body.slice(headerEnd + 4, contentEnd);

    const nameMatch = /name="([^"]*)"/.exec(headers);
    const filenameMatch = /filename="([^"]*)"/.exec(headers);
    if (nameMatch) {
      if (filenameMatch) {
        file = { filename: filenameMatch[1] ?? '', bytes: content };
      } else {
        fields[nameMatch[1] ?? ''] = content.toString('utf8');
      }
    }
    cursor = next;
  }

  return { fields, file };
}

/**
 * The same-origin server boundary: body limits, accepted content types and the
 * 413-then-415 head of the error precedence order.
 */
export async function bodyBoundary(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const contentType = baseType(req.headers['content-type']);
  const declaredLength = Number.parseInt(req.headers['content-length'] ?? '', 10);
  const isMultipart = contentType === 'multipart/form-data';
  const limit = isMultipart ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;
  const tooLarge = isMultipart
    ? ApiError.payloadTooLarge('That file is over 20,000,000 bytes.')
    : ApiError.payloadTooLarge('That request body is over 1,000,000 bytes.');

  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    next(tooLarge);
    return;
  }

  const hasBody = !Number.isFinite(declaredLength) || declaredLength > 0;
  if (hasBody && contentType !== '' && contentType !== 'application/json' && !isMultipart) {
    next(ApiError.unsupportedMediaType());
    return;
  }

  try {
    const body = await readBody(req, limit, tooLarge);

    if (isMultipart) {
      const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '');
      const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
      if (!boundary) {
        next(ApiError.unsupportedMediaType());
        return;
      }
      req.uploadBody = parseMultipart(body, boundary.trim());
      next();
      return;
    }

    if (body.length === 0) {
      req.jsonBody = undefined;
      next();
      return;
    }

    if (contentType === '') {
      next(ApiError.unsupportedMediaType());
      return;
    }

    try {
      req.jsonBody = JSON.parse(body.toString('utf8'));
    } catch {
      next(ApiError.validation({ body: 'Send a JSON object.' }));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
