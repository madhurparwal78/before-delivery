import type { IncomingMessage } from 'node:http';

const JSON_BODY_LIMIT = 65_536;
const PART_BODY_LIMIT = 5_242_880;

export async function readJsonBody(req: IncomingMessage, limit: number = JSON_BODY_LIMIT): Promise<Record<string, unknown> | null> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType) return null;
  const mime = contentType.split(';')[0]?.trim();
  if (mime !== 'application/json') return null;
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limit) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limit) return null;
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function hasBody(req: IncomingMessage): boolean {
  const method = req.method ?? 'GET';
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

export function jsonContentTypeOk(req: IncomingMessage): boolean {
  const contentType = req.headers['content-type'];
  if (!contentType) return true;
  return contentType.split(';')[0]?.trim() === 'application/json';
}

export const partBodyLimit = PART_BODY_LIMIT;
export const jsonBodyLimit = JSON_BODY_LIMIT;
