import type { IncomingMessage } from 'node:http';
import { ApiError } from '../errors';

const JSON_BODY_LIMIT = 65536;

/**
 * Reads at most `limit` bytes. The 413 is decided while reading, before any
 * other check, so an oversized body never reaches a route.
 */
function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        /** The rest is drained so the 413 can still be written. */
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (tooLarge ? reject(new ApiError('payload_too_large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBytes(req, JSON_BODY_LIMIT);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('validation_failed', { fields: {} });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('validation_failed', { fields: {} });
  }
  return parsed as Record<string, unknown>;
}

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return readBytes(req, limit);
}

export interface MultipartFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

function parseHeaders(block: string): { name: string | null; filename: string | null; contentType: string } {
  let name: string | null = null;
  let filename: string | null = null;
  let contentType = 'application/octet-stream';
  for (const line of block.split('\r\n')) {
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'content-disposition') {
      name = /;\s*name="([^"]*)"/.exec(value)?.[1] ?? null;
      filename = /;\s*filename="([^"]*)"/.exec(value)?.[1] ?? null;
    } else if (key === 'content-type') {
      contentType = value;
    }
  }
  return { name, filename, contentType };
}

export async function readMultipartBody(req: IncomingMessage, limit: number): Promise<MultipartBody> {
  const raw = await readBytes(req, limit);
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '');
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) throw new ApiError('validation_failed', { fields: {} });

  const separator = Buffer.from(`--${marker}`);
  const body: MultipartBody = { fields: {}, files: {} };
  let cursor = raw.indexOf(separator);
  while (cursor >= 0) {
    const partStart = cursor + separator.length;
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) break;
    const next = raw.indexOf(separator, headerEnd);
    if (next < 0) break;
    const { name, filename, contentType } = parseHeaders(raw.slice(partStart + 2, headerEnd).toString('utf8'));
    const content = raw.slice(headerEnd + 4, next - 2);
    if (name !== null) {
      if (filename === null) body.fields[name] = content.toString('utf8');
      else body.files[name] = { filename, contentType, bytes: content };
    }
    cursor = next;
  }
  return body;
}
