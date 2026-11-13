/** Plan endpoints: draft, adopt, preview, derived year, tonight. */
import { Ctx, sendJson, sendNoContent } from './http';
import { problem } from './problems';
import { AppDeps } from './apiTypes';
import * as auth from './auth';
import {
  loadVersions, loadDerivedSwaps, toVersionForNight, versionOut, requireIfMatch, requireIfNoneMatchStar, loadHousehold, bodyOf,
} from './helpers';
import { canonicalJson, digestOf } from '../lib/canonical';
import { deriveYear, deriveNight } from '../domain/derive';
import { VersionForNight } from '../domain/derived';
import { householdToday } from '../domain/today';
import { nowInstant, parseDate, localDate, isValidZone, instantOnTheMinute, parseInstant } from '../lib/time';
import { Temporal } from '@js-temporal/polyfill';
import { PlanRule, ParentRole } from '../domain/plan';
import { ValidationErrors, fail, isObject, checkDate } from './validate';
import { appendLog, withTransaction } from '../db/db';

export async function getPlan(ctx: Ctx, deps: AppDeps): Promise<void> {
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  sendJson(ctx, 200, { versions: versions.map(versionOut) });
}

/** Validate a version body and return the canonical body with field checks.
 *  Each failure is a 422 on its path with the stated message. */
export function validateVersionBody(body: unknown): Record<string, unknown> {
  if (!isObject(body)) fail({ '': 'This field is not accepted.' });
  const allowed = ['effectiveFrom', 'exchangeZone', 'firstExchangeAt', 'base', 'splitBp', 'maxConsecutiveNights', 'rules'];
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype' || !allowed.includes(k)) {
      fail({ [k]: 'This field is not accepted.' });
    }
  }
  for (const f of allowed) {
    if (!(f in body)) fail({ [f]: 'This field is not accepted.' });
  }
  const effectiveFrom = checkDate('effectiveFrom', body.effectiveFrom);
  const exchangeZone = typeof body.exchangeZone === 'string' && isValidZone(body.exchangeZone)
    ? body.exchangeZone
    : fail({ exchangeZone: 'Choose a time zone from the list.' });
  const firstExchangeAt = typeof body.firstExchangeAt === 'string'
    ? body.firstExchangeAt
    : fail({ firstExchangeAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  let fxInstant;
  try {
    fxInstant = parseInstant(firstExchangeAt);
  } catch {
    fail({ firstExchangeAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  }
  if (!instantOnTheMinute(fxInstant)) {
    fail({ firstExchangeAt: 'The exchange must be on the minute.' });
  }
  const base = isObject(body.base) ? body.base : fail({ base: 'This field is not accepted.' });
  for (const k of Object.keys(base)) {
    if (k !== 'pattern' && k !== 'anchor') fail({ [`base.${k}`]: 'This field is not accepted.' });
  }
  const pattern = typeof base.pattern === 'string' && /^[PO]{1,28}$/.test(base.pattern)
    ? base.pattern
    : fail({ 'base.pattern': 'Use 1 to 28 letters P and O.' });
  const anchor = checkDate('base.anchor', base.anchor);
  const split = isObject(body.splitBp) ? body.splitBp : fail({ splitBp: 'This field is not accepted.' });
  const planningBp = typeof split.planning === 'number' && Number.isInteger(split.planning)
    ? split.planning : fail({ 'splitBp.planning': 'The two shares must add up to 100%.' });
  const otherBp = typeof split.other === 'number' && Number.isInteger(split.other)
    ? split.other : fail({ 'splitBp.other': 'The two shares must add up to 100%.' });
  if (planningBp + otherBp !== 10000) fail({ splitBp: 'The two shares must add up to 100%.' });
  const maxN = body.maxConsecutiveNights;
  if (maxN !== null && !(typeof maxN === 'number' && Number.isInteger(maxN) && maxN >= 2 && maxN <= 60)) {
    fail({ maxConsecutiveNights: 'Use 2 to 60 nights.' });
  }
  // first exchange local date must equal effectiveFrom
  const fxLocal = localDate(fxInstant, exchangeZone);
  if (fxLocal.toString() !== effectiveFrom) {
    fail({ firstExchangeAt: 'The first exchange must fall on the effective date.' });
  }
  const rules = validateRules(body.rules);
  return {
    effectiveFrom,
    exchangeZone,
    firstExchangeAt,
    base: { pattern, anchor },
    splitBp: { planning: planningBp, other: otherBp },
    maxConsecutiveNights: maxN,
    rules,
  };
}

function validateRules(input: unknown): PlanRule[] {
  if (!Array.isArray(input)) fail({ rules: 'This field is not accepted.' });
  if (input.length > 60) fail({ rules: 'This field is not accepted.' });
  const out: PlanRule[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  input.forEach((raw, i) => {
    if (!isObject(raw)) fail({ [`rules[${i}]`]: 'This field is not accepted.' });
    const kind = raw.kind;
    if (kind === 'holiday') out.push(validateHoliday(raw, i));
    else if (kind === 'school_break') out.push(validateBreak(raw, i));
    else if (kind === 'vacation') out.push(validateVacation(raw, i));
    else fail({ [`rules[${i}].kind`]: 'This value is out of range.' });
    const rule = out[out.length - 1];
    if (rule.id === 'base') fail({ [`rules[${i}].id`]: 'Each rule needs its own name.' });
    if (seenIds.has(rule.id)) fail({ [`rules[${i}].id`]: 'Each rule needs its own name.' });
    if (seenNames.has(rule.name)) fail({ [`rules[${i}].name`]: 'Each rule needs its own name.' });
    seenIds.add(rule.id);
    seenNames.add(rule.name);
  });
  return out;
}

function ruleCommon(raw: Record<string, unknown>, i: number): { id: string; name: string } {
  const id = typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id)
    ? raw.id : fail({ [`rules[${i}].id`]: 'Each rule needs its own name.' });
  const name = typeof raw.name === 'string' && raw.name.length >= 1 && raw.name.length <= 80
    ? raw.name : fail({ [`rules[${i}].name`]: 'Each rule needs its own name.' });
  return { id, name };
}

function validateHoliday(raw: Record<string, unknown>, i: number): PlanRule {
  const common = ruleCommon(raw, i);
  const allowed = ['id', 'name', 'kind', 'date', 'startOffset', 'nights', 'oddYears', 'evenYears'];
  for (const k of Object.keys(raw)) {
    if (!allowed.includes(k)) fail({ [`rules[${i}].${k}`]: 'This field is not accepted.' });
  }
  const date = isObject(raw.date) ? raw.date : fail({ [`rules[${i}].date`]: 'This value is out of range.' });
  let dateOut: Record<string, unknown>;
  if (date.type === 'fixed') {
    const month = date.month, day = date.day;
    if (typeof month !== 'number' || typeof day !== 'number') fail({ [`rules[${i}].date`]: 'This value is out of range.' });
    if (month < 1 || month > 12) fail({ [`rules[${i}].date.month`]: 'This value is out of range.' });
    // must exist every year, so 29 February refused
    const days = new Date(Date.UTC(2001, month, 0)).getUTCDate();
    if (day < 1 || day > days) fail({ [`rules[${i}].date.day`]: 'Enter a date that exists every year.' });
    dateOut = { type: 'fixed', month, day };
  } else if (date.type === 'nth_weekday') {
    const month = date.month, weekday = date.weekday, n = date.n;
    if (typeof month !== 'number' || typeof weekday !== 'number' || typeof n !== 'number') {
      fail({ [`rules[${i}].date`]: 'This value is out of range.' });
    }
    if (month < 1 || month > 12) fail({ [`rules[${i}].date.month`]: 'This value is out of range.' });
    if (weekday < 1 || weekday > 7) fail({ [`rules[${i}].date.weekday`]: 'This value is out of range.' });
    if (n !== -1 && (n < 1 || n > 5)) fail({ [`rules[${i}].date.n`]: 'This value is out of range.' });
    dateOut = { type: 'nth_weekday', month, weekday, n };
  } else if (date.type === 'easter') {
    dateOut = { type: 'easter' };
  } else {
    fail({ [`rules[${i}].date.type`]: 'This value is out of range.' });
  }
  const startOffset = raw.startOffset;
  if (typeof startOffset !== 'number' || startOffset < -7 || startOffset > 7) {
    fail({ [`rules[${i}].startOffset`]: 'This value is out of range.' });
  }
  const nights = raw.nights;
  if (typeof nights !== 'number' || nights < 1 || nights > 14) {
    fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  }
  const oddYears = checkRole(`rules[${i}].oddYears`, raw.oddYears);
  const evenYears = checkRole(`rules[${i}].evenYears`, raw.evenYears);
  return { kind: 'holiday', ...common, date: dateOut as never, startOffset, nights, oddYears, evenYears };
}

function validateBreak(raw: Record<string, unknown>, i: number): PlanRule {
  const common = ruleCommon(raw, i);
  const allowed = ['id', 'name', 'kind', 'nights', 'split', 'firstHalfOddYears'];
  for (const k of Object.keys(raw)) {
    if (!allowed.includes(k)) fail({ [`rules[${i}].${k}`]: 'This field is not accepted.' });
  }
  const nights = typeof raw.nights === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(raw.nights)
    ? raw.nights : fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  const [a, b] = nights.split('/');
  checkDate(`rules[${i}].nights`, a);
  checkDate(`rules[${i}].nights`, b);
  if (a > b) fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  const days = Temporal.PlainDate.from(b).since(Temporal.PlainDate.from(a)).days + 1;
  if (days < 1 || days > 120) fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  const split = raw.split === 'halves' || raw.split === 'whole'
    ? raw.split : fail({ [`rules[${i}].split`]: 'This value is out of range.' });
  const firstHalfOddYears = checkRole(`rules[${i}].firstHalfOddYears`, raw.firstHalfOddYears);
  return { kind: 'school_break', ...common, nights, split, firstHalfOddYears };
}

function validateVacation(raw: Record<string, unknown>, i: number): PlanRule {
  const common = ruleCommon(raw, i);
  const allowed = ['id', 'name', 'kind', 'parent', 'nights', 'exchangeZone', 'firstExchangeAt'];
  for (const k of Object.keys(raw)) {
    if (!allowed.includes(k)) fail({ [`rules[${i}].${k}`]: 'This field is not accepted.' });
  }
  const parent = checkRole(`rules[${i}].parent`, raw.parent);
  const nights = typeof raw.nights === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(raw.nights)
    ? raw.nights : fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  const [a, b] = nights.split('/');
  checkDate(`rules[${i}].nights`, a);
  checkDate(`rules[${i}].nights`, b);
  if (a > b) fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  const days = Temporal.PlainDate.from(b).since(Temporal.PlainDate.from(a)).days + 1;
  if (days < 1 || days > 42) fail({ [`rules[${i}].nights`]: 'This value is out of range.' });
  let exchangeZone: string | undefined;
  let firstExchangeAt: string | undefined;
  const hasZone = 'exchangeZone' in raw;
  const hasFx = 'firstExchangeAt' in raw;
  if (hasZone !== hasFx) {
    // a vacation's exchangeZone and firstExchangeAt come together
    fail({ [`rules[${i}].firstExchangeAt`]: 'This value is out of range.' });
  }
  if (hasZone) {
    exchangeZone = typeof raw.exchangeZone === 'string' && isValidZone(raw.exchangeZone)
      ? raw.exchangeZone : fail({ [`rules[${i}].exchangeZone`]: 'Choose a time zone from the list.' });
    const fx = typeof raw.firstExchangeAt === 'string' ? raw.firstExchangeAt : null;
    let inst;
    try {
      inst = fx ? parseInstant(fx) : null;
    } catch {
      inst = null;
    }
    if (!inst || !instantOnTheMinute(inst)) {
      fail({ [`rules[${i}].firstExchangeAt`]: 'The exchange must be on the minute.' });
    }
    const fxLocal = localDate(inst, exchangeZone);
    if (fxLocal.toString() !== a) {
      fail({ [`rules[${i}].firstExchangeAt`]: 'The first exchange must fall on the effective date.' });
    }
    firstExchangeAt = fx!;
  }
  return { kind: 'vacation', ...common, parent, nights, ...(exchangeZone ? { exchangeZone, firstExchangeAt } : {}) };
}

function checkRole(field: string, v: unknown): ParentRole {
  if (v === 'planning' || v === 'other') return v;
  fail({ [field]: 'This value is out of range.' });
}

export async function putDraft(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const body = validateVersionBody(requireBody(ctx));
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const existingDraft = versions.find((v) => v.status === 'draft');
  const canon = canonicalJson(body);
  const etag = `"${digestOf(Buffer.from(canon, 'utf8'))}"`;
  const created = !existingDraft;
  if (created) requireIfNoneMatchStar(ctx);
  else requireIfMatch(ctx, existingDraft.etag);
  const res = await withTransaction(deps.pool, async (client) => {
    if (created) {
      const id = auth.randomId();
      const number = versions.length > 0 ? Math.max(...versions.map((v) => v.number)) + 1 : 1;
      await client.query(
        `INSERT INTO plan_versions (id, household_id, number, status, effective_from, exchange_zone,
           first_exchange_at, base_pattern, base_anchor, split_planning_bp, split_other_bp,
           max_consecutive_nights, body, etag)
         VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, ctx.householdId, number, body.effectiveFrom, body.exchangeZone, body.firstExchangeAt,
          (body.base as Record<string, unknown>).pattern, (body.base as Record<string, unknown>).anchor,
          (body.splitBp as Record<string, unknown>).planning, (body.splitBp as Record<string, unknown>).other,
          body.maxConsecutiveNights, JSON.stringify(body), etag],
      );
      await appendLog(client, ctx.householdId!, 'planning', 'plan.draft_saved', id);
      return id;
    } else {
      await client.query(
        `UPDATE plan_versions SET effective_from=$2, exchange_zone=$3, first_exchange_at=$4, base_pattern=$5,
           base_anchor=$6, split_planning_bp=$7, split_other_bp=$8, max_consecutive_nights=$9, body=$10, etag=$11
         WHERE id=$1`,
        [existingDraft.id, body.effectiveFrom, body.exchangeZone, body.firstExchangeAt,
          (body.base as Record<string, unknown>).pattern, (body.base as Record<string, unknown>).anchor,
          (body.splitBp as Record<string, unknown>).planning, (body.splitBp as Record<string, unknown>).other,
          body.maxConsecutiveNights, JSON.stringify(body), etag],
      );
      await appendLog(client, ctx.householdId!, 'planning', 'plan.draft_saved', existingDraft.id);
      return existingDraft.id;
    }
  });
  const versions2 = await loadVersions(deps.pool, ctx.householdId!);
  const v = versions2.find((x) => x.id === res)!;
  sendJson(ctx, created ? 201 : 200, versionOut(v), { etag });
}

export async function deleteDraft(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const draft = versions.find((v) => v.status === 'draft');
  if (!draft) throw problem(404, 'not_found');
  requireIfMatch(ctx, draft.etag);
  await withTransaction(deps.pool, async (client) => {
    await client.query(`DELETE FROM plan_versions WHERE id=$1`, [draft.id]);
    await appendLog(client, ctx.householdId!, 'planning', 'plan.draft_deleted', draft.id);
  });
  sendNoContent(ctx);
}

export async function adoptDraft(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const draft = versions.find((v) => v.status === 'draft');
  if (!draft) throw problem(404, 'not_found');
  const adopted = versions.filter((v) => v.status === 'adopted');
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const today = householdToday(adopted.map(toVersionForNight), toVersionForNight(draft), nowInstant());

  // amendments must start after today, checked at adoption only
  if (adopted.length > 0) {
    if (Temporal.PlainDate.compare(parseDate(draft.effective_from), today) <= 0) {
      throw problem(409, 'costs_logged_after_effective_date');
    }
  }
  // no non-draft cost with custody day on or after effectiveFrom
  const badCosts = await deps.pool.query(
    `SELECT 1 FROM costs WHERE household_id=$1 AND state <> 'draft' AND custody_day >= $2 LIMIT 1`,
    [ctx.householdId, draft.effective_from],
  );
  if (badCosts.rows.length > 0) {
    throw problem(409, 'costs_logged_after_effective_date');
  }
  const versionId = draft.id;
  await withTransaction(deps.pool, async (client) => {
    await client.query(`UPDATE plan_versions SET status='adopted' WHERE id=$1`, [draft.id]);
    // re-split every draft cost whose custody day is on or after the effective date
    const drafts = await client.query(
      `SELECT id, amount_minor, paid_by FROM costs WHERE household_id=$1 AND state='draft' AND custody_day >= $2`,
      [ctx.householdId, draft.effective_from],
    );
    const split = { planning: draft.split_planning_bp, other: draft.split_other_bp };
    for (const c of drafts.rows) {
      const shares = splitAmountFor(Number(c.amount_minor), split.planning, c.paid_by);
      await client.query(
        `UPDATE costs SET version_id=$2, split_planning_bp=$3, split_other_bp=$4, share_planning=$5,
           share_other=$6, owed_minor=$7, etag=$8 WHERE id=$1`,
        [c.id, draft.id, split.planning, split.other, shares.planning, shares.other,
          c.paid_by === 'planning' ? shares.other : shares.planning, auth.etagForId(String(c.id) + 'r')],
      );
    }
    await appendLog(client, ctx.householdId!, 'planning', 'plan.adopted', versionId);
    // amendment notice from version 2 on
    if (draft.number >= 2) {
      await queueNotice(client, ctx.householdId!, 'amendment', h.other_email,
        `Plan amendment recorded in ${h.name}`, '/plan');
    }
    // clear year docs for affected years
    await client.query(`DELETE FROM year_docs WHERE household_id=$1`, [ctx.householdId]);
  });
  const versions2 = await loadVersions(deps.pool, ctx.householdId!);
  const v = versions2.find((x) => x.id === draft.id)!;
  sendJson(ctx, 200, versionOut(v), { etag: v.etag });
}

import { splitAmount } from '../lib/money';

function splitAmountFor(amount: number, planningBp: number, payer: 'planning' | 'other') {
  return splitAmount(amount, planningBp, payer);
}

function queueNotice(
  client: import('pg').PoolClient,
  hid: string,
  kind: string,
  to: string,
  subject: string,
  link: string,
): Promise<import('pg').QueryResult> {
  const id = auth.randomId();
  return client.query(
    `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
     VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
    [id, hid, kind, to, subject, link],
  );
}

export async function preview(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const body = validateVersionBody(requireBody(ctx));
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adopted = versions.filter((v) => v.status === 'adopted');
  const draftVersion: VersionForNight = {
    effectiveFrom: body.effectiveFrom as string,
    exchangeZone: body.exchangeZone as string,
    firstExchangeAt: body.firstExchangeAt as string,
    pattern: (body.base as Record<string, unknown>).pattern as string,
    anchor: (body.base as Record<string, unknown>).anchor as string,
    maxConsecutiveNights: body.maxConsecutiveNights as number | null,
    rules: body.rules as PlanRule[],
  };
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  const yearParam = ctx.query('year');
  let year: number;
  if (yearParam === null) {
    const today = householdToday(adopted.map(toVersionForNight), draftVersion, nowInstant());
    year = today.year;
  } else {
    const y = Number(yearParam);
    if (!/^\d{4}$/.test(yearParam) || y < 2000 || y > 2100) {
      fail({ year: 'Choose a year from 2000 to 2100.' });
    }
    year = y;
  }
  void h;
  const all = [...adopted.map(toVersionForNight), draftVersion];
  const swaps = await loadDerivedSwaps(deps.pool, ctx.householdId!);
  const doc = deriveYear(all, swaps, ctx.householdId!, year);
  sendJson(ctx, 200, { year, nights: doc.nights } as Record<string, unknown>);
}

export async function getYear(ctx: Ctx, deps: AppDeps, yearStr: string): Promise<void> {
  if (!/^\d{4}$/.test(yearStr)) throw problem(404, 'not_found');
  const year = Number(yearStr);
  if (year < 2000 || year > 2100) throw problem(404, 'not_found');
  const { householdId } = ctx;
  const doc = await deriveYearDoc(deps, householdId!, year);
  const canon = canonicalJson(doc);
  const bytes = Buffer.from(canon, 'utf8');
  const digest = digestOf(bytes);
  const etag = `"${digest}"`;
  const inm = ctx.header('if-none-match');
  if (inm === etag) {
    ctx.res.writeHead(304, { etag });
    ctx.res.end();
    return;
  }
  sendJson(ctx, 200, doc as unknown as Record<string, unknown>, { etag, 'x-year-digest': digest });
}

export async function deriveYearDoc(deps: AppDeps, hid: string, year: number): Promise<Record<string, unknown>> {
  const cached = await deps.pool.query(
    `SELECT body FROM year_docs WHERE household_id=$1 AND year=$2`,
    [hid, year],
  );
  if (cached.rows.length > 0) {
    return bodyOf(cached.rows[0].body) as Record<string, unknown>;
  }
  const versions = await loadVersions(deps.pool, hid);
  const vfn = versions.filter((v) => v.status === 'adopted').map(toVersionForNight);
  const swaps = await loadDerivedSwaps(deps.pool, hid);
  const doc = deriveYear(vfn, swaps, hid, year);
  const canon = canonicalJson(doc);
  await deps.pool.query(
    `INSERT INTO year_docs (household_id, year, body, digest) VALUES ($1,$2,$3,$4)
     ON CONFLICT (household_id, year) DO NOTHING`,
    [hid, year, canon, digestOf(Buffer.from(canon, 'utf8'))],
  );
  return doc as unknown as Record<string, unknown>;
}

export async function tonight(ctx: Ctx, deps: AppDeps): Promise<void> {
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adopted = versions.filter((v) => v.status === 'adopted').map(toVersionForNight);
  const draft = versions.find((v) => v.status === 'draft');
  const today = householdToday(adopted, draft ? toVersionForNight(draft) : null, nowInstant());
  const swaps = await loadDerivedSwaps(deps.pool, ctx.householdId!);
  const own = deriveNight(adopted, swaps, today);
  // next handover: the first day within 60 days where the owner differs from today's
  let nextHandover: Record<string, unknown> | null = null;
  for (let i = 1; i <= 60; i++) {
    const d = today.add({ days: i });
    const prev = deriveNight(adopted, swaps, d.add({ days: -1 }));
    const cur = deriveNight(adopted, swaps, d);
    if (prev.owner && cur.owner && prev.owner !== cur.owner) {
      nextHandover = handoverOut(adopted, swaps, d, prev.owner, cur.owner);
      break;
    }
  }
  const answer = {
    date: today.toString(),
    owner: own.owner,
    ruleName: own.ruleName,
    nextHandover,
  };
  sendJson(ctx, 200, answer);
}

import { handoverFor } from '../domain/derive';

function handoverOut(versions: VersionForNight[], swaps: import('../domain/derived').DerivedSwap[], d: Temporal.PlainDate, prevOwner: ParentRole, newOwner: ParentRole) {
  const h = handoverFor(versions, swaps, d, prevOwner, newOwner);
  return { at: h?.exchangeAt ?? null, zone: h?.zone ?? null, from: h?.from ?? null, to: h?.to ?? null };
}

function requireBody(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body ?? Buffer.alloc(0);
  const ct = ctx.header('content-type') ?? '';
  if (body.length === 0) return {};
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
