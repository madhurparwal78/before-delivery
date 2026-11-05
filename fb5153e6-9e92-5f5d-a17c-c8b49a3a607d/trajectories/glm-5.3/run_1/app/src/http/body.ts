import type { IncomingMessage } from 'node:http';
import { ApiError } from '../errors.js';
import type { RequestBody } from './types.js';

export const JSON_BODY_LIMIT = 64_000;
export const MULTIPART_BODY_LIMIT = 101_000_000;

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    let destroyed = false;
    const hardCap = Math.max(limit, 101_000_000) * 2;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > hardCap) {
        destroyed = true;
        req.destroy();
        reject(new ApiError(413, 'body_too_large'));
        return;
      }
      if (total > limit) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (destroyed) return;
      if (exceeded) {
        reject(new ApiError(413, 'body_too_large'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', err => {
      if (!destroyed) {
        destroyed = true;
        reject(err);
      }
    });
  });
}

export function parseJsonBody(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation_failed', undefined, { body: 'Unknown field.' });
  }
}

interface MultipartPart {
  name: string;
  filename?: string;
  contentType: string;
  data: Buffer;
}

/** Minimal multipart/form-data reader with a hard size cap. */
export async function readMultipart(
  req: IncomingMessage,
  contentType: string,
  limit: number,
): Promise<{ fields: Map<string, string>; files: Map<string, { filename: string; data: Buffer; contentType: string }> }> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (boundary === undefined || boundary === '') {
    throw new ApiError(415, 'unsupported_media_type');
  }
  const raw = await readRawBody(req, limit);
  const fields = new Map<string, string>();
  const files = new Map<string, { filename: string; data: Buffer; contentType: string }>();
  const delim = Buffer.from(`--${boundary}`);
  let pos = raw.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (raw[start] === 0x2d && raw[start + 1] === 0x2d) break;
    const next = raw.indexOf(delim, start);
    if (next === -1) break;
    let part = raw.subarray(start, next);
    if (part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const partInfo = parsePartHeaders(headerText);
      if (partInfo.name !== '') {
        if (partInfo.filename === undefined) {
          fields.set(partInfo.name, data.toString('utf8'));
        } else {
          files.set(partInfo.name, { filename: partInfo.filename, data, contentType: partInfo.contentType ?? 'application/octet-stream' });
        }
      }
    }
    pos = next;
  }
  return { fields, files };
}

function parsePartHeaders(text: string): { name: string; filename?: string; contentType?: string } {
  const lines = text.split('\r\n');
  let name = '';
  let filename: string | undefined;
  let contentType: string | undefined;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('content-disposition:')) {
      const nameMatch = /name="([^"]*)"/i.exec(line);
      if (nameMatch?.[1] !== undefined) name = nameMatch[1];
      const fileMatch = /filename="([^"]*)"/i.exec(line);
      if (fileMatch?.[1] !== undefined) filename = fileMatch[1];
    } else if (lower.startsWith('content-type:')) {
      contentType = line.slice(line.indexOf(':') + 1).trim();
    }
  }
  return { name, filename, contentType };
}

export function bodyOf(ctx: { body?: RequestBody }): Record<string, unknown> {
  if (ctx.body?.json !== undefined && typeof ctx.body.json === 'object' && ctx.body.json !== null && !Array.isArray(ctx.body.json)) {
    return ctx.body.json as Record<string, unknown>;
  }
  return {};
}
