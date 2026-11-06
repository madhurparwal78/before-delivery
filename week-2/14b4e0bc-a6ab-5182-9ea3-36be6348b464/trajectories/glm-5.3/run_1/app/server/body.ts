import busboy from 'busboy';
import type { Request } from 'express';
import { ERR } from './errors';

export const JSON_LIMIT = 1_000_000;
export const MULTIPART_LIMIT = 6_000_000;

export interface JsonBody {
  value: unknown;
}

/** Reads a JSON body with the exact 1,000,000-byte boundary and the depth rule (DP-80, DP-92). */
export async function readJsonBody(req: Request): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > JSON_LIMIT) {
        aborted = true;
        reject(ERR.payloadTooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw ERR.validation({}, 'Request body is not valid JSON.');
  }
  if (depthOf(value) > 20) throw ERR.tooDeep();
  return value;
}

export function depthOf(value: unknown, depth = 1): number {
  if (typeof value !== 'object' || value === null) return depth;
  let maxDepth = depth;
  if (Array.isArray(value)) {
    for (const v of value) maxDepth = Math.max(maxDepth, depthOf(v, depth + 1));
    return maxDepth;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    maxDepth = Math.max(maxDepth, depthOf(v, depth + 1));
  }
  return maxDepth;
}

export interface MultipartFile {
  filename: string;
  data: Buffer;
}
export interface MultipartResult {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

/** Reads a multipart body with the exact 6,000,000-byte boundary (DP-80). */
export function readMultipart(req: Request): Promise<MultipartResult> {
  return new Promise<MultipartResult>((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MULTIPART_LIMIT, files: 2, fields: 5, fieldSize: 1_000_000, parts: 10 },
    });
    const fields: Record<string, string> = {};
    let file: MultipartFile | null = null;
    let size = 0;
    let failed: boolean = false;
    bb.on('field', (name, value) => {
      fields[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MULTIPART_LIMIT) {
          failed = true;
          stream.resume();
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        failed = true;
      });
      stream.on('end', () => {
        if (!failed) file = { filename: info.filename ?? '', data: Buffer.concat(chunks) };
      });
    });
    bb.on('error', () => reject(ERR.payloadTooLarge()));
    bb.on('close', () => {
      if (failed) {
        reject(ERR.payloadTooLarge());
        return;
      }
      resolve({ fields, file });
    });
    req.pipe(bb);
  });
}

/** Percent-decodes a path id (ids arrive as UTF-8). */
export function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
