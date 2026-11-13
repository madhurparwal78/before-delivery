/**
 * Reading a request: its body within the route's cap, its cookies, its origin and the
 * caller's address. Nothing here touches the claim records.
 */

import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';

import { ApiError, apiError, type Audience } from './errors';

export interface UploadedFile {
  field: string;
  fileName: string;
  bytes: Buffer;
  /** The type the browser declared, which the desk ignores when judging a photo. */
  declaredType: string;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** Reads the body, refusing with 413 as soon as the cap is passed. */
export async function readBody(
  request: IncomingMessage,
  limit: number,
  oversizeCode: string,
  audience: Audience,
): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    throw apiError(audience, 413, oversizeCode);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(apiError(audience, 413, oversizeCode));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function contentType(request: IncomingMessage): string {
  return (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function requireJson(request: IncomingMessage, audience: Audience): void {
  const type = contentType(request);
  // A body-less request never has to declare a type.
  if (type === '' && (request.headers['content-length'] ?? '0') === '0') return;
  if (type !== 'application/json') throw apiError(audience, 415, 'unsupported_media_type');
}

export function parseJsonBody(raw: Buffer, audience: Audience): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw apiError(audience, 415, 'unsupported_media_type');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw apiError(audience, 415, 'unsupported_media_type');
  }
  return parsed as Record<string, unknown>;
}

export async function readMultipart(
  request: IncomingMessage,
  limit: number,
  oversizeCode: string,
  audience: Audience,
): Promise<MultipartBody> {
  if (contentType(request) !== 'multipart/form-data') {
    throw apiError(audience, 415, 'unsupported_media_type');
  }

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      request.destroy();
      reject(error);
    };

    const parser = busboy({
      headers: request.headers,
      limits: { fields: 40, files: 40, fieldSize: 1_000_000 },
    });

    parser.on('field', (name, value) => {
      total += Buffer.byteLength(value);
      if (total > limit) fail(apiError(audience, 413, oversizeCode));
      else fields[name] = value;
    });

    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          fail(apiError(audience, 413, oversizeCode));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        files.push({
          field: name,
          fileName: info.filename ?? '',
          bytes: Buffer.concat(chunks),
          declaredType: info.mimeType ?? '',
        });
      });
      stream.on('error', fail);
    });

    parser.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    });
    parser.on('error', (error: unknown) => fail(error instanceof ApiError ? error : apiError(audience, 413, oversizeCode)));

    request.pipe(parser);
  });
}

export function readCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (header === undefined) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const divider = part.indexOf('=');
    if (divider === -1) continue;
    const name = part.slice(0, divider).trim();
    const value = part.slice(divider + 1).trim();
    if (name !== '') cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * The desk serves its pages and its API from one origin. A state-changing request whose
 * `Origin` names any other origin is refused.
 */
export function refuseOtherOrigins(request: IncomingMessage, audience: Audience): void {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return;

  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;

  const host = request.headers.host;
  const expected = new Set([`http://${host}`, `https://${host}`]);
  if (!expected.has(origin)) throw apiError(audience, 403, 'cross_origin');
}

/** The rate for the public parts list is counted per caller connection address. */
export function callerAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}
