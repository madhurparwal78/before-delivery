import type { IncomingMessage } from 'node:http';
import { tooLarge, unsupportedMediaType, validation } from './errors.js';

export type BodyKind = 'none' | 'json' | 'zip';

export function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function mimeOf(req: IncomingMessage): string {
  return (readHeader(req, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export async function readBody(
  req: IncomingMessage,
  kind: BodyKind,
  limitBytes: number,
): Promise<Buffer> {
  if (kind === 'none') return Buffer.alloc(0);

  const declared = readHeader(req, 'content-length');
  if (declared !== undefined && Number(declared) > limitBytes) throw tooLarge(limitBytes);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limitBytes) throw tooLarge(limitBytes);
    chunks.push(part);
  }
  const body = Buffer.concat(chunks);

  const mime = mimeOf(req);
  if (kind === 'zip' && mime !== 'application/zip') throw unsupportedMediaType();
  if (kind === 'json' && body.length > 0 && mime !== 'application/json') {
    throw unsupportedMediaType();
  }
  return body;
}

export function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw validation({ body: 'Send a JSON object.' });
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validation({ body: 'Send a JSON object.' });
  }
  return value as Record<string, unknown>;
}
