/** The answer archive: stable capped paging, and plain-text search. */

import type { Answer, ArchiveBody, SearchBody } from '../shared/model.js';
import { checkText, LIMITS, normaliseText } from '../shared/text.js';
import { ANSWER_SELECT, toAnswer, type AnswerRow } from './answers.js';
import type { Db } from './db.js';
import { invalidFields, searchTimeout } from './errors.js';
import { isRoundNumber } from './rounds.js';

const PAGE_DEFAULT = 25;
const PAGE_CAP = 100;
const SEARCH_RESULT_CAP = 100;
const SEARCH_BUDGET_MS = 1500;
export const SEARCH_BODY_DEPTH = 4;

export function readLimit(raw: string | null): number {
  if (raw === null) return PAGE_DEFAULT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw invalidFields({ limit: 'invalid' });
  return Math.min(value, PAGE_CAP);
}

export function readRoundFilter(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!isRoundNumber(value)) throw invalidFields({ round: 'invalid' });
  return value;
}

export function readCursor(raw: string | null): number {
  if (raw === null) return 0;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const after = Number(decoded);
  if (decoded === '' || !Number.isInteger(after) || after < 0) throw invalidFields({ cursor: 'invalid' });
  return after;
}

function cursorFor(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64url');
}

export async function archivePage(
  db: Db,
  limit: number,
  after: number,
  round: number | null,
): Promise<ArchiveBody> {
  const result = await db.query<AnswerRow>(
    `${ANSWER_SELECT} where a.id > $1 and ($2::int is null or a.round = $2)
      order by a.id asc limit $3`,
    [after, round, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  const answers = rows.map(toAnswer);
  const last = answers[answers.length - 1];
  return {
    answers,
    limit,
    next_cursor: last === undefined ? null : cursorFor(last.id),
    has_more: result.rows.length > limit,
  };
}

/** Case-folded and stripped of accents, so `bjork` finds `Björk`. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function bodyDepth(value: unknown, level = 1): number {
  if (value === null || typeof value !== 'object') return level;
  let deepest = level;
  for (const held of Object.values(value as Record<string, unknown>)) {
    deepest = Math.max(deepest, bodyDepth(held, level + 1));
  }
  return deepest;
}

export async function searchAnswers(db: Db, query: unknown, round: unknown): Promise<SearchBody> {
  const started = Date.now();
  if (typeof query !== 'string') {
    throw invalidFields({ query: query === undefined || query === null ? 'required' : 'invalid' });
  }
  const verdict = checkText(query, LIMITS.searchQuery);
  if (verdict !== 'ok') throw invalidFields({ query: verdict });
  let filter: number | null = null;
  if (round !== undefined && round !== null) {
    if (typeof round !== 'number' || !isRoundNumber(round)) throw invalidFields({ round: 'invalid' });
    filter = round;
  }

  const wanted = fold(normaliseText(query));
  const result = await db.query<AnswerRow>(
    `${ANSWER_SELECT} where ($1::int is null or a.round = $1) order by a.id asc`,
    [filter],
  );

  const matched: Answer[] = [];
  let total = 0;
  for (const row of result.rows) {
    if (Date.now() - started > SEARCH_BUDGET_MS - 100) throw searchTimeout();
    if (!fold(row.text).includes(wanted)) continue;
    total += 1;
    if (matched.length < SEARCH_RESULT_CAP) matched.push(toAnswer(row));
  }
  return { answers: matched, count: matched.length, truncated: total > matched.length };
}
