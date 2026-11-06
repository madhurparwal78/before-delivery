import * as crypto from 'node:crypto';
import { query } from '../db';
import { config, limits } from '../config';
import { byteLength } from './text';
import { parseTagFilter, type TagFilter } from './tagfilter';

export const cursorMessage = 'This page link is no longer valid.';

export interface ListCursor {
  bucket: string;
  prefix: string;
  delimiter: string;
  tagFilter: string;
  after: string;
  skipPrefix: boolean;
}

function cursorMac(payload: string): string {
  return crypto.createHmac('sha256', config.secretKey).update(payload).digest('base64url').slice(0, 16);
}

export function encodeCursor(cursor: ListCursor): string {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  return `${payload}.${cursorMac(payload)}`;
}

export class CursorError extends Error {}

export function decodeCursor(token: string, expected: { bucket: string; prefix: string; delimiter: string; tagFilter: string }): ListCursor {
  const parts = token.split('.');
  if (parts.length !== 2 || cursorMac(parts[0]) !== parts[1]) throw new CursorError(cursorMessage);
  let parsed: ListCursor;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ListCursor;
  } catch {
    throw new CursorError(cursorMessage);
  }
  if (
    parsed.bucket !== expected.bucket ||
    parsed.prefix !== expected.prefix ||
    parsed.delimiter !== expected.delimiter ||
    parsed.tagFilter !== expected.tagFilter
  ) {
    throw new CursorError(cursorMessage);
  }
  return parsed;
}

export interface ListedObject {
  key: string;
  version_id: string;
  size: number;
  etag: string;
  content_type: string;
  last_modified: string;
  tags: Record<string, string>;
}

export interface ListResult {
  items: ListedObject[];
  commonPrefixes: string[];
  nextCursor: string | null;
  truncated: boolean;
}

export interface ListOptions {
  bucket: string;
  prefix: string;
  delimiter: string;
  tagFilter: string;
  limit: number;
  cursor: string | null;
  startAfter?: string;
}

function likeEscape(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

/**
 * Lists current versions in byte order, rolling keys up into common prefixes and paging with an
 * opaque cursor that never repeats or skips a key or common prefix.
 */
export async function listObjects(options: ListOptions): Promise<ListResult> {
  let filter: TagFilter | null = null;
  if (options.tagFilter.trim() !== '') filter = parseTagFilter(options.tagFilter);

  let after = '';
  let skipPrefix = false;
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor, options);
    after = cursor.after;
    skipPrefix = cursor.skipPrefix;
  } else if (options.startAfter) {
    after = options.startAfter;
    if (options.delimiter !== '') {
      const rest = options.startAfter.startsWith(options.prefix) ? options.startAfter.slice(options.prefix.length) : '';
      const boundary = rest.indexOf(options.delimiter);
      if (boundary >= 0) {
        after = options.prefix + rest.slice(0, boundary + options.delimiter.length);
        skipPrefix = true;
      }
    }
  }

  const items: ListedObject[] = [];
  const commonPrefixes: string[] = [];
  let entries = 0;
  let scanned = 0;
  let truncated = false;
  let lastEntry: { value: string; isPrefix: boolean } | null = null;
  let cursorAfter = after;
  let cursorSkip = skipPrefix;
  let exhausted = false;
  let filled = false;

  while (entries < options.limit && !truncated) {
    const batchSize = Math.min(500, limits.scanBudget - scanned + 1);
    if (batchSize <= 0) {
      truncated = true;
      break;
    }
    const conditions: string[] = ['bucket = $1', 'is_current'];
    const params: unknown[] = [options.bucket];
    if (options.prefix !== '') {
      params.push(`${likeEscape(options.prefix)}%`);
      conditions.push(`object_key like $${params.length}`);
    }
    if (cursorAfter !== '') {
      params.push(cursorAfter);
      conditions.push(`object_key collate "C" > $${params.length} collate "C"`);
      if (cursorSkip) {
        params.push(`${likeEscape(cursorAfter)}%`);
        conditions.push(`object_key not like $${params.length}`);
      }
    }
    params.push(batchSize);
    const batch = await query<{
      object_key: string;
      version_id: string;
      size: string;
      etag: string;
      content_type: string;
      acknowledged_at: string;
      tags: Record<string, string>;
    }>(
      `select object_key, version_id, size::text as size, etag, content_type, acknowledged_at, tags
       from object_versions where ${conditions.join(' and ')}
       order by object_key collate "C" limit $${params.length}`,
      params,
    );
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    for (const candidate of batch) {
      scanned += 1;
      cursorAfter = candidate.object_key;
      cursorSkip = false;
      if (options.delimiter !== '') {
        const rest = candidate.object_key.slice(options.prefix.length);
        const boundary = rest.indexOf(options.delimiter);
        if (boundary >= 0) {
          const commonPrefix = options.prefix + rest.slice(0, boundary + options.delimiter.length);
          if (!commonPrefixes.includes(commonPrefix)) {
            commonPrefixes.push(commonPrefix);
            entries += 1;
            lastEntry = { value: commonPrefix, isPrefix: true };
          }
          cursorAfter = commonPrefix;
          cursorSkip = true;
          if (entries >= options.limit) {
            filled = true;
            break;
          }
          continue;
        }
      }
      if (filter && !filter.matches(candidate.tags ?? {})) {
        if (scanned >= limits.scanBudget) {
          truncated = true;
          break;
        }
        continue;
      }
      items.push({
        key: candidate.object_key,
        version_id: candidate.version_id,
        size: Number(candidate.size),
        etag: candidate.etag,
        content_type: candidate.content_type,
        last_modified: candidate.acknowledged_at,
        tags: candidate.tags ?? {},
      });
      entries += 1;
      lastEntry = { value: candidate.object_key, isPrefix: false };
      if (entries >= options.limit) {
        filled = true;
        break;
      }
      if (scanned >= limits.scanBudget) {
        truncated = true;
        break;
      }
    }
    if (filled) break;
    if (batch.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const more = !exhausted && (filled || truncated);
  const nextCursor = more
    ? encodeCursor({
        bucket: options.bucket,
        prefix: options.prefix,
        delimiter: options.delimiter,
        tagFilter: options.tagFilter,
        after: lastEntry ? lastEntry.value : cursorAfter,
        skipPrefix: lastEntry ? lastEntry.isPrefix : cursorSkip,
      })
    : null;
  return { items, commonPrefixes, nextCursor, truncated };
}

export function validateListInputs(prefix: string, delimiter: string): Record<string, string> {
  const failures: Record<string, string> = {};
  if (byteLength(prefix) > 1024) failures.prefix = 'Prefixes are limited to 1,024 bytes.';
  if (delimiter !== '' && Array.from(delimiter).length !== 1) failures.delimiter = 'Use a single character as the delimiter.';
  return failures;
}

export interface SearchHit {
  bucket: string;
  key: string;
  size: number;
  last_modified: string;
}

/** Search reaches only the caller's own workspace. */
export async function searchObjects(slug: string, term: string): Promise<{ items: SearchHit[]; truncated: boolean }> {
  const found = await query<{ bucket: string; object_key: string; size: string; acknowledged_at: string }>(
    `select v.bucket, v.object_key, v.size::text as size, v.acknowledged_at
     from object_versions v join buckets b on b.name = v.bucket
     where b.workspace_slug = $1 and v.is_current and position(lower($2) in lower(v.object_key)) > 0
     order by v.bucket, v.object_key collate "C" limit 51`,
    [slug, term],
  );
  const truncated = found.length > 50;
  return {
    items: found.slice(0, 50).map((item) => ({
      bucket: item.bucket,
      key: item.object_key,
      size: Number(item.size),
      last_modified: item.acknowledged_at,
    })),
    truncated,
  };
}
