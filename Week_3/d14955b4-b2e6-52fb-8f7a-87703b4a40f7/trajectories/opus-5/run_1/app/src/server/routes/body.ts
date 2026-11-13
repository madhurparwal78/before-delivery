import { limits } from '../config';
import { ApiError } from '../errors';
import { contentTypeEssence, readRawBody, type Ctx } from '../http';

/** 413 then 415, both ahead of authentication; the JSON parse comes later. */
export async function readJsonRaw(ctx: Ctx, maxBytes = limits.jsonBodyBytes): Promise<Buffer> {
  const declared = Number(ctx.req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, 'too_large');
  if (contentTypeEssence(ctx.req) !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type');
  }
  return readRawBody(ctx, maxBytes);
}

export function parseJson(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, 'validation', { fields: {} });
  }
  return parsed as Record<string, unknown>;
}

export async function readJsonBody(ctx: Ctx, maxBytes = limits.jsonBodyBytes): Promise<Record<string, unknown>> {
  return parseJson(await readJsonRaw(ctx, maxBytes));
}
