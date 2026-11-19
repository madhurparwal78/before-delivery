import * as copy from '../../../shared/copy';
import type { PartShape, Settings } from '../../../shared/types';
import {
  CLOSES_AFTER_OPENS_MESSAGE,
  isQuarterHour,
  QUARTER_HOUR_MESSAGE,
} from '../../domain/calendar';
import { placeRectangle } from '../../domain/board';
import {
  isIanaZone,
  parseClockTime,
  parseLibraryDate,
  today,
  WEEKDAYS,
  weekdayOf,
  type Weekday,
} from '../../../shared/time';
import { pool, withTransaction } from '../../repo/db';
import {
  deleteClosure,
  insertClosure,
  moveDueDatesOntoOpenDays,
  readCalendar,
  readClosures,
  readSettings,
  replaceHours,
  sortedHours,
  writeSettings,
} from '../../repo/calendar';
import {
  insertItem,
  insertPart,
  readItem,
  takenPlacements,
  updateItem,
} from '../../repo/inventory';
import { readServiceStatus } from '../../services/status';
import * as fail from '../errors';
import { FieldProblems, invalid } from '../errors';
import { jsonReply, type Reply, type Route } from '../pipeline';
import { inRange, readArray, readInteger, readString } from '../validate';

const SHAPES: readonly PartShape[] = [
  'drill',
  'saw',
  'ladder',
  'hammer',
  'wrench',
  'case',
  'battery',
  'cable',
  'blade',
  'generic',
];

function coordinatorOnly(role: string | null): void {
  if (role !== 'coordinator') throw fail.coordinatorOnly();
}

export const statusRoute: Route = {
  method: 'GET',
  pattern: '/api/status',
  body: 'json',
  auth: 'anyone',
  run: async (): Promise<Reply> => jsonReply(200, readServiceStatus()),
};

export const readSettingsRoute: Route = {
  method: 'GET',
  pattern: '/api/settings',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => {
    if (ctx.role === 'member') throw fail.staffOnly();
  },
  run: async (): Promise<Reply> => jsonReply(200, await readSettings(pool)),
};

export const writeSettingsRoute: Route = {
  method: 'PUT',
  pattern: '/api/settings',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const timeZone = readString(body, 'time_zone') ?? '';
    const lateFee = readInteger(body, 'late_fee_cents');
    const damageFee = readInteger(body, 'damage_fee_cents');
    const loanPeriod = readInteger(body, 'loan_period_days');
    const problems = new FieldProblems();
    if (!isIanaZone(timeZone)) problems.add('time_zone', 'Give an IANA time zone name.');
    if (lateFee === null || !inRange(lateFee, 0, 10000)) {
      problems.add('late_fee_cents', 'Give a whole number of cents from 0 to 10,000.');
    }
    if (damageFee === null || !inRange(damageFee, 0, 100000)) {
      problems.add('damage_fee_cents', 'Give a whole number of cents from 0 to 100,000.');
    }
    if (loanPeriod === null || !inRange(loanPeriod, 1, 28)) {
      problems.add('loan_period_days', 'Give a whole number of days from 1 to 28.');
    }
    problems.throwIfAny();
    const settings: Settings = {
      time_zone: timeZone,
      late_fee_cents: lateFee as number,
      damage_fee_cents: damageFee as number,
      loan_period_days: loanPeriod as number,
    };
    await writeSettings(pool, settings);
    return jsonReply(200, settings);
  },
};

export const readCalendarRoute: Route = {
  method: 'GET',
  pattern: '/api/calendar',
  body: 'json',
  auth: 'anyone',
  run: async (ctx): Promise<Reply> => {
    const calendar = await readCalendar(pool);
    const libraryToday = today(calendar.timeZone, ctx.now);
    return jsonReply(200, {
      time_zone: calendar.timeZone,
      hours: sortedHours(calendar),
      closures: await readClosures(pool),
      next_open_days: calendar.nextOpenDays(libraryToday, 10),
    });
  },
};

interface HoursEntryInput {
  weekday: Weekday;
  opens: string;
  closes: string;
}

/** The published hours validation: structure first, then times in weekday order. */
function validateHours(value: unknown): HoursEntryInput[] {
  const structural = (): never => {
    throw invalid({ hours: 'List each open weekday once, with its opening and closing times.' });
  };
  if (!Array.isArray(value)) structural();
  const entries = value as unknown[];
  const seen = new Set<string>();
  const parsed: { weekday: Weekday; opens: unknown; closes: unknown }[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) structural();
    const record = entry as Record<string, unknown>;
    const weekday = record.weekday;
    if (typeof weekday !== 'string' || !WEEKDAYS.includes(weekday as Weekday)) structural();
    if (seen.has(weekday as string)) structural();
    seen.add(weekday as string);
    parsed.push({ weekday: weekday as Weekday, opens: record.opens, closes: record.closes });
  }
  if (parsed.length === 0) structural();

  const problems = new FieldProblems();
  for (const weekday of WEEKDAYS) {
    const entry = parsed.find((candidate) => candidate.weekday === weekday);
    if (!entry) continue;
    const opensValid = typeof entry.opens === 'string' && isQuarterHour(entry.opens);
    const closesValid = typeof entry.closes === 'string' && isQuarterHour(entry.closes);
    if (!opensValid) problems.add(`hours.${weekday}.opens`, QUARTER_HOUR_MESSAGE);
    if (!closesValid) problems.add(`hours.${weekday}.closes`, QUARTER_HOUR_MESSAGE);
    if (opensValid && closesValid) {
      const opens = parseClockTime(entry.opens as string) as number;
      const closes = parseClockTime(entry.closes as string) as number;
      if (closes <= opens) problems.add(`hours.${weekday}.closes`, CLOSES_AFTER_OPENS_MESSAGE);
    }
  }
  problems.throwIfAny();
  return parsed.map((entry) => ({
    weekday: entry.weekday,
    opens: entry.opens as string,
    closes: entry.closes as string,
  }));
}

export const writeHoursRoute: Route = {
  method: 'PUT',
  pattern: '/api/calendar/hours',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx): Promise<Reply> => {
    const hours = validateHours(ctx.json().hours);
    return withTransaction(async (client) => {
      await replaceHours(client, hours);
      const calendar = await readCalendar(client);
      const movedLoans = await moveDueDatesOntoOpenDays(client, calendar);
      return jsonReply(200, { hours: sortedHours(calendar), moved_loans: movedLoans });
    });
  },
};

export const declareClosureRoute: Route = {
  method: 'POST',
  pattern: '/api/closures',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const date = readString(body, 'date') ?? '';
    const reason = readString(body, 'reason') ?? '';
    const calendar = await readCalendar(pool);
    const libraryToday = today(calendar.timeZone, ctx.now);
    const problems = new FieldProblems();
    if (parseLibraryDate(date) === null) {
      problems.add('date', 'Give a date as YYYY-MM-DD.');
    } else if (date < libraryToday) {
      problems.add('date', 'Closures can only be declared for today or later.');
    } else if (calendar.hoursFor(weekdayOf(date)) === null) {
      problems.add('date', 'The library is already closed on that weekday.');
    }
    if (reason.length < 1 || reason.length > 120) {
      problems.add('reason', 'Give a reason of 1 to 120 characters.');
    }
    problems.throwIfAny();
    return withTransaction(async (client) => {
      if (!(await insertClosure(client, date, reason))) {
        throw fail.conflict(copy.DAY_ALREADY_CLOSED);
      }
      const updated = await readCalendar(client);
      const movedLoans = await moveDueDatesOntoOpenDays(client, updated);
      return jsonReply(201, {
        closure: { date, reason },
        moved_loans: movedLoans,
        new_due_date: updated.nextOpenDayAfter(date),
      });
    });
  },
};

export const removeClosureRoute: Route<{ date: string }> = {
  method: 'DELETE',
  pattern: '/api/closures/:date',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const date = ctx.params.date ?? '';
    if (parseLibraryDate(date) === null) throw fail.notFound();
    const closures = await readClosures(pool);
    if (!closures.some((closure) => closure.date === date)) throw fail.notFound();
    return { date };
  },
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const settings = await readSettings(pool);
    if (resolved.date < today(settings.time_zone, ctx.now)) {
      throw fail.conflict(copy.PAST_CLOSURE);
    }
    await deleteClosure(pool, resolved.date);
    return { kind: 'empty', status: 204 };
  },
};

export const readItemRoute: Route<{ id: number }> = {
  method: 'GET',
  pattern: '/api/items/:id',
  body: 'json',
  auth: 'anyone',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readItem(pool, id))) throw fail.notFound();
    return { id };
  },
  run: async (ctx, resolved): Promise<Reply> => {
    const item = await readItem(pool, resolved.id);
    if (!item) throw fail.notFound();
    if (ctx.role === 'member' || ctx.role === null) return jsonReply(200, { item });
    const queue = await pool.query<{ position: number; member_name: string; status: string }>(
      `select row_number() over (order by h.placed_at, h.id)::int as position,
       u.name as member_name, h.status from holds h join users u on u.id = h.member_id
       where h.item_id = $1 and h.status in ('queued', 'ready') order by h.placed_at, h.id`,
      [resolved.id],
    );
    return jsonReply(200, { item, queue: queue.rows });
  },
};

export const addItemRoute: Route = {
  method: 'POST',
  pattern: '/api/items',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const tag = (readString(body, 'tag') ?? '').trim().toUpperCase();
    const name = (readString(body, 'name') ?? '').trim();
    const cost = readInteger(body, 'replacement_cost_cents');
    const parts = readArray(body, 'parts');
    const problems = new FieldProblems();
    if (!/^PW-\d{3,5}$/.test(tag)) {
      problems.add('tag', 'Use PW- followed by three to five digits.');
    } else {
      const clash = await pool.query('select id from items where upper(tag) = $1', [tag]);
      if (clash.rows.length > 0) problems.add('tag', 'That tag is already on the board.');
    }
    if (name.length < 1 || name.length > 80) {
      problems.add('name', 'Give a name of 1 to 80 characters.');
    }
    if (cost === null || !inRange(cost, 1, 1_000_000)) {
      problems.add('replacement_cost_cents', 'Give a whole number of cents from 1 to 1,000,000.');
    }
    const validParts: { name: string; shape: PartShape; width: number; height: number }[] = [];
    if (parts === null || parts.length < 1 || parts.length > 8) {
      problems.add('parts', 'List one to eight parts.');
    } else {
      for (const entry of parts) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          problems.add('parts', 'Give each part a name, shape, width and height.');
          break;
        }
        const record = entry as Record<string, unknown>;
        const partName = (readString(record, 'name') ?? '').trim();
        const shape = readString(record, 'shape') ?? '';
        const width = readInteger(record, 'width');
        const height = readInteger(record, 'height');
        if (
          partName.length < 1 ||
          partName.length > 80 ||
          !SHAPES.includes(shape as PartShape) ||
          width === null ||
          height === null ||
          !inRange(width, 2, 10) ||
          !inRange(height, 2, 10)
        ) {
          problems.add(
            'parts',
            'Give each part a name, a known shape, and a width and height from 2 to 10 holes.',
          );
          break;
        }
        validParts.push({ name: partName, shape: shape as PartShape, width, height });
      }
    }
    problems.throwIfAny();

    return withTransaction(async (client) => {
      const itemId = await insertItem(client, tag, name, cost as number);
      const taken = await takenPlacements(client);
      let listedAt = 0;
      for (const part of validParts) {
        const spot = placeRectangle(taken, part.width, part.height);
        taken.push(spot);
        await insertPart(client, itemId, { ...part, ...spot, listedAt });
        listedAt += 1;
      }
      const item = await readItem(client, itemId);
      return jsonReply(201, { item });
    });
  },
};

export const patchItemRoute: Route<{ id: number }> = {
  method: 'PATCH',
  pattern: '/api/items/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readItem(pool, id))) throw fail.notFound();
    return { id };
  },
  role: (ctx) => coordinatorOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const body = ctx.json();
    const problems = new FieldProblems();
    const changes: { name?: string; replacementCostCents?: number } = {};
    if ('name' in body) {
      const name = (readString(body, 'name') ?? '').trim();
      if (name.length < 1 || name.length > 80) {
        problems.add('name', 'Give a name of 1 to 80 characters.');
      } else {
        changes.name = name;
      }
    }
    if ('replacement_cost_cents' in body) {
      const cost = readInteger(body, 'replacement_cost_cents');
      if (cost === null || !inRange(cost, 1, 1_000_000)) {
        problems.add('replacement_cost_cents', 'Give a whole number of cents from 1 to 1,000,000.');
      } else {
        changes.replacementCostCents = cost;
      }
    }
    problems.throwIfAny();
    await updateItem(pool, resolved.id, changes);
    return jsonReply(200, { item: await readItem(pool, resolved.id) });
  },
};
