// Routes: fees, pay, waiver requests and decisions.

import { Ctx, requireCoordinator, requireMember, requireUser, RouteContext } from './context';
import { sendJsonResponse } from '../http';
import { ApiError, COPY, conflict, notFound, providerDown, validation } from '../errors';
import { readJson } from '../body';
import { KillBillDown } from '../killbill';
import { getCalendar } from '../domain';
import { loadFeeRow, feeToApi } from '../serialize';
import type { Photo } from '../../shared/api';

// GET /api/fees
export async function getFees(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const statusFilter = ctx.query.get('status');
  if (user.role === 'member') {
    const rows = await ctx.route.db.query<{ id: number }>(
      'SELECT id FROM fees WHERE member_id = $1 ORDER BY id',
      [user.id],
    );
    const fees = await feeList(ctx, rows);
    sendJsonResponse(ctx.res, 200, { fees });
    return;
  }
  let rows: { id: number }[];
  if (statusFilter !== null && statusFilter !== '') {
    if (!['raised', 'settled', 'waived-by-coordinator'].includes(statusFilter)) throw notFound();
    rows = await ctx.route.db.query('SELECT id FROM fees WHERE status = $1 ORDER BY id', [statusFilter]);
  } else {
    rows = await ctx.route.db.query('SELECT id FROM fees ORDER BY id');
  }
  const fees = await feeList(ctx, rows);
  sendJsonResponse(ctx.res, 200, { fees });
}

// GET /api/fees/<id>
export async function getFee(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireUser(ctx);
  const id = wholeId(idSegment);
  if (id === null) throw notFound();
  const row = await loadFeeRow(ctx.route.db, id);
  if (row === null) throw notFound();
  if (user.role === 'member' && row.member_id !== user.id) throw notFound();
  const calendar = await getCalendar(ctx.route.db);
  const fee = await feeToApi(ctx.route.db, calendar, row);
  const photos = await loanPhotos(ctx.route.db, row.loan_id);
  sendJsonResponse(ctx.res, 200, { fee, photos });
}

// POST /api/fees/<id>/pay
export async function payFee(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireMember(ctx);
  const id = wholeId(idSegment);
  if (id === null) throw notFound();
  const row = await loadFeeRow(ctx.route.db, id);
  if (row === null || row.member_id !== user.id) throw notFound();
  if (row.status === 'settled') throw conflict(COPY.feeSettled);
  if (row.status === 'waived-by-coordinator') throw conflict(COPY.feeWaived);

  if (row.killbill_invoice_id === null) throw notFound();
  const membership = await ctx.route.db.one<{ killbill_account_id: string | null }>(
    'SELECT killbill_account_id FROM memberships WHERE user_id = $1',
    [user.id],
  );
  if (membership === null || membership.killbill_account_id === null) throw providerDown(COPY.billingDownJoin);
  try {
    const invoice = await ctx.route.killbill.getInvoice(row.killbill_invoice_id);
    if (invoice.balance <= 0.001) {
      await markSettled(ctx.route.db, id);
    } else {
      await ctx.route.killbill.recordPayment(
        membership.killbill_account_id,
        row.killbill_invoice_id,
        Math.round(invoice.balance * 100),
        `pegworth-fee-${row.killbill_invoice_id}`,
      );
      // The invoice payment posts asynchronously; wait briefly for the balance to clear.
      const cleared = await waitInvoiceCleared(ctx.route.killbill, row.killbill_invoice_id);
      if (!cleared) {
        throw providerDown(COPY.billingDownJoin);
      }
      await markSettled(ctx.route.db, id);
    }
  } catch (err) {
    if (err instanceof KillBillDown) throw providerDown(COPY.billingDownJoin);
    if (err instanceof ApiError) throw err;
    throw err;
  }
  const settled = await loadFeeRow(ctx.route.db, id);
  const calendar = await getCalendar(ctx.route.db);
  sendJsonResponse(ctx.res, 200, { fee: await feeToApi(ctx.route.db, calendar, settled!) });
}

// POST /api/fees/<id>/waiver-request
export async function waiverRequest(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireMember(ctx);
  const id = wholeId(idSegment);
  if (id === null) throw notFound();
  const row = await loadFeeRow(ctx.route.db, id);
  if (row === null || row.member_id !== user.id) throw notFound();
  if (row.status === 'settled') throw conflict(COPY.feeSettled);
  if (row.status === 'waived-by-coordinator') throw conflict(COPY.feeWaived);
  const body = await readJson<{ reason?: unknown }>(ctx.req);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1 || reason.length > 500) throw validation({ reason: 'Enter a reason up to 500 characters.' });
  const existing = await ctx.route.db.one<{ status: string }>('SELECT status FROM waivers WHERE fee_id = $1', [id]);
  if (existing !== null && existing.status === 'requested') throw conflict(COPY.waiverWaiting);
  if (existing === null) {
    await ctx.route.db.exec('INSERT INTO waivers (fee_id, status, reason) VALUES ($1, \'requested\', $2)', [id, reason]);
  } else {
    await ctx.route.db.exec('UPDATE waivers SET status = \'requested\', reason = $2, requested_at = now(), decided_at = NULL WHERE fee_id = $1', [id, reason]);
  }
  const fresh = await loadFeeRow(ctx.route.db, id);
  const calendar = await getCalendar(ctx.route.db);
  sendJsonResponse(ctx.res, 201, { fee: await feeToApi(ctx.route.db, calendar, fresh!) });
}

// POST /api/fees/<id>/waiver-decision
export async function waiverDecision(ctx: Ctx, idSegment: string): Promise<void> {
  requireCoordinator(ctx);
  const id = wholeId(idSegment);
  if (id === null) throw notFound();
  const row = await loadFeeRow(ctx.route.db, id);
  if (row === null) throw notFound();
  if (row.status === 'settled') throw conflict(COPY.feeSettled);
  if (row.status === 'waived-by-coordinator') throw conflict(COPY.feeWaived);
  const body = await readJson<{ decision?: unknown }>(ctx.req);
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'decline') throw validation({ decision: 'Choose approve or decline.' });
  const waiver = await ctx.route.db.one<{ status: string }>('SELECT status FROM waivers WHERE fee_id = $1', [id]);
  if (waiver === null || waiver.status !== 'requested') throw conflict(COPY.noWaiver);

  if (decision === 'decline') {
    await ctx.route.db.exec('UPDATE waivers SET status = \'declined\', decided_at = now() WHERE fee_id = $1', [id]);
    const fresh = await loadFeeRow(ctx.route.db, id);
    const calendar = await getCalendar(ctx.route.db);
    sendJsonResponse(ctx.res, 200, { fee: await feeToApi(ctx.route.db, calendar, fresh!) });
    return;
  }

  if (row.killbill_invoice_id === null) throw notFound();
  const membership = await ctx.route.db.one<{ killbill_account_id: string | null }>(
    'SELECT killbill_account_id FROM memberships WHERE user_id = $1',
    [row.member_id],
  );
  if (membership === null || membership.killbill_account_id === null) throw providerDown(COPY.billingDownJoin);
  const description = `Waiver for fee ${id}`;
  try {
    const existingCredit = await ctx.route.killbill.findCreditItem(membership.killbill_account_id, description);
    if (existingCredit === null) {
      await ctx.route.killbill.postCredit(membership.killbill_account_id, row.total_cents, description);
    }
    const invoice = await ctx.route.killbill.getInvoice(row.killbill_invoice_id);
    if (invoice.balance > 0.001) throw providerDown(COPY.billingDownJoin);
    await ctx.route.db.withClient(async (client) => {
      await client.query('BEGIN');
      await client.query(`UPDATE fees SET status = 'waived-by-coordinator' WHERE id = $1`, [id]);
      await client.query(`UPDATE waivers SET status = 'approved', decided_at = now() WHERE fee_id = $1`, [id]);
      await client.query('COMMIT');
    });
  } catch (err) {
    if (err instanceof KillBillDown) throw providerDown(COPY.billingDownJoin);
    if (err instanceof ApiError) throw err;
    throw err;
  }
  const fresh = await loadFeeRow(ctx.route.db, id);
  const calendar = await getCalendar(ctx.route.db);
  sendJsonResponse(ctx.res, 200, { fee: await feeToApi(ctx.route.db, calendar, fresh!) });
}

// GET /api/photos/<id>
export async function getPhoto(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireUser(ctx);
  const id = wholeId(idSegment);
  if (id === null) throw notFound();
  const photo = await ctx.route.db.one<{ id: number; loan_id: number; event: string; content_type: string; storage_key: string }>(
    'SELECT id, loan_id, event, content_type, storage_key FROM photos WHERE id = $1',
    [id],
  );
  if (photo === null) throw notFound();
  const loan = await ctx.route.db.one<{ member_id: number }>('SELECT member_id FROM loans WHERE id = $1', [photo.loan_id]);
  if (loan === null) throw notFound();
  if (user.role === 'member' && loan.member_id !== user.id) throw notFound();
  try {
    const object = await ctx.route.storage.get(photo.storage_key);
    const payload = object.body;
    ctx.res.writeHead(200, {
      'Content-Type': photo.content_type,
      'Content-Length': String(payload.length),
      'Cache-Control': 'private, no-store',
    });
    ctx.res.end(payload);
  } catch {
    throw providerDown(COPY.storageDownPhoto);
  }
}

async function markSettled(db: RouteContext['db'], feeId: number): Promise<void> {
  await db.exec(`UPDATE fees SET status = 'settled' WHERE id = $1`, [feeId]);
}

/** Wait for the invoice balance to read zero, or give up after a short while. */
async function waitInvoiceCleared(killbill: Ctx['route']['killbill'], invoiceId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const invoice = await killbill.getInvoice(invoiceId);
    if (invoice.balance <= 0.001) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function feeList(ctx: Ctx, rows: { id: number }[]): Promise<unknown[]> {
  const calendar = await getCalendar(ctx.route.db);
  const out: unknown[] = [];
  for (const row of rows) {
    const fee = await loadFeeRow(ctx.route.db, row.id);
    if (fee !== null) out.push(await feeToApi(ctx.route.db, calendar, fee));
  }
  return out;
}

async function loanPhotos(db: RouteContext['db'], loanId: number): Promise<Photo[]> {
  const rows = await db.query<{ id: number; event: string; content_type: string; byte_size: number; sha256: string; captured_at: Date; received_at: Date }>(
    'SELECT id, event, content_type, byte_size, sha256, captured_at, received_at FROM photos WHERE loan_id = $1 ORDER BY id',
    [loanId],
  );
  const checkout = rows.find((r) => r.event === 'checkout');
  const checkin = rows.find((r) => r.event === 'checkin');
  const out: Photo[] = [];
  if (checkout !== undefined) out.push(toPhoto(checkout));
  if (checkin !== undefined) out.push(toPhoto(checkin));
  return out;
}

function toPhoto(row: { id: number; event: string; content_type: string; byte_size: number; sha256: string; captured_at: Date; received_at: Date }): Photo {
  return {
    id: row.id,
    event: row.event as 'checkout' | 'checkin',
    content_type: row.content_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    captured_at: row.captured_at.toISOString(),
    received_at: row.received_at.toISOString(),
    url: `/api/photos/${row.id}`,
  };
}

function wholeId(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d+$/.test(segment)) return null;
  const n = Number(segment);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}
