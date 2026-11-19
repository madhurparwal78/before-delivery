import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, invalid, notFound } from '../errors.js';
import { copy } from '../copy.js';
import { inTransaction, makeId, query } from '../db.js';
import { requireDesk } from '../session.js';
import { isMoneyString, isPercentString, moneyString, parseMoney, percentTenths } from '../../domain/money.js';
import { cancellationCharge } from '../../domain/payments.js';
import { instantString, isDateString, isTimeString, readWall, ukDateOf } from '../../domain/time.js';
import { depositFor, vehicleMoney } from '../../domain/vehicles.js';
import { HireView, loadHire, makeQuotePage } from '../data/hires.js';
import { recordRefundDue } from '../data/payments.js';
import { mailQuote } from '../mails.js';
import { replaceStops } from '../data/trips.js';

type ChangeAsk = {
  departAt: { date: string; time: string } | null;
  stops: string[] | null;
  vehicles: { id: string; boughtPrice: number | null; marginTenths: number | null }[];
};

function readChangeBody(body: Record<string, unknown>, hire: HireView): ChangeAsk {
  let departAt: { date: string; time: string } | null = null;
  if (body.departAt !== undefined && body.departAt !== null) {
    const asked = body.departAt as Record<string, unknown>;
    if (!isDateString(asked.date)) throw invalid(copy.enterDate, { departAt: copy.enterDate });
    if (!isTimeString(asked.time)) throw invalid(copy.chooseHourAndMinutes, { departAt: copy.chooseHourAndMinutes });
    departAt = { date: asked.date, time: asked.time };
  }
  let stops: string[] | null = null;
  if (body.stops !== undefined && body.stops !== null) {
    const asked = Array.isArray(body.stops) ? (body.stops as unknown[]) : [];
    if (asked.length < 2 || asked.some((stop) => typeof stop !== 'string' || stop.trim() === '')) {
      throw invalid(copy.enterPickUp, { stops: copy.enterPickUp });
    }
    stops = (asked as string[]).map((stop) => stop.trim());
  }
  const vehicles: ChangeAsk['vehicles'] = [];
  if (body.vehicles !== undefined && body.vehicles !== null) {
    const rows = Array.isArray(body.vehicles) ? (body.vehicles as Record<string, unknown>[]) : [];
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!hire.vehicles.some((vehicle) => vehicle.id === id)) throw notFound();
      let boughtPrice: number | null = null;
      if (row.boughtPrice !== undefined && row.boughtPrice !== null) {
        if (!isMoneyString(row.boughtPrice)) throw invalid(copy.enterAmount, { boughtPrice: copy.enterAmount });
        boughtPrice = parseMoney(row.boughtPrice);
      }
      let marginTenths: number | null = null;
      if (row.marginPercent !== undefined && row.marginPercent !== null) {
        if (!isPercentString(row.marginPercent)) throw invalid(copy.marginRange, { marginPercent: copy.marginRange });
        marginTenths = percentTenths(row.marginPercent);
        if (marginTenths > 600 || marginTenths % 5 !== 0) throw invalid(copy.marginRange, { marginPercent: copy.marginRange });
      }
      vehicles.push({ id, boughtPrice, marginTenths });
    }
  }
  return { departAt, stops, vehicles };
}

function sideOf(hire: HireView, ask: ChangeAsk | null): Record<string, unknown> {
  const vehicles = hire.vehicles.map((vehicle) => {
    const change = ask?.vehicles.find((row) => row.id === vehicle.id);
    const boughtPrice = change?.boughtPrice ?? vehicle.boughtPrice;
    const marginTenths = change?.marginTenths ?? vehicle.marginTenths;
    const money = vehicleMoney(boughtPrice, marginTenths, vehicle.seats, hire.rates);
    return {
      id: vehicle.id,
      seats: vehicle.seats,
      total: moneyString(money.total + vehicle.extraCharges),
      deposit: moneyString(depositFor(money.total, vehicle.seats, hire.rates)),
      totalPennies: money.total + vehicle.extraCharges,
    };
  });
  return {
    departAt: ask?.departAt ?? hire.departAt,
    stops: ask?.stops ?? hire.stops.map((stop) => stop.text),
    vehicles: vehicles.map(({ totalPennies, ...rest }) => rest),
    total: moneyString(vehicles.reduce((sum, vehicle) => sum + vehicle.totalPennies, 0)),
  };
}

function linesOf(hire: HireView, ask: ChangeAsk): { vehicleId: string; refundsDue: number; owed: number }[] {
  return hire.vehicles.map((vehicle) => {
    const change = ask.vehicles.find((row) => row.id === vehicle.id);
    const boughtPrice = change?.boughtPrice ?? vehicle.boughtPrice;
    const marginTenths = change?.marginTenths ?? vehicle.marginTenths;
    const money = vehicleMoney(boughtPrice, marginTenths, vehicle.seats, hire.rates);
    const total = money.total + vehicle.extraCharges;
    const paid = vehicle.depositPaid + vehicle.balancePaid;
    return {
      vehicleId: vehicle.id,
      refundsDue: Math.max(0, paid - total),
      owed: Math.max(0, total - paid),
    };
  });
}

function priceMoves(hire: HireView, ask: ChangeAsk): boolean {
  return hire.vehicles.some((vehicle) => {
    const change = ask.vehicles.find((row) => row.id === vehicle.id);
    if (!change) return false;
    const boughtPrice = change.boughtPrice ?? vehicle.boughtPrice;
    const marginTenths = change.marginTenths ?? vehicle.marginTenths;
    const money = vehicleMoney(boughtPrice, marginTenths, vehicle.seats, hire.rates);
    return money.total !== vehicle.quoteTotal;
  });
}

export const changeRoutes: Route[] = [
  route('POST', '/api/hires/:id/changes/preview', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    if (!hire.page?.acceptedAt) throw conflict('notAccepted', copy.noAcceptedQuote);
    const ask = readChangeBody(body, hire);
    ctx.json(200, {
      old: sideOf(hire, null),
      new: sideOf(hire, ask),
      priceMoved: priceMoves(hire, ask),
      lines: linesOf(hire, ask).map((line) => ({
        vehicleId: line.vehicleId,
        refundsDue: moneyString(line.refundsDue),
        owed: moneyString(line.owed),
      })),
    });
  }),

  route('POST', '/api/hires/:id/changes', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    if (!hire.page?.acceptedAt) throw conflict('notAccepted', copy.noAcceptedQuote);
    const ask = readChangeBody(body, hire);
    const oldSide = sideOf(hire, null);
    const newSide = sideOf(hire, ask);
    const moved = priceMoves(hire, ask);
    const lines = linesOf(hire, ask);
    const now = Date.now();
    const changeId = makeId('CG');
    let quotePath = hire.page ? `/q/${hire.page.token}` : null;

    await inTransaction(async (client) => {
      if (ask.departAt) {
        const reading = readWall(ask.departAt);
        if (!reading) throw invalid(copy.enterDate, { departAt: copy.enterDate });
        await client.query(
          'update enquiries set depart_date = $3, depart_time = $4, depart_instant = $5 where desk_id = $1 and id = $2',
          [desk.id, hire.id, ask.departAt.date, ask.departAt.time, reading.instant],
        );
        await client.query(
          'update runs set depart_date = $3, depart_time = $4, depart_instant = $5 where desk_id = $1 and hire_id = $2',
          [desk.id, hire.id, ask.departAt.date, ask.departAt.time, reading.instant],
        );
      }
      for (const vehicle of ask.vehicles) {
        if (vehicle.boughtPrice !== null) {
          await client.query('update vehicles set bought_price = $3 where desk_id = $1 and id = $2', [
            desk.id,
            vehicle.id,
            vehicle.boughtPrice,
          ]);
        }
        if (vehicle.marginTenths !== null) {
          await client.query('update vehicles set margin_tenths = $3 where desk_id = $1 and id = $2', [
            desk.id,
            vehicle.id,
            vehicle.marginTenths,
          ]);
        }
      }
      for (const line of lines) {
        await recordRefundDue(client, desk.id, hire.id, line.vehicleId, line.refundsDue, now);
      }
      await client.query(
        `insert into hire_changes (desk_id, id, hire_id, old_body, new_body, price_moved, lines, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          desk.id,
          changeId,
          hire.id,
          JSON.stringify(oldSide),
          JSON.stringify(newSide),
          moved,
          JSON.stringify(lines),
          now,
        ],
      );
      if (moved && hire.page) {
        await client.query('update quote_pages set replaced = true where desk_id = $1 and id = $2', [
          desk.id,
          hire.page.id,
        ]);
        const page = await makeQuotePage(client, desk.id, hire.id, hire.quoteVersion + 1, now, true);
        await client.query('update hires set quote_version = quote_version + 1 where desk_id = $1 and id = $2', [
          desk.id,
          hire.id,
        ]);
        quotePath = `/q/${page.token}`;
      }
    });
    if (ask.stops) await replaceStops(desk.id, hire.id, ask.stops);
    if (moved) {
      const fresh = assertKnown(await loadHire(desk.id, hire.id));
      if (fresh.page) {
        await query('update vehicles set deposit = null where desk_id = $1 and hire_id = $2', [desk.id, hire.id]);
        await mailQuote(
          fresh.customer.email,
          fresh.reference,
          fresh.customer.language,
          fresh.vehicles.reduce((sum, vehicle) => sum + vehicle.quoteTotal, 0),
          fresh.page.validUntil,
          `/q/${fresh.page.token}`,
        );
      }
    }
    ctx.json(201, {
      id: changeId,
      quotePath,
      old: oldSide,
      new: newSide,
      priceMoved: moved,
      lines: lines.map((line) => ({
        vehicleId: line.vehicleId,
        refundsDue: moneyString(line.refundsDue),
        owed: moneyString(line.owed),
      })),
    });
  }),

  route('GET', '/api/hires/:id/changes', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const changes = await query<{
      id: string;
      old_body: unknown;
      new_body: unknown;
      price_moved: boolean;
      lines: unknown;
      created_at: string;
    }>(
      'select id, old_body, new_body, price_moved, lines, created_at from hire_changes where desk_id = $1 and hire_id = $2 order by created_at',
      [desk.id, hire.id],
    );
    const cancellation = await heldCancellation(desk.id, hire.id);
    ctx.json(200, {
      changes: changes.map((change) => ({
        id: change.id,
        old: change.old_body,
        new: change.new_body,
        priceMoved: change.price_moved,
        lines: change.lines,
        at: instantString(Number(change.created_at)),
      })),
      cancellation,
    });
  }),

  route('POST', '/api/hires/:id/cancel/preview', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const ask = readCancelBody(body);
    if (hire.departInstant <= Date.now()) throw conflict('departureGone', copy.departureGone);
    ctx.json(200, { cancellation: cancellationOf(hire, ask, null, null) });
  }),

  route('POST', '/api/hires/:id/cancel', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const held = await heldCancellation(desk.id, hire.id);
    if (held) {
      ctx.json(200, { cancellation: held });
      return;
    }
    const ask = readCancelBody(body);
    if (hire.departInstant <= Date.now()) throw conflict('departureGone', copy.departureGone);
    const now = Date.now();
    const id = makeId('CN');
    const worked = cancellationOf(hire, ask, id, now);
    await inTransaction(async (client) => {
      await client.query(
        `insert into cancellations (desk_id, id, hire_id, notice_date, notice_time, notice_instant, by_whom, lines, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          desk.id,
          id,
          hire.id,
          ask.noticeAt.date,
          ask.noticeAt.time,
          readWall(ask.noticeAt)?.instant ?? now,
          ask.by,
          JSON.stringify(worked.lines),
          now,
        ],
      );
      await client.query('update hires set cancelled_at = $3 where desk_id = $1 and id = $2', [desk.id, hire.id, now]);
      for (const line of worked.lines as { vehicleId: string; refundsDue: string }[]) {
        const refund = parseMoney(line.refundsDue);
        if (refund > 0) {
          await recordRefundDue(client, desk.id, hire.id, line.vehicleId, refund, now);
        }
      }
    });
    ctx.json(200, { cancellation: worked, announcement: copy.bookingCancelled });
  }),
];

type CancelAsk = { noticeAt: { date: string; time: string }; by: 'customer' | 'arranger' };

function readCancelBody(body: Record<string, unknown>): CancelAsk {
  const noticeAt = body.noticeAt;
  if (noticeAt === null || typeof noticeAt !== 'object' || Array.isArray(noticeAt)) {
    throw invalid(copy.enterDate, { noticeAt: copy.enterDate });
  }
  const asked = noticeAt as Record<string, unknown>;
  if (!isDateString(asked.date)) throw invalid(copy.enterDate, { noticeAt: copy.enterDate });
  if (!isTimeString(asked.time)) throw invalid(copy.chooseHourAndMinutes, { noticeAt: copy.chooseHourAndMinutes });
  const by = body.by;
  if (by !== 'customer' && by !== 'arranger') throw invalid('Choose who gave notice.', { by: 'Choose who gave notice.' });
  return { noticeAt: { date: asked.date, time: asked.time }, by };
}

/** A cancellation by the arranger returns exactly what was paid. */
function cancellationOf(
  hire: HireView,
  ask: CancelAsk,
  id: string | null,
  at: number | null,
): Record<string, unknown> {
  const lines = hire.vehicles.map((vehicle) => {
    const departureDate = vehicle.departAt?.date ?? hire.departAt.date;
    const paid = vehicle.depositPaid + vehicle.balancePaid;
    if (ask.by === 'arranger') {
      return {
        vehicleId: vehicle.id,
        days: 0,
        charge: moneyString(0),
        paid: moneyString(paid),
        refundsDue: moneyString(paid),
        owed: moneyString(0),
      };
    }
    const worked = cancellationCharge(ask.noticeAt.date, departureDate, vehicle.total, vehicle.deposit);
    return {
      vehicleId: vehicle.id,
      days: worked.days,
      charge: moneyString(worked.charge),
      paid: moneyString(paid),
      refundsDue: moneyString(Math.max(0, paid - worked.charge)),
      owed: moneyString(Math.max(0, worked.charge - paid)),
    };
  });
  return {
    id: id ?? null,
    noticeAt: instantString(readWall(ask.noticeAt)?.instant ?? at ?? Date.now()),
    by: ask.by,
    lines,
  };
}

async function heldCancellation(deskId: string, hireId: string): Promise<Record<string, unknown> | null> {
  const row = await query<{
    id: string;
    notice_date: string;
    notice_time: string;
    notice_instant: string;
    by_whom: string;
    lines: unknown;
  }>(
    'select id, notice_date, notice_time, notice_instant, by_whom, lines from cancellations where desk_id = $1 and hire_id = $2 order by created_at limit 1',
    [deskId, hireId],
  );
  const held = row[0];
  if (!held) return null;
  return {
    id: held.id,
    noticeAt: instantString(Number(held.notice_instant)),
    by: held.by_whom,
    lines: held.lines,
  };
}

export { ukDateOf };
