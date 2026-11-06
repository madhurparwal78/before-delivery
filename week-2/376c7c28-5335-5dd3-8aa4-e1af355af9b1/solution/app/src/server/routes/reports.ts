import { now } from '../clock.ts';
import { first, pool, rows, transaction, type Queryable } from '../db/pool.ts';
import { csvDocument } from '../domain/csv.ts';
import { plainDollars } from '../domain/money.ts';
import { cubicInches } from '../domain/quote.ts';
import {
  addDays,
  daysBetween,
  firstDateOfMonth,
  isDateString,
  isMonthString,
  monthOfDate,
  nextMonth,
  startOfStudioDay,
  studioDate,
} from '../domain/studio-day.ts';
import { publish } from '../events.ts';
import { ApiError, ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { safeParam } from '../http/pipeline.ts';
import { newId } from '../security.ts';
import { studioToday } from '../views.ts';
import type { PieceStatus } from '../../shared/labels.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

const STATEMENT_HEADER = [
  'date',
  'entry',
  'charge_id',
  'member_handle',
  'piece_title',
  'firing',
  'cubic_inches',
  'rate_cents',
  'amount',
] as const;

interface MonthWindow {
  readonly month: string;
  readonly from: Date;
  readonly to: Date;
}

function monthWindow(month: string, timeZone: string): MonthWindow {
  return {
    month,
    from: startOfStudioDay(firstDateOfMonth(month), timeZone),
    to: startOfStudioDay(firstDateOfMonth(nextMonth(month)), timeZone),
  };
}

function monthFromQuery(ctx: Ctx): string {
  const raw = ctx.query.get('month');
  if (raw === null) return monthOfDate(studioToday(ctx.actorOrFail.studio.time_zone));
  if (!isMonthString(raw)) {
    const bag = new ValidationBag();
    bag.add('month', V.month);
    bag.throwIfAny();
  }
  return raw;
}

interface RevenueFigures {
  readonly fees_cents: number;
  readonly refunds_cents: number;
  readonly charge_count: number;
}

async function revenueFigures(
  client: Queryable,
  studioId: string,
  window: MonthWindow,
): Promise<RevenueFigures> {
  const settled = await rows<{ fees: number; count: number }>(
    client,
    `select coalesce(sum(fee_cents), 0)::bigint as fees, count(*)::bigint as count
       from charges
      where studio_id = $1 and settled_at >= $2 and settled_at < $3`,
    [studioId, window.from, window.to],
  );
  const refunded = await rows<{ refunds: number }>(
    client,
    `select coalesce(sum(fee_cents), 0)::bigint as refunds
       from charges
      where studio_id = $1 and refunded_at >= $2 and refunded_at < $3`,
    [studioId, window.from, window.to],
  );
  return {
    fees_cents: settled[0]?.fees ?? 0,
    refunds_cents: refunded[0]?.refunds ?? 0,
    charge_count: settled[0]?.count ?? 0,
  };
}

interface StatementRow {
  readonly charge_id: string;
  readonly handle: string;
  readonly title: string;
  readonly firing: 'bisque' | 'glaze' | 'storage';
  readonly cubic_eighths: number | null;
  readonly rate_cents: number;
  readonly fee_cents: number;
  readonly at: Date;
  readonly entry: 'fee' | 'storage' | 'refund';
}

async function statementRows(
  client: Queryable,
  studioId: string,
  window: MonthWindow,
): Promise<StatementRow[]> {
  const found = await rows<StatementRow>(
    client,
    `select c.id as charge_id, owner.handle, p.title, c.firing, c.cubic_eighths, c.rate_cents,
            c.fee_cents, c.settled_at as at,
            case when c.firing = 'storage' then 'storage' else 'fee' end as entry
       from charges c
       join pieces p on p.id = c.piece_id
       join people owner on owner.id = c.member_id
      where c.studio_id = $1 and c.settled_at >= $2 and c.settled_at < $3
     union all
     select c.id as charge_id, owner.handle, p.title, c.firing, c.cubic_eighths, c.rate_cents,
            c.fee_cents, c.refunded_at as at, 'refund' as entry
       from charges c
       join pieces p on p.id = c.piece_id
       join people owner on owner.id = c.member_id
      where c.studio_id = $1 and c.refunded_at >= $2 and c.refunded_at < $3
      order by at, charge_id`,
    [studioId, window.from, window.to],
  );
  return found;
}

async function buildStatement(
  client: Queryable,
  studioId: string,
  timeZone: string,
  window: MonthWindow,
): Promise<string> {
  const source = await statementRows(client, studioId, window);
  const body = source.map((row) => [
    studioDate(row.at, timeZone),
    row.entry,
    row.charge_id,
    row.handle,
    row.title,
    row.firing,
    row.cubic_eighths === null ? '' : cubicInches(row.cubic_eighths).toFixed(3),
    String(row.rate_cents),
    plainDollars(row.fee_cents),
  ]);
  return csvDocument(STATEMENT_HEADER, body);
}

interface ClosedRow {
  readonly closed_at: Date;
  readonly fees_cents: number;
  readonly refunds_cents: number;
  readonly net_cents: number;
  readonly charge_count: number;
  readonly statement_csv: string;
}

async function closedMonth(studioId: string, month: string): Promise<ClosedRow | null> {
  return first<ClosedRow>(
    pool,
    `select closed_at, fees_cents, refunds_cents, net_cents, charge_count, statement_csv
       from closed_months where studio_id = $1 and month = $2`,
    [studioId, month],
  );
}

async function readRevenue(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const month = monthFromQuery(ctx);
  const stored = await closedMonth(actor.studio.id, month);
  if (stored) {
    return {
      status: 200,
      body: {
        month,
        closed_at: stored.closed_at.toISOString(),
        fees_cents: stored.fees_cents,
        refunds_cents: stored.refunds_cents,
        net_cents: stored.net_cents,
        charge_count: stored.charge_count,
      },
    };
  }
  const window = monthWindow(month, actor.studio.time_zone);
  const figures = await revenueFigures(pool, actor.studio.id, window);
  return {
    status: 200,
    body: {
      month,
      closed_at: null,
      fees_cents: figures.fees_cents,
      refunds_cents: figures.refunds_cents,
      net_cents: figures.fees_cents - figures.refunds_cents,
      charge_count: figures.charge_count,
    },
  };
}

async function closeMonth(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const month = safeParam(ctx, 'month');
  if (!isMonthString(month)) throw new ApiError('not_found');
  const window = monthWindow(month, actor.studio.time_zone);
  if (now().getTime() < window.to.getTime()) throw new ApiError('month_open');

  const outcome = await transaction(async (client) => {
    const figures = await revenueFigures(client, actor.studio.id, window);
    const statement = await buildStatement(
      client,
      actor.studio.id,
      actor.studio.time_zone,
      window,
    );
    const closedAt = now();
    const inserted = await rows<{ month: string }>(
      client,
      `insert into closed_months (studio_id, month, closed_at, fees_cents, refunds_cents,
                                  net_cents, charge_count, statement_csv)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (studio_id, month) do nothing
       returning month`,
      [
        actor.studio.id,
        month,
        closedAt,
        figures.fees_cents,
        figures.refunds_cents,
        figures.fees_cents - figures.refunds_cents,
        figures.charge_count,
        statement,
      ],
    );
    if (inserted.length === 0) throw new ApiError('month_closed');
    await publish(client, { kind: 'month', id: month, studio_id: actor.studio.id });
    return { figures, closedAt };
  });
  return {
    status: 200,
    body: {
      month,
      closed_at: outcome.closedAt.toISOString(),
      fees_cents: outcome.figures.fees_cents,
      refunds_cents: outcome.figures.refunds_cents,
      net_cents: outcome.figures.fees_cents - outcome.figures.refunds_cents,
      charge_count: outcome.figures.charge_count,
    },
  };
}

async function exportStatement(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const month = monthFromQuery(ctx);
  const stored = await closedMonth(actor.studio.id, month);
  const csv =
    stored?.statement_csv ??
    (await buildStatement(
      pool,
      actor.studio.id,
      actor.studio.time_zone,
      monthWindow(month, actor.studio.time_zone),
    ));
  return {
    status: 200,
    raw: {
      buffer: Buffer.from(csv, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: {
        'content-disposition': `attachment; filename="statement-${month}.csv"`,
      },
    },
  };
}

interface FiringRow {
  readonly load_id: string;
  readonly kiln_name: string;
  readonly firing: 'bisque' | 'glaze';
  readonly unloaded_at: Date;
  readonly piece_count: number;
  readonly value_cents: number;
}

async function readFiringLog(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const raw = ctx.query.get('date');
  if (raw !== null && !isDateString(raw)) {
    const bag = new ValidationBag();
    bag.add('date', V.date);
    bag.throwIfAny();
  }
  const date = raw ?? studioToday(actor.studio.time_zone);
  const from = startOfStudioDay(date, actor.studio.time_zone);
  const nextStart = startOfStudioDay(addDays(date, 1), actor.studio.time_zone);
  const firings = await rows<FiringRow>(
    pool,
    `select l.id as load_id, k.name as kiln_name, l.firing, l.unloaded_at,
            count(pl.piece_id)::bigint as piece_count,
            coalesce(sum(case when l.firing = 'bisque' then p.bisque_fee_cents
                              else p.glaze_fee_cents end), 0)::bigint as value_cents
       from loads l
       join kilns k on k.id = l.kiln_id
       left join placements pl on pl.load_id = l.id
       left join pieces p on p.id = pl.piece_id
      where l.studio_id = $1 and l.unloaded_at >= $2 and l.unloaded_at < $3
      group by l.id, k.name, l.firing, l.unloaded_at
      order by l.unloaded_at`,
    [actor.studio.id, from, nextStart],
  );
  return {
    status: 200,
    body: {
      date,
      time_zone: actor.studio.time_zone,
      firings: firings.map((row) => ({
        load_id: row.load_id,
        kiln_name: row.kiln_name,
        firing: row.firing,
        unloaded_at: row.unloaded_at.toISOString(),
        piece_count: row.piece_count,
        value_cents: row.value_cents,
      })),
    },
  };
}

const BACKLOG_STATES: readonly PieceStatus[] = [
  'logged',
  'waiting_bisque',
  'bisqued',
  'waiting_glaze',
  'ready_for_pickup',
];

async function readDashboard(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const today = studioToday(actor.studio.time_zone);
  const counted = await rows<{ status: PieceStatus; total: number }>(
    pool,
    `select status, count(*)::bigint as total from pieces
      where studio_id = $1 and status = any($2) group by status`,
    [actor.studio.id, BACKLOG_STATES],
  );
  const counts: Record<string, number> = {};
  for (const state of BACKLOG_STATES) counts[state] = 0;
  for (const row of counted) counts[row.status] = row.total;

  const waiting = await rows<{
    id: string;
    title: string;
    owner_handle: string;
    status: PieceStatus;
    waiting_since: Date;
  }>(
    pool,
    `select p.id, p.title, owner.handle as owner_handle, p.status, p.waiting_since
       from pieces p join people owner on owner.id = p.member_id
      where p.studio_id = $1 and p.status in ('waiting_bisque','waiting_glaze')
        and p.waiting_since is not null
      order by p.waiting_since asc limit 10`,
    [actor.studio.id],
  );
  const pending = await rows<{ total: number }>(
    pool,
    `select count(*)::bigint as total from charges where studio_id = $1 and status = 'pending'`,
    [actor.studio.id],
  );
  const month = monthOfDate(today);
  const stored = await closedMonth(actor.studio.id, month);
  const figures = stored
    ? { net: stored.net_cents }
    : await (async () => {
        const window = monthWindow(month, actor.studio.time_zone);
        const sums = await revenueFigures(pool, actor.studio.id, window);
        return { net: sums.fees_cents - sums.refunds_cents };
      })();

  return {
    status: 200,
    body: {
      today,
      counts,
      longest_waiting: waiting.map((row) => ({
        id: row.id,
        title: row.title,
        owner_handle: row.owner_handle,
        status: row.status,
        days_waiting: daysBetween(studioDate(row.waiting_since, actor.studio.time_zone), today),
      })),
      pending_charges: pending[0]?.total ?? 0,
      month_revenue_cents: figures.net,
    },
  };
}

interface ScheduleRow {
  readonly id: string;
  readonly effective_from: string;
  readonly member_bisque_cents: number;
  readonly member_glaze_cents: number;
  readonly dropoff_bisque_cents: number;
  readonly dropoff_glaze_cents: number;
}

const RATE_FIELDS = [
  'member_bisque_cents',
  'member_glaze_cents',
  'dropoff_bisque_cents',
  'dropoff_glaze_cents',
] as const;

async function createSchedule(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const bag = new ValidationBag();
  const values: number[] = [];
  for (const field of RATE_FIELDS) {
    const value = ctx.json[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
      bag.add(field, V.rateCents);
      values.push(0);
    } else {
      values.push(value);
    }
  }
  const effectiveFrom = ctx.json['effective_from'];
  const today = studioToday(actor.studio.time_zone);
  if (!isDateString(effectiveFrom)) bag.add('effective_from', V.effectiveFromPast);
  else if (effectiveFrom < today) bag.add('effective_from', V.effectiveFromPast);
  bag.throwIfAny();

  const id = newId();
  const inserted = await rows<ScheduleRow>(
    pool,
    `insert into rate_schedules (id, studio_id, effective_from, member_bisque_cents,
        member_glaze_cents, dropoff_bisque_cents, dropoff_glaze_cents, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (studio_id, effective_from) do nothing
     returning id, effective_from, member_bisque_cents, member_glaze_cents,
               dropoff_bisque_cents, dropoff_glaze_cents`,
    [id, actor.studio.id, effectiveFrom, values[0], values[1], values[2], values[3], now()],
  );
  if (inserted.length === 0) {
    const taken = new ValidationBag();
    taken.add('effective_from', V.effectiveFromTaken);
    taken.throwIfAny();
  }
  await publish(pool, { kind: 'rates', id, studio_id: actor.studio.id });
  return { status: 201, body: inserted[0] };
}

export const reportRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/rate-schedules',
    role: 'owner',
    handle: async (ctx) => ({
      status: 200,
      body: await rows<ScheduleRow>(
        pool,
        `select id, effective_from, member_bisque_cents, member_glaze_cents,
                dropoff_bisque_cents, dropoff_glaze_cents
           from rate_schedules where studio_id = $1 order by effective_from desc`,
        [ctx.actorOrFail.studio.id],
      ),
    }),
  },
  { method: 'POST', pattern: '/api/rate-schedules', role: 'owner', handle: createSchedule },
  { method: 'GET', pattern: '/api/dashboard', role: 'owner', handle: readDashboard },
  { method: 'GET', pattern: '/api/reports/revenue', role: 'owner', handle: readRevenue },
  {
    method: 'POST',
    pattern: '/api/reports/months/:month/close',
    role: 'owner',
    handle: closeMonth,
  },
  { method: 'GET', pattern: '/api/reports/statement.csv', role: 'owner', handle: exportStatement },
  { method: 'GET', pattern: '/api/firing-log', role: 'owner', handle: readFiringLog },
];
