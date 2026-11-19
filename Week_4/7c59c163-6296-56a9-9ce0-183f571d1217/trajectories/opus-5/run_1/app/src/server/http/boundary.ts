import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';
import { RANGES } from '../domain/validate.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The allowed origin is the request's own origin: the scheme it arrived on plus its Host header. */
export function ownOrigin(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-proto'];
  const scheme =
    typeof forwarded === 'string' && forwarded.length > 0
      ? (forwarded.split(',')[0] as string).trim()
      : 'encrypted' in request.socket && request.socket.encrypted
        ? 'https'
        : 'http';
  return `${scheme}://${request.headers.host ?? ''}`;
}

export function checkOrigin(request: IncomingMessage): void {
  if (!STATE_CHANGING.has(request.method ?? 'GET')) return;
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  if (origin !== ownOrigin(request)) throw new ApiError(403, 'bad_origin');
}

export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large');

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number.parseInt(declared, 10) > limit) throw payloadTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw payloadTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = await readBody(request, RANGES.jsonBodyBytes);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'bad_json');
  }
}
