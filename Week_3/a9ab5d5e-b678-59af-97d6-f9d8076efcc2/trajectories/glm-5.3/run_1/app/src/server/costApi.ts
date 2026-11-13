/** Cost endpoints: draft, quote, split, statement, receipts. */
import { Ctx, sendJson, sendNoContent, sendBytes } from './http';
import { problem, Problem } from './problems';
import { AppDeps, CostRow, ReceiptRow } from './apiTypes';
import * as auth from './auth';
import { loadVersions, toVersionForNight, requireIfMatch, loadHousehold, bodyOf } from './helpers';
import { ValidationErrors, fail, hasField, isObject } from './validate';
import { appendLog, withTransaction } from '../db/db';
import { canonicalJson, digestOf } from '../lib/canonical';
import { splitAmount } from '../lib/money';
import { nfc, hasForbiddenChars } from '../lib/text';
import { householdToday, custodyDayOf } from '../domain/today';
import { nowInstant, parseInstant, instantOnTheMinute } from '../lib/time';
import { StorageUnavailable } from '../storage/s3';
import { requestTransition } from '../domain/requests';
import { transitionProblem } from './swapApi';

const CATEGORIES = ['medical', 'school', 'activities', 'child_care', 'clothing', 'other'] as const;

export function costOut(c: CostRow, receipts: ReceiptRow[]): Record<string, unknown> {
  return {
    id: c.id,
    description: c.description,
    category: c.category,
    note: c.note,
    amountMinor: Number(c.amount_minor),
    incurredAt: c.incurred_at,
    custodyDay: c.custody_day,
    paidBy: c.paid_by,
    versionId: c.version_id,
    agreedSplitBp: c.agreed_split_bp,
    splitBp: { planning: c.split_planning_bp, other: c.split_other_bp },
    shares: { planning: Number(c.share_planning), other: Number(c.share_other) },
    owedMinor: Number(c.owed_minor),
    state: c.state,
    sentAt: c.sent_at ? isoOut(c.sent_at) : null,
    answerBy: c.answer_by ? isoOut(c.answer_by) : null,
    answerZone: c.answer_zone,
    answeredAt: c.answered_at ? isoOut(c.answered_at) : null,
    declineReason: c.decline_reason,
    receipts: receipts.map(receiptOut),
  };
}

function receiptOut(r: ReceiptRow): Record<string, unknown> {
  return {
    id: r.id,
    contentType: r.content_type,
    bytes: Number(r.bytes),
    sha256: r.sha256,
    filename: r.filename,
    storedAt: isoOut(r.stored_at),
  };
}

function isoOut(d: Date): string {
  // RFC 3339: no fractional seconds, never Z
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00').replace('Z', '+00:00');
}

export async function listCosts(ctx: Ctx, deps: AppDeps): Promise<void> {
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
    if (!/^\d+$/.test(after)) throw new ValidationErrors({ after: 'This cursor is not valid.' });
    params.push(after);
    cursorWhere = ` AND id > $${params.length}`;
  }
  params.push(limit + 1);
  const res = await deps.pool.query(
    `SELECT * FROM costs WHERE ${where}${cursorWhere} ORDER BY id ASC LIMIT $${params.length}`,
    params,
  );
  const rows = res.rows as CostRow[];
  const next = rows.length > limit ? String(rows[limit - 1].id) : null;
  const withReceipts = await Promise.all(rows.slice(0, limit).map(async (c) => {
    const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1 ORDER BY id`, [c.id]);
    return costOut(c, rr.rows as ReceiptRow[]);
  }));
  sendJson(ctx, 200, { items: withReceipts, next });
}

export async function getCost(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, id);
  const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1 ORDER BY id`, [c.id]);
  sendJson(ctx, 200, costOut(c, rr.rows as ReceiptRow[]), { etag: c.etag });
}

export async function loadCost(deps: AppDeps, hid: string, id: string): Promise<CostRow> {
  if (!/^\d+$/.test(id)) throw problem(404, 'not_found');
  const res = await deps.pool.query(`SELECT * FROM costs WHERE id=$1 AND household_id=$2`, [id, hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as CostRow;
}

export async function createCost(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  const input = parseCostInput(body);
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adoptedRows = versions.filter((v) => v.status === 'adopted');
  if (adoptedRows.length === 0) throw problem(409, 'no_adopted_plan');
  const adopted = adoptedRows.map(toVersionForNight);
  const h = await loadHousehold(deps.pool, ctx.householdId!);
  if (!h.other_joined_at) throw problem(409, 'other_parent_not_joined');

  // custody day from incurredAt
  let inst;
  try {
    inst = parseInstant(input.incurredAt);
  } catch {
    fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  }
  if (!instantOnTheMinute(inst)) {
    fail({ incurredAt: 'The exchange must be on the minute.' });
  }
  const custodyDay = custodyDayOf(adopted, inst);
  if (!custodyDay) fail({ incurredAt: 'Choose a date from the plan start to one year ahead.' });
  // cost date range: first version's effectiveFrom to today plus 366 days
  const earliest = adoptedRows[adoptedRows.length - 1].effective_from;
  const today = householdToday(adopted, null, nowInstant());
  const latest = today.add({ days: 366 }).toString();
  if (custodyDay < earliest || custodyDay > latest) {
    fail({ incurredAt: 'Choose a date from the plan start to one year ahead.' });
  }
  // version: a draft follows the current one (custody day's version)
  const version = adoptedRows.map(toVersionForNight).find((v) => v.effectiveFrom <= custodyDay)
    ?? adoptedRows.map(toVersionForNight).find((v) => v.effectiveFrom >= custodyDay);
  if (!version) throw problem(409, 'no_adopted_plan');
  const versionRow = adoptedRows.find((r) => r.id === (adoptedRows.find((x) => x.effective_from === version.effectiveFrom)?.id));
  if (!versionRow) throw problem(409, 'no_adopted_plan');
  const splitBp = input.agreedSplitBp ?? { planning: versionRow.split_planning_bp, other: versionRow.split_other_bp };
  const paidBy: 'planning' | 'other' = ctx.role!;
  const shares = splitAmount(input.amountMinor, splitBp.planning, paidBy);
  const owedMinor = paidBy === 'planning' ? shares.other : shares.planning;
  const id = auth.randomId();
  const etag = auth.etagForId(id);
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO costs (id, household_id, description, category, note, amount_minor, incurred_at, custody_day,
         paid_by, version_id, agreed_split_bp, split_planning_bp, split_other_bp, share_planning, share_other,
         owed_minor, state, etag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17)`,
      [id, ctx.householdId, input.description, input.category, input.note, input.amountMinor,
        input.incurredAt, custodyDay, paidBy, versionRow.id, input.agreedSplitBp,
        splitBp.planning, splitBp.other, shares.planning, shares.other, owedMinor, etag],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'cost.drafted', id);
  });
  const c = await loadCost(deps, ctx.householdId!, id);
  const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1`, [id]);
  sendJson(ctx, 201, costOut(c, rr.rows as ReceiptRow[]), { etag });
}

interface CostInput {
  description: string;
  category: string;
  amountMinor: number;
  incurredAt: string;
  note: string | null;
  paidBy?: 'planning' | 'other';
  agreedSplitBp?: { planning: number; other: number } | null;
}

function parseCostInput(body: Record<string, unknown>): CostInput {
  const allowed = ['description', 'category', 'amountMinor', 'incurredAt', 'note'];
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype' || !allowed.includes(k)) {
      fail({ [k]: 'This field is not accepted.' });
    }
  }
  for (const f of ['description', 'category', 'amountMinor', 'incurredAt']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const description = typeof body.description === 'string' ? body.description : fail({ description: 'Use 1 to 500 characters.' });
  if (hasForbiddenChars(description)) fail({ description: 'Remove hidden or control characters.' });
  const dLen = nfc(description).length;
  if (dLen < 1 || dLen > 500) fail({ description: 'Use 1 to 500 characters.' });
  const category = typeof body.category === 'string' && (CATEGORIES as readonly string[]).includes(body.category)
    ? body.category : fail({ category: 'This value is out of range.' });
  const amountMinor = typeof body.amountMinor === 'number' && Number.isInteger(body.amountMinor)
    && body.amountMinor >= 1 && body.amountMinor <= 100000000000
    ? body.amountMinor : fail({ amountMinor: 'Enter the amount as whole minor units from 1 to 100000000000.' });
  const incurredAt = typeof body.incurredAt === 'string' ? body.incurredAt
    : fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    const t = typeof body.note === 'string' ? body.note : fail({ note: 'Use at most 500 characters.' });
    if (hasForbiddenChars(t)) fail({ note: 'Remove hidden or control characters.' });
    if (nfc(t).length > 500) fail({ note: 'Use at most 500 characters.' });
    note = t;
  }
  return { description, category, amountMinor, incurredAt, note };
}

export async function patchCost(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, id);
  requireIfMatch(ctx, c.etag);
  const body = requireJsonBody(ctx);
  const allowed = ['description', 'category', 'amountMinor', 'incurredAt', 'note', 'agreedSplitBp'];
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype' || !allowed.includes(k)) {
      fail({ [k]: 'This field is not accepted.' });
    }
  }

  // split edits: either parent, on a draft or sent cost
  const hasSplit = hasField(body, 'agreedSplitBp');
  if (hasSplit && Object.keys(body).length === 1) {
    return patchSplit(ctx, deps, c, body);
  }
  if (hasSplit && Object.keys(body).length > 1) {
    // mixing split with other fields: split change is separate in the brief's
    // flow, but a PATCH with both is allowed only when both paths agree
    return patchSplitAndFields(ctx, deps, c, body);
  }
  // field edits: creator, draft only
  if (c.paid_by !== ctx.role) {
    // the creator of a cost is the payer
    throw problem(403, 'not_your_request');
  }
  if (c.state !== 'draft') throw problem(409, 'invalid_transition');
  return patchFields(ctx, deps, c, body);
}

async function patchSplit(ctx: Ctx, deps: AppDeps, c: CostRow, body: Record<string, unknown>): Promise<void> {
  if (c.state !== 'draft' && c.state !== 'sent') throw problem(409, 'invalid_transition');
  let agreed: { planning: number; other: number } | null = null;
  if (body.agreedSplitBp !== null) {
    const sp = isObject(body.agreedSplitBp) ? body.agreedSplitBp : fail({ agreedSplitBp: 'The two shares must add up to 100%.' });
    const planning = typeof sp.planning === 'number' && Number.isInteger(sp.planning) ? sp.planning : null;
    const other = typeof sp.other === 'number' && Number.isInteger(sp.other) ? sp.other : null;
    if (planning === null || other === null || planning + other !== 10000) {
      fail({ agreedSplitBp: 'The two shares must add up to 100%.' });
    }
    agreed = { planning, other };
  }
  const splitBp = agreed ?? { planning: c.split_planning_bp, other: c.split_other_bp };
  const shares = splitAmount(Number(c.amount_minor), splitBp.planning, c.paid_by);
  const owedMinor = c.paid_by === 'planning' ? shares.other : shares.planning;
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `UPDATE costs SET agreed_split_bp=$2, split_planning_bp=$3, split_other_bp=$4,
         share_planning=$5, share_other=$6, owed_minor=$7, etag=$8
       WHERE id=$1 AND etag=$9`,
      [c.id, agreed ? agreed.planning : null, splitBp.planning, splitBp.other,
        shares.planning, shares.other, owedMinor, auth.etagForId(c.id + ':' + Date.now()), c.etag],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'cost.edited', c.id);
    await updateStatement(client, ctx.householdId!);
  });
  const c2 = await loadCost(deps, ctx.householdId!, c.id);
  const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1`, [c.id]);
  sendJson(ctx, 200, costOut(c2, rr.rows as ReceiptRow[]), { etag: c2.etag });
}

async function patchSplitAndFields(ctx: Ctx, deps: AppDeps, c: CostRow, body: Record<string, unknown>): Promise<void> {
  // split-only PATCH is the screen's path; both-at-once reuses the two rules
  if (c.state === 'draft' && c.paid_by === ctx.role) {
    await patchFields(ctx, deps, c, stripKey(body, 'agreedSplitBp'), true);
    const c2 = await loadCost(deps, ctx.householdId!, c.id);
    const body2 = { agreedSplitBp: body.agreedSplitBp };
    return patchSplit(ctx, deps, c2, body2);
  }
  throw problem(409, 'invalid_transition');
}

function stripKey(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const out = { ...body };
  delete out[key];
  return out;
}

async function patchFields(ctx: Ctx, deps: AppDeps, c: CostRow, body: Record<string, unknown>, skipEtagCheck = false): Promise<void> {
  if (!skipEtagCheck) requireIfMatch(ctx, c.etag);
  const updates: Record<string, unknown> = {};
  if (hasField(body, 'description')) {
    if (body.description === null) fail({ description: 'Use 1 to 500 characters.' });
    const t = typeof body.description === 'string' ? body.description : fail({ description: 'Use 1 to 500 characters.' });
    if (hasForbiddenChars(t)) fail({ description: 'Remove hidden or control characters.' });
    const len = nfc(t).length;
    if (len < 1 || len > 500) fail({ description: 'Use 1 to 500 characters.' });
    updates.description = t;
  }
  if (hasField(body, 'category')) {
    updates.category = typeof body.category === 'string' && (CATEGORIES as readonly string[]).includes(body.category)
      ? body.category : fail({ category: 'This value is out of range.' });
  }
  if (hasField(body, 'amountMinor')) {
    updates.amountMinor = typeof body.amountMinor === 'number' && Number.isInteger(body.amountMinor)
      && body.amountMinor >= 1 && body.amountMinor <= 100000000000
      ? body.amountMinor : fail({ amountMinor: 'Enter the amount as whole minor units from 1 to 100000000000.' });
  }
  if (hasField(body, 'incurredAt')) {
    const v = body.incurredAt;
    updates.incurredAt = typeof v === 'string' ? v : fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  }
  if (hasField(body, 'note')) {
    if (body.note === null) updates.note = null;
    else {
      const t = typeof body.note === 'string' ? body.note : fail({ note: 'Use at most 500 characters.' });
      if (hasForbiddenChars(t)) fail({ note: 'Remove hidden or control characters.' });
      if (nfc(t).length > 500) fail({ note: 'Use at most 500 characters.' });
      updates.note = t;
    }
  }
  // recompute custody day and split when incurredAt or amount changes
  await withTransaction(deps.pool, async (client) => {
    const next = { ...c, ...updates } as unknown as Record<string, unknown>;
    let custodyDay = c.custody_day;
    if (updates.incurredAt !== undefined) {
      const versions = await loadVersionsFor(client, ctx.householdId!);
      const adopted = versions.filter((v) => v.status === 'adopted').map(toVersionForNight);
      let inst;
      try {
        inst = parseInstant(updates.incurredAt as string);
      } catch {
        fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
      }
      const cd = custodyDayOf(adopted, inst);
      if (!cd) fail({ incurredAt: 'Choose a date from the plan start to one year ahead.' });
      custodyDay = cd;
    }
    const amount = updates.amountMinor !== undefined ? Number(updates.amountMinor) : Number(c.amount_minor);
    const splitBp = c.agreed_split_bp
      ? { planning: c.agreed_split_bp, other: 10000 - c.agreed_split_bp }
      : { planning: c.split_planning_bp, other: c.split_other_bp };
    const shares = splitAmount(amount, splitBp.planning, c.paid_by);
    const owedMinor = c.paid_by === 'planning' ? shares.other : shares.planning;
    await client.query(
      `UPDATE costs SET description=$2, category=$3, amount_minor=$4, incurred_at=$5, note=$6,
         custody_day=$7, share_planning=$8, share_other=$9, owed_minor=$10, etag=$11
       WHERE id=$1 AND etag=$12`,
      [c.id, (next.description as string) ?? c.description, (next.category as string) ?? c.category,
        amount, (next.incurredAt as string) ?? c.incurred_at, updates.note !== undefined ? updates.note : c.note,
        custodyDay, shares.planning, shares.other, owedMinor,
        auth.etagForId(c.id + ':' + Date.now()), c.etag],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'cost.edited', c.id);
    await updateStatement(client, ctx.householdId!);
  });
  const c2 = await loadCost(deps, ctx.householdId!, c.id);
  const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1`, [c.id]);
  sendJson(ctx, 200, costOut(c2, rr.rows as ReceiptRow[]), { etag: c2.etag });
}

async function loadVersionsFor(client: import('pg').PoolClient, hid: string): Promise<import('./apiTypes').PlanVersionRow[]> {
  const res = await client.query(`SELECT * FROM plan_versions WHERE household_id=$1 ORDER BY number DESC`, [hid]);
  return res.rows as import('./apiTypes').PlanVersionRow[];
}

export async function quote(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  for (const k of Object.keys(body)) {
    if (k !== 'amountMinor' && k !== 'incurredAt') fail({ [k]: 'This field is not accepted.' });
  }
  for (const f of ['amountMinor', 'incurredAt']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const amountMinor = typeof body.amountMinor === 'number' && Number.isInteger(body.amountMinor)
    && body.amountMinor >= 1 && body.amountMinor <= 100000000000
    ? body.amountMinor : fail({ amountMinor: 'Enter the amount as whole minor units from 1 to 100000000000.' });
  const incurredAt = typeof body.incurredAt === 'string' ? body.incurredAt
    : fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  let inst;
  try {
    inst = parseInstant(incurredAt);
  } catch {
    fail({ incurredAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  }
  const versions = await loadVersions(deps.pool, ctx.householdId!);
  const adoptedRows = versions.filter((v) => v.status === 'adopted');
  const adopted = adoptedRows.map(toVersionForNight);
  if (adopted.length === 0) throw problem(409, 'no_adopted_plan');
  const custodyDay = custodyDayOf(adopted, inst);
  if (!custodyDay) fail({ incurredAt: 'Choose a date from the plan start to one year ahead.' });
  const version = versionForDay(adoptedRows, custodyDay);
  if (!version) fail({ incurredAt: 'Choose a date from the plan start to one year ahead.' });
  const shares = splitAmount(amountMinor, version.split_planning_bp, ctx.role === 'planning' ? 'planning' : 'other');
  sendJson(ctx, 200, {
    splitBp: { planning: version.split_planning_bp, other: version.split_other_bp },
    shares: { planning: shares.planning, other: shares.other },
    versionId: version.id,
    custodyDay,
  });
}

function versionForDay(rows: import('./apiTypes').PlanVersionRow[], day: string): import('./apiTypes').PlanVersionRow | null {
  const before = rows.filter((r) => r.effective_from <= day);
  if (before.length > 0) {
    return before.reduce((a, b) => (a.effective_from > b.effective_from ? a : b));
  }
  return rows.reduce((a, b) => (a.effective_from < b.effective_from ? a : b), rows[0]) ?? null;
}

export async function costAction(ctx: Ctx, deps: AppDeps, id: string, action: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, id);
  const nowDate = new Date();
  const isCreator = c.paid_by === ctx.role;
  const answerer = c.paid_by === 'planning' ? 'other' : 'planning';
  const isAnswerer = ctx.role === answerer;
  if (action === 'lapse' || action === 'remind') throw problem(409, 'invalid_transition');

  if (action === 'send') {
    const t = requestTransition('cost', c.state as never, 'send', isCreator);
    if (!t.ok) throw transitionProblem(t.code!);
    const h = await loadHousehold(deps.pool, ctx.householdId!);
    const answererEmail = answerer === 'planning' ? h.planning_email : h.other_email;
    const windowEnd = new Date(nowDate.getTime() + deps.config.answerWindowSeconds * 1000);
    const answerBy = windowEnd;
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE costs SET state='sent', sent_at=now(), answer_by=$2, answer_zone=$3,
           reminder_at=$4, etag=$5 WHERE id=$1`,
        [c.id, answerBy, 'UTC', new Date(answerBy.getTime() - deps.config.reminderLeadSeconds * 1000),
          auth.etagForId(c.id + ':' + Date.now())],
      );
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
         VALUES ($1,$2,'request_sent',$3,$4,'/requests','queued')`,
        [noticeId, ctx.householdId, answererEmail, `Reimbursement request in ${h.name}`],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'cost.sent', c.id);
      await updateStatement(client, ctx.householdId!);
    });
    return costResponse(ctx, deps, c.id);
  }
  if (action === 'withdraw') {
    const t = requestTransition('cost', c.state as never, 'withdraw', isCreator);
    if (!t.ok) throw transitionProblem(t.code!);
    checkCostLapse(c, nowDate);
    const h = await loadHousehold(deps.pool, ctx.householdId!);
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE costs SET state='withdrawn', answered_at=now(), etag=$2 WHERE id=$1`,
        [c.id, auth.etagForId(c.id + ':' + Date.now())],
      );
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
         VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
        [noticeId, ctx.householdId, c.paid_by === 'planning' ? h.planning_email : h.other_email,
          `Your request was withdrawn in ${h.name}`],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'cost.withdrawn', c.id);
      await updateStatement(client, ctx.householdId!);
    });
    return costResponse(ctx, deps, c.id);
  }
  if (action === 'accept') {
    const t = requestTransition('cost', c.state as never, 'accept', isCreator);
    if (!t.ok) throw transitionProblem(t.code!);
    void isAnswerer;
    checkCostLapse(c, nowDate);
    const h = await loadHousehold(deps.pool, ctx.householdId!);
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE costs SET state='accepted', answered_at=now(), etag=$2 WHERE id=$1`,
        [c.id, auth.etagForId(c.id + ':' + Date.now())],
      );
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
         VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
        [noticeId, ctx.householdId, c.paid_by === 'planning' ? h.planning_email : h.other_email,
          `Your request was accepted in ${h.name}`],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'cost.accepted', c.id);
      await updateStatement(client, ctx.householdId!);
    });
    return costResponse(ctx, deps, c.id);
  }
  if (action === 'decline') {
    const t = requestTransition('cost', c.state as never, 'decline', isCreator);
    if (!t.ok) throw transitionProblem(t.code!);
    checkCostLapse(c, nowDate);
    const reason = requireReason(ctx);
    const h = await loadHousehold(deps.pool, ctx.householdId!);
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE costs SET state='declined', answered_at=now(), decline_reason=$2, etag=$3 WHERE id=$1`,
        [c.id, reason, auth.etagForId(c.id + ':' + Date.now())],
      );
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
         VALUES ($1,$2,'answered',$3,$4,'/requests','queued')`,
        [noticeId, ctx.householdId, c.paid_by === 'planning' ? h.planning_email : h.other_email,
          `Your request was declined in ${h.name}`],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'cost.declined', c.id);
      await updateStatement(client, ctx.householdId!);
    });
    return costResponse(ctx, deps, c.id);
  }
  if (action === 'settle') {
    const t = requestTransition('cost', c.state as never, 'settle', isCreator);
    if (!t.ok) throw transitionProblem(t.code!);
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE costs SET state='settled', answered_at=now(), etag=$2 WHERE id=$1`,
        [c.id, auth.etagForId(c.id + ':' + Date.now())],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'cost.settled', c.id);
      await updateStatement(client, ctx.householdId!);
    });
    return costResponse(ctx, deps, c.id);
  }
  throw problem(404, 'not_found');
}

function checkCostLapse(c: CostRow, nowDate: Date): void {
  if (c.answer_by && nowDate.getTime() >= c.answer_by.getTime()) {
    throw problem(409, 'request_lapsed');
  }
}

async function costResponse(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, id);
  const rr = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1`, [id]);
  sendJson(ctx, 200, costOut(c, rr.rows as ReceiptRow[]), { etag: c.etag });
}

export async function deleteCost(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, id);
  if (c.paid_by !== ctx.role) throw problem(403, 'not_your_request');
  if (c.state !== 'draft') throw problem(409, 'invalid_transition');
  requireIfMatch(ctx, c.etag);
  const receipts = await deps.pool.query(`SELECT * FROM receipts WHERE cost_id=$1`, [c.id]);
  const rows = receipts.rows as ReceiptRow[];
  // delete stored objects first; nothing is deleted if storage is unreachable
  try {
    for (const r of rows) {
      await deps.s3.deleteObject(r.object_key);
    }
  } catch (e) {
    if (e instanceof StorageUnavailable) {
      const err = new Error('storage') as Error & { code?: string };
      err.code = 'storage_unavailable';
      throw err;
    }
    throw e;
  }
  await withTransaction(deps.pool, async (client) => {
    await client.query(`DELETE FROM receipts WHERE cost_id=$1`, [c.id]);
    await client.query(`DELETE FROM costs WHERE id=$1`, [c.id]);
    await appendLog(client, ctx.householdId!, ctx.role!, 'cost.deleted', c.id);
    await updateStatement(client, ctx.householdId!);
  });
  sendNoContent(ctx);
}

// --- receipts ---

export async function uploadReceipt(ctx: Ctx, deps: AppDeps, costId: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, costId);
  if (c.paid_by !== ctx.role) throw problem(403, 'not_your_request');
  if (!['draft', 'sent', 'accepted'].includes(c.state)) throw problem(409, 'invalid_transition');
  requireIfMatch(ctx, c.etag);
  const count = await deps.pool.query(`SELECT count(*)::int AS n FROM receipts WHERE cost_id=$1`, [c.id]);
  if (count.rows[0].n >= 5) throw problem(409, 'receipt_limit');
  const filenameParam = ctx.query('filename');
  const filename = filenameParam && decodeURIComponent(filenameParam);
  if (!filename || filename.length < 1 || filename.length > 200) {
    fail({ receipt: 'This value is out of range.' });
  }
  const buf = ctx.body ?? Buffer.alloc(0);
  if (buf.length === 0 || buf.length > 5242880) {
    throw problem(413, 'payload_too_large');
  }
  const contentType = sniffType(buf);
  if (!contentType) fail({ receipt: "The file isn't a JPEG, PNG or PDF." });
  const sha = digestOf(buf);
  const id = auth.randomId();
  const objectKey = `households/${ctx.householdId}/receipts/${id}`;
  try {
    await deps.s3.putObject(objectKey, buf, contentType);
    const back = await deps.s3.getObject(objectKey);
    if (back.length !== buf.length || digestOf(back) !== sha) {
      await deps.s3.deleteObject(objectKey).catch(() => undefined);
      const err = new Error('storage') as Error & { code?: string };
      err.code = 'storage_unavailable';
      throw err;
    }
  } catch (e) {
    if (e instanceof StorageUnavailable || (e as { code?: string }).code === 'storage_unavailable') {
      const err = new Error('storage') as Error & { code?: string };
      err.code = 'storage_unavailable';
      throw err;
    }
    throw e;
  }
  const storedAt = new Date();
  await withTransaction(deps.pool, async (client) => {
    // re-check the ETag inside the transaction; lose cleanly on 412
    const fresh = await client.query(`SELECT etag FROM costs WHERE id=$1`, [c.id]);
    if (fresh.rows.length === 0 || fresh.rows[0].etag !== c.etag) {
      // lost to another write: remove the object
      await deps.s3.deleteObject(objectKey).catch(() => undefined);
      throw problem(412, 'precondition_failed');
    }
    await client.query(
      `INSERT INTO receipts (id, household_id, cost_id, content_type, bytes, sha256, filename, object_key, stored_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ctx.householdId, costId, contentType, buf.length, sha, filename, objectKey, storedAt],
    );
    await client.query(
      `UPDATE costs SET etag=$2 WHERE id=$1`,
      [c.id, auth.etagForId(c.id + ':' + Date.now())],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'receipt.stored', id);
  }).catch(async (e) => {
    if (e instanceof Problem) {
      throw e;
    }
    await deps.s3.deleteObject(objectKey).catch(() => undefined);
    throw e;
  });
  sendJson(ctx, 201, {
    id,
    contentType,
    bytes: buf.length,
    sha256: sha,
    filename,
    storedAt: isoOut(storedAt),
  });
}

function sniffType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export async function downloadReceipt(ctx: Ctx, deps: AppDeps, costId: string, receiptId: string): Promise<void> {
  const c = await loadCost(deps, ctx.householdId!, costId);
  if (!/^\d+$/.test(receiptId)) throw problem(404, 'not_found');
  const res = await deps.pool.query(
    `SELECT * FROM receipts WHERE id=$1 AND cost_id=$2 AND household_id=$3`,
    [receiptId, c.id, ctx.householdId],
  );
  if (res.rows.length === 0) throw problem(404, 'not_found');
  const r = res.rows[0] as ReceiptRow;
  let bytes: Buffer;
  try {
    bytes = await deps.s3.getObject(r.object_key);
  } catch {
    const err = new Error('storage') as Error & { code?: string };
    err.code = 'storage_unavailable';
    throw err;
  }
  const asciiName = r.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const starName = encodeURIComponent(r.filename).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  sendBytes(ctx, 200, r.content_type, bytes, {
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${starName}`,
    etag: `"${r.sha256}"`,
  });
}

// --- statement ---

export async function getStatement(ctx: Ctx, deps: AppDeps): Promise<void> {
  const res = await deps.pool.query(`SELECT body FROM statements WHERE household_id=$1`, [ctx.householdId!]);
  if (res.rows.length === 0) {
    await rebuildStatementIn(deps, ctx.householdId!);
    const res2 = await deps.pool.query(`SELECT body FROM statements WHERE household_id=$1`, [ctx.householdId!]);
    const body = bodyOf(res2.rows[0].body);
    const canon = canonicalJson(body);
    sendJson(ctx, 200, body, { etag: `"${digestOf(Buffer.from(canon, 'utf8'))}"` });
    return;
  }
  const body = bodyOf(res.rows[0].body);
  const canon = canonicalJson(body);
  const etag = `"${digestOf(Buffer.from(canon, 'utf8'))}"`;
  const inm = ctx.header('if-none-match');
  if (inm === etag) {
    ctx.res.writeHead(304, { etag });
    ctx.res.end();
    return;
  }
  sendJson(ctx, 200, body, { etag });
}

export async function rebuildStatement(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = await rebuildStatementIn(deps, ctx.householdId!);
  const canon = canonicalJson(body);
  sendJson(ctx, 200, body, { etag: `"${digestOf(Buffer.from(canon, 'utf8'))}"` });
}

export async function rebuildStatementIn(deps: AppDeps, hid: string): Promise<Record<string, unknown>> {
  const h = await loadHousehold(deps.pool, hid);
  const costs = await deps.pool.query(
    `SELECT * FROM costs WHERE household_id=$1 AND state IN ('accepted','settled') ORDER BY id`,
    [hid],
  );
  const body = statementOf(hid, h.currency, costs.rows as CostRow[]);
  const canon = canonicalJson(body);
  await deps.pool.query(
    `INSERT INTO statements (household_id, body, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (household_id) DO UPDATE SET body=$2, updated_at=now()`,
    [hid, canon],
  );
  return body;
}

export function statementOf(hid: string, currency: string, costs: CostRow[]): Record<string, unknown> {
  const years = new Map<string, { costs: number; amountMinor: number; planning: number; other: number }>();
  let owedBy: 'planning' | 'other' | null = null;
  let owedTo: 'planning' | 'other' | null = null;
  let balance = 0;
  for (const c of costs) {
    if (c.state === 'accepted') {
      balance += c.paid_by === 'planning' ? Number(c.owed_minor) : -Number(c.owed_minor);
    }
    const year = c.custody_day.slice(0, 4);
    let y = years.get(year);
    if (!y) {
      y = { costs: 0, amountMinor: 0, planning: 0, other: 0 };
      years.set(year, y);
    }
    y.costs += 1;
    y.amountMinor += Number(c.amount_minor);
    y.planning += Number(c.share_planning);
    y.other += Number(c.share_other);
  }
  if (balance !== 0) {
    if (balance > 0) {
      // planning paid more: other owes planning
      owedBy = 'other'; owedTo = 'planning';
    } else {
      owedBy = 'planning'; owedTo = 'other';
    }
  }
  const balanceOut = balance !== 0
    ? { owedBy, owedTo, minor: Math.abs(balance) }
    : null;
  return {
    householdId: hid,
    currency,
    balance: balanceOut,
    years: [...years.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([year, y]) => ({
      year: Number(year),
      costs: y.costs,
      amountMinor: y.amountMinor,
      shares: { planning: y.planning, other: y.other },
    })),
  };
}

export async function updateStatement(client: import('pg').PoolClient, hid: string): Promise<void> {
  const hRes = await client.query(`SELECT currency FROM households WHERE id=$1`, [hid]);
  const costs = await client.query(
    `SELECT * FROM costs WHERE household_id=$1 AND state IN ('accepted','settled') ORDER BY id`,
    [hid],
  );
  const body = statementOf(hid, hRes.rows[0].currency, costs.rows as CostRow[]);
  const canon = canonicalJson(body);
  await client.query(
    `INSERT INTO statements (household_id, body, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (household_id) DO UPDATE SET body=$2, updated_at=now()`,
    [hid, canon],
  );
}

function requireReason(ctx: Ctx): string {
  const body = requireJsonBody(ctx);
  for (const k of Object.keys(body)) {
    if (k !== 'reason') fail({ [k]: 'This field is not accepted.' });
  }
  if (!hasField(body, 'reason')) fail({ reason: 'Give a reason in 1 to 200 characters.' });
  const reason = typeof body.reason === 'string' ? body.reason : fail({ reason: 'Give a reason in 1 to 200 characters.' });
  if (hasForbiddenChars(reason)) fail({ reason: 'Remove hidden or control characters.' });
  const len = nfc(reason).length;
  if (len < 1 || len > 200) fail({ reason: 'Give a reason in 1 to 200 characters.' });
  return reason;
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
