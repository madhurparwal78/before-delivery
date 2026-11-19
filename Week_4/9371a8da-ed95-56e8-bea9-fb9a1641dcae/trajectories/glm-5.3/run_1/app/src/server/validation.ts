import type { Request } from 'express';
import { ApiError, tooLarge, malformedJson, unsupportedMediaType, invalid } from './errors.js';

export const BODY_CAP_DEFAULT = 2_100_000;
export const BODY_CAP_UPLOAD = 10_100_000;

const UNSTORABLE_RE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function hasUnstorable(s: string): boolean {
  return UNSTORABLE_RE.test(s);
}

/**
 * Read and validate a JSON body: cap, content type, UTF-8 and object shape.
 * This is the one place where the boundary checks run.
 */
export async function readJson(
  req: Request,
  allowed: string[] | null = null,
  cap = BODY_CAP_DEFAULT,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
    chunks.push(buf);
    total += buf.length;
    if (total > cap) throw tooLarge();
  }
  if (total === 0) {
    return {};
  }
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.startsWith('application/json')) throw unsupportedMediaType();
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    parsed = JSON.parse(text);
  } catch {
    throw malformedJson();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: 'must be an object' });
  }
  const body = parsed as Record<string, unknown>;
  if (allowed !== null) {
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) errors[key] = 'not an allowed key';
    }
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' && hasUnstorable(value)) errors[key] = 'unstorable character';
    }
    if (Object.keys(errors).length > 0) throw invalid(errors);
  }
  return body;
}

export function requireStringField(body: Record<string, unknown>, key: string): string {
  if (typeof body[key] !== 'string') throw invalid({ [key]: 'required' });
  return body[key] as string;
}

