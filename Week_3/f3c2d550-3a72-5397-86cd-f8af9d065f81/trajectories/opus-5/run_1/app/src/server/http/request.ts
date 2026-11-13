import type { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import { ApiError } from '../domain/errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 16_000_000;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The app sends no cross-origin sharing headers and refuses cross-origin writes. */
export function assertSameOrigin(request: IncomingMessage): void {
  if (!STATE_CHANGING.has(request.method ?? 'GET')) return;
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError('cross_origin');
  }
  if (originHost !== request.headers.host) throw new ApiError('cross_origin');
}

function declaredLength(request: IncomingMessage): number | null {
  const raw = request.headers['content-length'];
  if (raw === undefined) return null;
  const length = Number(raw);
  return Number.isFinite(length) ? length : null;
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = declaredLength(request);
  if (declared !== null && declared > limit) throw new ApiError('too_large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      request.destroy();
      throw new ApiError('too_large');
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const body = await readBody(request, JSON_BODY_LIMIT);
  const type = String(request.headers['content-type'] ?? '');
  if (body.length === 0) return {};
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError('unsupported_media_type');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError('malformed_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('malformed_json');
  }
  return parsed as Record<string, unknown>;
}

export interface MultipartBody {
  fields: Record<string, string>;
  file: { name: string; bytes: Buffer } | null;
}

export async function readMultipartBody(request: IncomingMessage): Promise<MultipartBody> {
  const type = String(request.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApiError('unsupported_media_type');
  }
  const declared = declaredLength(request);
  if (declared !== null && declared > MULTIPART_BODY_LIMIT) throw new ApiError('too_large');

  return new Promise<MultipartBody>((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: { name: string; bytes: Buffer } | null = null;
    let total = 0;
    let settled = false;

    const busboy = Busboy({ headers: request.headers, limits: { files: 1 } });

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      request.unpipe(busboy);
      request.destroy();
      reject(error);
    };

    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MULTIPART_BODY_LIMIT) fail(new ApiError('too_large'));
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });
    busboy.on('file', (name, stream, info) => {
      const parts: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => parts.push(chunk));
      stream.on('end', () => {
        if (name === 'photo') file = { name: info.filename ?? '', bytes: Buffer.concat(parts) };
      });
    });
    busboy.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ fields, file });
    });
    busboy.on('error', () => fail(new ApiError('malformed_json')));

    request.pipe(busboy);
  });
}
