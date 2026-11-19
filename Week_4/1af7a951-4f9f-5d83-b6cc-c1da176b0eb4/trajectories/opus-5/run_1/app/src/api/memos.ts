import { createHash } from 'node:crypto';
import { oneRow, pool } from '../db/pool.js';
import { apiError, notFound, validationError } from '../http/errors.js';
import { parseByteRange } from '../http/ranges.js';
import { memoContentType, type ApiResponse, type RequestContext } from '../http/router.js';
import { MESSAGES } from '../domain/fields.js';
import { signatureMatches } from '../domain/memoSignature.js';
import { findEntry, memoView, type EntryRow } from '../store/entries.js';
import {
  MemoStorageUnavailableError,
  getMemo,
  memoKey,
  putMemo,
  storageOutage,
} from '../services/storage.js';
import { dreamerOf, coachOf } from './support.js';

const CLAIM_WAIT_MS = 50;
const CLAIM_WAIT_ATTEMPTS = 200;

interface MemoDescriptor {
  readonly contentType: string;
  readonly durationMs: number | null;
  readonly digest: string;
  readonly sizeBytes: number;
}

function describe(ctx: RequestContext): MemoDescriptor {
  const contentType = memoContentType(ctx.headers);
  if (contentType === null) throw apiError(415, 'unsupported_media_type');
  const header = ctx.headers['x-memo-duration-ms'];
  const raw = Array.isArray(header) ? header[0] : header;
  let durationMs: number | null = null;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const value = Number(raw.trim());
    if (value >= 1 && value <= 600_000) durationMs = value;
  }
  return {
    contentType,
    durationMs,
    digest: createHash('sha256').update(ctx.rawBody).digest('hex'),
    sizeBytes: ctx.rawBody.length,
  };
}

function matchesSlot(entry: EntryRow, memo: MemoDescriptor): boolean {
  return (
    entry.memo_digest === memo.digest &&
    entry.memo_content_type === memo.contentType &&
    entry.memo_duration_ms === memo.durationMs
  );
}

function memoBody(memo: MemoDescriptor): Record<string, unknown> {
  return {
    content_type: memo.contentType,
    size_bytes: memo.sizeBytes,
    duration_ms: memo.durationMs,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function uploadMemo(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entryId = ctx.params['entryId'] ?? '';
  const entry = await findEntry(entryId);
  if (entry === null || entry.enrollment_id !== dreamer.id) throw notFound();
  const memo = describe(ctx);

  for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt += 1) {
    const fresh = await findEntry(entryId);
    if (fresh === null) throw notFound();
    if (fresh.memo_state === 'stored') {
      if (!matchesSlot(fresh, memo)) throw apiError(409, 'memo_exists');
      const stored = memoView(fresh);
      if (stored === null) throw apiError(409, 'memo_exists');
      return { status: 200, json: { memo: stored } };
    }
    if (fresh.memo_state === 'claimed') {
      if (!matchesSlot(fresh, memo)) throw apiError(409, 'memo_exists');
      await sleep(CLAIM_WAIT_MS);
      continue;
    }

    if (memo.durationMs === null) {
      throw validationError({ duration_ms: MESSAGES.memoDuration });
    }
    if (memo.sizeBytes === 0) throw validationError({ memo: MESSAGES.memoEmpty });
    if (!signatureMatches(memo.contentType, ctx.rawBody)) {
      throw validationError({ memo: MESSAGES.memoSignature });
    }

    const claimed = await oneRow<{ id: string }>(
      `update entries
          set memo_state = 'claimed', memo_content_type = $2, memo_size_bytes = $3,
              memo_duration_ms = $4, memo_digest = $5
        where id = $1 and memo_state = 'empty'
        returning id`,
      [entryId, memo.contentType, memo.sizeBytes, memo.durationMs, memo.digest],
    );
    if (claimed === null) continue;

    try {
      await putMemo(memoKey(dreamer.id, entryId), ctx.rawBody, memo.contentType, memo.durationMs);
    } catch (error) {
      await pool.query(
        `update entries
            set memo_state = 'empty', memo_content_type = null, memo_size_bytes = null,
                memo_duration_ms = null, memo_digest = null
          where id = $1 and memo_state = 'claimed'`,
        [entryId],
      );
      if (error instanceof MemoStorageUnavailableError) throw storageOutage();
      throw error;
    }
    await pool.query("update entries set memo_state = 'stored' where id = $1", [entryId]);
    return { status: 201, json: { memo: memoBody(memo) } };
  }
  throw apiError(409, 'memo_exists');
}

async function serveMemo(entry: EntryRow, ctx: RequestContext): Promise<ApiResponse> {
  const stored = memoView(entry);
  if (stored === null) throw notFound();
  let bytes: Buffer;
  try {
    bytes = await getMemo(memoKey(entry.enrollment_id, entry.id));
  } catch (error) {
    if (error instanceof MemoStorageUnavailableError) throw storageOutage();
    throw error;
  }
  const size = stored.size_bytes;
  const rangeHeader = ctx.headers['range'];
  const range = parseByteRange(typeof rangeHeader === 'string' ? rangeHeader : null, size);
  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': stored.content_type,
    'X-Memo-Duration-Ms': String(stored.duration_ms),
  };
  if (range.kind === 'unsatisfiable') {
    return {
      status: 416,
      json: { error: 'range_not_satisfiable' },
      headers: { ...common, 'Content-Range': `bytes */${size}` },
    };
  }
  if (range.kind === 'full') {
    return { status: 200, bytes, headers: common };
  }
  return {
    status: 206,
    bytes: bytes.subarray(range.first, range.last + 1),
    headers: { ...common, 'Content-Range': `bytes ${range.first}-${range.last}/${size}` },
  };
}

export async function fetchMemo(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entry = await findEntry(ctx.params['entryId'] ?? '');
  if (entry === null || entry.enrollment_id !== dreamer.id) throw notFound();
  return serveMemo(entry, ctx);
}

export async function fetchSharedMemo(ctx: RequestContext): Promise<ApiResponse> {
  const coach = await coachOf(ctx);
  const entry = await oneRow<EntryRow>(
    `select n.id, n.enrollment_id, n.night_key, n.title, n.text, n.dreams_recalled, n.lucid, n.wbtb,
            n.technique, n.technique_minutes, n.late_recall, n.shared, n.created_at, n.memo_state,
            n.memo_content_type, n.memo_size_bytes, n.memo_duration_ms, n.memo_digest
       from entries n
       join enrollments e on e.id = n.enrollment_id
       join cohorts c on c.id = e.cohort_id
      where n.id = $1 and c.id = $2 and c.coach_id = $3 and n.shared and e.status = 'active'`,
    [ctx.params['entryId'] ?? '', ctx.params['id'] ?? '', coach.id],
  );
  if (entry === null) throw notFound();
  return serveMemo(entry, ctx);
}
