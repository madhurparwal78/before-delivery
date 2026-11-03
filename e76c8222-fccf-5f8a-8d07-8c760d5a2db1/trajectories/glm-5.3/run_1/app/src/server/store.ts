import { pool, type Queryable } from './db.js';
import { newId } from './seed.js';
import { evaluateGates, computeQuote, credentialStatus, type AssignmentInterval } from './rules.js';
import { apiError } from './api-error.js';
import { centsToMoney } from './money.js';
import { isoWithOffset, parseNominalDate, MS_PER_MINUTE } from './time.js';
import {
  type CredentialType, type GateResult, type Quote, type RequestStatus, type RequestView,
  type SeatView, type Setting, type SessionUser, type MyOfferView, type AuditEntryView,
} from './types.js';

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);
const nullable = (v: unknown): string | null => (v === null ? null : String(v));

// ---------- request and seat rows ----------

export interface RequestRow {
  id: string; ref: string; org_id: string; org_name: string; title: string;
  setting: Setting; location: string; start_ms: number; end_ms: number;
  consumer_id: string; consumer_name: string; notes: string; logged_after: boolean;
  status: string; cancellation_fee_cents: number | null; cancel_quote: unknown;
  seats_total: number;
}

export interface SeatRow {
  id: string; request_id: string; position: number; status: string;
  interpreter_id: string | null; interpreter_name: string | null;
  held_by_id: string | null; held_by_name: string | null;
  offer_id: string | null; offer_status: string | null;
  offer_sent_ms: number | null; offer_expires_ms: number | null; offer_email_sent: boolean;
  ts_id: string | null; ts_status: string | null; ts_billed_hours: string | null; ts_amount_cents: number | null;
}

export async function loadRequestRow(q: Queryable, requestId: string): Promise<RequestRow> {
  const res = await q.query<Row>(
    `SELECT r.id, r.ref, r.org_id, o.name AS org_name, r.title, r.setting, r.location,
            extract(epoch from r.start_at)*1000 AS start_ms,
            extract(epoch from r.end_at)*1000 AS end_ms,
            r.consumer_id, c.name AS consumer_name, r.notes, r.logged_after,
            r.status, r.cancellation_fee_cents, r.cancel_quote, r.seats_total
     FROM requests r JOIN orgs o ON o.id = r.org_id JOIN consumers c ON c.id = r.consumer_id
     WHERE r.id = $1`,
    [requestId],
  );
  const row = res.rows[0];
  if (!row) throw apiError('not_found');
  return {
    id: str(row.id), ref: str(row.ref), org_id: str(row.org_id), org_name: str(row.org_name),
    title: str(row.title), setting: str(row.setting) as Setting, location: str(row.location),
    start_ms: num(row.start_ms), end_ms: num(row.end_ms),
    consumer_id: str(row.consumer_id), consumer_name: str(row.consumer_name),
    notes: str(row.notes ?? ''), logged_after: Boolean(row.logged_after),
    status: str(row.status),
    cancellation_fee_cents: row.cancellation_fee_cents === null ? null : num(row.cancellation_fee_cents),
    cancel_quote: row.cancel_quote ?? null, seats_total: num(row.seats_total),
  };
}

// Marks offers past their expiry as expired, reopens their seats, writes audit.
// Used by request paths so a stale seat reads open at once; the sweep also runs this.
export async function expireOverdueOffersForSeat(q: Queryable, seatId: string): Promise<void> {
  const expired = await q.query<Row>(
    `UPDATE offers SET status = 'expired'
     WHERE status = 'active' AND expires_at <= now()
       AND seat_id = $1
     RETURNING id`,
    [seatId],
  );
  for (const row of expired.rows) {
    await writeAudit(q, {
      actorUserId: null, action: 'offer.expired', entity: 'offer', entityId: str(row.id),
      from: 'active', to: 'expired',
    });
  }
  await q.query(
    `UPDATE seats SET status = 'open', interpreter_id = NULL, held_by_user_id = NULL
     WHERE id = $1 AND status = 'offered' AND NOT EXISTS (
       SELECT 1 FROM offers o WHERE o.seat_id = $1 AND o.status = 'active'
     )`,
    [seatId],
  );
}

export async function loadSeatRows(q: Queryable, requestId: string): Promise<SeatRow[]> {
  const res = await q.query<Row>(
    `SELECT s.id, s.request_id, s.position, s.status,
            s.interpreter_id, i.name AS interpreter_name,
            s.held_by_user_id, hb.name AS held_by_name,
            o.id AS offer_id, o.status AS offer_status,
            extract(epoch from o.sent_at)*1000 AS offer_sent_ms,
            extract(epoch from o.expires_at)*1000 AS offer_expires_ms,
            (ob.state = 'sent') AS offer_email_sent,
            t.id AS ts_id, t.status AS ts_status, t.billed_hours AS ts_billed_hours, t.amount_cents AS ts_amount_cents
     FROM seats s
     LEFT JOIN interpreters i ON i.id = s.interpreter_id
     LEFT JOIN users hb ON hb.id = s.held_by_user_id
     LEFT JOIN LATERAL (
       SELECT o.* FROM offers o
       WHERE o.seat_id = s.id AND o.status IN ('active','accepted')
       ORDER BY (o.status = 'accepted') DESC, o.sent_at DESC LIMIT 1
     ) o ON true
     LEFT JOIN outbox ob ON ob.id = o.outbox_id
     LEFT JOIN timesheets t ON t.seat_id = s.id
     WHERE s.request_id = $1 ORDER BY s.position`,
    [requestId],
  );
  const seats = res.rows.map((row) => ({
    id: str(row.id), request_id: str(row.request_id), position: num(row.position), status: str(row.status),
    interpreter_id: nullable(row.interpreter_id), interpreter_name: nullable(row.interpreter_name),
    held_by_id: nullable(row.held_by_user_id), held_by_name: nullable(row.held_by_name),
    offer_id: nullable(row.offer_id), offer_status: nullable(row.offer_status),
    offer_sent_ms: row.offer_sent_ms === null ? null : num(row.offer_sent_ms),
    offer_expires_ms: row.offer_expires_ms === null ? null : num(row.offer_expires_ms),
    offer_email_sent: Boolean(row.offer_email_sent),
    ts_id: nullable(row.ts_id), ts_status: nullable(row.ts_status),
    ts_billed_hours: nullable(row.ts_billed_hours),
    ts_amount_cents: row.ts_amount_cents === null ? null : num(row.ts_amount_cents),
  }));
  // An offer past its expiry reads as expired and its seat as open at once.
  const nowMs = Date.now();
  for (const seat of seats) {
    if (seat.offer_status === 'active' && seat.offer_expires_ms !== null && seat.offer_expires_ms <= nowMs) {
      seat.offer_status = 'expired';
      seat.status = 'open';
      seat.interpreter_id = null;
      seat.interpreter_name = null;
      seat.held_by_id = null;
      seat.held_by_name = null;
    }
  }
  return seats;
}

export async function loadSeatById(q: Queryable, seatId: string): Promise<SeatRow> {
  const res = await q.query<Row>(
    `SELECT s.id, s.request_id, s.position, s.status, s.interpreter_id, i.name AS interpreter_name,
            s.held_by_user_id, hb.name AS held_by_name
     FROM seats s
     LEFT JOIN interpreters i ON i.id = s.interpreter_id
     LEFT JOIN users hb ON hb.id = s.held_by_user_id
     WHERE s.id = $1`,
    [seatId],
  );
  const row = res.rows[0];
  if (!row) throw apiError('not_found');
  return {
    id: str(row.id), request_id: str(row.request_id), position: num(row.position), status: str(row.status),
    interpreter_id: nullable(row.interpreter_id), interpreter_name: nullable(row.interpreter_name),
    held_by_id: nullable(row.held_by_user_id), held_by_name: nullable(row.held_by_name),
    offer_id: null, offer_status: null, offer_sent_ms: null, offer_expires_ms: null,
    offer_email_sent: false, ts_id: null, ts_status: null, ts_billed_hours: null, ts_amount_cents: null,
  };
}

export function durationMinutesOf(r: { start_ms: number; end_ms: number }): number {
  return Math.round((r.end_ms - r.start_ms) / MS_PER_MINUTE);
}

export function seatView(s: SeatRow): SeatView {
  const offer: SeatView['offer'] = s.offer_id && s.offer_status
    ? {
        id: s.offer_id,
        status: s.offer_status as 'active' | 'accepted' | 'declined' | 'expired' | 'withdrawn',
        sent_at: isoWithOffset(new Date(s.offer_sent_ms!)),
        expires_at: isoWithOffset(new Date(s.offer_expires_ms!)),
        email: s.offer_email_sent ? 'sent' : 'queued',
      }
    : null;
  const timesheet: SeatView['timesheet'] = s.ts_id
    ? {
        id: s.ts_id,
        status: s.ts_status as 'submitted' | 'approved',
        billed_hours: s.ts_billed_hours!,
        amount: s.ts_amount_cents === null ? null : centsToMoney(s.ts_amount_cents),
      }
    : null;
  return {
    id: s.id,
    position: s.position,
    status: s.status as SeatView['status'],
    interpreter: s.interpreter_id ? { id: s.interpreter_id, name: s.interpreter_name! } : null,
    held_by: s.held_by_id ? { id: s.held_by_id, name: s.held_by_name! } : null,
    offer,
    timesheet,
  };
}

export async function loadPrepFiles(q: Queryable, requestId: string): Promise<RequestView['prep_files']> {
  const res = await q.query<Row>(
    `SELECT id, filename, content_type, size_bytes FROM prep_files WHERE request_id = $1 ORDER BY created_at`,
    [requestId],
  );
  return res.rows.map((row) => ({
    id: str(row.id), filename: str(row.filename), content_type: str(row.content_type), size: num(row.size_bytes),
  }));
}

// ---------- rates ----------

export async function getRates(q: Queryable): Promise<Record<Setting, number>> {
  const res = await q.query<Row>('SELECT setting, hourly_rate_cents FROM rates');
  const out = {} as Record<Setting, number>;
  for (const row of res.rows) out[str(row.setting) as Setting] = num(row.hourly_rate_cents);
  return out;
}

// ---------- quote (the fee definition's single entry point) ----------

export async function loadQuote(q: Queryable, r: RequestRow, seats: SeatRow[], rates?: Record<Setting, number>): Promise<Quote> {
  const settingRates = rates ?? (await getRates(q));
  return computeQuote({
    nowMs: Date.now(),
    startMs: r.start_ms,
    endMs: r.end_ms,
    seatedCount: seats.filter((s) => s.status === 'accepted').length,
    hourlyRateCents: settingRates[r.setting],
  });
}

export function renderRequest(
  r: RequestRow, seats: SeatRow[], prep: RequestView['prep_files'],
  rates: Record<Setting, number>, nowMs: number,
): RequestView {
  const quote = computeQuote({
    nowMs, startMs: r.start_ms, endMs: r.end_ms,
    seatedCount: seats.filter((s) => s.status === 'accepted').length,
    hourlyRateCents: rates[r.setting],
  });
  const cancellable = !['draft', 'completed', 'invoiced'].includes(r.status) && !r.status.startsWith('cancelled');
  return {
    id: r.id, ref: r.ref, org_id: r.org_id, org_name: r.org_name,
    title: r.title, setting: r.setting, location: r.location,
    start: isoWithOffset(new Date(r.start_ms)), end: isoWithOffset(new Date(r.end_ms)),
    duration_hours: (durationMinutesOf(r) / 60).toFixed(2),
    consumer: { id: r.consumer_id, name: r.consumer_name },
    notes: r.notes,
    status: r.status as RequestStatus,
    logged_after: r.logged_after,
    seats_total: seats.length,
    seats_claimed: seats.filter((s) => s.status !== 'open').length,
    seats_accepted: seats.filter((s) => s.status === 'accepted').length,
    in_cancellation_window: cancellable ? quote.late : false,
    cancellation_fee: r.cancellation_fee_cents === null ? null : centsToMoney(r.cancellation_fee_cents),
    seats: seats.map(seatView),
    prep_files: prep,
  };
}

export async function requestFullView(q: Queryable, requestId: string): Promise<RequestView> {
  const r = await loadRequestRow(q, requestId);
  const seats = await loadSeatRows(q, requestId);
  const prep = await loadPrepFiles(q, requestId);
  const rates = await getRates(q);
  return renderRequest(r, seats, prep, rates, Date.now());
}

// ---------- gates ----------

export async function loadCredentials(q: Queryable, interpreterId: string): Promise<Array<{ type: CredentialType; expiresOnMs: number }>> {
  const res = await q.query<Row>(
    'SELECT type, expires_on FROM credentials WHERE interpreter_id = $1',
    [interpreterId],
  );
  return res.rows
    .map((row) => ({
      type: str(row.type) as CredentialType,
      expiresOnMs: parseNominalDate(str(row.expires_on)) ?? 0,
    }))
    .filter((c) => c.expiresOnMs > 0);
}

export async function loadAssignments(q: Queryable, interpreterId: string, excludeSeatId: string): Promise<AssignmentInterval[]> {
  const res = await q.query<Row>(
    `SELECT rq.ref, extract(epoch from rq.start_at)*1000 AS start_ms, extract(epoch from rq.end_at)*1000 AS end_ms
     FROM (
       SELECT s.request_id FROM seats s
       JOIN offers o ON o.seat_id = s.id
       WHERE o.interpreter_id = $1 AND o.status = 'active' AND s.id <> $2
       UNION
       SELECT s.request_id FROM seats s
       WHERE s.interpreter_id = $1 AND s.status = 'accepted' AND s.id <> $2
     ) m
     JOIN requests rq ON rq.id = m.request_id
     WHERE rq.status NOT IN ('cancelled_on_time','cancelled_late')`,
    [interpreterId, excludeSeatId],
  );
  return res.rows.map((row) => ({ ref: str(row.ref), startMs: num(row.start_ms), endMs: num(row.end_ms) }));
}

export async function consumerBlocked(q: Queryable, consumerId: string, interpreterId: string): Promise<boolean> {
  const res = await q.query<Row>(
    `SELECT 1 FROM consumer_preferences WHERE consumer_id = $1 AND interpreter_id = $2 AND kind = 'blocked'`,
    [consumerId, interpreterId],
  );
  return res.rows.length > 0;
}

export async function evaluateGatesForSeat(q: Queryable, seat: SeatRow, interpreterId: string): Promise<GateResult[]> {
  const r = await loadRequestRow(q, seat.request_id);
  const creds = await loadCredentials(q, interpreterId);
  const assignments = await loadAssignments(q, interpreterId, seat.id);
  const blocked = await consumerBlocked(q, r.consumer_id, interpreterId);
  return evaluateGates({
    setting: r.setting,
    credentials: creds,
    endMs: r.end_ms,
    assignments,
    startMs: r.start_ms,
    consumerBlocked: blocked,
    consumerName: r.consumer_name,
  });
}

// ---------- audit ----------

export async function writeAudit(q: Queryable, entry: {
  actorUserId: string | null; action: string; entity: string; entityId: string;
  from: string | null; to: string | null; detail?: Record<string, unknown> | null;
}): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (at, actor_user_id, action, entity, entity_id, from_status, to_status, detail)
     VALUES (now(), $1, $2, $3, $4, $5, $6, $7)`,
    [entry.actorUserId, entry.action, entry.entity, entry.entityId, entry.from, entry.to, entry.detail ?? null],
  );
}

export async function readAudit(q: Queryable, requestId: string): Promise<AuditEntryView[]> {
  const res = await q.query<Row>(
    `SELECT a.at, a.actor_user_id, u.name AS actor_name, u.role AS actor_role, a.action, a.entity, a.entity_id,
            a.from_status, a.to_status, a.detail
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.entity_id = $1
        OR a.entity_id IN (
          SELECT s.id FROM seats s WHERE s.request_id = $1
          UNION SELECT o.id FROM offers o JOIN seats s ON s.id = o.seat_id WHERE s.request_id = $1
          UNION SELECT t.id FROM timesheets t JOIN seats s ON s.id = t.seat_id WHERE s.request_id = $1
        )
     ORDER BY a.id`,
    [requestId],
  );
  return res.rows.map((row) => ({
    at: isoWithOffset(new Date(row.at as string)),
    actor: row.actor_user_id
      ? { id: str(row.actor_user_id), name: str(row.actor_name!), role: str(row.actor_role!) as SessionUser['role'] }
      : null,
    action: str(row.action),
    entity: str(row.entity),
    entity_id: str(row.entity_id),
    from: nullable(row.from_status),
    to: nullable(row.to_status),
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  }));
}

// ---------- board and interpreter views ----------

export interface BoardInterpreter {
  id: string;
  name: string;
  credentials: Array<{ id: string; type: CredentialType; expires_on: string; expired: boolean }>;
}

export async function boardData(): Promise<{ interpreters: BoardInterpreter[]; requests: RequestView[] }> {
  const q = pool;
  const interp = await q.query<Row>(
    `SELECT i.id, i.name, cr.id AS cred_id, cr.type, cr.expires_on
     FROM interpreters i LEFT JOIN credentials cr ON cr.interpreter_id = i.id
     ORDER BY i.name, cr.expires_on`,
  );
  const byInterpreter = new Map<string, BoardInterpreter>();
  for (const row of interp.rows) {
    const id = str(row.id);
    if (!byInterpreter.has(id)) byInterpreter.set(id, { id, name: str(row.name), credentials: [] });
    if (row.cred_id) {
      const expiresOnMs = parseNominalDate(str(row.expires_on)) ?? 0;
      byInterpreter.get(id)!.credentials.push({
        id: str(row.cred_id),
        type: str(row.type) as CredentialType,
        expires_on: str(row.expires_on),
        expired: credentialStatus(expiresOnMs, Date.now()) === 'expired',
      });
    }
  }
  const reqs = await q.query<Row>(
    `SELECT r.id FROM requests r
     WHERE r.status NOT IN ('cancelled_on_time','cancelled_late')
       AND r.status <> 'draft'
       AND r.start_at >= now()
       AND r.start_at <= now() + interval '72 hours'
     ORDER BY r.start_at`,
  );
  const rates = await getRates(q);
  const requests: RequestView[] = [];
  for (const row of reqs.rows) {
    const r = await loadRequestRow(q, str(row.id));
    const seats = await loadSeatRows(q, r.id);
    const prep = await loadPrepFiles(q, r.id);
    requests.push(renderRequest(r, seats, prep, rates, Date.now()));
  }
  return { interpreters: [...byInterpreter.values()], requests };
}

export async function myAssignments(interpreterId: string): Promise<{ interpreter_id: string; offers: MyOfferView[]; assignments: RequestView[] }> {
  const q = pool;
  const rates = await getRates(q);
  const offerRes = await q.query<Row>(
    `SELECT o.id, o.token, o.sent_at, o.expires_at, s.position, s.request_id, (SELECT count(*) FROM seats x WHERE x.request_id = s.request_id) AS total
     FROM offers o
     JOIN seats s ON s.id = o.seat_id
     JOIN requests rq ON rq.id = s.request_id
     WHERE o.interpreter_id = $1 AND o.status = 'active' AND o.expires_at > now()
     ORDER BY o.expires_at`,
    [interpreterId],
  );
  const offers: MyOfferView[] = [];
  for (const row of offerRes.rows) {
    const r = await loadRequestRow(q, str(row.request_id));
    offers.push({
      id: str(row.id), token: str(row.token), status: 'active',
      sent_at: isoWithOffset(new Date(row.sent_at as string)),
      expires_at: isoWithOffset(new Date(row.expires_at as string)),
      request: {
        id: r.id, ref: r.ref, title: r.title, setting: r.setting, location: r.location,
        start: isoWithOffset(new Date(r.start_ms)), end: isoWithOffset(new Date(r.end_ms)), org_name: r.org_name,
      },
      seat: { position: num(row.position), total: num(row.total) },
    });
  }
  const assignRes = await q.query<Row>(
    `SELECT rq.id, min(rq.start_at) FROM requests rq
     JOIN seats s ON s.request_id = rq.id
     WHERE s.interpreter_id = $1 AND s.status = 'accepted'
       AND rq.status NOT IN ('cancelled_on_time','cancelled_late')
     GROUP BY rq.id ORDER BY min(rq.start_at)`,
    [interpreterId],
  );
  const assignments: RequestView[] = [];
  for (const row of assignRes.rows) {
    const r = await loadRequestRow(q, str(row.id));
    const seats = await loadSeatRows(q, r.id);
    const prep = await loadPrepFiles(q, r.id);
    assignments.push(renderRequest(r, seats, prep, rates, Date.now()));
  }
  return { interpreter_id: interpreterId, offers, assignments };
}

export { newId };
