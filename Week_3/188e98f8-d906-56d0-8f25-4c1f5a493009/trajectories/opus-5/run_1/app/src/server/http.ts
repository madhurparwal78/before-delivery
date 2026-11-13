/** The published server boundary: methods, content types, body sizes and the error shape. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../shared/model.js';
import { ApiFailure, badJson, methodNotAllowed, tooLarge, unsupportedMediaType } from './errors.js';

export const JSON_BODY_CAP = 16_384;

export type BodyKind = 'json' | 'image' | 'none';

export type Reply =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'bytes'; status: number; bytes: Buffer; contentType: string }
  | { kind: 'empty'; status: number; headers?: Record<string, string> };

export function json(status: number, body: unknown, headers?: Record<string, string>): Reply {
  return headers === undefined ? { kind: 'json', status, body } : { kind: 'json', status, body, headers };
}

export async function readBody(request: IncomingMessage, cap: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > cap) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.byteLength;
    if (size > cap) throw tooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

export function declaredType(request: IncomingMessage): string | null {
  const header = request.headers['content-type'];
  if (header === undefined) return null;
  return header.split(';')[0]?.trim().toLowerCase() ?? null;
}

/** Content type rules for JSON and bodyless endpoints. */
export function checkJsonType(request: IncomingMessage, method: string): void {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return;
  const type = declaredType(request);
  if (type === null) return;
  if (type !== 'application/json') throw unsupportedMediaType();
}

export function parseJsonBody(body: Buffer): unknown {
  if (body.byteLength === 0) return {};
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw badJson();
  }
}

function allowHeader(methods: readonly string[]): string {
  const all = [...methods];
  if (all.includes('GET') && !all.includes('HEAD')) all.push('HEAD');
  return all.join(', ');
}

export function refuseMethod(methods: readonly string[]): never {
  throw methodNotAllowed(allowHeader(methods));
}

export function sendReply(request: IncomingMessage, response: ServerResponse, reply: Reply): void {
  const headOnly = request.method === 'HEAD';
  if (reply.kind === 'empty') {
    response.writeHead(reply.status, reply.headers ?? {});
    response.end();
    return;
  }
  const bytes =
    reply.kind === 'json' ? Buffer.from(JSON.stringify(reply.body), 'utf8') : reply.bytes;
  const contentType = reply.kind === 'json' ? 'application/json' : reply.contentType;
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(bytes.byteLength),
    ...(reply.kind === 'json' ? (reply.headers ?? {}) : {}),
  };
  response.writeHead(reply.status, headers);
  response.end(headOnly ? undefined : bytes);
}

export function failureReply(failure: unknown): Reply {
  if (failure instanceof ApiFailure) {
    const body: ApiError = failure.body;
    return { kind: 'json', status: failure.status, body, headers: failure.headers };
  }
  return { kind: 'json', status: 500, body: { error: 'server_error' } satisfies ApiError };
}
