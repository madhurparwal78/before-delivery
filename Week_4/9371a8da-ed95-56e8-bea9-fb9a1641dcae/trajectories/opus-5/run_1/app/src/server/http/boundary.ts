import { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';

export const UPLOAD_BODY_CAP = 10_100_000;
export const JSON_BODY_CAP = 2_100_000;

export async function readBody(request: IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        reject(new ApiError(413, 'too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (error) => reject(error));
  });
}

function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * The boundary's body rules: an empty body for a no-key endpoint is `{}`, other
 * JSON endpoints need a JSON content type and a body that parses to an object.
 */
export function parseJsonBody(
  request: IncomingMessage,
  raw: Buffer,
  acceptsKeys: boolean,
): Record<string, unknown> {
  if (raw.length === 0) {
    if (!acceptsKeys) return {};
    throw new ApiError(400, 'malformed_json');
  }
  if (!isJsonContentType(request.headers['content-type'])) {
    throw new ApiError(415, 'unsupported_media_type');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new ApiError(400, 'malformed_json');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'malformed_json');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(422, 'invalid', { errors: { body: 'Expected an object.' } });
  }
  return value as Record<string, unknown>;
}

export function checkOrigin(request: IncomingMessage): void {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return;
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = request.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, 'cross_origin');
  }
  if (host === undefined || originHost !== host) throw new ApiError(403, 'cross_origin');
}
