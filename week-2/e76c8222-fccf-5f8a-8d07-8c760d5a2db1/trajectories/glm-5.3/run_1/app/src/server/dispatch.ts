import pg from 'pg';
import { config } from './config.js';
import { withTransaction } from './db.js';
import { newId, newToken } from './seed.js';
import { apiError } from './api-error.js';
import {
  evaluateGatesForSeat, loadRequestRow, loadSeatRows, requestFullView,
  renderRequest, loadQuote, writeAudit, getRates, loadPrepFiles, durationMinutesOf,
  expireOverdueOffersForSeat,
  type RequestRow, type SeatRow,
} from './store.js';
import {
  billedHours, offerExpiryMs, chargeKeyForTimesheet, chargeKeyForCancellation,
  EXPIRY_WARNING_DAYS, credentialStatus,
} from './rules.js';
import { queueEmail } from './services/outbox.js';
import * as kb from './services/killbill.js';
import { buildTimesheetPdf } from './services/pdf.js';
import { putObject } from './services/s3.js';
import { centsToMoney, moneyToCents, roundHalfUpCents } from './money.js';
import { AGENCY_TZ, MS_PER_MINUTE, dateKeyInAgencyTz, isoWithOffset, parseInstant, parseNominalDate } from './time.js';
import type { Quote, RequestStatus, RequestView, SessionUser } from './types.js';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);
const nullable = (v: unknown): string | null => (v === null ? null : String(v));

function agencyText(d: Date): string {
  const date = dateKeyInAgencyTz(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: AGENCY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

function agencyDate(d: Date): string {
  return dateKeyInAgencyTz(d);
}

// ---------- idempotency ----------

export type IdemScope = 'cancel' | 'timesheet_submit' | 'timesheet_approve';

export function validIdempotencyKey(key: string | undefined): boolean {
  return key !== undefined && /^[\x20-\x7E]{1,128}$/.test(key);
}

// Runs the action once per key. Only a success is stored; failures leave the key free.
export async function idempotentRun(
  poolClient: pg.PoolClient, key: string, scope: IdemScope, bodyJson: string,
  run: () => Promise<{ status: number; body: string }>,
): Promise<{ status: number; body: string; idempotentReplay: boolean }> {
  await poolClient.query('SELECT pg_advisory_xact_lock(hashtext($1 || $2))', [scope, key]);
  const stored = await poolClient.query<Row>(
    'SELECT status, response_body, body FROM idempotency WHERE scope = $1 AND key = $2',
    [scope, key],
  );
  if (stored.rows.length > 0) {
    const row = stored.rows[0]!;
    if (str(row.body) !== bodyJson) throw apiError('idempotency_conflict');
    return { status: num(row.status), body: str(row.response_body), idempotentReplay: true };
  }
  const outcome = await run();
  await poolClient.query(
    'INSERT INTO idempotency (key, scope, status, body, response_body, created_at) VALUES ($1,$2,$3,$4,$5,now())',
    [key, scope, outcome.status, bodyJson, outcome.body],
  );
  return { status: outcome.status, body: outcome.body, idempotentReplay: false };
}

// ---------- pin (offer creation) ----------

export async function pinSeat(
  coordinator: SessionUser, seatId: string, interpreterId: string,
): Promise<{ offerId: string; seat: SeatRow; request: RequestView }> {
  return withTransaction(async (client) => {
    // Serialize pins per interpreter so racing pins re-run the gates against
    // each other's committed offers (DP-12).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`interp-assignments:${interpreterId}`]);
    await expireOverdueOffersForSeat(client, seatId);
    const seat = await seatForUpdate(client, seatId);
    const r = await loadRequestRow(client, seat.request_id);

    if (seat.status !== 'open') {
      throw apiError('seat_taken', { holder: { id: seat.held_by_id!, name: seat.held_by_name! } });
    }
    if (r.status !== 'submitted' && r.status !== 'partially_staffed') {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }

    const interp = await client.query<Row>(
      'SELECT i.id, i.name, u.email FROM interpreters i JOIN users u ON u.id = i.user_id WHERE i.id = $1',
      [interpreterId],
    );
    if (interp.rows.length === 0) throw apiError('not_found');
    const interpreter = interp.rows[0]!;

    const nowMs = Date.now();
    const expiresMs = offerExpiryMs(nowMs, r.logged_after ? null : r.start_ms);
    if (expiresMs <= nowMs) throw apiError('offer_window_closed');

    const gates = await evaluateGatesForSeat(client, seat, interpreterId);
    const failing = gates.find((g) => !g.pass);
    if (failing) throw apiError('gate_failed', { gate: failing.gate, gates });

    const offerId = newId('off');
    const token = newToken();
    const expiresAt = new Date(expiresMs);
    const outboxId = await queueEmail({
      to: str(interpreter.email),
      subject: `Offer for ${r.ref} on ${agencyDate(new Date(r.start_ms))}`,
      text: [
        `Offer for ${r.ref} on ${agencyDate(new Date(r.start_ms))}`,
        '',
        `Setting: ${r.setting}`,
        `Times: ${agencyText(new Date(r.start_ms))} to ${agencyText(new Date(r.end_ms))}`,
        `Location: ${r.location}`,
        `This offer expires at ${agencyText(expiresAt)}.`,
        '',
        `Answer it here: ${config.publicUrl}/offers/${token}`,
      ].join('\n'),
    });
    await client.query(
      `INSERT INTO offers (id, seat_id, interpreter_id, coordinator_user_id, status, token, sent_at, expires_at, email_state, outbox_id)
       VALUES ($1,$2,$3,$4,'active',$5,now(),$6,'queued',$7)`,
      [offerId, seatId, interpreterId, coordinator.id, token, expiresAt, outboxId],
    );
    await client.query(
      `UPDATE seats SET status = 'offered', interpreter_id = $1, held_by_user_id = $2 WHERE id = $3`,
      [interpreterId, coordinator.id, seatId],
    );
    await writeAudit(client, {
      actorUserId: coordinator.id, action: 'seat.offered', entity: 'seat', entityId: seatId,
      from: 'open', to: 'offered', detail: { offer_id: offerId, interpreter_id: interpreterId },
    });

    const seats = await loadSeatRows(client, r.id);
    const rates = await getRates(client);
    const prep = await loadPrepFiles(client, r.id);
    return {
      offerId,
      seat: seats.find((s) => s.id === seatId)!,
      request: renderRequest(r, seats, prep, rates, Date.now()),
    };
  });
}

async function seatForUpdate(client: pg.PoolClient, seatId: string): Promise<SeatRow> {
  const res = await client.query<Row>(
    `SELECT s.id, s.request_id, s.position, s.status, s.interpreter_id, i.name AS interpreter_name,
            s.held_by_user_id, hb.name AS held_by_name
     FROM seats s
     LEFT JOIN interpreters i ON i.id = s.interpreter_id
     LEFT JOIN users hb ON hb.id = s.held_by_user_id
     WHERE s.id = $1 FOR UPDATE OF s`,
    [seatId],
  );
  const row = res.rows[0];
  if (!row) throw apiError('not_found');
  return {
    id: str(row.id), request_id: str(row.request_id), position: num(row.position), status: str(row.status),
    interpreter_id: nullable(row.interpreter_id), interpreter_name: nullable(row.interpreter_name),
    held_by_id: nullable(row.held_by_user_id), held_by_name: nullable(row.held_by_name),
    offer_id: null, offer_status: null, offer_sent_ms: null, offer_expires_ms: null, offer_email_sent: false,
    ts_id: null, ts_status: null, ts_billed_hours: null, ts_amount_cents: null,
  };
}

// ---------- offer answers ----------

export async function answerOffer(
  token: string, answer: 'accept' | 'decline',
): Promise<{ offerStatus: string; requestRef: string; requestStatus: string }> {
  return withTransaction(async (client) => {
    // Answering also serializes per interpreter, so a pin racing with an accept
    // can never end with overlapping assignments for the same interpreter.
    const claimed = await client.query<Row>(
      `SELECT o.id, o.seat_id, o.status, o.expires_at, o.interpreter_id, s.request_id
       FROM offers o JOIN seats s ON s.id = o.seat_id
       WHERE o.token = $1 FOR UPDATE OF o`,
      [token],
    );
    const offer = claimed.rows[0];
    if (!offer) throw apiError('not_found');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`interp-assignments:${str(offer.interpreter_id)}`]);
    if (offer.status !== 'active') {
      const status = str(offer.status);
      throw apiError('offer_closed', { offer_status: status as 'accepted' | 'declined' | 'expired' | 'withdrawn' }, { status });
    }
    if (new Date(offer.expires_at as string).getTime() <= Date.now()) {
      await client.query(`UPDATE offers SET status = 'expired' WHERE id = $1`, [str(offer.id)]);
      throw apiError('offer_closed', { offer_status: 'expired' });
    }
    const r = await loadRequestRow(client, str(offer.request_id));
    if (r.status.startsWith('cancelled')) {
      await client.query(`UPDATE offers SET status = 'withdrawn' WHERE id = $1`, [str(offer.id)]);
      throw apiError('offer_closed', { offer_status: 'withdrawn' });
    }

    const finalStatus = answer === 'accept' ? 'accepted' : 'declined';
    await client.query('UPDATE offers SET status = $1 WHERE id = $2', [finalStatus, str(offer.id)]);
    if (answer === 'accept') {
      await client.query(
        `UPDATE seats SET status = 'accepted' WHERE id = $1`,
        [str(offer.seat_id)],
      );
    } else {
      await client.query(
        `UPDATE seats SET status = 'open', interpreter_id = NULL, held_by_user_id = NULL WHERE id = $1`,
        [str(offer.seat_id)],
      );
    }
    await writeAudit(client, {
      actorUserId: null,
      action: answer === 'accept' ? 'offer.accepted' : 'offer.declined',
      entity: 'offer', entityId: str(offer.id),
      from: 'active', to: finalStatus,
      detail: { interpreter_id: str(offer.interpreter_id) },
    });

    let newStatus = r.status;
    if (answer === 'accept') {
      const seats = await loadSeatRows(client, r.id);
      const accepted = seats.filter((s) => s.status === 'accepted').length;
      newStatus = accepted === seats.length ? 'staffed' : 'partially_staffed';
      if (newStatus !== r.status) {
        await client.query('UPDATE requests SET status = $1, updated_at = now() WHERE id = $2', [newStatus, r.id]);
        await writeAudit(client, {
          actorUserId: null, action: 'request.status_changed', entity: 'request', entityId: r.id,
          from: r.status, to: newStatus,
        });
      }
      if (newStatus === 'staffed') {
        await queueStaffedEmails(client, r);
      }
    }
    return { offerStatus: finalStatus, requestRef: r.ref, requestStatus: newStatus };
  });
}

async function queueStaffedEmails(client: pg.PoolClient, r: RequestRow): Promise<void> {
  const requesters = await client.query<Row>(
    `SELECT email FROM users WHERE org_id = $1 AND role = 'requester'`,
    [r.org_id],
  );
  const seats = await loadSeatRows(client, r.id);
  const names = seats.filter((s) => s.status === 'accepted').map((s) => s.interpreter_name).join(', ');
  for (const u of requesters.rows) {
    await queueEmail({
      to: str(u.email),
      subject: `Staffed: ${r.ref} on ${agencyDate(new Date(r.start_ms))}`,
      text: [
        `Staffed: ${r.ref} on ${agencyDate(new Date(r.start_ms))}`,
        '',
        `Interpreters: ${names}`,
        `Location: ${r.location}`,
      ].join('\n'),
    });
  }
}

// ---------- cancellation ----------

export async function cancelRequest(
  user: SessionUser, requestId: string, expectedFee: string, reason: string, idemKey: string,
): Promise<{ status: number; body: string; idempotentReplay: boolean }> {
  const bodyJson = JSON.stringify({ expected_fee: expectedFee, reason });
  return withTransaction(async (client) => {
    return await idempotentRun(client, idemKey, 'cancel', bodyJson, async () => ({
      status: 200,
      body: await performCancel(client, user, requestId, expectedFee, reason),
    }));
  });
}

async function performCancel(
  client: pg.PoolClient, user: SessionUser, requestId: string, expectedFee: string, reason: string,
): Promise<string> {
  const r = await loadRequestRow(client, requestId);
  const seats = await loadSeatRows(client, requestId);
  const rates = await getRates(client);

  if (['completed', 'invoiced'].includes(r.status) || r.status.startsWith('cancelled')) {
    throw apiError('invalid_transition', { from: r.status }, { from: r.status });
  }
  if (r.status !== 'draft' && Date.now() > r.start_ms) {
    throw apiError('already_started');
  }

  const quote = await loadQuote(client, r, seats, rates);
  let effectiveQuote: Quote = quote;
  let adoptedCharge = false;

  // Reconciliation: adopt an earlier uncertain charge, only when this cancel could carry one.
  const chargeKey = chargeKeyForCancellation(requestId);
  if (quote.late && moneyToCents(quote.fee)! > 0) {
    const accountId = await billingAccount(client, r.org_id);
    let existing: kb.ExistingCharge | null;
    try {
      existing = await kb.findChargeByKey(accountId, chargeKey);
    } catch (err) {
      if (err instanceof kb.KillBillError && err.kind === 'unavailable') throw apiError('billing_unavailable');
      throw err;
    }
    if (existing) {
      effectiveQuote = quoteFromKbItem(existing, r);
      adoptedCharge = true;
    }
  }

  const expectedCents = moneyToCents(expectedFee);
  if (expectedCents === null || expectedCents !== moneyToCents(effectiveQuote.fee)) {
    throw apiError('fee_changed', { quote: effectiveQuote });
  }

  const feeCents = moneyToCents(effectiveQuote.fee)!;
  if (!adoptedCharge && effectiveQuote.late && feeCents > 0) {
    const accountId = await billingAccount(client, r.org_id);
    const description = `${r.ref} late cancellation: ${effectiveQuote.seated} x ${effectiveQuote.charge_hours_per_interpreter} h at $${effectiveQuote.hourly_rate}/h`;
    try {
      await kb.postExternalCharge(accountId, chargeKey, description, feeCents);
    } catch (err) {
      if (err instanceof kb.KillBillError && err.kind === 'unavailable') throw apiError('billing_unavailable');
      throw err;
    }
  }

  const beforeStatus = r.status;
  const newStatus = effectiveQuote.late ? 'cancelled_late' : 'cancelled_on_time';
  await client.query(
    'UPDATE requests SET status = $1, cancellation_fee_cents = $2, cancel_quote = $3, updated_at = now() WHERE id = $4',
    [newStatus, feeCents, JSON.stringify(effectiveQuote), requestId],
  );
  await writeAudit(client, {
    actorUserId: user.id, action: 'request.cancelled', entity: 'request', entityId: requestId,
    from: beforeStatus, to: newStatus, detail: { fee: centsToMoney(feeCents), reason },
  });

  const activeOffers = await client.query<Row>(
    `SELECT o.id FROM offers o JOIN seats s ON s.id = o.seat_id
     WHERE s.request_id = $1 AND o.status = 'active' FOR UPDATE OF o`,
    [requestId],
  );
  for (const o of activeOffers.rows) {
    await client.query(`UPDATE offers SET status = 'withdrawn' WHERE id = $1`, [str(o.id)]);
    await client.query(
      `UPDATE seats SET status = 'open', interpreter_id = NULL, held_by_user_id = NULL WHERE id = (SELECT seat_id FROM offers WHERE id = $1)`,
      [str(o.id)],
    );
    await writeAudit(client, {
      actorUserId: user.id, action: 'offer.withdrawn', entity: 'offer', entityId: str(o.id),
      from: 'active', to: 'withdrawn',
    });
  }

  const startDate = agencyDate(new Date(r.start_ms));
  const seatedInterpreters = await client.query<Row>(
    `SELECT DISTINCT u.email, i.name FROM seats s
     JOIN interpreters i ON i.id = s.interpreter_id
     JOIN users u ON u.id = i.user_id
     WHERE s.request_id = $1 AND s.status = 'accepted'`,
    [requestId],
  );
  const chargeLine = effectiveQuote.late
    ? `Late cancellation. Charge per interpreter: $${effectiveQuote.fee_per_interpreter}`
    : 'On-time cancellation. No charge.';
  for (const row of seatedInterpreters.rows) {
    await queueEmail({
      to: str(row.email),
      subject: `Cancelled: ${r.ref} on ${startDate}`,
      text: `Cancelled: ${r.ref} on ${startDate}\n\n${chargeLine}`,
    });
  }

  const updated = await requestFullView(client, requestId);
  return JSON.stringify({ request: updated, quote: effectiveQuote });
}

function quoteFromKbItem(item: kb.ExistingCharge, r: RequestRow): Quote {
  const description = item.description.replace(/^\[[^\]]+\]\s*/, '');
  const match = /(\d+) x ([\d.]+) h at \$([\d.]+)\/h/.exec(description);
  const seated = match?.[1] ? Number(match[1]) : 1;
  const chargeHours = match?.[2] ?? '0.00';
  const rate = match?.[3] ?? '0.00';
  const feeCents = Math.round(item.amount * 100);
  const durationMin = durationMinutesOf(r);
  return {
    late: true,
    window_hours: durationMin <= 120 ? 48 : 72,
    hours_before_start: ((r.start_ms - Date.now()) / 3_600_000).toFixed(2),
    seated,
    charge_hours_per_interpreter: chargeHours,
    hourly_rate: rate,
    fee_per_interpreter: centsToMoney(seated > 0 ? Math.round(feeCents / seated) : feeCents),
    fee: centsToMoney(feeCents),
  };
}

export async function ensureOrgAccount(client: pg.PoolClient, orgId: string): Promise<string> {
  const cached = await client.query<Row>('SELECT killbill_account_id FROM orgs WHERE id = $1', [orgId]);
  const existing = cached.rows[0]?.killbill_account_id;
  if (existing) return str(existing);
  const nameRes = await client.query<Row>('SELECT name FROM orgs WHERE id = $1', [orgId]);
  const accountId = await kb.ensureAccount(`fernhollow-${orgId}`, str(nameRes.rows[0]!.name));
  await client.query('UPDATE orgs SET killbill_account_id = $1 WHERE id = $2', [accountId, orgId]);
  return accountId;
}

// Reads and writes against Kill Bill answer billing_unavailable when the
// billing service is unreachable; the app keeps its own state unchanged.
export async function billingAccount(client: pg.PoolClient, orgId: string): Promise<string> {
  try {
    return await ensureOrgAccount(client, orgId);
  } catch (err) {
    if (err instanceof kb.KillBillError && err.kind === 'unavailable') {
      throw apiError('billing_unavailable');
    }
    throw err;
  }
}

// ---------- timesheets ----------

export async function submitTimesheet(
  user: SessionUser, seatId: string, actualStart: string, actualEnd: string,
  signatureName: string, idemKey: string,
): Promise<{ status: number; body: string; idempotentReplay: boolean }> {
  const bodyJson = JSON.stringify({ actual_start: actualStart, actual_end: actualEnd, signature_name: signatureName });
  return withTransaction(async (client) => {
    return await idempotentRun(client, idemKey, 'timesheet_submit', bodyJson, async () => ({
      status: 201,
      body: await performTimesheetSubmit(client, user, seatId, actualStart, actualEnd, signatureName),
    }));
  });
}

async function performTimesheetSubmit(
  client: pg.PoolClient, user: SessionUser, seatId: string,
  actualStart: string, actualEnd: string, signatureName: string,
): Promise<string> {
  const seatRes = await client.query<Row>(
    `SELECT s.id, s.request_id, s.status, s.interpreter_id, i.user_id FROM seats s
     JOIN interpreters i ON i.id = s.interpreter_id WHERE s.id = $1 FOR UPDATE`,
    [seatId],
  );
  const seat = seatRes.rows[0];
  if (!seat) throw apiError('not_found');
  if (str(seat.user_id) !== user.id) throw apiError('forbidden');
  const r = await loadRequestRow(client, str(seat.request_id));

  const startMs = parseInstant(actualStart);
  const endMs = parseInstant(actualEnd);
  if (!startMs || !endMs) {
    throw apiError('validation', { fields: {
      ...(startMs ? {} : { actual_start: 'Enter a valid date and time.' }),
      ...(endMs ? {} : { actual_end: 'Enter a valid date and time.' }),
    } });
  }
  if (endMs <= startMs || endMs.getTime() - startMs.getTime() > 12 * 60 * MS_PER_MINUTE) {
    throw apiError('validation', { fields: { actual_end: 'Actual end must be after actual start and at most 12 hours later.' } });
  }
  if (signatureName.trim().length < 2 || signatureName.trim().length > 120) {
    throw apiError('validation', { fields: { signature_name: 'Signature name must be 2-120 characters.' } });
  }

  const existing = await client.query<Row>('SELECT id FROM timesheets WHERE seat_id = $1', [seatId]);
  if (existing.rows.length > 0) throw apiError('already_submitted');
  if (r.status.startsWith('cancelled')) throw apiError('invalid_transition', { from: r.status }, { from: r.status });
  if (seat.status !== 'accepted') throw apiError('invalid_transition', { from: str(seat.status) }, { from: str(seat.status) });
  if (Date.now() < r.end_ms) throw apiError('not_yet_ended');

  const hours = billedHours(startMs.getTime(), endMs.getTime());
  const tsId = newId('ts');
  await client.query(
    `INSERT INTO timesheets (id, seat_id, interpreter_id, request_id, actual_start, actual_end, signature_name, billed_hours, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',now())`,
    [tsId, seatId, str(seat.interpreter_id), r.id, startMs, endMs, signatureName.trim(), hours],
  );
  await writeAudit(client, {
    actorUserId: user.id, action: 'timesheet.submitted', entity: 'timesheet', entityId: tsId,
    from: null, to: 'submitted', detail: { billed_hours: hours },
  });
  return JSON.stringify({
    timesheet: {
      id: tsId, status: 'submitted',
      actual_start: isoWithOffset(startMs), actual_end: isoWithOffset(endMs),
      billed_hours: hours,
    },
  });
}

export async function approveTimesheet(
  user: SessionUser, timesheetId: string, idemKey: string,
): Promise<{ status: number; body: string; idempotentReplay: boolean }> {
  const bodyJson = JSON.stringify({});
  return withTransaction(async (client) => {
    return await idempotentRun(client, idemKey, 'timesheet_approve', bodyJson, async () => ({
      status: 200,
      body: await performApproval(client, user, timesheetId),
    }));
  });
}

async function performApproval(client: pg.PoolClient, user: SessionUser, timesheetId: string): Promise<string> {
  const tsRes = await client.query<Row>(
    `SELECT t.id, t.status, t.seat_id, t.request_id, t.interpreter_id, t.actual_start, t.actual_end,
            t.billed_hours, t.signature_name, i.name AS interpreter_name
     FROM timesheets t JOIN interpreters i ON i.id = t.interpreter_id
     WHERE t.id = $1 FOR UPDATE`,
    [timesheetId],
  );
  const ts = tsRes.rows[0];
  if (!ts) throw apiError('not_found');
  if (str(ts.status) !== 'submitted') {
    throw apiError('invalid_transition', { from: str(ts.status) }, { from: str(ts.status) });
  }
  const r = await loadRequestRow(client, str(ts.request_id));
  const rates = await getRates(client);
  const rateCents = rates[r.setting];
  const chargeKey = chargeKeyForTimesheet(timesheetId);

  // Reconciliation: adopt an earlier uncertain charge.
  const accountId = await billingAccount(client, r.org_id);
  let existing: kb.ExistingCharge | null;
  try {
    existing = await kb.findChargeByKey(accountId, chargeKey);
  } catch (err) {
    if (err instanceof kb.KillBillError && err.kind === 'unavailable') throw apiError('billing_unavailable');
    throw err;
  }
  let amountCents: number;
  let frozenRateCents: number;
  let killbillInvoiceId: string | null = null;
  if (existing) {
    const desc = existing.description.replace(/^\[[^\]]+\]\s*/, '');
    const rateMatch = /\$([\d.]+)\/h$/.exec(desc);
    frozenRateCents = rateMatch?.[1] ? Math.round(Number(rateMatch[1]) * 100) : rateCents;
    amountCents = Math.round(existing.amount * 100);
    killbillInvoiceId = existing.invoiceId;
  } else {
    frozenRateCents = rateCents;
    amountCents = roundHalfUpCents(Math.round(Number(ts.billed_hours) * 100) * frozenRateCents);
    const description = `${r.ref} interpreting: ${str(ts.interpreter_name)}, ${str(ts.billed_hours)} h at $${centsToMoney(frozenRateCents)}/h`;
    const posted = await kb.postExternalCharge(accountId, chargeKey, description, amountCents);
    amountCents = posted.amountCents;
    killbillInvoiceId = posted.invoiceId;
  }

  let pdf: Buffer;
  try {
    pdf = await buildTimesheetPdf({
    ref: r.ref,
    interpreterName: str(ts.interpreter_name),
    actualStart: isoWithOffset(new Date(ts.actual_start as string)),
    actualEnd: isoWithOffset(new Date(ts.actual_end as string)),
    billedHours: str(ts.billed_hours),
    signatureName: str(ts.signature_name),
    amount: centsToMoney(amountCents),
    rate: centsToMoney(frozenRateCents),
    approvedBy: user.name,
    approvedAt: agencyText(new Date()),
    title: r.title,
    setting: r.setting,
    orgName: r.org_name,
    });
  } catch (err) {
    throw err;
  }
  const pdfKey = `timesheets/${r.id}/${timesheetId}.pdf`;
  try {
    await putObject(pdfKey, pdf, 'application/pdf');
  } catch {
    throw apiError('storage_unavailable');
  }

  await client.query(
    `UPDATE timesheets SET status = 'approved', hourly_rate_cents = $1, amount_cents = $2,
       killbill_invoice_id = $3, approved_at = now(), pdf_key = $4 WHERE id = $5`,
    [frozenRateCents, amountCents, killbillInvoiceId, pdfKey, timesheetId],
  );
  await writeAudit(client, {
    actorUserId: user.id, action: 'timesheet.approved', entity: 'timesheet', entityId: timesheetId,
    from: 'submitted', to: 'approved', detail: { amount: centsToMoney(amountCents), rate: centsToMoney(frozenRateCents) },
  });

  const seats = await loadSeatRows(client, r.id);
  const allApproved = seats.every((s) => s.ts_id === null || s.ts_status === 'approved');
  let requestStatus: string = r.status;
  if (allApproved && r.status === 'completed') {
    requestStatus = 'invoiced';
    await client.query('UPDATE requests SET status = $1 WHERE id = $2', ['invoiced', r.id]);
    await writeAudit(client, {
      actorUserId: user.id, action: 'request.status_changed', entity: 'request', entityId: r.id,
      from: r.status, to: 'invoiced',
    });
  }

  const requesters = await client.query<Row>(
    `SELECT email FROM users WHERE org_id = $1 AND role = 'requester'`, [r.org_id],
  );
  for (const u of requesters.rows) {
    await queueEmail({
      to: str(u.email),
      subject: `Timesheet approved: ${r.ref}`,
      text: [
        `Timesheet approved: ${r.ref}`,
        '',
        `Interpreter: ${str(ts.interpreter_name)}`,
        `Billed hours: ${str(ts.billed_hours)}`,
        `Amount: $${centsToMoney(amountCents)}`,
      ].join('\n'),
    });
  }

  return JSON.stringify({
    timesheet: {
      id: timesheetId, status: 'approved', billed_hours: str(ts.billed_hours),
      hourly_rate: centsToMoney(frozenRateCents), amount: centsToMoney(amountCents),
      killbill_invoice_id: killbillInvoiceId,
    },
    request: { ref: r.ref, status: requestStatus },
  });
}

// ---------- preferences ----------

export async function savePreferences(
  client: pg.PoolClient, consumerId: string, preferred: string[], blocked: string[],
): Promise<void> {
  const overlap = preferred.filter((id) => blocked.includes(id));
  if (overlap.length > 0) {
    throw apiError('validation', { fields: {} }, {});
  }
  const all = [...new Set([...preferred, ...blocked])];
  for (const id of all) {
    const res = await client.query<Row>('SELECT id FROM interpreters WHERE id = $1', [id]);
    if (res.rows.length === 0) throw apiError('validation', { fields: {} });
  }
  await client.query('DELETE FROM consumer_preferences WHERE consumer_id = $1', [consumerId]);
  for (const id of preferred) {
    await client.query(
      'INSERT INTO consumer_preferences (consumer_id, interpreter_id, kind) VALUES ($1,$2,$3)',
      [consumerId, id, 'preferred'],
    );
  }
  for (const id of blocked) {
    await client.query(
      'INSERT INTO consumer_preferences (consumer_id, interpreter_id, kind) VALUES ($1,$2,$3)',
      [consumerId, id, 'blocked'],
    );
  }
}

// ---------- credential expiry warnings ----------

export async function sendExpiryWarnings(client: pg.PoolClient): Promise<void> {
  const res = await client.query<Row>(
    `SELECT cr.id, cr.type, cr.number, cr.expires_on, cr.interpreter_id, u.email, u.name
     FROM credentials cr
     JOIN interpreters i ON i.id = cr.interpreter_id
     JOIN users u ON u.id = i.user_id
     WHERE cr.warning_sent_at IS NULL`,
  );
  const nowMs = Date.now();
  for (const row of res.rows) {
    const expiresOnMs = parseNominalDate(str(row.expires_on)) ?? 0;
    const status = credentialStatus(expiresOnMs, nowMs);
    if (status === 'expiring') {
      await queueEmail({
        to: str(row.email),
        subject: `Credential expiring: ${str(row.type)} on ${str(row.expires_on)}`,
        text: `Your ${str(row.type)} credential, number ${str(row.number)}, expires on ${str(row.expires_on)}.`,
      });
    }
    if (status !== 'valid') {
      await client.query('UPDATE credentials SET warning_sent_at = now() WHERE id = $1', [str(row.id)]);
    }
  }
}
