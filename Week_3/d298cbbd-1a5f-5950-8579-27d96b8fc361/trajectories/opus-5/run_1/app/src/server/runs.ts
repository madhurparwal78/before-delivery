import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { query, queryOne, transaction } from './db.js';
import type { Ticket } from './tickets.js';
import {
  isAllowedLogKey,
  replay,
  roundHalfUp,
  type Characters,
  type EngineFigures,
  type LogEntry,
  type TestKind,
  type TestMode,
} from '../shared/engine.js';

export type RunErrorCode =
  | 'invalid_log'
  | 'wrong_text'
  | 'impossible_interval'
  | 'duration_mismatch'
  | 'replay_mismatch';

export function proofKeyFor(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface SubmittedFigures {
  readonly duration: number | null;
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly characters: {
    readonly correct: number | null;
    readonly incorrect: number | null;
    readonly extra: number | null;
    readonly missed: number | null;
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? roundHalfUp(value) : null;
}

export function submittedFigures(body: Record<string, unknown>): SubmittedFigures {
  const characters = body['characters'];
  const bag = typeof characters === 'object' && characters !== null
    ? (characters as Record<string, unknown>)
    : {};
  return {
    duration: numberOrNull(body['duration']),
    speed: numberOrNull(body['speed']),
    raw: numberOrNull(body['raw']),
    accuracy: numberOrNull(body['accuracy']),
    consistency: numberOrNull(body['consistency']),
    characters: {
      correct: numberOrNull(bag['correct']),
      incorrect: numberOrNull(bag['incorrect']),
      extra: numberOrNull(bag['extra']),
      missed: numberOrNull(bag['missed']),
    },
  };
}

/** The 413 check: decided from the submitted value alone, before any replay. */
export function logExceedsLimits(body: Record<string, unknown>): boolean {
  const log = body['log'];
  if (!Array.isArray(log)) return false;
  if (log.length > config.maxLogEvents) return true;
  for (const entry of log) {
    if (typeof entry !== 'object' || entry === null) continue;
    const t = (entry as Record<string, unknown>)['t'];
    if (typeof t === 'number' && t > config.maxTestMs) return true;
  }
  return false;
}

export type LogOrigin = 'ticket' | 'race';

function parseLog(value: unknown, origin: LogOrigin): LogEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: LogEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 2 || !keys.includes('k') || !keys.includes('t')) return null;
    const k = record['k'];
    const t = record['t'];
    if (typeof k !== 'string' || !isAllowedLogKey(k)) return null;
    if (typeof t !== 'number' || !Number.isInteger(t)) return null;
    entries.push({ k, t });
  }
  const first = entries[0];
  if (first) {
    if (origin === 'ticket' && first.t !== 0) return null;
    if (origin === 'race' && (first.t < 0 || first.t >= config.raceTimeLimitSeconds * 1000)) {
      return null;
    }
  }
  return entries;
}

function textMatches(value: unknown, words: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== words.length) return false;
  return value.every((word, index) => word === words[index]);
}

function impossibleInterval(entries: readonly LogEntry[]): boolean {
  let fast = 0;
  let gaps = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1] as LogEntry;
    const current = entries[i] as LogEntry;
    if (current.t < previous.t) return true;
    gaps += 1;
    if (current.t - previous.t < config.fastIntervalMs) fast += 1;
  }
  return gaps > 0 && fast / gaps > 0.3;
}

export interface CheckInput {
  readonly words: readonly string[];
  readonly kind: TestKind;
  /** `<length> * 1000` for a time test, null for a finite one. */
  readonly timeLengthMs: number | null;
  readonly body: Record<string, unknown>;
  readonly origin: LogOrigin;
}

export type CheckOutcome =
  | { readonly ok: true; readonly figures: EngineFigures }
  | { readonly ok: false; readonly code: RunErrorCode };

/** The 422 run checks, in the published order. */
export function checkRun(input: CheckInput): CheckOutcome {
  const entries = parseLog(input.body['log'], input.origin);
  if (!entries) return { ok: false, code: 'invalid_log' };
  if (!textMatches(input.body['text'], input.words)) return { ok: false, code: 'wrong_text' };
  if (impossibleInterval(entries)) return { ok: false, code: 'impossible_interval' };

  const submittedDuration = input.body['duration'];
  const result = replay({
    words: input.words,
    kind: input.kind,
    log: entries,
    maxExtraLetters: config.maxExtraLetters,
    timeDurationMs: input.timeLengthMs,
  });
  if (typeof submittedDuration !== 'number' || !Number.isFinite(submittedDuration)) {
    return { ok: false, code: 'duration_mismatch' };
  }
  if (input.timeLengthMs !== null) {
    if (submittedDuration !== input.timeLengthMs) return { ok: false, code: 'duration_mismatch' };
    if (entries.some((entry) => entry.t >= submittedDuration)) {
      return { ok: false, code: 'duration_mismatch' };
    }
  } else {
    if (!result.engine.ended) return { ok: false, code: 'duration_mismatch' };
    if (result.engine.entriesAfterEnd > 0) return { ok: false, code: 'duration_mismatch' };
    if (submittedDuration !== result.engine.endT) return { ok: false, code: 'duration_mismatch' };
  }

  const submitted = submittedFigures(input.body);
  const figures = result.figures;
  const sameCharacters =
    submitted.characters.correct === figures.characters.correct &&
    submitted.characters.incorrect === figures.characters.incorrect &&
    submitted.characters.extra === figures.characters.extra &&
    submitted.characters.missed === figures.characters.missed;
  const sameFigures =
    submitted.speed === roundHalfUp(figures.speed) &&
    submitted.raw === roundHalfUp(figures.raw) &&
    submitted.accuracy === roundHalfUp(figures.accuracy) &&
    submitted.consistency === roundHalfUp(figures.consistency);
  if (!sameCharacters || !sameFigures) return { ok: false, code: 'replay_mismatch' };
  return { ok: true, figures };
}

export interface StoredResponse {
  readonly status: number;
  readonly body: string;
}

interface RunMeta {
  readonly typistId: string;
  readonly mode: TestMode;
  readonly length: string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly quoteId: string | null;
  readonly words: readonly string[];
}

export function metaOfTicket(ticket: Ticket): RunMeta {
  return {
    typistId: ticket.typistId as string,
    mode: ticket.mode,
    length: ticket.length,
    punctuation: ticket.punctuation,
    numbers: ticket.numbers,
    quoteId: ticket.quoteId,
    words: ticket.words,
  };
}

function charactersJson(characters: Characters | SubmittedFigures['characters']): string {
  return JSON.stringify(characters);
}

interface CountedInsert {
  readonly ticketId: string | null;
  readonly meta: RunMeta;
  readonly logValue: unknown;
  readonly figures: EngineFigures;
  readonly proofKey: string;
  readonly bytes: Buffer;
  readonly finishedAt?: Date;
}

interface RefusedInsert {
  readonly ticketId: string | null;
  readonly meta: RunMeta;
  readonly logValue: unknown;
  readonly code: RunErrorCode;
  readonly submitted: SubmittedFigures;
  readonly proofKey: string;
  readonly bytes: Buffer;
}

function lockKeyFor(typistId: string): number {
  let hash = 0;
  for (const character of typistId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return hash;
}

/**
 * Stores a counted run with its verdict in one transaction and answers with the response that
 * was recorded first for the ticket.
 */
export async function storeCountedRun(input: CountedInsert): Promise<StoredResponse> {
  const runId = randomUUID();
  return transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1, $2)', [2, lockKeyFor(input.meta.typistId)]);
    const best = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from runs
          where typist_id = $1 and verdict = 'counted' and mode = $2
            and length is not distinct from $3 and punctuation = $4 and numbers = $5
            and (speed > $6 or (speed = $6 and accuracy >= $7))
            and (mode <> 'custom' or jsonb_array_length(words) = $8)
       ) as exists`,
      [
        input.meta.typistId,
        input.meta.mode,
        input.meta.length,
        input.meta.punctuation,
        input.meta.numbers,
        roundHalfUp(input.figures.speed),
        roundHalfUp(input.figures.accuracy),
        input.meta.words.length,
      ],
    );
    const personalBest = !(best.rows[0]?.exists ?? false);
    const body = JSON.stringify({
      runId,
      verdict: 'counted',
      personalBest,
      speed: roundHalfUp(input.figures.speed),
      raw: roundHalfUp(input.figures.raw),
      accuracy: roundHalfUp(input.figures.accuracy),
      consistency: roundHalfUp(input.figures.consistency),
      proofKey: input.proofKey,
    });
    const inserted = await client.query<{ id: string }>(
      `insert into runs (
         id, ticket_id, typist_id, mode, length, punctuation, numbers, quote_id, words, log,
         duration, speed, raw, accuracy, consistency, characters, errors_by_key, per_second,
         verdict, reason, finished_at, proof_key, body, response_status, response_body)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
               $11, $12, $13, $14, $15, $16::json, $17::json, $18::json,
               'counted', null, coalesce($19::timestamptz, now()), $20, $21, 201, $22)
       on conflict (ticket_id) do nothing
       returning id`,
      [
        runId,
        input.ticketId,
        input.meta.typistId,
        input.meta.mode,
        input.meta.length,
        input.meta.punctuation,
        input.meta.numbers,
        input.meta.quoteId,
        JSON.stringify(input.meta.words),
        JSON.stringify(input.logValue ?? null),
        roundHalfUp(input.figures.duration),
        roundHalfUp(input.figures.speed),
        roundHalfUp(input.figures.raw),
        roundHalfUp(input.figures.accuracy),
        roundHalfUp(input.figures.consistency),
        charactersJson(input.figures.characters),
        JSON.stringify(input.figures.errorsByKey),
        JSON.stringify(
          input.figures.perSecond.map((row) => ({
            second: row.second,
            speed: roundHalfUp(row.speed),
            raw: roundHalfUp(row.raw),
            errors: row.errors,
          })),
        ),
        input.finishedAt ? input.finishedAt.toISOString() : null,
        input.proofKey,
        input.bytes,
        body,
      ],
    );
    if (inserted.rowCount === 0) return storedResponseFor(client, input.ticketId);
    return { status: 201, body };
  });
}

export async function storeRefusedRun(input: RefusedInsert): Promise<StoredResponse> {
  const runId = randomUUID();
  const body = JSON.stringify({
    error: input.code,
    verdict: 'not_counted',
    runId,
    proofKey: input.proofKey,
  });
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into runs (
         id, ticket_id, typist_id, mode, length, punctuation, numbers, quote_id, words, log,
         duration, speed, raw, accuracy, consistency, characters, errors_by_key, per_second,
         verdict, reason, proof_key, body, response_status, response_body)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
               $11, $12, $13, $14, $15, $16::json, null, null,
               'not_counted', $17, $18, $19, 422, $20)
       on conflict (ticket_id) do nothing
       returning id`,
      [
        runId,
        input.ticketId,
        input.meta.typistId,
        input.meta.mode,
        input.meta.length,
        input.meta.punctuation,
        input.meta.numbers,
        input.meta.quoteId,
        JSON.stringify(input.meta.words),
        JSON.stringify(input.logValue ?? null),
        input.submitted.duration,
        input.submitted.speed,
        input.submitted.raw,
        input.submitted.accuracy,
        input.submitted.consistency,
        charactersJson(input.submitted.characters),
        input.code,
        input.proofKey,
        input.bytes,
        body,
      ],
    );
    if (inserted.rowCount === 0) return storedResponseFor(client, input.ticketId);
    return { status: 422, body };
  });
}

interface Queryable {
  query<T extends import('pg').QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<{ rows: T[] }>;
}

async function storedResponseFor(
  client: Queryable,
  ticketId: string | null,
): Promise<StoredResponse> {
  const found = await client.query<{ response_status: number; response_body: string }>(
    'select response_status, response_body from runs where ticket_id = $1',
    [ticketId],
  );
  const row = found.rows[0];
  if (!row) throw new Error('stored run response missing');
  return { status: row.response_status, body: row.response_body };
}

export async function storedRunResponse(ticketId: string): Promise<StoredResponse | null> {
  const row = await queryOne<{ response_status: number; response_body: string }>(
    'select response_status, response_body from runs where ticket_id = $1',
    [ticketId],
  );
  return row ? { status: row.response_status, body: row.response_body } : null;
}

export interface RunRow {
  id: string;
  mode: string;
  length: string | null;
  punctuation: boolean;
  numbers: boolean;
  quote_id: string | null;
  words: string[];
  log: string | null;
  duration: string | null;
  speed: string | null;
  raw: string | null;
  accuracy: string | null;
  consistency: string | null;
  characters: Record<string, number | null> | null;
  errors_by_key: Record<string, number> | null;
  per_second: { second: number; speed: number; raw: number; errors: number }[] | null;
  verdict: string;
  reason: string | null;
  finished_at: Date;
  proof_key: string | null;
}

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function displayLength(mode: string, length: string | null, words: string[]): number | string | null {
  if (mode === 'custom') return words.length;
  if (length === null) return null;
  return mode === 'quote' ? length : Number(length);
}

export async function runById(id: string, typistId: string | null): Promise<RunRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id) || typistId === null) return null;
  return queryOne<RunRow>(
    `select id, mode, length, punctuation, numbers, quote_id, words, log, duration, speed, raw,
            accuracy, consistency, characters, errors_by_key, per_second, verdict, reason,
            finished_at, proof_key
       from runs where id = $1 and typist_id = $2`,
    [id, typistId],
  );
}

export function runResponse(row: RunRow): Record<string, unknown> {
  return {
    runId: row.id,
    mode: row.mode,
    length: displayLength(row.mode, row.length, row.words),
    punctuation: row.punctuation,
    numbers: row.numbers,
    quoteId: row.quote_id,
    words: row.words,
    log: row.log === null ? null : (JSON.parse(row.log) as unknown),
    duration: numeric(row.duration),
    speed: numeric(row.speed),
    raw: numeric(row.raw),
    accuracy: numeric(row.accuracy),
    consistency: numeric(row.consistency),
    characters: row.characters,
    errorsByKey: row.errors_by_key,
    perSecond: row.per_second,
    verdict: row.verdict,
    reason: row.reason,
    finishedAt: row.finished_at.toISOString(),
    proofKey: row.proof_key,
  };
}

export interface HistoryFilters {
  readonly mode: string | null;
  readonly length: string | null;
  readonly verdict: string | null;
  readonly page: number;
}

export async function historyPage(
  typistId: string,
  filters: HistoryFilters,
): Promise<{ runs: Record<string, unknown>[]; more: boolean; customLengths: number[] }> {
  const conditions: string[] = ['typist_id = $1'];
  const values: unknown[] = [typistId];
  if (filters.mode) {
    values.push(filters.mode);
    conditions.push(`mode = $${values.length}`);
  }
  if (filters.length) {
    if (filters.mode === 'custom') {
      values.push(Number(filters.length));
      conditions.push(`jsonb_array_length(words) = $${values.length}`);
    } else {
      values.push(filters.length);
      conditions.push(`length = $${values.length}`);
    }
  }
  if (filters.verdict) {
    values.push(filters.verdict);
    conditions.push(`verdict = $${values.length}`);
  }
  const offset = (filters.page - 1) * 20;
  const rows = await query<RunRow>(
    `select id, mode, length, punctuation, numbers, quote_id, words, log, duration, speed, raw,
            accuracy, consistency, characters, errors_by_key, per_second, verdict, reason,
            finished_at, proof_key
       from runs where ${conditions.join(' and ')}
      order by finished_at desc, id desc limit 21 offset ${offset}`,
    values,
  );
  const page = rows.slice(0, 20);
  const custom = await query<{ count: number }>(
    `select distinct jsonb_array_length(words) as count from runs
      where typist_id = $1 and mode = 'custom' order by count asc`,
    [typistId],
  );
  return {
    runs: page.map((row) => ({
      runId: row.id,
      finishedAt: row.finished_at.toISOString(),
      mode: row.mode,
      length: displayLength(row.mode, row.length, row.words),
      speed: numeric(row.speed),
      raw: numeric(row.raw),
      accuracy: numeric(row.accuracy),
      consistency: numeric(row.consistency),
      verdict: row.verdict,
    })),
    more: rows.length > 20,
    customLengths: custom.map((row) => Number(row.count)),
  };
}

const MODE_ORDER: Record<string, number> = { time: 0, words: 1, quote: 2, custom: 3 };
const QUOTE_ORDER: Record<string, number> = { short: 0, medium: 1, long: 2, all: 3 };

export interface PersonalBest {
  readonly mode: string;
  readonly length: number | string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly speed: number;
  readonly accuracy: number;
  readonly finishedAt: string;
  readonly runId: string;
}

function lengthOrder(length: number | string | null): number {
  if (typeof length === 'number') return length;
  if (typeof length === 'string') return QUOTE_ORDER[length] ?? 0;
  return 0;
}

export async function personalBests(typistId: string): Promise<PersonalBest[]> {
  const rows = await query<RunRow>(
    `select id, mode, length, punctuation, numbers, quote_id, words, log, duration, speed, raw,
            accuracy, consistency, characters, errors_by_key, per_second, verdict, reason,
            finished_at, proof_key
       from runs where typist_id = $1 and verdict = 'counted'
      order by speed desc, accuracy desc, finished_at asc`,
    [typistId],
  );
  const bests = new Map<string, PersonalBest>();
  for (const row of rows) {
    const length = displayLength(row.mode, row.length, row.words);
    const key = `${row.mode}|${String(length)}|${row.punctuation}|${row.numbers}`;
    if (bests.has(key)) continue;
    bests.set(key, {
      mode: row.mode,
      length,
      punctuation: row.punctuation,
      numbers: row.numbers,
      speed: Number(row.speed),
      accuracy: Number(row.accuracy),
      finishedAt: row.finished_at.toISOString(),
      runId: row.id,
    });
  }
  return [...bests.values()].sort((a, b) => {
    const modes = (MODE_ORDER[a.mode] ?? 0) - (MODE_ORDER[b.mode] ?? 0);
    if (modes !== 0) return modes;
    const lengths = lengthOrder(a.length) - lengthOrder(b.length);
    if (lengths !== 0) return lengths;
    if (a.punctuation !== b.punctuation) return a.punctuation ? 1 : -1;
    if (a.numbers !== b.numbers) return a.numbers ? 1 : -1;
    return 0;
  });
}

export async function testsCounted(typistId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*) as count from runs where typist_id = $1 and verdict = 'counted'",
    [typistId],
  );
  return Number(row?.count ?? 0);
}
