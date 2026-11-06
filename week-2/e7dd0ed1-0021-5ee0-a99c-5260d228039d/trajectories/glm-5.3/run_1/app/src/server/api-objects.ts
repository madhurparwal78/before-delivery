import { sendJson, type Router } from './http.js';
import { rows } from './db.js';
import { notFound, validationFailed } from './errors.js';
import { requireSession } from './auth.js';
import { bucketByName } from './objects.js';

function iso(d: Date): string { return d.toISOString(); }

import { wsCtx } from './api-ws.js';

/** Key rules shared by the console and S3 paths. */
export function isValidKey(key: string): boolean {
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes < 1 || bytes > 1024) return false;
  if (key.startsWith('/')) return false;
  if (key.includes('\\')) return false;
  for (const ch of key) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || c === 0x7f) return false;
  }
  for (const seg of key.split('/')) {
    if (seg === '.' || seg === '..') return false;
  }
  return true;
}

export function tagsFromQuery(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const out: Record<string, string> = {};
  const params = new URLSearchParams(value);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export function validateTags(tags: Record<string, string>): string | null {
  const keys = Object.keys(tags);
  if (keys.length > 10) return 'Up to 10 tags; keys 1 to 128 characters, values up to 256.';
  for (const k of keys) {
    if (k.length < 1 || k.length > 128) return 'Up to 10 tags; keys 1 to 128 characters, values up to 256.';
    if (tags[k].length > 256) return 'Up to 10 tags; keys 1 to 128 characters, values up to 256.';
  }
  return null;
}

export function metadataBytes(meta: Record<string, string>): number {
  let total = 0;
  for (const [k, v] of Object.entries(meta)) total += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
  return total;
}

/** Content-type judgement from bytes plus the declared header. */
export function judgeContentType(bytes: Buffer, declared: string): { type: string; refuse: boolean } {
  const head = bytes.subarray(0, 512).toString('utf8');
  let stripped = head.replace(/^\uFEFF/, '').replace(/^[\s]*/, '');
  const lower = stripped.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || lower.startsWith('<head') ||
      lower.startsWith('<body') || lower.startsWith('<script')) {
    return { type: 'text/html', refuse: false };
  }
  const looksSvg = /^\s*<\?xml[\s\S]*<svg/i.test(head) || /^\s*<svg/i.test(head);
  if (looksSvg) {
    if (/<script[\s>]/i.test(head) || /\son[a-z]+\s*=/i.test(head) || /javascript:/i.test(head)) {
      return { type: 'image/svg+xml', refuse: true };
    }
    return { type: 'image/svg+xml', refuse: false };
  }
  return { type: declared || 'application/octet-stream', refuse: false };
}

/** The two-part Content-Disposition filename. */
export function contentDisposition(key: string): string {
  const seg = key.split('/').pop() ?? '';
  const ascii = Array.from(seg).map(c => {
    const cp = c.codePointAt(0)!;
    return cp < 128 && /[A-Za-z0-9 !#$&+.\-^_`|~]/.test(c) && c !== '"' && c !== '\\' ? c : '_';
  }).join('');
  const enc = Array.from(seg).map(c => {
    if (c.codePointAt(0)! < 128 && /[A-Za-z0-9!#$&+.\-^_`|~]/.test(c) && c !== '"' && c !== '\\') return c;
    return Array.from(Buffer.from(c, 'utf8')).map(b => '%' + b.toString(16).toUpperCase()).join('');
  }).join('');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`;
}

export function downloadHeaders(key: string, type: string, riskyOverride = true): Record<string, string> {
  let ct = type;
  if (riskyOverride && /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)/i.test(type)) {
    ct = 'application/octet-stream';
  }
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': contentDisposition(key),
    'Content-Type': ct,
  };
}

export const SINGLE_UPLOAD_LIMIT = 50_000_000;

export function registerObjectRoutes(json: Router): void {
  json.get('/api/w/{ws}/buckets/{bucket}/objects', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const result = await listObjects(bucket.name, req.query);
    sendJson(res, 200, result);
  });

  json.get('/api/w/{ws}/search', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const q = req.query.get('q') ?? '';
    if (q.length < 1 || q.length > 128) throw validationFailed({ q: 'Search queries are 1 to 128 characters.' });
    const found = await rows<{ bucket: string; key: string; size: string; last_modified: Date }>(
      `SELECT v.bucket_name AS bucket, v.key, v.size::text AS size, v.acknowledged_at AS last_modified
       FROM versions v JOIN buckets b ON b.name = v.bucket_name
       WHERE b.workspace_slug = $1 AND v.state = 'current' AND v.key ILIKE $2
       ORDER BY v.bucket_name, v.key LIMIT 50`,
      [ws.slug, '%' + q.replace(/[%_]/g, m => '\\' + m) + '%']
    );
    sendJson(res, 200, {
      items: found.map(f => ({ bucket: f.bucket, key: f.key, size: Number(f.size), last_modified: iso(f.last_modified) })),
      truncated: found.length === 50,
    });
  });
}

/** The single listing implementation for the console. */
export async function listObjects(bucket: string, query: URLSearchParams): Promise<unknown> {
  const prefix = query.get('prefix') ?? '';
  const delimiter = query.get('delimiter') ?? '';
  const tagFilter = query.get('tag_filter') ?? '';
  const cursor = query.get('cursor');
  let limit = Number(query.get('limit') ?? '100');
  const errors: Record<string, string> = {};
  if (prefix && Buffer.byteLength(prefix, 'utf8') > 1024) errors.prefix = 'Prefixes are at most 1,024 bytes.';
  if (delimiter && Array.from(delimiter).length !== 1) errors.delimiter = 'The delimiter is one character.';
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) errors.limit = 'Choose 1 to 1,000.';
  if (tagFilter) {
    const parsed = parseTagFilter(tagFilter);
    if (typeof parsed === 'string') errors.tag_filter = parsed;
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const cursorState = cursor ? decodeCursor(cursor) : null;
  if (cursor && !cursorState) throw validationFailed({ cursor: 'This page link is no longer valid.' });

  let afterKey: string | null = cursorState?.afterKey ?? null;
  let afterPrefixEnd: boolean = cursorState?.afterPrefixEnd ?? false;
  void afterPrefixEnd;
  const perPage = limit;
  const items: unknown[] = [];
  const commonPrefixes: string[] = [];
  let scanned = 0;
  let truncated = false;
  let lastKey: string | null = afterKey;
  const tagFilterFn = tagFilter ? compileTagFilter(tagFilter) : null;

  while (items.length + commonPrefixes.length < perPage && scanned < 10_000) {
    const batch = await rows<{ key: string; version_id: string; size: string; etag: string; content_type: string; last_modified: Date; tags: Record<string, string> }>(
      `SELECT key, version_id, size::text AS size, etag, content_type, acknowledged_at AS last_modified, tags
       FROM versions
       WHERE bucket_name = $1 AND state = 'current' AND key > $2
       ORDER BY key ASC LIMIT 100`,
      [bucket, lastKey ?? '']
    );
    if (batch.length === 0) break;
    for (const row of batch) {
      scanned++;
      lastKey = row.key;
      if (prefix && !row.key.startsWith(prefix)) {
        if (row.key > prefix && !row.key.startsWith(prefix)) {
          // keys are sorted; past the prefix range we can stop
          if (row.key.slice(0, prefix.length) > prefix) { scanned = 10_000; truncated = false; }
        }
        continue;
      }
      if (delimiter) {
        const rest = row.key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          const cp = prefix + rest.slice(0, idx + delimiter.length);
          if (commonPrefixes.length === 0 || commonPrefixes[commonPrefixes.length - 1] !== cp) {
            if (items.length + commonPrefixes.length < perPage) commonPrefixes.push(cp);
            else { truncated = true; }
          }
          continue;
        }
      }
      if (tagFilterFn && !tagFilterFn(row.tags)) continue;
      const replicas = await rows<{ settled: string; total: string }>(
        `SELECT count(*) FILTER (WHERE state = 'settled')::text AS settled, count(*)::text AS total
         FROM replicas WHERE version_id = $1`, [row.version_id]
      );
      if (items.length + commonPrefixes.length < perPage) {
        items.push({
          key: row.key, version_id: row.version_id, size: Number(row.size), etag: row.etag,
          content_type: row.content_type, last_modified: iso(row.last_modified), tags: row.tags,
          replicas_settled: Number(replicas[0].settled), replicas_total: Number(replicas[0].total),
        });
      } else { truncated = true; break; }
    }
  }
  const nextCursor = truncated ? encodeCursor({ afterKey: lastKey, afterPrefixEnd: false }) : null;
  return { items, common_prefixes: commonPrefixes, next_cursor: nextCursor, truncated };
}

function encodeCursor(state: { afterKey: string | null; afterPrefixEnd: boolean }): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeCursor(cursor: string): { afterKey: string | null; afterPrefixEnd: boolean } | null {
  try {
    const s = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof s !== 'object' || s === null) return null;
    return { afterKey: typeof s.afterKey === 'string' ? s.afterKey : null, afterPrefixEnd: Boolean(s.afterPrefixEnd) };
  } catch { return null; }
}

type TagMatcher = (tags: Record<string, string>) => boolean;
type TagExpr = { kind: 'and' | 'or'; terms: TagNode[] } | { kind: 'not'; term: TagNode } | { kind: 'cmp'; key: string; op: '=' | '!=' | 'prefix'; value: string };
type TagNode = TagExpr | TagMatcher;

/** Parses the tag-filter grammar; returns an error string or a matcher. */
export function parseTagFilter(input: string): string | TagMatcher {
  let pos = 0;
  let comparisons = 0;
  let depth = 0;
  const maxDepthAt: number[] = [];
  const src = input;

  function err(position: number, message: string): string { return `${message}:${position}`; }

  function parseExpr(): TagNode | string {
    const t = peekToken();
    if (t === null) return err(pos + 1, 'eof');
    if (t === '(') {
      depth++;
      maxDepthAt.push(depth);
      const inner = parseExpr();
      if (typeof inner === 'string') return inner;
      const close = peekToken();
      if (close !== ')') return err(pos + 1, 'eof');
      depth--;
      return inner;
    }
    if (t === 'not') {
      const inner = parseExpr();
      if (typeof inner === 'string') return inner;
      return { kind: 'not', term: inner };
    }
    if (t === 'and' || t === 'or') return err(tokenStart, 'keyword');
    if (t === ')') return err(tokenStart, 'paren');
    return parseComparison();
  }

  let tokenStart = 0;
  function peekToken(): string | null {
    while (pos < src.length && /[\s\t]/.test(src[pos])) pos++;
    tokenStart = pos;
    if (pos >= src.length) return null;
    if (src[pos] === '(') { pos++; return '('; }
    if (src[pos] === ')') { pos++; return ')'; }
    const word = /^(and|or|not)(?![a-z])/.exec(src.slice(pos));
    if (word) { pos += word[1].length; return word[1]; }
    return 'cmp';
  }

  function parseComparison(): TagNode | string {
    // bare key
    let i = pos;
    while (i < src.length && !/[\s\t()="*!]/.test(src[i])) i++;
    let key: string;
    if (src[pos] === '"') {
      const close = findQuote(src, pos);
      if (close < 0) return err(pos + 1, 'quote');
      key = readQuoted(src, pos);
      pos = close + 1;
    } else {
      key = src.slice(pos, i);
      if (key.length === 0) return err(pos + 1, 'cmp');
      pos = i;
    }
    if (src[pos] !== '=' && src[pos] !== '!') return err(tokenStart + 1, 'cmp');
    const op = src[pos] === '!' ? (src[pos + 1] === '=' ? '!=' : '!') : '=';
    if (op === '!') return err(tokenStart + 1, 'cmp');
    pos += op === '!=' ? 2 : 1;
    let value: string;
    if (src[pos] === '"') {
      const close = findQuote(src, pos);
      if (close < 0) return err(pos + 1, 'quote');
      value = readQuoted(src, pos);
      pos = close + 1;
    } else {
      let j = pos;
      while (j < src.length && !/[\s\t()"]/.test(src[j]) && src[j] !== '*') j++;
      value = src.slice(pos, j);
      pos = j;
    }
    let kind: 'cmp' | 'prefix' = 'cmp';
    if (src[pos] === '*') { kind = 'prefix'; pos++; }
    comparisons++;
    if (kind === 'prefix') return { kind: 'cmp', key, op: 'prefix', value };
    return { kind: 'cmp', key, op: op === '!=' ? '!=' : '=', value };
  }

  function findQuote(s: string, from: number): number {
    let i = from + 1;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '"') return i;
      i++;
    }
    return -1;
  }
  function readQuoted(s: string, at: number): string {
    let i = at + 1;
    let out = '';
    while (i < s.length) {
      if (s[i] === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { out += s[i + 1]; i += 2; continue; }
      if (s[i] === '"') break;
      out += s[i];
      i++;
    }
    return out;
  }

  const terms: TagNode[] = [];
  let pendingOp: 'and' | 'or' | null = null;
  for (;;) {
    const node = parseExpr();
    if (typeof node === 'string') return node;
    terms.push(node);
    const next = peekToken();
    if (next === null) break;
    if (next !== 'and' && next !== 'or') return err(tokenStart + 1, 'cmp');
    pendingOp = next;
    void pendingOp;
  }
  if (comparisons > 10) return 'comparisons';
  if (maxDepthAt.some(d => d > 3)) return 'depth';
  return compile(terms);
}

function compile(terms: TagNode[]): TagMatcher {
  const evalNode = (n: TagNode, tags: Record<string, string>): boolean => {
    if (typeof n === 'function') return (n as TagMatcher)(tags);
    const e = n as TagExpr;
    if (e.kind === 'cmp') {
      const has = Object.prototype.hasOwnProperty.call(tags, e.key);
      if (e.op === '=') return has && tags[e.key] === e.value;
      if (e.op === 'prefix') return has && tags[e.key].startsWith(e.value);
      return has && tags[e.key] !== e.value;
    }
    if (e.kind === 'not') return !evalNode((e as { term: TagNode }).term, tags);
    const parts = (e as { terms: TagNode[] }).terms;
    return parts.every(t => evalNode(t, tags));
  };
  return tags => terms.every(t => evalNode(t, tags));
}

function compileTagFilter(input: string): TagMatcher {
  const parsed = parseTagFilter(input);
  if (typeof parsed === 'string') return () => false;
  return parsed;
}
