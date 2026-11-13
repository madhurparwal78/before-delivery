import type { IncomingMessage } from 'node:http';
import { copy } from '../../shared/copy.js';
import { ApiError } from './errors.js';

export interface FilePart { field: string; data: Buffer }

export type BodyKind = 'json' | 'multipart';

const hasBody = (req: IncomingMessage): boolean => {
  const length = req.headers['content-length'];
  return length === undefined ? req.headers['transfer-encoding'] !== undefined : Number(length) > 0;
};

const readLimited = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) {
    req.resume();
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', copy.internal);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) {
      req.resume();
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', copy.internal);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
};

const mediaType = (req: IncomingMessage): string => (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/** Splits a multipart/form-data body into its file parts. */
const multipartParts = (data: Buffer, boundary: string): FilePart[] => {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: FilePart[] = [];
  let cursor = data.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (data.subarray(start, start + 2).toString() === '--') break;
    const headerEnd = data.indexOf('\r\n\r\n', start);
    const next = data.indexOf(delimiter, headerEnd);
    if (headerEnd === -1 || next === -1) break;
    const headers = data.subarray(start, headerEnd).toString('utf8');
    const field = /name="([^"]*)"/.exec(headers)?.[1] ?? '';
    parts.push({ field, data: data.subarray(headerEnd + 4, next - 2) });
    cursor = next;
  }
  return parts;
};

/**
 * The request body, checked in the published order: too large (413), wrong media type (415), unparsable JSON (400).
 * A request with no body gives undefined.
 */
export const readBody = async (req: IncomingMessage, kind: BodyKind, limit: number): Promise<unknown> => {
  if (!hasBody(req)) return undefined;
  const type = mediaType(req);
  if (type !== (kind === 'json' ? 'application/json' : 'multipart/form-data')) {
    req.resume();
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', copy.internal);
  }
  const data = await readLimited(req, limit);
  if (kind === 'multipart') {
    const boundary = /boundary=("?)([^";]+)\1/i.exec(req.headers['content-type'] ?? '')?.[2];
    return boundary ? multipartParts(data, boundary) : [];
  }
  try {
    return JSON.parse(data.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'BAD_JSON', copy.internal);
  }
};
