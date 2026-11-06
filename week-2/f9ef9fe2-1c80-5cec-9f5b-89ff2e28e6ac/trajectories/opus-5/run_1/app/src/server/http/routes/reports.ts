import { Router } from 'express';
import type { UsageReport } from '../../../shared/types.js';
import { formatAmount, formatHours } from '../../../shared/format.js';
import { pool, query } from '../../db/pool.js';
import { loadStations, stationMap } from '../../domain/kitchens.js';
import { packBalanceQuarters } from '../../domain/pack.js';
import { TIER_COUNTING_STATES } from '../../domain/quoting.js';
import { isValidMonth } from '../../domain/time.js';
import { requireKitchen, requireRole, requireUser } from '../access.js';
import { ok, param, route } from '../context.js';
import { failures } from '../errors.js';

export const reportRoutes = Router();

const STANDING_STATES = [...TIER_COUNTING_STATES];

async function buildReport(
  kitchen: { id: string; name: string; timezone: string },
  month: string,
): Promise<UsageReport> {
  const stations = await loadStations(pool, kitchen.id);
  const members = await query<{ id: string; business: string }>(
    pool,
    'SELECT id, business FROM members WHERE kitchen_id = $1 ORDER BY business',
    [kitchen.id],
  );

  const bookedByMember = await query<{ member_id: string; quarters: string }>(
    pool,
    `SELECT b.member_id, count(*)::text AS quarters
       FROM booking_cells bc JOIN bookings b ON b.id = bc.booking_id
      WHERE b.kitchen_id = $1 AND to_char(b.date, 'YYYY-MM') = $2 AND b.state = ANY($3::text[])
      GROUP BY b.member_id`,
    [kitchen.id, month, STANDING_STATES],
  );
  const cancelledByMember = await query<{ member_id: string; quarters: string }>(
    pool,
    `SELECT b.member_id, count(*)::text AS quarters
       FROM booking_cells bc JOIN bookings b ON b.id = bc.booking_id
      WHERE b.kitchen_id = $1 AND to_char(b.date, 'YYYY-MM') = $2
        AND b.state = 'cancelled_in_window'
      GROUP BY b.member_id`,
    [kitchen.id, month],
  );
  const refundedByMember = await query<{ member_id: string; refunded: string }>(
    pool,
    `SELECT member_id, sum(total_cents)::text AS refunded
       FROM bookings
      WHERE kitchen_id = $1 AND to_char(date, 'YYYY-MM') = $2
        AND state = 'cancelled_in_window'
      GROUP BY member_id`,
    [kitchen.id, month],
  );
  const billedByMember = await query<{ member_id: string; billed: string }>(
    pool,
    `SELECT i.member_id, sum(i.total_cents)::text AS billed
       FROM invoices i
      WHERE i.kitchen_id = $1
        AND to_char(i.issued_at AT TIME ZONE $3, 'YYYY-MM') = $2
      GROUP BY i.member_id`,
    [kitchen.id, month, kitchen.timezone],
  );
  const bookedByStation = await query<{ station_id: string; quarters: string }>(
    pool,
    `SELECT bc.station_id, count(*)::text AS quarters
       FROM booking_cells bc JOIN bookings b ON b.id = bc.booking_id
      WHERE b.kitchen_id = $1 AND to_char(b.date, 'YYYY-MM') = $2 AND b.state = ANY($3::text[])
      GROUP BY bc.station_id`,
    [kitchen.id, month, STANDING_STATES],
  );
  const invoiceRows = await query<{
    invoice_id: string;
    ref: string;
    kind: string;
    member_id: string;
    business: string;
    killbill_invoice_id: string | null;
    total_cents: number;
    issued_on: string;
  }>(
    pool,
    `SELECT i.id AS invoice_id, i.ref, i.kind, i.member_id, m.business, i.killbill_invoice_id,
            i.total_cents,
            to_char(i.issued_at AT TIME ZONE $3, 'YYYY-MM-DD') AS issued_on
       FROM invoices i JOIN members m ON m.id = i.member_id
      WHERE i.kitchen_id = $1 AND to_char(i.issued_at AT TIME ZONE $3, 'YYYY-MM') = $2
      ORDER BY i.ref`,
    [kitchen.id, month, kitchen.timezone],
  );

  const memberRows: UsageReport['members'] = [];
  for (const member of members) {
    const booked = Number(bookedByMember.find((row) => row.member_id === member.id)?.quarters ?? 0);
    const cancelled = cancelledByMember.find((row) => row.member_id === member.id);
    const refunded = refundedByMember.find((row) => row.member_id === member.id);
    memberRows.push({
      member_id: member.id,
      business: member.business,
      booked_hours: formatHours(booked),
      cancelled_in_window_hours: formatHours(Number(cancelled?.quarters ?? 0)),
      billed_cents: Number(billedByMember.find((row) => row.member_id === member.id)?.billed ?? 0),
      refunded_cents: Number(refunded?.refunded ?? 0),
      pack_balance_hours: formatHours(await packBalanceQuarters(pool, member.id)),
    });
  }

  const totalQuarters = bookedByMember.reduce((sum, row) => sum + Number(row.quarters), 0);
  return {
    kitchen: { id: kitchen.id, name: kitchen.name, timezone: kitchen.timezone },
    month,
    members: memberRows,
    stations: stations.map((station) => ({
      station_id: station.id,
      name: station.name,
      booked_hours: formatHours(
        Number(bookedByStation.find((row) => row.station_id === station.id)?.quarters ?? 0),
      ),
    })),
    invoices: invoiceRows,
    totals: {
      booked_hours: formatHours(totalQuarters),
      billed_cents: memberRows.reduce((sum, row) => sum + row.billed_cents, 0),
      refunded_cents: memberRows.reduce((sum, row) => sum + row.refunded_cents, 0),
    },
  };
}

function requireMonth(value: unknown): string {
  if (!isValidMonth(value)) throw failures.validation({ month: 'Give a month as YYYY-MM.' });
  return value;
}

reportRoutes.get(
  '/kitchens/:kitchen_id/reports/usage',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator', 'bookkeeper');
    const month = requireMonth(ctx.req.query.month);
    return ok(await buildReport(kitchen, month));
  }),
);

reportRoutes.get(
  '/kitchens/:kitchen_id/reports/usage.csv',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator', 'bookkeeper');
    const month = requireMonth(ctx.req.query.month);
    const report = await buildReport(kitchen, month);
    const stations = stationMap(await loadStations(pool, kitchen.id));

    const lines = await query<{
      invoice_id: string;
      booking_ref: string | null;
      cell_date: string | null;
      station_id: string | null;
      tier: number | null;
      paid_by: string | null;
      quarters: number | null;
      amount_cents: number;
    }>(
      pool,
      `SELECT l.invoice_id, b.ref AS booking_ref, l.cell_date, l.station_id, l.tier, l.paid_by,
              l.quarters, l.amount_cents
         FROM invoice_lines l
         LEFT JOIN bookings b ON b.id = l.booking_id
        WHERE l.invoice_id = ANY($1::text[])
        ORDER BY l.invoice_id, l.idx`,
      [report.invoices.map((invoice) => invoice.invoice_id)],
    );

    const escape = (value: string): string =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const rows: string[] = ['invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount'];
    for (const invoice of report.invoices) {
      for (const line of lines.filter((entry) => entry.invoice_id === invoice.invoice_id)) {
        const station = line.station_id ? stations.get(line.station_id) : undefined;
        rows.push(
          [
            invoice.ref,
            invoice.kind,
            invoice.business,
            line.booking_ref ?? '',
            line.cell_date ?? '',
            station ? station.name : '',
            line.tier === null ? '' : String(line.tier),
            line.paid_by ?? '',
            line.quarters === null ? '' : formatHours(line.quarters),
            formatAmount(line.amount_cents).replace(/,/g, ''),
          ]
            .map(escape)
            .join(','),
        );
      }
    }

    ctx.res.status(200);
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader(
      'Content-Disposition',
      `attachment; filename="pilotlight-usage-${kitchen.id}-${month}.csv"`,
    );
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.send(`${rows.join('\n')}\n`);
    return null;
  }),
);
