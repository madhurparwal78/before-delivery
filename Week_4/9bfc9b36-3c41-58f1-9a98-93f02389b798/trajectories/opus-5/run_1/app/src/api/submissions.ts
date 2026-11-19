import { query, queryOne, transact, type Transaction } from '../db/pool';
import { notFound, rateLimited, refuse } from '../http/errors';
import { BULK_REFUSAL_COPY, FIELD_COPY } from '../shared/copy';
import { config } from '../config';
import { inches } from '../shared/units';
import {
  boatByCode, currentRuleSet, DIMENSION_ORDER, dimensionsOfBoat, instantOf, loftClosures,
  nameOf, reader, type AccountRow, type BoatRow,
} from '../domain/model';
import { asSubmittedMillimetres, parseInchFigure, readsAsInches } from '../domain/inches';
import { Check } from '../domain/validate';
import { audit, nextCode, opaqueId } from '../domain/records';
import { settleDependentDrawings } from './drawings';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { asOwner, onlyRoles } from './visibility';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';

/** Owner submissions, the owner request limit, and the sailmaker's decisions. */

export interface SubmissionRow {
  readonly id: string;
  readonly boat_code: string;
  readonly dimension: string;
  readonly value_mm: number;
  readonly as_submitted: string;
  readonly measured_on: Date;
  readonly note: string;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'reversed';
  readonly submitted_by: string;
  readonly submitted_at: Date;
  readonly decided_at: Date | null;
  readonly decided_by: string | null;
  readonly reason: string | null;
}

export async function submissionView(row: SubmissionRow, forOwner: boolean): Promise<Record<string, unknown>> {
  const submitter = await queryOne<AccountRow>('SELECT * FROM account WHERE email = $1', [row.submitted_by]);
  const base: Record<string, unknown> = {
    id: row.id,
    boat_code: row.boat_code,
    dimension: row.dimension,
    value_mm: row.value_mm,
    value_in: inches(row.value_mm),
    as_submitted: row.as_submitted,
    measured_on: row.measured_on.toISOString().slice(0, 10),
    note: row.note,
    status: row.status,
    submitted_by: { email: row.submitted_by, display_name: nameOf(submitter) },
    submitted_at: instantOf(row.submitted_at),
    decided_at: row.decided_at === null ? null : instantOf(row.decided_at),
    reason: row.reason,
  };
  if (forOwner) return base;
  return { ...base, decided_by: row.decided_by };
}

/**
 * The owner request limit, kept in the database so every instance shares it.
 * A refused request writes nothing and is not counted.
 */
export async function chargeOwnerLimit(
  tx: Transaction,
  email: string,
  kind: 'submission' | 'sheet',
  now: Date,
  limit: number,
): Promise<void> {
  const since = new Date(now.getTime() - config.ownerRateWindowSeconds * 1000).toISOString();
  const rows = await tx.query<{ at: Date }>(
    `SELECT at FROM owner_request_count
      WHERE account_email = $1 AND kind = $2 AND at > $3 ORDER BY at ASC`,
    [email, kind, since],
  );
  if (rows.length >= limit) {
    const oldest = rows[0] as { at: Date };
    const leaves = oldest.at.getTime() + config.ownerRateWindowSeconds * 1000 - now.getTime();
    throw rateLimited(Math.max(1, Math.ceil(leaves / 1000)));
  }
  await tx.query('INSERT INTO owner_request_count (account_email, kind, at) VALUES ($1,$2,$3)', [
    email,
    kind,
    now.toISOString(),
  ]);
}

export async function submitOwnerMeasurement(ctx: Ctx, boat: BoatRow): Promise<Reply> {
  const caller = signedIn(ctx);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const dimension = check.choice('dimension', DIMENSION_ORDER, FIELD_COPY.dimension);
  const measuredOn = check.date('measured_on');
  check.text('note', 0, 200);
  const note = typeof body['note'] === 'string' ? body['note'] : '';

  const hasMm = body['value_mm'] !== undefined && body['value_mm'] !== null;
  const hasIn = body['value_in'] !== undefined && body['value_in'] !== null;
  let valueMm = 0;
  let asSubmitted = '';

  if (hasMm === hasIn) {
    check.fail('value_mm', FIELD_COPY.bothOrNeither);
  } else if (hasMm) {
    valueMm = check.lengthMm('value_mm');
    asSubmitted = asSubmittedMillimetres(valueMm);
    const ruleset = await currentRuleSet(reader, ctx.now);
    const closures = await loftClosures(reader);
    const states = await dimensionsOfBoat(reader, boat.code, closures);
    const current = states.get(dimension)?.value_mm ?? null;
    if (!check.anyErrors() && readsAsInches(valueMm, current, ruleset.tolerance_mm)) {
      check.fail('value_mm', FIELD_COPY.looksLikeInches);
    }
  } else {
    const raw = body['value_in'];
    if (typeof raw !== 'string') {
      check.fail('value_in', FIELD_COPY.inchesMalformed);
    } else {
      const parsed = parseInchFigure(raw);
      if (!parsed.ok) {
        check.fail('value_in', parsed.problem === 'malformed' ? FIELD_COPY.inchesMalformed : FIELD_COPY.lengthRange);
      } else {
        valueMm = parsed.mm;
        asSubmitted = parsed.asSubmitted;
      }
    }
  }
  check.done();

  const created = await transact(async (tx) => {
    await chargeOwnerLimit(tx, caller.email, 'submission', ctx.now, config.ownerSubmissionLimit);
    const id = await nextCode(tx, 'submission');
    const row = await tx.one<SubmissionRow>(
      `INSERT INTO submission (id, boat_code, dimension, value_mm, as_submitted, measured_on, note,
         status, submitted_by, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *`,
      [id, boat.code, dimension, valueMm, asSubmitted, measuredOn, note, caller.email, ctx.now.toISOString()],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'submission.create',
      target: id,
      after: 'pending',
    });
    return row as SubmissionRow;
  });
  return reply(201, await submissionView(created, true));
}

export async function listSubmissions(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'yacht-owner']);
  const status = ctx.query.get('status');
  const order = { at: 'submitted_at', id: numericIdSql('id') };
  const clause = pageClause(ctx, { status }, order, 1);
  const filters: string[] = [];
  const values: unknown[] = [...clause.values];
  if (status !== null && status !== '') {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }
  if (caller.role === 'yacht-owner') {
    values.push(caller.email);
    filters.push(`submitted_by = $${values.length}`);
  }
  const where = filters.length === 0 ? '' : ` AND ${filters.join(' AND ')}`;
  const countValues = values.slice(clause.values.length);
  const countWhere = filters
    .map((clauseText, index) => clauseText.replace(/\$\d+/, `$${index + 1}`))
    .join(' AND ');
  const page = await answerPage<SubmissionRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM submission WHERE true ${clause.where} ${where}
             ORDER BY submitted_at DESC, code_number(id) DESC LIMIT ${clause.limit + 1}`,
      values,
      countSql: `SELECT count(*)::text n FROM submission ${countWhere === '' ? '' : `WHERE ${countWhere}`}`,
      countValues,
      position: (row) => ({ at: instantOf(row.submitted_at), id: padNumber(row.id) }),
    },
    (row) => submissionView(row, asOwner(caller)),
  );
  return reply(200, page);
}

export type DecisionOutcome = 'applied' | 'refused';
export type DecisionReason = 'already_decided' | 'not_found' | 'reason_required' | 'invalid_decision';

interface DecisionResult {
  readonly id: string;
  readonly outcome: DecisionOutcome;
  readonly reason: DecisionReason | null;
  readonly status: string | null;
}

/**
 * Applies one decision under a row lock, so of simultaneous decisions on one
 * submission exactly one applies. Accept turns it into a measurement.
 */
async function applyDecision(
  tx: Transaction,
  actorEmail: string,
  now: Date,
  id: string,
  decision: string,
  reason: string | null,
): Promise<DecisionResult> {
  if (decision !== 'accept' && decision !== 'reject') {
    return { id, outcome: 'refused', reason: 'invalid_decision', status: null };
  }
  if (decision === 'reject' && (reason === null || reason === '')) {
    return { id, outcome: 'refused', reason: 'reason_required', status: null };
  }
  const row = await tx.one<SubmissionRow>('SELECT * FROM submission WHERE id = $1 FOR UPDATE', [id]);
  if (row === null) return { id, outcome: 'refused', reason: 'not_found', status: null };
  if (row.status !== 'pending') {
    return { id, outcome: 'refused', reason: 'already_decided', status: row.status };
  }

  const status = decision === 'accept' ? 'accepted' : 'rejected';
  await tx.query(
    'UPDATE submission SET status = $2, decided_at = $3, decided_by = $4, reason = $5 WHERE id = $1',
    [id, status, now.toISOString(), actorEmail, reason],
  );
  if (decision === 'accept') {
    const ruleset = await currentRuleSet(tx, now);
    await tx.query(
      `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, submission_id, tolerance_mm)
       VALUES ($1,$2,$3,$4,$5,'submission',$6,$7)`,
      [opaqueId('ME-'), row.boat_code, row.dimension, row.value_mm, row.measured_on, id, ruleset.tolerance_mm],
    );
    await settleDependentDrawings(tx, row.boat_code, row.dimension, now);
  }
  await audit(tx, now, {
    actorEmail,
    action: decision === 'accept' ? 'submission.accept' : 'submission.reject',
    target: id,
    before: 'pending',
    after: status,
    reason,
  });
  return { id, outcome: 'applied', reason: null, status };
}

export async function decideSubmission(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const existing = await queryOne<SubmissionRow>('SELECT * FROM submission WHERE id = $1', [id]);
  if (existing === null) throw notFound();
  const body = jsonBody(ctx);
  const check = new Check(body);
  const decision = check.choice('decision', ['accept', 'reject'], FIELD_COPY.decision);
  const reason = decision === 'reject' ? check.reason('reason', FIELD_COPY.reasonRequired) : null;
  if (typeof body['reason'] === 'string' && [...(body['reason'] as string)].length > 200) {
    check.fail('reason', FIELD_COPY.reasonTooLong);
  }
  check.done();

  const outcome = await transact((tx) => applyDecision(tx, caller.email, ctx.now, id, decision, reason));
  if (outcome.outcome === 'refused') {
    if (outcome.reason === 'already_decided') throw refuse('already_decided');
    if (outcome.reason === 'not_found') throw notFound();
  }
  const row = (await queryOne<SubmissionRow>('SELECT * FROM submission WHERE id = $1', [id])) as SubmissionRow;
  return reply(200, await submissionView(row, false));
}

export async function reverseSubmission(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const existing = await queryOne<SubmissionRow>('SELECT * FROM submission WHERE id = $1', [id]);
  if (existing === null) throw notFound();
  const body = jsonBody(ctx);
  const check = new Check(body);
  const reason = check.reason('reason', FIELD_COPY.reasonRequired);
  check.done();

  const row = await transact(async (tx) => {
    const locked = await tx.one<SubmissionRow>('SELECT * FROM submission WHERE id = $1 FOR UPDATE', [id]);
    if (locked === null) throw notFound();
    if (locked.status !== 'accepted') throw refuse('not_accepted');
    // Reverse keeps `decided_at` and `decided_by`, so the streak order holds.
    await tx.query(`UPDATE submission SET status = 'reversed', reason = $2 WHERE id = $1`, [id, reason]);
    await tx.query('DELETE FROM measurement WHERE submission_id = $1', [id]);
    await settleDependentDrawings(tx, locked.boat_code, locked.dimension, ctx.now);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'submission.reverse',
      target: id,
      before: 'accepted',
      after: 'reversed',
      reason,
    });
    return (await tx.one<SubmissionRow>('SELECT * FROM submission WHERE id = $1', [id])) as SubmissionRow;
  });
  return reply(200, await submissionView(row, false));
}

/** The bulk path applies each item independently, in submitted order. */
export async function bulkDecide(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const raw = body['decisions'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) {
    const check = new Check(body);
    check.fail('decisions', FIELD_COPY.required);
    check.done();
  }
  const items = raw as readonly Record<string, unknown>[];
  const results: DecisionResult[] = [];
  for (const item of items) {
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    const decision = typeof item['decision'] === 'string' ? item['decision'] : '';
    const reason = typeof item['reason'] === 'string' ? item['reason'] : null;
    const outcome = await transact((tx) => applyDecision(tx, caller.email, ctx.now, id, decision, reason));
    results.push(outcome);
  }
  return reply(200, { results });
}

export const BULK_COPY = BULK_REFUSAL_COPY;

export async function boatOfSubmission(id: string): Promise<BoatRow | null> {
  const row = await queryOne<SubmissionRow>('SELECT * FROM submission WHERE id = $1', [id]);
  if (row === null) return null;
  return boatByCode(reader, row.boat_code);
}

export async function pendingCount(): Promise<number> {
  const row = await query<{ n: string }>(`SELECT count(*)::text n FROM submission WHERE status = 'pending'`);
  return Number(row[0]?.n ?? '0');
}
