import { callerOf, forbidden } from '../api-core.js';
import { ApiError, monthName } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler, type RouteContext } from '../pipeline.js';
import { currentMonthInZone, formatInstant, localDateInZone } from '../time.js';
import { hourBankObject, monthClosed } from '../serialize.js';
import { statementBody } from '../copy.js';
import { centsToDollarString, newId } from '../util.js';
import { getPersonEmail } from './helpers.js';
import { stationNameOf, ensureKbAccount } from './bookings.js';
import type { PoolClient } from 'pg';

const nowDate = (): Date => new Date();

const MARKER = 'lineboard:';

interface InvoiceLine {
  kind: 'booking' | 'penalty' | 'credit';
  bookingId: string | null;
  description: string;
  amountCents: number;
  billingStatus: 'billed' | 'pending_billing';
}

function lineKindOf(kind: string): 'booking' | 'penalty' | 'credit' {
  if (kind === 'booking') return 'booking';
  if (kind === 'late_fee') return 'penalty';
  return 'credit';
}

/** A member's invoice lines for a month: one line per Kill Bill item. */
export async function invoiceLines(client: PoolClient, memberId: string, month: string): Promise<InvoiceLine[]> {
  const rows = (await client.query<{ kind: string; booking_id: string | null; description: string; amount_cents: number; recorded: boolean; id: string }>(
    `SELECT * FROM kb_items WHERE member_id=$1 AND month=$2 ORDER BY created_at, id`,
    [memberId, month],
  )).rows;
  return rows.map((row) => ({
    kind: lineKindOf(row.kind),
    bookingId: row.booking_id,
    description: row.description,
    amountCents: row.amount_cents,
    billingStatus: row.recorded ? 'billed' : 'pending_billing',
  }));
}

// ---------------------------------------------------------------------------
// GET /api/members/{memberId}/invoices/{month}
// ---------------------------------------------------------------------------
export const memberInvoice: Handler = async (req, res) => {
  const caller = callerOf(req);
  const memberId = String(req.params.memberId);
  const month = String(req.params.month);
  if (caller.person.role === 'shift_lead') throw forbidden();
  if (caller.person.role === 'member' && caller.person.member_id !== memberId) throw new ApiError('not_found');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
  await withContentionRetry(async (client) => {
    const member = await client.query<{ kitchen_id: string }>(`SELECT kitchen_id FROM members WHERE id=$1`, [memberId]);
    if (member.rows.length === 0 || member.rows[0].kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    const closed = await monthClosed(client, caller.kitchen.id, month);
    if (closed) {
      const frozen = (await client.query<{ payload: string }>(
        `SELECT payload FROM frozen_figures WHERE kitchen_id=$1 AND month=$2 AND kind='invoice'`,
        [caller.kitchen.id, month],
      )).rows[0];
      const parsed = frozen ? (JSON.parse(frozen.payload) as Record<string, unknown>) : null;
      const mine = parsed ? (parsed[memberId] as Record<string, unknown> | undefined) : undefined;
      if (mine) {
        res.status(200).json(mine);
        return;
      }
    }
    const lines = await invoiceLines(client, memberId, month);
    const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
    res.status(200).json({
      memberId,
      month,
      status: closed ? 'closed' : 'open',
      lines,
      totalCents: total,
      hourBank: await hourBankObject(client, memberId, month),
    });
  });
};

/** The months a Kill Bill invoice's marked items belong to. */
async function invoiceMonths(client: PoolClient, items: { itemDetails: string | null }[]): Promise<string[]> {
  const markerIds = items
    .filter((item) => item.itemDetails && item.itemDetails.startsWith(MARKER))
    .map((item) => item.itemDetails!.slice(MARKER.length));
  if (markerIds.length === 0) return [];
  const rows = (await client.query<{ month: string }>(`SELECT DISTINCT month FROM kb_items WHERE id = ANY($1)`, [markerIds])).rows;
  return rows.map((row) => row.month);
}

/** The Kill Bill amount for a member and month: sum of items except CBA_ADJ. */
async function killBillAmount(client: PoolClient, ctx: RouteContext, memberId: string, month: string): Promise<number> {
  const account = await ensureKbAccount(client, ctx, memberId);
  const invoices = await ctx.killbill.listInvoices(account);
  let sum = 0;
  for (const invoice of invoices) {
    const items = invoice.items.filter((item) => item.itemType !== 'CBA_ADJ');
    if (items.length === 0) continue;
    const months = await invoiceMonths(client, items);
    if (!months.includes(month)) continue;
    const committed = (await client.query<{ amount_cents: number }>(
      `SELECT amount_cents FROM committed_invoices WHERE member_id=$1 AND month=$2 AND kb_invoice_id=$3`,
      [memberId, month, invoice.invoiceId],
    )).rows[0];
    if (committed) {
      sum += committed.amount_cents;
      continue;
    }
    for (const item of items) sum += Math.round(item.amount * 100);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// POST /api/months/{month}/close
// ---------------------------------------------------------------------------
export const closeMonth: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const month = String(req.params.month);
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  if (Object.keys(body).length > 0) {
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) errors[key] = 'This field cannot be set.';
    throw new ApiError('validation_failed', { errors });
  }
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
  await withContentionRetry(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [`month:${caller.kitchen.id}`, month]);
    const state = (await client.query<{ closed: boolean }>(`SELECT closed FROM invoice_state WHERE kitchen_id=$1 AND month=$2`, [caller.kitchen.id, month])).rows[0];
    if (state?.closed) {
      throw new ApiError('month_closed', {}, (n) => (n === 'monthName' ? monthName(month) : ''));
    }
    const members = (await client.query<{ id: string; business_name: string; kitchen_id: string }>(`SELECT id, business_name, kitchen_id FROM members WHERE kitchen_id=$1 ORDER BY id`, [caller.kitchen.id])).rows;
    const totals = new Map<string, number>();
    const linesByMember = new Map<string, InvoiceLine[]>();
    for (const member of members) {
      const lines = await invoiceLines(client, member.id, month);
      linesByMember.set(member.id, lines);
      totals.set(member.id, lines.reduce((sum, line) => sum + line.amountCents, 0));
    }
    const pending = (await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM kb_items WHERE kitchen_id=$1 AND month=$2 AND recorded=false`,
      [caller.kitchen.id, month],
    )).rows[0].count;
    if (Number(pending) > 0) throw new ApiError('billing_pending');
    if (!(await ctx.killbill.reachable())) throw new ApiError('billing_unavailable');

    // Read every member's Kill Bill invoice back before the first commit.
    const mismatched: string[] = [];
    for (const member of members) {
      const amount = await killBillAmount(client, ctx, member.id, month);
      if (amount !== (totals.get(member.id) ?? 0)) mismatched.push(member.id);
    }
    if (mismatched.length > 0) {
      mismatched.sort();
      const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [mismatched[0]])).rows[0].business_name;
      throw new ApiError('billing_mismatch', { members: mismatched }, (n) => (n === 'business' ? business : ''));
    }
    for (const member of members) {
      await commitMemberInvoices(client, ctx, member, month);
    }
    const invoices: { memberId: string; totalCents: number }[] = [];
    const frozenInvoices: Record<string, unknown> = {};
    for (const member of members) {
      const lines = linesByMember.get(member.id)!;
      const total = totals.get(member.id) ?? 0;
      if (lines.length === 0) continue;
      invoices.push({ memberId: member.id, totalCents: total });
      frozenInvoices[member.id] = {
        memberId: member.id,
        month,
        status: 'closed',
        lines,
        totalCents: total,
        hourBank: await hourBankObject(client, member.id, month),
      };
      await client.query(
        `INSERT INTO close_names (kitchen_id, month, member_id, business_name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (kitchen_id, month, member_id) DO NOTHING`,
        [caller.kitchen.id, month, member.id, member.business_name],
      );
      const email = await getPersonEmail(client, member.id);
      await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'mail',$2::jsonb)`, [
        newId('out'),
        JSON.stringify({
          kind: 'mail',
          to: email,
          subject: `Statement for ${monthName(month)}: ${member.business_name}`,
          body: statementBody(month, member.business_name, lines.map((l) => ({ description: l.description, amountCents: l.amountCents })), total),
        }),
      ]);
    }
    await client.query(
      `INSERT INTO invoice_state (kitchen_id, month, closed, closed_at) VALUES ($1,$2,true,now())
       ON CONFLICT (kitchen_id, month) DO UPDATE SET closed=true, closed_at=now()`,
      [caller.kitchen.id, month],
    );
    await client.query(
      `INSERT INTO frozen_figures (kitchen_id, month, kind, payload) VALUES ($1,$2,'invoice',$3::jsonb)
       ON CONFLICT (kitchen_id, month, kind) DO UPDATE SET payload=$3::jsonb`,
      [caller.kitchen.id, month, JSON.stringify(frozenInvoices)],
    );
    const reportJson = await buildUtilisation(client, caller.kitchen.id, month);
    await client.query(
      `INSERT INTO frozen_figures (kitchen_id, month, kind, payload) VALUES ($1,$2,'report',$3::jsonb)
       ON CONFLICT (kitchen_id, month, kind) DO UPDATE SET payload=$3::jsonb`,
      [caller.kitchen.id, month, JSON.stringify(reportJson)],
    );
    const csv = await buildUsageCsv(client, caller.kitchen.id, month, true, caller.kitchen.time_zone);
    await client.query(
      `INSERT INTO frozen_figures (kitchen_id, month, kind, payload) VALUES ($1,$2,'csv',$3)
       ON CONFLICT (kitchen_id, month, kind) DO UPDATE SET payload=$3`,
      [caller.kitchen.id, month, csv],
    );
    res.status(200).json({ month, invoices });
  });
};

/** Commits every draft invoice of the member for the month, each exactly once. */
async function commitMemberInvoices(client: PoolClient, ctx: RouteContext, member: { id: string; kitchen_id: string }, month: string): Promise<void> {
  const account = await ensureKbAccount(client, ctx, member.id);
  const invoices = await ctx.killbill.listInvoices(account);
  for (const invoice of invoices) {
    if (invoice.status !== 'DRAFT') continue;
    const items = invoice.items.filter((item) => item.itemType !== 'CBA_ADJ');
    if (items.length === 0) continue;
    const months = await invoiceMonths(client, items);
    if (!months.includes(month)) continue;
    const amount = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    await ctx.killbill.commitInvoice(invoice.invoiceId);
    await client.query(
      `INSERT INTO committed_invoices (id, kitchen_id, member_id, month, kb_invoice_id, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [newId('cmi'), member.kitchen_id, member.id, month, invoice.invoiceId, amount],
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/utilisation?month=
// ---------------------------------------------------------------------------
export const utilisationReport: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  let month = currentMonthInZone(nowDate(), caller.kitchen.time_zone);
  if (typeof req.query.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
    month = req.query.month;
  }
  await withContentionRetry(async (client) => {
    const closed = await monthClosed(client, caller.kitchen.id, month);
    if (closed) {
      const frozen = (await client.query<{ payload: string }>(`SELECT payload FROM frozen_figures WHERE kitchen_id=$1 AND month=$2 AND kind='report'`, [caller.kitchen.id, month])).rows[0];
      if (frozen) {
        res.status(200).json(JSON.parse(frozen.payload));
        return;
      }
    }
    res.status(200).json(await buildUtilisation(client, caller.kitchen.id, month));
  });
};

async function buildUtilisation(client: PoolClient, kitchenId: string, month: string): Promise<Record<string, unknown>> {
  const stations = (await client.query<{ id: string; name: string }>(`SELECT id, name FROM stations WHERE kitchen_id=$1 ORDER BY lane_order`, [kitchenId])).rows;
  const countedHourly = (await client.query<{ station_id: string; hours: string; peak_hours: string; charge_cents: number }>(
    `SELECT station_id, hours, peak_hours, charge_cents FROM bookings
      WHERE kitchen_id=$1 AND status IN ('confirmed','checked_in','completed','no_show')
        AND to_char(local_date,'YYYY-MM')=$2 AND kind='hourly'`,
    [kitchenId, month],
  )).rows;
  const countedShelf = (await client.query<{ station_id: string; days: number; charge_cents: number }>(
    `SELECT station_id, days, charge_cents FROM bookings
      WHERE kitchen_id=$1 AND status IN ('confirmed','checked_in','completed','no_show')
        AND to_char(local_date,'YYYY-MM')=$2 AND kind='shelf'`,
    [kitchenId, month],
  )).rows;
  const fees = (await client.query<{ station_id: string; penalty_cents: number }>(
    `SELECT station_id, penalty_cents FROM bookings
      WHERE kitchen_id=$1 AND status='cancelled_late' AND penalty_waived=false
        AND to_char(local_date,'YYYY-MM')=$2`,
    [kitchenId, month],
  )).rows;
  const adjustments = Number(
    (await client.query<{ sum: string | null }>(
      `SELECT COALESCE(sum(amount_cents),0)::text AS sum FROM kb_items WHERE kitchen_id=$1 AND month=$2 AND kind='adjustment_credit'`,
      [kitchenId, month],
    )).rows[0].sum ?? 0,
  );
  const out = [];
  let totalHours = 0;
  let totalPeak = 0;
  let totalShelfDays = 0;
  let totalRevenue = 0;
  for (const station of stations) {
    const myHourly = countedHourly.filter((row) => row.station_id === station.id);
    const myShelf = countedShelf.filter((row) => row.station_id === station.id);
    const bookedHours = myHourly.reduce((s, r) => s + Number(r.hours), 0);
    const peakHours = myHourly.reduce((s, r) => s + Number(r.peak_hours), 0);
    const shelfDays = myShelf.reduce((s, r) => s + r.days, 0);
    const revenue =
      myHourly.reduce((s, r) => s + r.charge_cents, 0) +
      myShelf.reduce((s, r) => s + r.charge_cents, 0) +
      fees.filter((f) => f.station_id === station.id).reduce((s, f) => s + f.penalty_cents, 0);
    totalHours += bookedHours;
    totalPeak += peakHours;
    totalShelfDays += shelfDays;
    totalRevenue += revenue;
    out.push({ stationId: station.id, name: station.name, bookedHours, peakHours, shelfDays, revenueCents: revenue });
  }
  return {
    month,
    stations: out,
    totals: { bookedHours: totalHours, peakHours: totalPeak, shelfDays: totalShelfDays, revenueCents: totalRevenue, adjustmentCents: adjustments },
  };
}

// ---------------------------------------------------------------------------
// GET /api/exports/usage.csv?month=
// ---------------------------------------------------------------------------
export const usageCsv: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  let month = currentMonthInZone(nowDate(), caller.kitchen.time_zone);
  if (typeof req.query.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
    month = req.query.month;
  }
  await withContentionRetry(async (client) => {
    const closed = await monthClosed(client, caller.kitchen.id, month);
    let csv: string;
    if (closed) {
      const frozen = (await client.query<{ payload: string }>(`SELECT payload FROM frozen_figures WHERE kitchen_id=$1 AND month=$2 AND kind='csv'`, [caller.kitchen.id, month])).rows[0];
      csv = frozen?.payload ?? (await buildUsageCsv(client, caller.kitchen.id, month, true, caller.kitchen.time_zone));
    } else {
      csv = await buildUsageCsv(client, caller.kitchen.id, month, false, caller.kitchen.time_zone);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lineboard-usage-${caller.kitchen.slug}-${month}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(csv, 'utf8'));
  });
};

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Text cells that could run as a spreadsheet formula are neutralised. */
function neutralise(value: string): string {
  const first = value.codePointAt(0);
  if (first === 0x3d || first === 0x2b || first === 0x2d || first === 0x40 || first === 9 || first === 13) {
    return `'${value}`;
  }
  return value;
}

export async function buildUsageCsv(client: PoolClient, kitchenId: string, month: string, frozen: boolean, timeZone: string): Promise<string> {
  const rows: string[] = [];
  rows.push('booking_id,member_id,business_name,station,date,start,end,hours,peak_hours,shelf_days,status,charge,penalty,billing_status,hour_bank_balance,notes');
  const bookings = (await client.query<{
    id: string; member_id: string; business_name: string; station_id: string; local_date: string;
    local_start: string | null; local_end: string | null; kind: string; hours: string; peak_hours: string;
    days: number | null; status: string; charge_cents: number; penalty_cents: number; penalty_waived: boolean;
    recorded_count: string; total_count: string; notes: string;
  }>(
    `SELECT b.*, m.business_name,
            (SELECT count(*) FROM kb_items k WHERE k.booking_id=b.id AND k.recorded)::text AS recorded_count,
            (SELECT count(*) FROM kb_items k WHERE k.booking_id=b.id)::text AS total_count
       FROM bookings b JOIN members m ON m.id=b.member_id
      WHERE b.kitchen_id=$1 AND to_char(b.local_date,'YYYY-MM')=$2
        AND (b.status='held' OR b.confirmed_at IS NOT NULL)
      ORDER BY b.start_at`,
    [kitchenId, month],
  )).rows;
  for (const booking of bookings) {
    const counted = ['confirmed', 'checked_in', 'completed', 'no_show'].includes(booking.status);
    const businessName = frozen
      ? (await closeName(client, kitchenId, month, booking.member_id)) ?? booking.business_name
      : booking.business_name;
    const charge = counted ? booking.charge_cents : 0;
    const penalty = booking.status === 'cancelled_late' && !booking.penalty_waived ? booking.penalty_cents : 0;
    const billingStatus = Number(booking.total_count) === 0 ? 'not_billed' : Number(booking.recorded_count) === Number(booking.total_count) ? 'billed' : 'pending_billing';
    const balance = await memberBalance(client, booking.member_id, month);
    rows.push(
      [
        csvEscape(booking.id),
        csvEscape(booking.member_id),
        csvEscape(neutralise(businessName)),
        csvEscape(await stationNameOf(client, booking.station_id)),
        csvEscape(booking.local_date),
        csvEscape(booking.kind === 'hourly' ? (booking.local_start ?? '') : ''),
        csvEscape(booking.kind === 'hourly' ? (booking.local_end ?? '') : ''),
        booking.kind === 'hourly' ? String(Number(booking.hours)) : '0',
        booking.kind === 'hourly' ? String(Number(booking.peak_hours)) : '0',
        booking.kind === 'shelf' ? String(booking.days ?? 0) : '0',
        csvEscape(booking.status),
        centsToDollarString(charge),
        centsToDollarString(penalty),
        billingStatus,
        String(balance),
        csvEscape(booking.notes ?? ''),
      ].join(','),
    );
  }
  const adjustments = (await client.query<{ booking_id: string; member_id: string; created_at: Date; amount_cents: number; recorded: boolean }>(
    `SELECT * FROM kb_items WHERE kitchen_id=$1 AND month=$2 AND kind='adjustment_credit' ORDER BY created_at, id`,
    [kitchenId, month],
  )).rows;
  for (const adj of adjustments) {
    const booking = (await client.query<{ station_id: string }>(`SELECT station_id FROM bookings WHERE id=$1`, [adj.booking_id])).rows[0];
    const balance = await memberBalance(client, adj.member_id, month);
    const businessName = frozen
      ? (await closeName(client, kitchenId, month, adj.member_id)) ?? ''
      : (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [adj.member_id])).rows[0].business_name;
    rows.push(
      [
        csvEscape(adj.booking_id ?? ''),
        csvEscape(adj.member_id),
        csvEscape(neutralise(businessName)),
        csvEscape(booking ? await stationNameOf(client, booking.station_id) : ''),
        csvEscape(localDateInZone(adj.created_at, timeZone)),
        '',
        '',
        '0',
        '0',
        '0',
        'adjustment',
        centsToDollarString(adj.amount_cents),
        '0.00',
        adj.recorded ? 'billed' : 'pending_billing',
        String(balance),
        '',
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

async function closeName(client: PoolClient, kitchenId: string, month: string, memberId: string): Promise<string | null> {
  const row = (await client.query<{ business_name: string }>(`SELECT business_name FROM close_names WHERE kitchen_id=$1 AND month=$2 AND member_id=$3`, [kitchenId, month, memberId])).rows[0];
  return row?.business_name ?? null;
}

async function memberBalance(client: PoolClient, memberId: string, month: string): Promise<number> {
  const row = (await client.query<{ allowance_hours: number; sum: string | null }>(
    `SELECT m.allowance_hours, (SELECT COALESCE(sum(hours),0) FROM hour_ledger h WHERE h.member_id=m.id AND h.month=$2) AS sum
       FROM members m WHERE m.id=$1`,
    [memberId, month],
  )).rows[0];
  return Math.max(0, row.allowance_hours - Number(row.sum ?? 0));
}

export { formatInstant };
