/**
 * The API boundary: one origin, a body limit, strict JSON types and the
 * session that carries every request. These checks run in the published
 * precedence, so a request that breaks several rungs is answered at the
 * earliest one.
 */

import type { IncomingMessage } from 'node:http';
import { crossOrigin, invalidJson, payloadTooLarge, unsupportedMediaType } from './problem.ts';

/** Bodies are limited to 16,384 bytes; exactly that many is accepted. */
export const MAX_BODY_BYTES = 16384;

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Reads the body, refusing anything past the limit as soon as the limit is
 * passed. Returns the raw bytes so the JSON check can run at its own rung.
 */
export function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let refused = false;
    request.on('data', (chunk: Buffer) => {
      if (refused) return;
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        // Stop reading but leave the socket alive, so the 413 can be written.
        refused = true;
        request.pause();
        reject(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (error: Error) => reject(error));
  });
}

/**
 * An unsafe request whose `Origin` names any other origin than the request's
 * own is refused. Requests without an `Origin` header are allowed.
 */
export function checkOrigin(request: IncomingMessage, selfOrigin: string): void {
  if (!UNSAFE_METHODS.has(request.method ?? '')) return;
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  if (origin !== selfOrigin) throw crossOrigin();
}

/** The origin the request was addressed to, from its own Host header. */
export function originOf(request: IncomingMessage): string {
  const host = request.headers.host ?? '';
  return `http://${host}`;
}

/** Bodies on POST and PATCH must be `application/json`. */
export function checkMediaType(request: IncomingMessage): void {
  const method = request.method ?? '';
  if (method !== 'POST' && method !== 'PATCH') return;
  const contentType = request.headers['content-type'];
  if (contentType === undefined) throw unsupportedMediaType();
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') throw unsupportedMediaType();
}

/**
 * Parses the body as a JSON object. A body that is not valid JSON, or is not
 * a JSON object, cannot be checked field by field and is refused here.
 */
export function parseJsonObject(raw: Buffer): Record<string, unknown> {
  if (raw.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw invalidJson();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidJson();
  }
  return parsed as Record<string, unknown>;
}

/** The canonical form of a body, for comparing two requests with one key. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
