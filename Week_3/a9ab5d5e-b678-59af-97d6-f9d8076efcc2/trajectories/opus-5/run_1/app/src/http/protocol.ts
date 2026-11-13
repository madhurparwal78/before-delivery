import { createHash } from 'node:crypto';
import { ApiError, fail, failField } from '../errors';
import { Json } from '../lib/json';
import { rows } from '../db';
import { ApiResponse, Ctx } from './context';

const keyPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function idempotencyKeyOf(ctx: Ctx): string | null {
  const key = ctx.header('idempotency-key');
  if (key === undefined) return null;
  if (!keyPattern.test(key)) failField('Idempotency-Key', 'Use 1 to 64 letters, digits, - and _.');
  return key;
}

function responseBodyText(response: ApiResponse): string {
  if (response.json !== undefined) return JSON.stringify(response.json);
  return response.body ? response.body.toString('utf8') : '';
}

/** Stored-response replay for state-changing POSTs, scoped to user, method and path. */
export async function withIdempotency(ctx: Ctx, run: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const key = idempotencyKeyOf(ctx);
  if (key === null) return run();
  const parentId = ctx.user.parentId;
  const path = ctx.url.pathname;
  const bodySha = createHash('sha256').update(ctx.raw).digest('hex');
  const claimed = await rows(
    `INSERT INTO idempotency (parent_id, method, path, key, body_sha)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (parent_id, method, path, key) DO NOTHING
     RETURNING key`,
    [parentId, ctx.method, path, key, bodySha],
  );
  if (claimed.length === 0) return replay(parentId, ctx.method, path, key, bodySha);
  try {
    const response = await run();
    await rows(
      `UPDATE idempotency SET status = $5, response_body = $6, response_etag = $7
       WHERE parent_id = $1 AND method = $2 AND path = $3 AND key = $4`,
      [parentId, ctx.method, path, key, response.status, responseBodyText(response), response.headers?.ETag ?? null],
    );
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await rows(
        `UPDATE idempotency SET status = $5, response_body = $6, response_etag = null
         WHERE parent_id = $1 AND method = $2 AND path = $3 AND key = $4`,
        [parentId, ctx.method, path, key, error.status, JSON.stringify(error.body())],
      );
      throw error;
    }
    await rows(
      'DELETE FROM idempotency WHERE parent_id = $1 AND method = $2 AND path = $3 AND key = $4',
      [parentId, ctx.method, path, key],
    );
    throw error;
  }
}

async function replay(
  parentId: string,
  method: string,
  path: string,
  key: string,
  bodySha: string,
): Promise<ApiResponse> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = await rows(
      'SELECT body_sha, status, response_body, response_etag FROM idempotency WHERE parent_id = $1 AND method = $2 AND path = $3 AND key = $4',
      [parentId, method, path, key],
    );
    const row = found[0];
    if (!row) return fail('idempotency_key_reused');
    if ((row.body_sha as string) !== bodySha) fail('idempotency_key_reused');
    if (row.status !== null) {
      const status = row.status as number;
      const bodyText = (row.response_body as string) ?? '';
      const headers: Record<string, string> = { 'Idempotent-Replayed': 'true' };
      if (row.response_etag) headers.ETag = row.response_etag as string;
      if (status >= 400) headers['Content-Type'] = 'application/problem+json; charset=utf-8';
      return {
        status,
        json: bodyText === '' ? undefined : (JSON.parse(bodyText) as Json),
        headers,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return fail('idempotency_key_reused');
}

function etagList(header: string): string[] {
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function requireIfMatch(ctx: Ctx, current: string): void {
  const header = ctx.header('if-match');
  if (header === undefined) fail('precondition_required');
  const candidates = etagList(header);
  if (candidates.includes('*')) return;
  if (!candidates.includes(current)) fail('precondition_failed');
}

export function requireIfNoneMatchStar(ctx: Ctx): void {
  const noneMatch = ctx.header('if-none-match');
  if (noneMatch === undefined) {
    if (ctx.header('if-match') !== undefined) fail('precondition_failed');
    fail('precondition_required');
  }
  if (!etagList(noneMatch).includes('*')) fail('precondition_failed');
}

export function notModified(ctx: Ctx, etag: string): boolean {
  const header = ctx.header('if-none-match');
  if (header === undefined) return false;
  const candidates = etagList(header);
  return candidates.includes('*') || candidates.includes(etag);
}

export interface PageRequest {
  limit: number;
  afterId: string | null;
}

export function readPageRequest(ctx: Ctx, householdId: string): PageRequest {
  const limitRaw = ctx.url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(limitRaw)) failField('limit', 'Use a limit from 1 to 100.');
    limit = Number.parseInt(limitRaw, 10);
    if (limit < 1 || limit > 100) failField('limit', 'Use a limit from 1 to 100.');
  }
  const after = ctx.url.searchParams.get('after');
  if (after === null) return { limit, afterId: null };
  let decoded: string;
  try {
    decoded = Buffer.from(after, 'base64url').toString('utf8');
  } catch {
    return failField('after', 'This cursor is not valid.');
  }
  const match = /^(\d+):(\d+)$/.exec(decoded);
  if (!match || match[1] !== householdId) failField('after', 'This cursor is not valid.');
  return { limit, afterId: match[2] as string };
}

export function makeCursor(householdId: string, id: string): string {
  return Buffer.from(`${householdId}:${id}`, 'utf8').toString('base64url');
}

export function readLogPageRequest(ctx: Ctx): { limit: number; afterSeq: number } {
  const limitRaw = ctx.url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(limitRaw)) failField('limit', 'Use a limit from 1 to 100.');
    limit = Number.parseInt(limitRaw, 10);
    if (limit < 1 || limit > 100) failField('limit', 'Use a limit from 1 to 100.');
  }
  const after = ctx.url.searchParams.get('after');
  if (after === null) return { limit, afterSeq: 0 };
  if (!/^(0|[1-9][0-9]*)$/.test(after)) failField('after', 'This cursor is not valid.');
  return { limit, afterSeq: Number.parseInt(after, 10) };
}

export function readYearParam(ctx: Ctx, fallback: number): number {
  const raw = ctx.url.searchParams.get('year');
  if (raw === null) return fallback;
  if (!/^\d{4}$/.test(raw)) failField('year', 'Choose a year from 2000 to 2100.');
  const year = Number.parseInt(raw, 10);
  if (year < 2000 || year > 2100) failField('year', 'Choose a year from 2000 to 2100.');
  return year;
}
