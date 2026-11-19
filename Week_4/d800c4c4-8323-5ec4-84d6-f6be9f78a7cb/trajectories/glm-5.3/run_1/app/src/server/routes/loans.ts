// Routes: loans, reservations, checkout, hang, take-down, check-in, finish.
// The loan's id is bound to `loanId` after the unknown-id guard, so the precedence
// (404 before the role 403) holds while later code can rely on a number.

import { Ctx, requireStaff, RouteContext, requireUser } from './context';
import { needsSignIn, sessionEnded } from '../errors';
import { sendJsonResponse, JSON_BODY_LIMIT } from '../http';
import { ApiError, COPY, conflict, notFound, providerDown, tooLarge, validation } from '../errors';
import { readJson, readMultipart, validatePhoto, validateCapturedAt, parseIsoInstant, readBodyForInspection, parseJsonBody, checkJsonContentTypeForRaw, type PhotoUpload } from '../body';
import {
  dueDateForCheckout,
  effectiveReturnDay,
  feeTotal,
  getCalendar,
  getSettings,
  computeFeeLines,
  nextLoanRef,
  openDaysLate,
  recomputeItemStatus,
  membershipIsActive,
} from '../domain';
import { promoteNextHold } from './core';
import { createHash } from 'node:crypto';
import { dateInZone } from '../libraryTime';
import type { FeeLine, FeeRules, Loan } from '../../shared/api';
import { loadLoanRow, loanToApi, loadFeeRow, feeToApi } from '../serialize';
import { KillBillDown } from '../killbill';

// GET /api/loans
export async function getLoans(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const statusFilter = ctx.query.get('status');
  const memberFilter = ctx.query.get('member_id');
  if (user.role === 'member') {
    if (memberFilter !== null && memberFilter !== '' && memberFilter !== String(user.id)) throw notFound();
    const rows = await loanIdRows(ctx.route.db, { memberId: user.id });
    sendJsonResponse(ctx.res, 200, { loans: await serializeLoans(ctx, rows) });
    return;
  }
  requireStaff(ctx);
  const filters: { memberId?: number; status?: string } = {};
  if (memberFilter !== null && memberFilter !== '') {
    const id = /^\d+$/.test(memberFilter) ? Number(memberFilter) : null;
    if (id === null) throw notFound();
    filters.memberId = id;
  }
  if (statusFilter !== null && statusFilter !== '') {
    if (!['reserved', 'out', 'pending-photo', 'returned-partial', 'returned-complete'].includes(statusFilter)) throw notFound();
    filters.status = statusFilter;
  }
  const rows = await loanIdRows(ctx.route.db, filters);
  sendJsonResponse(ctx.res, 200, { loans: await serializeLoans(ctx, rows) });
}

// GET /api/loans/<id>
export async function getLoan(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireUser(ctx);
  const id = wholeId(idSegment);
  const row = id === null ? null : await loadLoanRow(ctx.route.db, id);
  if (row === null) throw notFound();
  if (user.role === 'member' && row.member_id !== user.id) throw notFound();
  const calendar = await getCalendar(ctx.route.db);
  sendJsonResponse(ctx.res, 200, { loan: await loanToApi(ctx.route.db, calendar, row, new Date()) });
}

// POST /api/loans (reserve)
export async function postLoan(ctx: Ctx): Promise<void> {
  requireStaff(ctx);
  const user = ctx.auth.user!;
  // The coordinator-only check for a volunteer naming checked_out_at (role, step 4) precedes
  // the content-type check (step 5), so peek inside the body first.
  const raw = await readBodyForInspection(ctx.req);
  if (user.role !== 'coordinator') {
    const peek = parseJsonBody(raw);
    if (peek !== null && 'checked_out_at' in peek) {
      throw new ApiError(403, COPY.coordinatorOnly);
    }
  }
  // Step 5 (content type) precedes step 6 (size).
  checkJsonContentTypeForRaw(ctx.req, raw);
  if (raw.length > JSON_BODY_LIMIT) throw tooLarge();
  const body = parseJsonBody(raw) as { member_id?: unknown; item_ids?: unknown; checked_out_at?: unknown } | null;
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const memberField = body?.member_id;
  if (!isWholeId(memberField)) {
    fields['member_id'] = 'Name the member.';
    order.push('member_id');
  }
  const itemIdsRaw = body?.item_ids;
  let itemIds: number[] | null = null;
  if (!Array.isArray(itemIdsRaw) || itemIdsRaw.length === 0) {
    fields['item_ids'] = 'List at least one tool.';
    order.push('item_ids');
  } else if (itemIdsRaw.length > 10) {
    fields['item_ids'] = 'A loan can carry at most 10 tools.';
    order.push('item_ids');
  } else {
    const all: number[] = [];
    let ok = true;
    for (const raw of itemIdsRaw) {
      if (!isWholeId(raw)) {
        ok = false;
        break;
      }
      all.push(Number(raw));
    }
    if (!ok) {
      fields['item_ids'] = 'List whole-number tool ids.';
      order.push('item_ids');
    } else if (new Set(all).size !== all.length) {
      fields['item_ids'] = 'List each tool once.';
      order.push('item_ids');
    } else {
      itemIds = all;
    }
  }
  const hasCheckedOut = body !== null && 'checked_out_at' in body;
  let checkedOutInstant: Date | null = null;
  if (hasCheckedOut && typeof body?.checked_out_at === 'string') {
    const parsed = parseIsoInstant(body.checked_out_at);
    const now = new Date();
    if (parsed === null || parsed.getTime() > now.getTime() || now.getTime() - parsed.getTime() > 120 * 86400000) {
      fields['checked_out_at'] = 'Use an ISO 8601 time in the past, within 120 days.';
      order.push('checked_out_at');
    } else {
      checkedOutInstant = parsed;
    }
  } else if (hasCheckedOut) {
    fields['checked_out_at'] = 'Use an ISO 8601 time in the past, within 120 days.';
    order.push('checked_out_at');
  }
  if (order.length > 0) throw reorderThrow(fields, order);

  if (user.role !== 'coordinator' && hasCheckedOut) {
    throw new ApiError(403, COPY.coordinatorOnly);
  }

  const member = await ctx.route.db.one<{ id: number; name: string; role: string }>(
    'SELECT id, name, role FROM users WHERE id = $1',
    [Number(memberField)],
  );
  if (member === null || member.role !== 'member') throw notFound();
  const active = await membershipIsActive(ctx.route.db, member.id);
  if (!active) throw conflict(COPY.memberNotActive);

  const itemRows: { id: number; tag: string; status: string }[] = [];
  for (const itemId of itemIds!) {
    const item = await ctx.route.db.one<{ id: number; tag: string; status: string }>('SELECT id, tag, status FROM items WHERE id = $1', [itemId]);
    if (item === null) throw notFound();
    itemRows.push(item);
  }
  for (const item of itemRows) {
    if (item.status === 'out' || item.status === 'reserved' || item.status === 'pending-photo') {
      throw conflict(COPY.notOnWall(item.tag));
    }
    if (item.status === 'incomplete') throw conflict(COPY.missingPartsTool(item.tag));
    if (item.status === 'held') {
      const readyHold = await ctx.route.db.one<{ member_id: number }>(
        `SELECT member_id FROM holds WHERE item_id = $1 AND status = 'ready' LIMIT 1`,
        [item.id],
      );
      if (readyHold === null || readyHold.member_id !== member.id) throw conflict(COPY.heldForAnother(item.tag));
    }
  }

  const { ref, seq } = await nextLoanRef(ctx.route.db);
  const loanId = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    for (const item of itemRows) {
      const locked = await client.query<{ status: string }>('SELECT status FROM items WHERE id = $1 FOR UPDATE', [item.id]);
      const status = locked.rows[0]?.status;
      if (status === undefined) {
        await client.query('ROLLBACK');
        throw notFound();
      }
      if (status === 'out' || status === 'reserved' || status === 'pending-photo') {
        await client.query('ROLLBACK');
        throw conflict(COPY.notOnWall(item.tag));
      }
      if (status === 'incomplete') {
        await client.query('ROLLBACK');
        throw conflict(COPY.missingPartsTool(item.tag));
      }
      if (status === 'held') {
        const readyHold = await client.query<{ member_id: number }>(
          `SELECT member_id FROM holds WHERE item_id = $1 AND status = 'ready' LIMIT 1 FOR UPDATE`,
          [item.id],
        );
        const holder = readyHold.rows[0]?.member_id;
        if (holder === undefined || holder !== member.id) {
          await client.query('ROLLBACK');
          throw conflict(COPY.heldForAnother(item.tag));
        }
      }
      await client.query(`UPDATE items SET status = 'reserved' WHERE id = $1`, [item.id]);
    }
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO loans (ref, member_id, status, loan_seq, checked_out_at) VALUES ($1, $2, 'reserved', $3, $4) RETURNING id`,
      [ref, member.id, seq, checkedOutInstant],
    );
    const id = inserted.rows[0]!.id;
    for (const item of itemRows) {
      await client.query('INSERT INTO loan_items (loan_id, item_id) VALUES ($1, $2)', [id, item.id]);
    }
    await client.query('COMMIT');
    return id;
  });
  const row = await loadLoanRow(ctx.route.db, loanId);
  const calendar = await getCalendar(ctx.route.db);
  sendJsonResponse(ctx.res, 201, { loan: await loanToApi(ctx.route.db, calendar, row!, new Date()) });
}

// DELETE /api/loans/<id>
export async function deleteLoan(ctx: Ctx, idSegment: string): Promise<void> {
  const id = wholeId(idSegment);
  const loanRow = id === null ? null : await ctx.route.db.one<{ id: number; status: string }>('SELECT id, status FROM loans WHERE id = $1', [id]);
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  if (loanRow.status !== 'reserved') throw conflict(COPY.onlyReservedCancel);
  const itemIds = await ctx.route.db.query<{ item_id: number }>('SELECT item_id FROM loan_items WHERE loan_id = $1', [loanRow.id]);
  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanRow.id]);
    const status = locked.rows[0]?.status;
    if (status !== 'reserved') {
      await client.query('ROLLBACK');
      throw conflict(COPY.onlyReservedCancel);
    }
    await client.query('DELETE FROM loans WHERE id = $1', [loanRow.id]);
    await client.query('COMMIT');
  });
  for (const item of itemIds) {
    const status = await recomputeItemStatus(ctx.route.db, item.item_id);
    await ctx.route.db.exec('UPDATE items SET status = $2 WHERE id = $1', [item.item_id, status]);
    if (status === 'on-wall') {
      // The holder cancelled the ready hold before the reservation was deleted.
      await promoteNextHold(ctx.route, item.item_id);
    }
  }
  ctx.res.writeHead(204).end();
}

// POST /api/loans/<id>/checkout
export async function checkout(ctx: Ctx, idSegment: string): Promise<void> {
  // 401 (no session) precedes the unknown-id 404, which precedes the role 403.
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  const id = wholeId(idSegment);
  const loanRow =
    id === null
      ? null
      : await ctx.route.db.one<{ id: number; ref: string; status: string; checked_out_at: Date | null }>(
          'SELECT id, ref, status, checked_out_at FROM loans WHERE id = $1',
          [id],
        );
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  const loanId = loanRow.id;

  const parts = await readMultipart(ctx.req);
  if (parts === null) throw validation({ photo: 'Choose a photo.' });
  const now = new Date();
  const photo = validatePhoto(parts.get('photo'));
  const fields: Record<string, string> = {};
  const order: string[] = [];
  if (photo === 'missing') {
    fields['photo'] = 'Choose a photo.';
    order.push('photo');
  } else if (photo === 'too-large') {
    throw new ApiError(413, COPY.photoTooLarge);
  } else if (photo === 'bad-type') {
    fields['photo'] = 'Choose a JPEG, PNG or WebP photo.';
    order.push('photo');
  }
  const captured = validateCapturedAt(parts.get('captured_at')?.data.toString('utf8'), now);
  if (captured === 'missing') {
    fields['captured_at'] = 'Send the photo capture time.';
    order.push('captured_at');
  } else if (captured === 'bad') {
    fields['captured_at'] = 'Send an ISO 8601 capture time not in the future.';
    order.push('captured_at');
  }
  if (order.length > 0) throw reorderThrow(fields, order);

  const calendar = await getCalendar(ctx.route.db);
  const settings = await getSettings(ctx.route.db);

  const checkedOutAt = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string; checked_out_at: Date | null; ref: string; member_id: number }>(
      'SELECT status, checked_out_at, ref, member_id FROM loans WHERE id = $1 FOR UPDATE',
      [loanId],
    );
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (row.status !== 'reserved') {
      await client.query('ROLLBACK');
      throw conflict(COPY.loanAlreadyOut);
    }
    const outAt = row.checked_out_at ?? new Date();
    const checkoutDate = dateInZone(outAt, calendar.zone);
    const dueDate = dueDateForCheckout(calendar, checkoutDate, settings);
    await client.query(`UPDATE loans SET status = 'out', checked_out_at = $2, due_date = to_date($3, 'YYYY-MM-DD') WHERE id = $1`, [
      loanId,
      outAt,
      dueDate,
    ]);
    const items = await client.query<{ id: number; replacement_cost_cents: number }>(
      `SELECT i.id, i.replacement_cost_cents FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY i.id FOR UPDATE`,
      [loanId],
    );
    const costs: Record<string, number> = {};
    for (const item of items.rows) {
      await client.query(`UPDATE parts SET state = 'out' WHERE item_id = $1`, [item.id]);
      await client.query(`UPDATE items SET status = 'out' WHERE id = $1`, [item.id]);
      costs[String(item.id)] = item.replacement_cost_cents;
    }
    const feeRules: FeeRules = {
      late_fee_cents: settings.late_fee_cents,
      damage_fee_cents: settings.damage_fee_cents,
      replacement_costs_cents: costs,
    };
    await client.query('UPDATE loans SET fee_rules = $2 WHERE id = $1', [loanId, JSON.stringify(feeRules)]);
    await client.query(
      `UPDATE holds SET status = 'collected' WHERE item_id = ANY($1::int[]) AND member_id = $2 AND status = 'ready'`,
      [items.rows.map((i) => i.id), row.member_id],
    );
    await client.query('COMMIT');
    return outAt;
  });

  const photoId = await storePhoto(ctx, loanId, loanRow.ref, 'checkout', photo as PhotoUpload, captured as Date, checkedOutAt);
  if (photoId === null) {
    await ctx.route.db.withClient(async (client) => {
      await client.query('BEGIN');
      const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
      const status = locked.rows[0]?.status;
      if (status === 'out') {
        await client.query(`UPDATE loans SET status = 'reserved', due_date = NULL, fee_rules = NULL WHERE id = $1`, [loanId]);
        const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
        for (const item of items.rows) {
          await client.query(`UPDATE parts SET state = 'hung' WHERE item_id = $1 AND state = 'out'`, [item.id]);
          await client.query(`UPDATE items SET status = 'reserved' WHERE id = $1`, [item.id]);
        }
      }
      await client.query('COMMIT');
    });
    throw providerDown(COPY.storageDownCheckout);
  }

  const row = await loadLoanRow(ctx.route.db, loanId);
  sendJsonResponse(ctx.res, 200, { loan: await loanToApi(ctx.route.db, calendar, row!, new Date()) });
}

// POST /api/loans/<id>/hang
export async function hang(ctx: Ctx, idSegment: string): Promise<void> {
  // 401 (no session) precedes the unknown-id 404, which precedes the role 403.
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  const id = wholeId(idSegment);
  const loanRow = id === null ? null : await ctx.route.db.one<{ id: number; status: string }>('SELECT id, status FROM loans WHERE id = $1', [id]);
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  const loanId = loanRow.id;

  const body = await readJson<{ part_id?: unknown; peg_part_id?: unknown }>(ctx.req);
  const partId = isWholeId(body?.part_id) ? Number(body?.part_id) : null;
  const pegPartId = isWholeId(body?.peg_part_id) ? Number(body?.peg_part_id) : null;
  if (partId === null || pegPartId === null) throw notFound();

  const part = await ctx.route.db.one<{ id: number; item_id: number; name: string; state: string }>(
    'SELECT id, item_id, name, state FROM parts WHERE id = $1',
    [partId],
  );
  const pegPart = await ctx.route.db.one<{ id: number; item_id: number }>('SELECT id, item_id FROM parts WHERE id = $1', [pegPartId]);
  if (part === null || pegPart === null) throw notFound();
  const onLoan = await ctx.route.db.one<{ item_id: number }>('SELECT item_id FROM loan_items WHERE loan_id = $1 AND item_id = $2', [
    loanId,
    part.item_id,
  ]);
  if (onLoan === null) throw notFound();
  if (pegPart.item_id !== part.item_id) {
    // The one 422 whose error text is not the form-problems summary.
    throw new ApiError(422, COPY.wrongPeg, { peg_part_id: COPY.wrongPeg });
  }

  const completed = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (row.status === 'reserved') {
      await client.query('ROLLBACK');
      throw conflict(COPY.notCheckedOut);
    }
    if (row.status === 'pending-photo') {
      await client.query('ROLLBACK');
      throw conflict(COPY.waitingForPhoto);
    }
    const partRow = await client.query<{ state: string; name: string }>('SELECT state, name FROM parts WHERE id = $1 FOR UPDATE', [partId]);
    const fresh = partRow.rows[0];
    if (fresh === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (fresh.state === 'hung') {
      await client.query('ROLLBACK');
      throw conflict(COPY.alreadyOnPeg(fresh.name));
    }
    if (row.status === 'returned-complete') {
      await client.query('ROLLBACK');
      throw conflict(COPY.alreadyCheckedIn);
    }
    await client.query(`UPDATE parts SET state = 'hung' WHERE id = $1`, [partId]);
    let done = false;
    if (row.status === 'returned-partial') {
      const remaining = await client.query<{ n: string }>(
        `SELECT count(*)::text as n FROM parts p JOIN loan_items li ON li.item_id = p.item_id
         WHERE li.loan_id = $1 AND p.state IN ('missing','out')`,
        [loanId],
      );
      if (Number(remaining.rows[0]?.n ?? 1) === 0) {
        await client.query(`UPDATE loans SET status = 'returned-complete' WHERE id = $1`, [loanId]);
        done = true;
      }
    }
    await client.query('COMMIT');
    return done;
  });

  if (completed) await afterCompleteReturn(ctx, loanId);
  const row = await loadLoanRow(ctx.route.db, loanId);
  const calendar = await getCalendar(ctx.route.db);
  const loan = await loanToApi(ctx.route.db, calendar, row!, new Date());
  const counts = await readCounts(ctx.route.db);
  sendJsonResponse(ctx.res, 200, { loan, counts });
}

// DELETE /api/loans/<id>/hang/<part_id>
export async function takeDown(ctx: Ctx, idSegment: string, partSegment: string): Promise<void> {
  // 401 (no session) precedes the unknown-id 404, which precedes the role 403.
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  const id = wholeId(idSegment);
  const partId = wholeId(partSegment);
  if (id === null || partId === null) throw notFound();
  const loanRow = id === null ? null : await ctx.route.db.one<{ id: number; status: string }>('SELECT id, status FROM loans WHERE id = $1', [id]);
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  const loanId = loanRow.id;

  const part = await ctx.route.db.one<{ id: number; item_id: number; name: string }>('SELECT id, item_id, name FROM parts WHERE id = $1', [partId]);
  if (part === null) throw notFound();
  const onLoan = await ctx.route.db.one<{ item_id: number }>('SELECT item_id FROM loan_items WHERE loan_id = $1 AND item_id = $2', [
    loanId,
    part.item_id,
  ]);
  if (onLoan === null) throw notFound();

  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (row.status === 'reserved') {
      await client.query('ROLLBACK');
      throw conflict(COPY.notCheckedOut);
    }
    if (row.status === 'pending-photo') {
      await client.query('ROLLBACK');
      throw conflict(COPY.waitingForPhoto);
    }
    if (row.status !== 'out') {
      await client.query('ROLLBACK');
      throw conflict(COPY.alreadyCheckedIn);
    }
    const fresh = await client.query<{ state: string; name: string }>('SELECT state, name FROM parts WHERE id = $1 FOR UPDATE', [partId]);
    const state = fresh.rows[0]?.state;
    if (state !== 'hung') {
      await client.query('ROLLBACK');
      throw conflict(`${fresh.rows[0]?.name ?? 'That part'} is not on a peg.`);
    }
    await client.query(`UPDATE parts SET state = 'out' WHERE id = $1`, [partId]);
    await client.query('COMMIT');
  });
  const row = await loadLoanRow(ctx.route.db, loanId);
  const calendar = await getCalendar(ctx.route.db);
  const loan = await loanToApi(ctx.route.db, calendar, row!, new Date());
  const counts = await readCounts(ctx.route.db);
  sendJsonResponse(ctx.res, 200, { loan, counts });
}

// POST /api/loans/<id>/checkin
export async function checkin(ctx: Ctx, idSegment: string): Promise<void> {
  // 401 (no session) precedes the unknown-id 404, which precedes the role 403.
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  const id = wholeId(idSegment);
  const loanRow = id === null ? null : await ctx.route.db.one<{ id: number; ref: string; status: string }>('SELECT id, ref, status FROM loans WHERE id = $1', [id]);
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  const loanId = loanRow.id;

  const parts = await readMultipart(ctx.req);
  if (parts === null) throw validation({ grades: 'Grade every tool.' });
  const now = new Date();
  const gradesText = parts.get('grades')?.data.toString('utf8') ?? '';
  let grades: Record<string, string> | null = null;
  try {
    const parsed = JSON.parse(gradesText) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) grades = parsed as Record<string, string>;
  } catch {
    grades = null;
  }
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const loanItems = await ctx.route.db.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
  if (grades === null) {
    fields['grades'] = 'Grade every tool.';
    order.push('grades');
  } else {
    for (const item of loanItems) {
      const grade = grades[String(item.id)];
      if (grade !== 'good' && grade !== 'worn' && grade !== 'damaged') {
        fields['grades'] = 'Grade every tool.';
        order.push('grades');
        break;
      }
    }
  }
  const returnedText = parts.get('returned_at')?.data.toString('utf8') ?? '';
  let returnedInstant: Date | null = null;
  if (returnedText.trim() !== '') {
    const parsed = parseIsoInstant(returnedText.trim());
    if (parsed === null || parsed.getTime() > now.getTime()) {
      fields['returned_at'] = 'Use an ISO 8601 time in the past.';
      order.push('returned_at');
    } else {
      returnedInstant = parsed;
    }
  }
  const captured = validateCapturedAt(parts.get('captured_at')?.data.toString('utf8'), now);
  const photo = validatePhoto(parts.get('photo'));
  if (photo === 'too-large') throw new ApiError(413, COPY.photoTooLarge);
  if (captured === 'missing') {
    fields['captured_at'] = 'Send the photo capture time.';
    order.push('captured_at');
  } else if (captured === 'bad') {
    fields['captured_at'] = 'Send an ISO 8601 capture time not in the future.';
    order.push('captured_at');
  }
  if (photo === 'missing') {
    fields['photo'] = 'Choose a photo.';
    order.push('photo');
  } else if (photo === 'bad-type') {
    fields['photo'] = 'Choose a JPEG, PNG or WebP photo.';
    order.push('photo');
  }
  if (order.length > 0) throw reorderThrow(fields, order);

  const calendar = await getCalendar(ctx.route.db);
  const effectiveReturnInstant = returnedInstant ?? now;
  const loanDetails = await ctx.route.db.one<{ checked_out_at: Date | null }>('SELECT checked_out_at FROM loans WHERE id = $1', [loanId]);
  if (
    returnedInstant !== null &&
    loanDetails !== null &&
    loanDetails.checked_out_at !== null &&
    returnedInstant.getTime() < loanDetails.checked_out_at.getTime()
  ) {
    throw validation({ returned_at: 'The return time cannot be before the checkout time.' });
  }

  const precomputed = await computeCheckinFigures(ctx.route.db, loanId, calendar, effectiveReturnInstant, grades!);

  const decision = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string; ref: string; member_id: number }>(
      'SELECT status, ref, member_id FROM loans WHERE id = $1 FOR UPDATE',
      [loanId],
    );
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (row.status === 'reserved') {
      await client.query('ROLLBACK');
      throw conflict(COPY.notCheckedOut);
    }
    if (row.status === 'pending-photo') {
      await client.query('ROLLBACK');
      throw conflict(COPY.waitingForPhoto);
    }
    if (row.status === 'returned-partial' || row.status === 'returned-complete') {
      await client.query('ROLLBACK');
      throw conflict(COPY.alreadyCheckedIn);
    }
    const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1 ORDER BY item_id', [loanId]);
    const partsUnhung = await client.query<{ id: number }>(
      `SELECT p.id FROM parts p JOIN loan_items li ON li.item_id = p.item_id
       WHERE li.loan_id = $1 AND p.state = 'out' ORDER BY p.row, p.col`,
      [loanId],
    );
    const complete = partsUnhung.rows.length === 0;
    const status = complete ? 'returned-complete' : 'returned-partial';
    await client.query(`UPDATE loans SET status = $2, returned_at = $3, open_days_late = $4, late_fee_so_far_cents = $5 WHERE id = $1`, [
      loanId,
      status,
      effectiveReturnInstant,
      precomputed.openDaysLate,
      precomputed.lateFeeSoFar,
    ]);
    for (const item of items.rows) {
      const grade = grades![String(item.id)] ?? null;
      await client.query('UPDATE loan_items SET grade = $3 WHERE loan_id = $1 AND item_id = $2', [loanId, item.id, grade]);
    }
    for (const part of partsUnhung.rows) {
      await client.query(`UPDATE parts SET state = 'missing' WHERE id = $1`, [part.id]);
    }
    for (const item of items.rows) {
      await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [item.id, complete ? 'on-wall' : 'incomplete']);
    }
    await client.query('COMMIT');
    return { status, ref: row.ref, member_id: row.member_id };
  });

  const photoId = await storePhoto(ctx, loanId, decision.ref, 'checkin', photo as PhotoUpload, captured as Date, effectiveReturnInstant);
  if (photoId === null) {
    await ctx.route.db.withClient(async (client) => {
      await client.query('BEGIN');
      const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
      const row = locked.rows[0];
      if (row !== undefined && (row.status === 'returned-complete' || row.status === 'returned-partial')) {
        await client.query(`UPDATE loans SET status = 'pending-photo', open_days_late = $2, late_fee_so_far_cents = $3 WHERE id = $1`, [
          loanId,
          precomputed.openDaysLate,
          precomputed.lateFeeSoFar,
        ]);
        const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
        for (const item of items.rows) {
          await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [item.id, 'pending-photo']);
        }
        await client.query(`UPDATE parts SET state = 'out' WHERE state = 'missing' AND item_id = ANY($1::int[])`, [
          items.rows.map((i) => i.id),
        ]);
      }
      await client.query('COMMIT');
    });
    const row = await loadLoanRow(ctx.route.db, loanId);
    sendJsonResponse(ctx.res, 202, { loan: await loanToApi(ctx.route.db, calendar, row!, new Date()), fee: null });
    return;
  }

  const feeResult = await raiseFeeForCheckin(ctx, loanId, decision.member_id, precomputed.lines);
  if (feeResult === 'billing-down') {
    await deletePhotoRecord(ctx, photoId);
    await revertCheckin(ctx, loanId);
    throw providerDown(COPY.billingDownCheckin);
  }

  if (decision.status === 'returned-complete') await afterCompleteReturn(ctx, loanId);
  const row = await loadLoanRow(ctx.route.db, loanId);
  const loan = await loanToApi(ctx.route.db, calendar, row!, new Date());
  const fee = feeResult === null ? null : await feeView(ctx, feeResult.feeId);
  sendJsonResponse(ctx.res, 200, { loan, fee });
}

// POST /api/loans/<id>/finish
export async function finish(ctx: Ctx, idSegment: string): Promise<void> {
  // 401 (no session) precedes the unknown-id 404, which precedes the role 403.
  if (ctx.auth.user === null) throw ctx.auth.sessionEnded ? sessionEnded() : needsSignIn();
  const id = wholeId(idSegment);
  const loanRow = id === null ? null : await ctx.route.db.one<{ id: number; ref: string; status: string }>('SELECT id, ref, status FROM loans WHERE id = $1', [id]);
  if (loanRow === null) throw notFound();
  requireStaff(ctx);
  const loanId = loanRow.id;

  const parts = await readMultipart(ctx.req);
  if (parts === null) throw validation({ photo: 'Choose a photo.' });
  const now = new Date();
  const captured = validateCapturedAt(parts.get('captured_at')?.data.toString('utf8'), now);
  const photo = validatePhoto(parts.get('photo'));
  const fields: Record<string, string> = {};
  const order: string[] = [];
  if (captured === 'missing') {
    fields['captured_at'] = 'Send the photo capture time.';
    order.push('captured_at');
  } else if (captured === 'bad') {
    fields['captured_at'] = 'Send an ISO 8601 capture time not in the future.';
    order.push('captured_at');
  }
  if (photo === 'missing') {
    fields['photo'] = 'Choose a photo.';
    order.push('photo');
  } else if (photo === 'too-large') {
    throw new ApiError(413, COPY.photoTooLarge);
  } else if (photo === 'bad-type') {
    fields['photo'] = 'Choose a JPEG, PNG or WebP photo.';
    order.push('photo');
  }
  if (order.length > 0) throw reorderThrow(fields, order);

  const calendar = await getCalendar(ctx.route.db);
  const pending = await ctx.route.db.one<{
    status: string;
    ref: string;
    member_id: number;
    returned_at: Date | null;
    open_days_late: number | null;
    fee_rules: FeeRules | null;
  }>('SELECT status, ref, member_id, returned_at, open_days_late, fee_rules FROM loans WHERE id = $1', [loanId]);
  if (pending === null) throw notFound();
  if (pending.status !== 'pending-photo') throw conflict(COPY.notWaitingPhoto);

  const decision = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string; ref: string; member_id: number }>(
      'SELECT status, ref, member_id FROM loans WHERE id = $1 FOR UPDATE',
      [loanId],
    );
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (row.status !== 'pending-photo') {
      await client.query('ROLLBACK');
      throw conflict(COPY.notWaitingPhoto);
    }
    const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
    const unhung = await client.query<{ id: number }>(
      `SELECT p.id FROM parts p JOIN loan_items li ON li.item_id = p.item_id WHERE li.loan_id = $1 AND p.state = 'out'`,
      [loanId],
    );
    const complete = unhung.rows.length === 0;
    await client.query('UPDATE loans SET status = $2 WHERE id = $1', [loanId, complete ? 'returned-complete' : 'returned-partial']);
    for (const part of unhung.rows) {
      await client.query(`UPDATE parts SET state = 'missing' WHERE id = $1`, [part.id]);
    }
    for (const item of items.rows) {
      await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [item.id, complete ? 'on-wall' : 'incomplete']);
    }
    await client.query('COMMIT');
    return { status: complete ? 'returned-complete' : 'returned-partial', ref: row.ref, member_id: row.member_id };
  });

  const photoId = await storePhoto(ctx, loanId, decision.ref, 'checkin', photo as PhotoUpload, captured as Date, pending.returned_at ?? now);
  if (photoId === null) {
    await revertFinish(ctx, loanId);
    throw providerDown(COPY.storageDownFinish);
  }

  const lines = await finishFeeLines(ctx, loanId, pending);
  const feeResult = await raiseFeeForCheckin(ctx, loanId, decision.member_id, lines);
  if (feeResult === 'billing-down') {
    await deletePhotoRecord(ctx, photoId);
    await revertFinish(ctx, loanId);
    throw providerDown(COPY.billingDownCheckin);
  }

  if (decision.status === 'returned-complete') await afterCompleteReturn(ctx, loanId);
  const row = await loadLoanRow(ctx.route.db, loanId);
  const loan = await loanToApi(ctx.route.db, calendar, row!, new Date());
  const fee = feeResult === null ? null : await feeView(ctx, feeResult.feeId);
  sendJsonResponse(ctx.res, 200, { loan, fee });
}

// -- helpers ---------------------------------------------------------------

/** Fee lines for a finished pending-photo loan: the grades and days recorded at its check-in. */
async function finishFeeLines(
  ctx: Ctx,
  loanId: number,
  pending: { open_days_late: number | null; fee_rules: FeeRules | null },
): Promise<FeeLine[]> {
  const items = await ctx.route.db.query<{ id: number; tag: string; name: string; grade: string | null }>(
    `SELECT i.id, i.tag, i.name, li.grade FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY i.id`,
    [loanId],
  );
  return computeFeeLines({
    fee_rules: pending.fee_rules,
    items: items.map((i) => ({ id: i.id, tag: i.tag, name: i.name, grade: i.grade })),
    open_days_late: pending.open_days_late ?? 0,
  });
}

async function computeCheckinFigures(
  db: RouteContext['db'],
  loanId: number,
  calendar: Awaited<ReturnType<typeof getCalendar>>,
  returnedAt: Date,
  grades: Record<string, string>,
): Promise<{ openDaysLate: number; lateFeeSoFar: number; lines: FeeLine[] }> {
  const loan = await loadLoanRow(db, loanId);
  const effective = effectiveReturnDay(calendar, returnedAt);
  const dueDate = loan?.due_date ?? null;
  const days = dueDate === null ? 0 : openDaysLate(calendar, dueDate, effective);
  const items = await db.query<{ id: number; tag: string; name: string }>(
    `SELECT i.id, i.tag, i.name FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY i.id`,
    [loanId],
  );
  const rules = loan?.fee_rules ?? null;
  const lateFeeSoFar = items.reduce((sum, item) => {
    const cost = rules?.replacement_costs_cents[String(item.id)] ?? 0;
    return sum + Math.min((rules?.late_fee_cents ?? 0) * days, cost);
  }, 0);
  const lines = computeFeeLines({
    fee_rules: rules,
    items: items.map((i) => ({ id: i.id, tag: i.tag, name: i.name, grade: grades[String(i.id)] ?? null })),
    open_days_late: days,
  });
  return { openDaysLate: days, lateFeeSoFar, lines };
}

async function storePhoto(
  ctx: Ctx,
  loanId: number,
  ref: string,
  event: 'checkout' | 'checkin',
  photo: PhotoUpload,
  capturedAt: Date,
  receivedAt: Date,
): Promise<number | null> {
  const sha256 = createHash('sha256').update(photo.bytes).digest('hex');
  const existing = await ctx.route.db.one<{ id: number }>('SELECT id FROM photos WHERE loan_id = $1 AND event = $2', [loanId, event]);
  if (existing !== null) return existing.id;
  const key = `loans/${ref}/${event}`;
  try {
    await ctx.route.storage.put(key, photo.bytes, photo.contentType, { 'captured-at': capturedAt.toISOString() });
  } catch {
    return null;
  }
  const inserted = await ctx.route.db.query<{ id: number }>(
    `INSERT INTO photos (loan_id, event, content_type, byte_size, sha256, captured_at, received_at, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [loanId, event, photo.contentType, photo.bytes.length, sha256, capturedAt, receivedAt, key],
  );
  return inserted[0]?.id ?? null;
}

async function deletePhotoRecord(ctx: Ctx, photoId: number): Promise<void> {
  await ctx.route.db.exec('DELETE FROM photos WHERE id = $1', [photoId]);
}

async function revertCheckin(ctx: Ctx, loanId: number): Promise<void> {
  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
    const row = locked.rows[0];
    if (row !== undefined && (row.status === 'returned-complete' || row.status === 'returned-partial')) {
      await client.query(
        `UPDATE loans SET status = 'out', returned_at = NULL, open_days_late = NULL, late_fee_so_far_cents = NULL WHERE id = $1`,
        [loanId],
      );
      const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
      for (const item of items.rows) {
        await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [item.id, 'out']);
      }
      await client.query(`UPDATE parts SET state = 'out' WHERE state = 'missing' AND item_id = ANY($1::int[])`, [
        items.rows.map((i) => i.id),
      ]);
      await client.query('UPDATE loan_items SET grade = NULL WHERE loan_id = $1', [loanId]);
    }
    await client.query('COMMIT');
  });
}

async function revertFinish(ctx: Ctx, loanId: number): Promise<void> {
  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [loanId]);
    const row = locked.rows[0];
    if (row !== undefined && (row.status === 'returned-complete' || row.status === 'returned-partial')) {
      await client.query(`UPDATE loans SET status = 'pending-photo' WHERE id = $1`, [loanId]);
      const items = await client.query<{ id: number }>('SELECT item_id as id FROM loan_items WHERE loan_id = $1', [loanId]);
      for (const item of items.rows) {
        await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [item.id, 'pending-photo']);
      }
      await client.query(`UPDATE parts SET state = 'out' WHERE state = 'missing' AND item_id = ANY($1::int[])`, [
        items.rows.map((i) => i.id),
      ]);
    }
    await client.query('COMMIT');
  });
}

interface FeeRaiseResult {
  feeId: number;
}

async function raiseFeeForCheckin(
  ctx: Ctx,
  loanId: number,
  memberId: number,
  lines: FeeLine[],
): Promise<FeeRaiseResult | null | 'billing-down'> {
  if (lines.length === 0) return null;
  const total = feeTotal(lines);
  const membership = await ctx.route.db.one<{ killbill_account_id: string | null }>(
    'SELECT killbill_account_id FROM memberships WHERE user_id = $1',
    [memberId],
  );
  if (membership === null || membership.killbill_account_id === null) return 'billing-down';
  try {
    const existing = await ctx.route.db.one<{ id: number }>('SELECT id FROM fees WHERE loan_id = $1', [loanId]);
    if (existing !== null) return { feeId: existing.id };
    const invoice = await ctx.route.killbill.createChargeInvoice(
      membership.killbill_account_id,
      lines.map((line) => ({ amountCents: line.amount_cents, description: line.description })),
    );
    const inserted = await ctx.route.db.query<{ id: number }>(
      `INSERT INTO fees (loan_id, member_id, status, total_cents, lines, killbill_invoice_id, killbill_invoice_number)
       VALUES ($1, $2, 'raised', $3, $4, $5, $6) RETURNING id`,
      [loanId, memberId, total, JSON.stringify(lines), invoice.invoiceId, invoice.invoiceNumber],
    );
    const feeId = inserted[0]!.id;
    await enqueueReceipt(ctx, feeId);
    return { feeId };
  } catch (err) {
    if (err instanceof KillBillDown) return 'billing-down';
    throw err;
  }
}

async function enqueueReceipt(ctx: Ctx, feeId: number): Promise<void> {
  const claimed = await ctx.route.db.query<{ fee_id: number }>(
    'INSERT INTO fee_notices (fee_id) VALUES ($1) ON CONFLICT (fee_id) DO NOTHING RETURNING fee_id',
    [feeId],
  );
  if (claimed.length === 0) return;
  const fee = await loadFeeRow(ctx.route.db, feeId);
  if (fee === null) return;
  const member = await ctx.route.db.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [fee.member_id]);
  if (member === null) return;
  const total = formatMoney(fee.total_cents);
  const linesText = fee.lines.map((line) => `${line.description}: ${formatMoney(line.amount_cents)}`).join('\n');
  const body = [
    `Pegworth fees for loan ${fee.loan_ref}: ${total}`,
    ``,
    linesText,
    ``,
    `Total: ${total}`,
    `Kill Bill invoice number: ${fee.killbill_invoice_id ?? ''}`,
    `View the fee: ${ctx.route.config.publicUrl}/fees/${fee.id}`,
  ].join('\n');
  await ctx.route.mailer.enqueue(member.email, `Pegworth fees for loan ${fee.loan_ref}: ${total}`, body);
}

export function formatMoney(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rem = Math.abs(cents) % 100;
  return `${cents < 0 ? '-' : ''}$${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

async function afterCompleteReturn(ctx: Ctx, loanId: number): Promise<void> {
  const itemIds = await ctx.route.db.query<{ item_id: number }>('SELECT item_id FROM loan_items WHERE loan_id = $1', [loanId]);
  for (const row of itemIds) {
    const status = await recomputeItemStatus(ctx.route.db, row.item_id);
    await ctx.route.db.exec('UPDATE items SET status = $2 WHERE id = $1', [row.item_id, status]);
    if (status === 'on-wall') await promoteNextHold(ctx.route, row.item_id);
  }
}

async function readCounts(db: RouteContext['db']): Promise<{ on_wall: number; out: number; missing: number }> {
  const rows = await db.query<{ state: string; n: string }>('SELECT state, count(*)::text as n FROM parts GROUP BY state');
  let onWall = 0;
  let out = 0;
  let missing = 0;
  for (const row of rows) {
    if (row.state === 'hung') onWall = Number(row.n);
    if (row.state === 'out') out = Number(row.n);
    if (row.state === 'missing') missing = Number(row.n);
  }
  return { on_wall: onWall, out, missing };
}

async function serializeLoans(ctx: Ctx, ids: { id: number }[]): Promise<Loan[]> {
  const calendar = await getCalendar(ctx.route.db);
  const now = new Date();
  const out: Loan[] = [];
  for (const { id } of ids) {
    const row = await loadLoanRow(ctx.route.db, id);
    if (row !== null) out.push(await loanToApi(ctx.route.db, calendar, row, now));
  }
  return out;
}

async function loanIdRows(db: RouteContext['db'], filters: { memberId?: number; status?: string }): Promise<{ id: number }[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.memberId !== undefined) {
    params.push(filters.memberId);
    conditions.push(`l.member_id = $${params.length}`);
  }
  if (filters.status !== undefined) {
    params.push(filters.status);
    conditions.push(`l.status = $${params.length}`);
  }
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  return db.query(`SELECT l.id FROM loans l ${where} ORDER BY l.id`);
}

async function feeView(ctx: Ctx, feeId: number): Promise<unknown> {
  const fee = await loadFeeRow(ctx.route.db, feeId);
  const calendar = await getCalendar(ctx.route.db);
  return feeToApi(ctx.route.db, calendar, fee!);
}

function wholeId(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d+$/.test(segment)) return null;
  const n = Number(segment);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

function isWholeId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function reorderThrow(fields: Record<string, string>, order: string[]): never {
  const out: Record<string, string> = {};
  for (const key of order) out[key] = fields[key]!;
  throw validation(out);
}
