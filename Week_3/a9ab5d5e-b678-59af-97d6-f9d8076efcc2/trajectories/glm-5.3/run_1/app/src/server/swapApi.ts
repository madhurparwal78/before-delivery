/** Swap endpoints: lifecycle, overlap claims, run limit, accept recheck. */
import { Ctx, sendJson, sendNoContent } from './http';
import { problem } from './problems';
import { AppDeps, SwapRow } from './apiTypes';
import * as auth from './auth';
import { loadVersions, loadDerivedSwaps, toVersionForNight, requireIfMatch, loadHousehold } from './helpers';
import { ValidationErrors, checkDate, fail, hasField, isObject } from './validate';
import { appendLog, withTransaction } from '../db/db';
import { deriveNight, versionInEffect, handoverFor } from '../domain/derive';
import { runTooLong, otherOf } from '../domain/swapRules';
import { DerivedSwap, VersionForNight } from '../domain/derived';
import { Temporal } from '@js-temporal/polyfill';
import { nowInstant, parseDate } from '../lib/time';
import { requestTransition } from '../domain/requests';
import { nfc } from '../lib/text';

export async function listSwaps(ctx: Ctx, deps: AppDeps): Promise<void> {
  const state = ctx.query('state');
  const validStates = ['draft', 'sent', 'accepted', 'declined', 'lapsed', 'withdrawn', 'settled'];
  if (state !== null && !validStates.includes(state)) {
    throw new ValidationErrors({ state: 'This value is out of range.' });
  }
  const { limit, after } = parseListQuery(ctx);
  const params: unknown[] = [ctx.householdId!];
  let where = 'household_id = $1';
  if (state) {
    params.push(state);
    where += ` AND state = $${params.length}`;
  }
  let cursorWhere = '';
  if (after !== null) {
    params.push(after);
    cursorWhere = ` AND id > $${params.length}`;
  }
  params.push(limit + 1);
  const res = await deps.pool.query(
    `SELECT * FROM swaps WHERE ${where}${cursorWhere} ORDER BY id ASC LIMIT $${params.length}`,
    params,
  );
  const rows = res.rows as SwapRow[];
  const next = rows.length > limit ? String(rows[limit - 1].id) : null;
  sendJson(ctx, 200, { items: rows.slice(0, limit).map(swapOut), next });
}

export function swapOut(s: SwapRow): Record<string, unknown> {
  return {
    id: s.id,
    nights: `${s.nights_start}/${s.nights_end}`,
    makeupNights: s.makeup_start && s.makeup_end ? `${s.makeup_start}/${s.makeup_end}` : null,
    toParent: s.to_parent,
    createdBy: s.created_by,
    note: s.note,
    state: s.state,
    sentAt: s.sent_at ? instantOutJs(s.sent_at) : null,
    answerBy: s.answer_by ? instantOutJs(s.answer_by) : null,
    answerZone: s.answer_zone,
    answeredAt: s.answered_at ? instantOutJs(s.answered_at) : null,
    declineReason: s.decline_reason,
    createdAt: instantOutJs(s.created_at),
  };
}

function instantOutJs(d: Date): string {
  // RFC 3339: no fractional seconds, never Z
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00').replace('Z', '+00:00');
}

export async function getSwap(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const s = await loadSwap(deps, ctx.householdId!, id);
  sendJson(ctx, 200, swapOut(s), { etag: s.etag });
}

async function loadSwap(deps: AppDeps, hid: string, id: string): Promise<SwapRow> {
  if (!/^\d+$/.test(id)) throw problem(404, 'not_found');
  const res = await deps.pool.query(`SELECT * FROM swaps WHERE id=$1 AND household_id=$2`, [id, hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as SwapRow;
}

interface SwapInput {
  nights: { first: string; last: string };
  makeupNights: { first: string; last: string } | null;
  toParent: 'planning' | 'other';
  note: string | null;
}

export async function createSwap(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  const input = parseSwapInput(body);
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adopted = versions.filter((v) => v.status === 'adopted').map(toVersionForNight);
  if (adopted.length === 0) throw problem(409, 'no_adopted_plan');
  if (!h.other_joined_at) throw problem(409, 'other_parent_not_joined');

  // 1 to 28 nights, first <= last
  validateNights(input);

  // every night must belong to the giver with accepted swaps counted
  const giver = otherOf(input.toParent);
  const swaps = await loadDerivedSwaps(deps.pool, ctx.householdId!);
  for (const d of eachNight(input.nights)) {
    const own = deriveNight(adopted, swaps, d);
    if (own.owner !== giver) {
      throw new ValidationErrors({ nights: 'Every night in a swap must be with the parent giving it.' });
    }
  }
  // both intervals are one claim at create: check makeup rules
  if (input.makeupNights) {
    checkMakeup(input, adopted, swaps);
  }
  const id = auth.randomId();
  const etag = auth.etagForId(id);
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO swaps (id, household_id, nights_start, nights_end, makeup_start, makeup_end,
         to_parent, created_by, note, state, etag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10)`,
      [id, ctx.householdId, input.nights.first, input.nights.last,
        input.makeupNights?.first ?? null, input.makeupNights?.last ?? null,
        input.toParent, ctx.role!, input.note, etag],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.drafted', id);
  });
  const s = await loadSwap(deps, ctx.householdId!, id);
  sendJson(ctx, 201, swapOut(s), { etag, location: `/api/households/${ctx.householdId}/swaps/${id}` });
}

function parseSwapInput(body: Record<string, unknown>): SwapInput {
  const allowed = ['nights', 'makeupNights', 'toParent', 'note'];
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype' || !allowed.includes(k)) {
      fail({ [k]: 'This field is not accepted.' });
    }
  }
  for (const f of ['nights', 'toParent']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const nights = typeof body.nights === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(body.nights)
    ? body.nights : fail({ nights: 'Enter a first and last night, at most 28 nights.' });
  const [a, b] = nights.split('/');
  checkDate('nights', a);
  checkDate('nights', b);
  if (a > b) fail({ nights: 'Enter a first and last night, at most 28 nights.' });
  const nightsIv = { first: a, last: b };
  let makeupNights: { first: string; last: string } | null = null;
  if (body.makeupNights !== null && body.makeupNights !== undefined) {
    const mk = typeof body.makeupNights === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(body.makeupNights)
      ? body.makeupNights : fail({ makeupNights: 'This value is out of range.' });
    const [c, d] = mk.split('/');
    checkDate('makeupNights', c);
    checkDate('makeupNights', d);
    if (c > d) fail({ makeupNights: 'This value is out of range.' });
    makeupNights = { first: c, last: d };
  }
  const toParent = body.toParent === 'planning' || body.toParent === 'other'
    ? body.toParent : fail({ toParent: 'This value is out of range.' });
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    const t = typeof body.note === 'string' ? body.note : fail({ note: 'Use at most 500 characters.' });
    if (hasForbiddenChars(t)) fail({ note: 'Remove hidden or control characters.' });
    if (nfc(t).length > 500) fail({ note: 'Use at most 500 characters.' });
    note = t;
  }
  return { nights: nightsIv, makeupNights, toParent, note };
}

import { hasForbiddenChars } from '../lib/text';

function validateNights(input: SwapInput): void {
  const len = Temporal.PlainDate.from(input.nights.last).since(Temporal.PlainDate.from(input.nights.first)).days + 1;
  if (len < 1 || len > 28) {
    fail({ nights: 'Enter a first and last night, at most 28 nights.' });
  }
}

function* eachNight(iv: { first: string; last: string }): Generator<Temporal.PlainDate> {
  let d = Temporal.PlainDate.from(iv.first);
  const last = Temporal.PlainDate.from(iv.last);
  while (Temporal.PlainDate.compare(d, last) <= 0) {
    yield d;
    d = d.add({ days: 1 });
  }
}

function checkMakeup(input: SwapInput, adopted: VersionForNight[], swaps: DerivedSwap[]): void {
  const mk = input.makeupNights!;
  const giver = otherOf(input.toParent);
  // order: length mismatch, overlap, distance, ownership
  const nLen = Temporal.PlainDate.from(input.nights.last).since(Temporal.PlainDate.from(input.nights.first)).days + 1;
  const mkLen = Temporal.PlainDate.from(mk.last).since(Temporal.PlainDate.from(mk.first)).days + 1;
  if (nLen !== mkLen) {
    fail({ makeupNights: 'Make-up nights must match the number of nights swapped.' });
  }
  if (ivOverlap(input.nights, mk)) {
    fail({ makeupNights: "Make-up nights can't overlap the nights swapped." });
  }
  // more than 365 days between the end of the earlier interval and the first night of the later
  const ordered = [input.nights, mk].sort((x, y) => (x.first < y.first ? -1 : 1));
  const gap = Temporal.PlainDate.from(ordered[1].first).since(Temporal.PlainDate.from(ordered[0].last)).days;
  if (gap > 365) {
    fail({ makeupNights: 'Take make-up nights within one year.' });
  }
  for (const d of eachNight(mk)) {
    const own = deriveNight(adopted, swaps, d);
    if (own.owner !== input.toParent) {
      fail({ makeupNights: 'Every make-up night must be with the parent receiving the swap.' });
    }
  }
  void giver;
}

function ivOverlap(a: { first: string; last: string }, b: { first: string; last: string }): boolean {
  return a.first <= b.last && b.first <= a.last;
}

export async function deleteSwap(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const s = await loadSwap(deps, ctx.householdId!, id);
  if (s.created_by !== ctx.role) throw problem(403, 'not_your_request');
  if (s.state !== 'draft') throw problem(409, 'invalid_transition');
  requireIfMatch(ctx, s.etag);
  await withTransaction(deps.pool, async (client) => {
    await client.query(`DELETE FROM swaps WHERE id=$1`, [id]);
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.deleted', id);
  });
  sendNoContent(ctx);
}

export async function swapAction(ctx: Ctx, deps: AppDeps, id: string, action: string): Promise<void> {
  const s = await loadSwap(deps, ctx.householdId!, id);
  const now = nowInstant();
  const nowDate = new Date();
  const isCreator = s.created_by === ctx.role;
  const answererRole = otherOf(s.created_by);
  const isAnswerer = ctx.role === answererRole;

  switch (action) {
    case 'send':
      return sendSwap(ctx, deps, s, now, nowDate);
    case 'withdraw':
      return withdrawSwap(ctx, deps, s, now, isCreator, answererRole, isAnswerer, nowDate);
    case 'accept':
      return acceptSwap(ctx, deps, s, now, isCreator, answererRole, nowDate);
    case 'decline':
      return declineSwap(ctx, deps, s, isCreator, nowDate);
    default:
      // lapse and settle belong to the system
      if (action === 'lapse' || action === 'settle') throw problem(409, 'invalid_transition');
      throw problem(404, 'not_found');
  }
}

async function sendSwap(ctx: Ctx, deps: AppDeps, s: SwapRow, now: import('@js-temporal/polyfill').Temporal.Instant, nowDate: Date): Promise<void> {
  const isCreator = s.created_by === ctx.role;
  const t = requestTransition('swap', s.state as never, 'send', isCreator);
  if (!t.ok) throw transitionProblem(t.code!);
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adopted = versions.filter((v) => v.status === 'adopted').map(toVersionForNight);
  const swaps = await loadDerivedSwaps(deps.pool, ctx.householdId!);
  const nights = { first: s.nights_start, last: s.nights_end };
  const giver = otherOf(s.to_parent);

  // recheck ownership at send (accepted swaps counted, sent ignored)
  for (const d of eachNight(nights)) {
    const own = deriveNight(adopted, swaps, d);
    if (own.owner !== giver) {
      throw new ValidationErrors({ nights: 'Every night in a swap must be with the parent giving it.' });
    }
  }
  if (s.makeup_start && s.makeup_end) {
    const mk = { first: s.makeup_start, last: s.makeup_end };
    for (const d of eachNight(mk)) {
      const own = deriveNight(adopted, swaps, d);
      if (own.owner !== s.to_parent) {
        throw new ValidationErrors({ makeupNights: 'Every make-up night must be with the parent receiving the swap.' });
      }
    }
  }
  // first handover of each interval must be after now
  const intervals: Array<{ first: string; last: string }> = [nights];
  if (s.makeup_start && s.makeup_end) intervals.push({ first: s.makeup_start, last: s.makeup_end });
  for (const iv of intervals) {
    const first = Temporal.PlainDate.from(iv.first);
    const prev = deriveNight(adopted, swaps, first.add({ days: -1 }));
    const cur = deriveNight(adopted, swaps, first);
    if (prev.owner && cur.owner && prev.owner !== cur.owner) {
      const h = handoverFor(adopted, swaps, first, prev.owner, cur.owner);
      if (h && parseDate(h.exchangeAt) !== undefined) {
        const inst = Temporal.Instant.from(h.exchangeAt);
        if (Temporal.Instant.compare(inst, now) <= 0) {
          throw new ValidationErrors({ nights: "The first night's handover has already passed." });
        }
      }
    }
  }
  // run limit with the candidate accepted
  const candidate: DerivedSwap = {
    id: s.id,
    nights,
    makeupNights: s.makeup_start && s.makeup_end ? { first: s.makeup_start, last: s.makeup_end } : null,
    toParent: s.to_parent,
    createdBy: s.created_by,
    settledAtHandover: false,
  };
  if (runTooLong(adopted, swaps, candidate)) {
    throw new ValidationErrors({ nights: 'That swap would keep the child with one parent for more than the plan allows in a row.' });
  }

  // one-winner overlap claim, linearizable across processes; nights are
  // inclusive date intervals on either side
  const overlap = await deps.pool.query(
    `SELECT id FROM swaps
     WHERE household_id=$1 AND state IN ('sent','accepted')
       AND (nights_start <= $3 AND $2 <= nights_end
         OR (makeup_start IS NOT NULL AND makeup_start <= $3 AND $2 <= makeup_end))
     LIMIT 1`,
    [ctx.householdId, s.nights_start, s.nights_end],
  );
  if (overlap.rows.length > 0) {
    const conflictingId = overlap.rows[0].id;
    throw problem(409, 'swap_overlaps', { extra: { conflictingRequestId: conflictingId } });
  }
  if (s.makeup_start && s.makeup_end) {
    const overlapMk = await deps.pool.query(
      `SELECT id FROM swaps
       WHERE household_id=$1 AND state IN ('sent','accepted')
         AND (nights_start <= $3 AND $2 <= nights_end
           OR (makeup_start IS NOT NULL AND makeup_start <= $3 AND $2 <= makeup_end))
       LIMIT 1`,
      [ctx.householdId, s.makeup_start, s.makeup_end],
    );
    if (overlapMk.rows.length > 0) {
      throw problem(409, 'swap_overlaps', { extra: { conflictingRequestId: overlapMk.rows[0].id } });
    }
  }

  // answer-by: earlier of window end and first handover
  const windowEnd = new Date(nowDate.getTime() + deps.config.answerWindowSeconds * 1000);
  let answerBy = windowEnd;
  for (const iv of intervals) {
    const first = Temporal.PlainDate.from(iv.first);
    const prev = deriveNight(adopted, swaps, first.add({ days: -1 }));
    const cur = deriveNight(adopted, swaps, first);
    if (prev.owner && cur.owner && prev.owner !== cur.owner) {
      const h = handoverFor(adopted, swaps, first, prev.owner, cur.owner);
      if (h) {
        const inst = Temporal.Instant.from(h.exchangeAt);
        const ms = epochMs(inst);
        if (ms < answerBy.getTime()) answerBy = new Date(ms);
      }
    }
  }
  const answerZone = versionInEffect(adopted, Temporal.PlainDate.from(s.nights_start))?.exchangeZone ?? 'UTC';
  const reminderAt = new Date(answerBy.getTime() - deps.config.reminderLeadSeconds * 1000);
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const answerer = otherOf(s.created_by);
  const answererEmail = answerer === 'planning' ? h.planning_email : h.other_email;
  const subject = `Swap request in ${h.name}`;
  const updated = await withTransaction(deps.pool, async (client) => {
    // linearizable claim: lock the household row, recheck overlap, update
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ctx.householdId]);
    const again = await client.query(
      `SELECT id FROM swaps
       WHERE household_id=$1 AND state IN ('sent','accepted') AND id <> $2
         AND (nights_start <= $4 AND $3 <= nights_end
           OR (makeup_start IS NOT NULL AND makeup_start <= $4 AND $3 <= makeup_end)
           OR (nights_start <= $6 AND $5 <= nights_end)
           OR (makeup_start IS NOT NULL AND makeup_start <= $6 AND $5 <= makeup_end))
       LIMIT 1`,
      [ctx.householdId, s.id, s.nights_start, s.nights_end,
        s.makeup_start ?? '9999-12-31', s.makeup_end ?? '9999-12-31'],
    );
    if (again.rows.length > 0) {
      throw problem(409, 'swap_overlaps', { extra: { conflictingRequestId: again.rows[0].id } });
    }
    await client.query(
      `UPDATE swaps SET state='sent', sent_at=now(), answer_by=$2, answer_zone=$3, reminder_at=$4,
         reminded_at=NULL, etag=$5 WHERE id=$1`,
      [s.id, answerBy, answerZone, reminderAt > nowDate ? reminderAt : null, auth.etagForId(s.id + ':' + Date.now())],
    );
    const noticeId = auth.randomId();
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'request_sent',$3,$4,'/requests','queued')`,
      [noticeId, ctx.householdId, answererEmail, subject],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.sent', s.id);
    return noticeId;
  });
  void updated;
  const s2 = await loadSwap(deps, ctx.householdId!, s.id);
  sendJson(ctx, 200, swapOut(s2), { etag: s2.etag });
}

function epochMs(inst: Temporal.Instant): number {
  return Number(inst.epochMilliseconds);
}

function transitionProblem(code: string): import('./problems').Problem {
  switch (code) {
    case 'not_your_request': return problem(403, 'not_your_request');
    case 'not_your_answer': return problem(403, 'not_your_answer');
    default: return problem(409, 'invalid_transition');
  }
}

export { transitionProblem };

async function withdrawSwap(ctx: Ctx, deps: AppDeps, s: SwapRow, now: import('@js-temporal/polyfill').Temporal.Instant, isCreator: boolean, answererRole: 'planning' | 'other', isAnswerer: boolean, nowDate: Date): Promise<void> {
  const t = requestTransition('swap', s.state as never, 'withdraw', isCreator);
  if (!t.ok) throw transitionProblem(t.code!);
  checkLapse(s, nowDate);
  void answererRole; void isAnswerer;
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const creatorEmail = s.created_by === 'planning' ? h.planning_email : h.other_email;
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `UPDATE swaps SET state='withdrawn', answered_at=now(), etag=$2 WHERE id=$1`,
      [s.id, auth.etagForId(s.id + ':' + Date.now())],
    );
    const noticeId = auth.randomId();
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
      [noticeId, ctx.householdId, creatorEmail, `Your request was withdrawn in ${h.name}`],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.withdrawn', s.id);
  });
  const s2 = await loadSwap(deps, ctx.householdId!, s.id);
  sendJson(ctx, 200, swapOut(s2), { etag: s2.etag });
  void now;
}

async function declineSwap(ctx: Ctx, deps: AppDeps, s: SwapRow, isCreator: boolean, nowDate: Date): Promise<void> {
  const t2 = requestTransition('swap', s.state as never, 'decline', isCreator);
  if (!t2.ok) throw transitionProblem(t2.code!);
  checkLapse(s, nowDate);
  const reason = requireReason(ctx);
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const creatorEmail = s.created_by === 'planning' ? h.planning_email : h.other_email;
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `UPDATE swaps SET state='declined', answered_at=now(), decline_reason=$2, etag=$3 WHERE id=$1`,
      [s.id, reason, auth.etagForId(s.id + ':' + Date.now())],
    );
    const noticeId = auth.randomId();
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
      [noticeId, ctx.householdId, creatorEmail, `Your request was declined in ${h.name}`],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.declined', s.id);
  });
  const s2 = await loadSwap(deps, ctx.householdId!, s.id);
  sendJson(ctx, 200, swapOut(s2), { etag: s2.etag });
}

function requireReason(ctx: Ctx): string {
  const body = requireJsonBody(ctx);
  for (const k of Object.keys(body)) {
    if (k !== 'reason') fail({ [k]: 'This field is not accepted.' });
  }
  if (!hasField(body, 'reason')) fail({ reason: 'Give a reason in 1 to 200 characters.' });
  const reason = typeof body.reason === 'string' ? body.reason : fail({ reason: 'Give a reason in 1 to 200 characters.' });
  if (hasForbiddenChars(reason)) fail({ reason: 'Remove hidden or control characters.' });
  const len = [...reason].length;
  if (len < 1 || len > 200) fail({ reason: 'Give a reason in 1 to 200 characters.' });
  return reason;
}

function checkLapse(s: SwapRow, nowDate: Date): void {
  if (s.answer_by && nowDate.getTime() >= s.answer_by.getTime()) {
    throw problem(409, 'request_lapsed');
  }
}

async function acceptSwap(ctx: Ctx, deps: AppDeps, s: SwapRow, now: import('@js-temporal/polyfill').Temporal.Instant, isCreator: boolean, answererRole: 'planning' | 'other', nowDate: Date): Promise<void> {
  void answererRole;
  const t = requestTransition('swap', s.state as never, 'accept', isCreator);
  if (!t.ok) throw transitionProblem(t.code!);
  checkLapse(s, nowDate);
  const intervals: Array<{ first: string; last: string }> = [{ first: s.nights_start, last: s.nights_end }];
  if (s.makeup_start && s.makeup_end) intervals.push({ first: s.makeup_start, last: s.makeup_end });
  const candidate: DerivedSwap = {
    id: s.id,
    nights: { first: s.nights_start, last: s.nights_end },
    makeupNights: s.makeup_start && s.makeup_end ? { first: s.makeup_start, last: s.makeup_end } : null,
    toParent: s.to_parent,
    createdBy: s.created_by,
    settledAtHandover: false,
  };

  // linearize accepts with adoptions and other accepts
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const creatorEmail = s.created_by === 'planning' ? h.planning_email : h.other_email;
  await withTransaction(deps.pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ctx.householdId]);
    const fresh = await client.query(`SELECT state, answer_by FROM swaps WHERE id=$1`, [s.id]);
    const freshRow = fresh.rows[0] as { state: string; answer_by: Date | null };
    if (freshRow.state !== 'sent') throw problem(409, 'invalid_transition');
    if (freshRow.answer_by && nowDate.getTime() >= freshRow.answer_by.getTime()) {
      throw problem(409, 'request_lapsed');
    }
    // accept recheck under the versions in effect now
    const vRows = await client.query(`SELECT * FROM plan_versions WHERE household_id=$1 AND status='adopted'`, [ctx.householdId]);
    const nowAdopted = (vRows.rows as unknown as import('./apiTypes').PlanVersionRow[]).map(toVersionForNight);
    const nowSwaps = (await client.query(`SELECT id, nights_start, nights_end, makeup_start, makeup_end, to_parent, created_by, state FROM swaps WHERE household_id=$1 AND state IN ('accepted','settled')`, [ctx.householdId])).rows.map((r: Record<string, string | null>) => ({ id: r.id as string, nights: { first: r.nights_start as string, last: r.nights_end as string }, makeupNights: r.makeup_start && r.makeup_end ? { first: r.makeup_start, last: r.makeup_end } : null, toParent: r.to_parent as 'planning' | 'other', createdBy: r.created_by as 'planning' | 'other', settledAtHandover: true }));
    for (const iv of intervals) {
      for (const d of eachNight(iv)) {
        const own = deriveNight(nowAdopted, nowSwaps, d);
        // nights must still belong to the giver; make-up nights to the receiver
        const want = iv === intervals[0] ? otherOf(s.to_parent) : s.to_parent;
        if (own.owner !== want) {
          throw problem(409, 'swap_nights_changed');
        }
      }
    }
    // run limit
    if (runTooLong(nowAdopted, nowSwaps, candidate)) {
      throw problem(409, 'swap_run_too_long');
    }
    await client.query(
      `UPDATE swaps SET state='accepted', answered_at=now(), etag=$2 WHERE id=$1`,
      [s.id, auth.etagForId(s.id + ':' + Date.now())],
    );
    const noticeId = auth.randomId();
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
      [noticeId, ctx.householdId, creatorEmail, `Your request was accepted in ${h.name}`],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'swap.accepted', s.id);
    // derived year documents change
    await client.query(`DELETE FROM year_docs WHERE household_id=$1`, [ctx.householdId]);
  });
  const s2 = await loadSwap(deps, ctx.householdId!, s.id);
  sendJson(ctx, 200, swapOut(s2), { etag: s2.etag });
  void now;
}

function requireJsonBody(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body ?? Buffer.alloc(0);
  if (body.length === 0) return {};
  const ct = ctx.header('content-type') ?? '';
  if (!ct.startsWith('application/json')) throw problem(415, 'unsupported_media_type');
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!isObject(parsed)) fail({ '': 'This field is not accepted.' });
    return parsed;
  } catch (e) {
    if (e instanceof ValidationErrors) throw e;
    if (e instanceof Error && 'errors' in e) throw e;
    throw problem(400, 'malformed_json');
  }
}

function parseListQuery(ctx: Ctx): { limit: number; after: string | null } {
  const limitStr = ctx.query('limit');
  let limit = 50;
  if (limitStr !== null) {
    if (!/^\d+$/.test(limitStr)) throw new ValidationErrors({ limit: 'Use a limit from 1 to 100.' });
    const n = Number(limitStr);
    if (n < 1 || n > 100) throw new ValidationErrors({ limit: 'Use a limit from 1 to 100.' });
    limit = n;
  }
  const after = ctx.query('after');
  return { limit, after };
}
