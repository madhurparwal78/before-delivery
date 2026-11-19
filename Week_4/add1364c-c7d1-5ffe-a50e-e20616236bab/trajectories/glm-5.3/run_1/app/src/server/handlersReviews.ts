import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole } from './handlersCore.js';
import { mapPerson } from './people.js';
import { applyScopeLoss } from './domain/scopeChanges.js';
import { notifyReviewChangedToManagers, notifySeatConfirmed } from './handlersPeopleApi.js';
import { visibleNow } from './handlersCore.js';
import { officeDateString, officeMidnightInstant, quarterOfDate } from './officeTime.js';

export async function listReviews(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM reviews ORDER BY opened_on DESC');
  const now = ctx.store.clock.now();
  const views = [];
  for (const row of rows.rows) {
    const overdueFrom = String(row.overdue_from).slice(0, 10);
    let status = String(row.status);
    if (status === 'open' && now.getTime() >= officeMidnightInstant(overdueFrom).getTime()) {
      status = 'overdue';
    }
    views.push({
      id: String(row.id),
      quarter: String(row.quarter),
      opened_on: String(row.opened_on).slice(0, 10),
      overdue_from: overdueFrom,
      status,
      signed_off_by: row.signed_off_by ? String(row.signed_off_by) : null
    });
  }
  jsonOk(ctx.res, 200, { reviews: views });
}

export async function getReview(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM reviews WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const review = rows.rows[0];
  const lines = await ctx.store.pool.query(
    `SELECT rl.*, p.full_name AS person_name, p.created_seq AS person_seq, v.name AS vault_name, v.formerly AS vault_formerly, v.position AS vault_position
     FROM review_lines rl
     JOIN people p ON p.id = rl.person_id
     JOIN vaults v ON v.id = rl.vault_id
     WHERE rl.review_id = $1
     ORDER BY p.created_seq, v.position`,
    [String(review.id)]
  );
  const lineViews = [];
  let decided = 0;
  for (const line of lines.rows) {
    const vendors = await ctx.store.pool.query(
      'SELECT v.name, v.formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id WHERE c.vault_id = $1 ORDER BY c.created_seq',
      [String(line.vault_id)]
    );
    if (line.decision === 'kept' || line.decision === 'removed') decided += 1;
    lineViews.push({
      id: String(line.id),
      person_id: String(line.person_id),
      person_name: String(line.person_name),
      vault_id: String(line.vault_id),
      vault_name: String(line.vault_name),
      vault_formerly: line.vault_formerly ? String(line.vault_formerly) : null,
      vendors: vendors.rows.map((row) => ({ name: String(row.name), formerly: row.formerly ? String(row.formerly) : null })),
      decision: String(line.decision),
      decided_by: line.decided_by ? String(line.decided_by) : null,
      decided_via: line.decided_via ? String(line.decided_via) : null
    });
  }
  const now = ctx.store.clock.now();
  const overdueFrom = String(review.overdue_from).slice(0, 10);
  let status = String(review.status);
  if (status === 'open' && now.getTime() >= officeMidnightInstant(overdueFrom).getTime()) {
    status = 'overdue';
  }
  jsonOk(ctx.res, 200, {
    id: String(review.id),
    quarter: String(review.quarter),
    opened_on: String(review.opened_on).slice(0, 10),
    overdue_from: overdueFrom,
    status,
    signed_off_by: review.signed_off_by ? String(review.signed_off_by) : null,
    decided,
    total: lineViews.length,
    lines: lineViews
  });
}

export async function decideReviewLine(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const reviewRows = await ctx.store.pool.query('SELECT * FROM reviews WHERE id = $1', [ctx.params.id]);
  if (reviewRows.rows.length === 0) throw notFound();
  const review = reviewRows.rows[0];
  if (String(review.status) === 'signed_off') {
    throw conflict('review_signed_off', 'This review is signed off.');
  }
  const lineRows = await ctx.store.pool.query(
    'SELECT * FROM review_lines WHERE id = $1 AND review_id = $2',
    [ctx.params.lineId, String(review.id)]
  );
  if (lineRows.rows.length === 0) throw notFound();
  const line = lineRows.rows[0];
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { decision: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const decision = String(body.decision ?? '');
  if (decision !== 'keep' && decision !== 'remove') {
    throw invalid({ decision: 'Decide the line as keep or remove.' });
  }
  if (String(line.decision) !== 'undecided') {
    throw conflict('line_decided', COPY.lineDecided);
  }
  const personRows = await ctx.store.pool.query('SELECT * FROM people WHERE id = $1', [String(line.person_id)]);
  if (personRows.rows.length === 0) throw notFound();
  const person = mapPerson(personRows.rows[0]);
  const vaultRows = await ctx.store.pool.query('SELECT * FROM vaults WHERE id = $1', [String(line.vault_id)]);
  const vaultName = vaultRows.rows.length > 0 ? String(vaultRows.rows[0].name) : '';
  await ctx.store.transaction(async (client) => {
    const stored = decision === 'keep' ? 'kept' : 'removed';
    const updated = await client.query(
      "UPDATE review_lines SET decision = $2, decided_by = $3, decided_via = 'review' WHERE id = $1 AND decision = 'undecided' RETURNING id",
      [String(line.id), stored, ctx.person!.id]
    );
    if (updated.rows.length === 0) {
      throw conflict('line_decided', COPY.lineDecided);
    }
    if (decision === 'remove') {
      await client.query('DELETE FROM vault_scopes WHERE person_id = $1 AND vault_id = $2', [
        String(line.person_id),
        String(line.vault_id)
      ]);
      await applyScopeLoss(
        ctx.store,
        client,
        {
          personId: String(line.person_id),
          personName: person.full_name,
          vaultIds: [String(line.vault_id)],
          confirmedBy: ctx.person!.id,
          cause: 'review'
        },
        { personId: ctx.person!.id, name: ctx.person!.full_name }
      );
      await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
        { action: 'review_decision', subject: { kind: 'person', id: String(line.person_id), name: person.full_name }, details: { decided_via: 'review' } }
      ]);
    } else {
      await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
        { action: 'review_decision', subject: { kind: 'person', id: String(line.person_id), name: person.full_name }, details: { decided_via: 'review' } }
      ]);
    }
  });
  if (decision === 'remove') {
    const visible = await visibleNow(ctx, person);
    ctx.store.events.send(person.id, 'access-changed', {
      vault_ids: visible,
      ended: [{ vault_id: String(line.vault_id), name: vaultName }],
      cause: 'change'
    });
  }
  notifyReviewChangedToManagers(ctx);
  const fresh = await ctx.store.pool.query('SELECT * FROM review_lines WHERE id = $1', [String(line.id)]);
  const row = fresh.rows[0];
  jsonOk(ctx.res, 200, {
    id: String(row.id),
    person_id: String(row.person_id),
    vault_id: String(row.vault_id),
    decision: String(row.decision),
    decided_by: row.decided_by ? String(row.decided_by) : null,
    decided_via: row.decided_via ? String(row.decided_via) : null
  });
}

export async function signOffReview(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'managing_partner');
  const reviewRows = await ctx.store.pool.query('SELECT * FROM reviews WHERE id = $1', [ctx.params.id]);
  if (reviewRows.rows.length === 0) throw notFound();
  const review = reviewRows.rows[0];
  if (String(review.status) === 'signed_off') {
    throw conflict('review_signed_off', 'This review is signed off.');
  }
  const undecided = await ctx.store.pool.query(
    "SELECT COUNT(*)::int AS n FROM review_lines WHERE review_id = $1 AND decision = 'undecided'",
    [String(review.id)]
  );
  if (Number(undecided.rows[0].n) > 0) {
    throw conflict('lines_undecided', COPY.linesUndecided);
  }
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  await ctx.store.transaction(async (client) => {
    const updated = await client.query(
      "UPDATE reviews SET status = 'signed_off', signed_off_by = $2, signed_off_at = $3 WHERE id = $1 AND status <> 'signed_off' RETURNING id",
      [String(review.id), ctx.person!.id, ctx.store.clock.now()]
    );
    if (updated.rows.length === 0) {
      throw conflict('review_signed_off', 'This review is signed off.');
    }
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'review_sign_off', subject: { kind: 'review', id: String(review.id), name: String(review.quarter) } }
    ]);
  });
  notifyReviewChangedToManagers(ctx);
  jsonOk(ctx.res, 200, { status: 'signed_off' });
}
