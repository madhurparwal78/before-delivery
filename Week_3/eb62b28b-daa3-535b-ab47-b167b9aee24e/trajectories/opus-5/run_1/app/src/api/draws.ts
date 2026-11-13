import {
  DrawRow,
  MemberRow,
  PhlebotomistRow,
  findDraw,
  findMember,
  findPhlebotomist,
  latestVisitPage,
  listPhlebotomists,
} from '../data';
import { newId, query } from '../db';
import { conflict, notFound } from '../http/errors';
import { Route, defineRoute, jsonBody, person } from '../http/kernel';
import { copy, twoTimeForm } from '../shared/copy';
import { readKitCode } from '../shared/kitcode';
import { stateName } from '../shared/catalog';
import {
  DateOnly,
  PRACTICE_ZONE,
  TimeZoneId,
  addDays,
  dateOnlyDifference,
  displayDate,
  formatDateOnly,
  instantToIso,
  localDate,
  localTime,
  parseDateOnly,
} from '../shared/time';
import {
  MEMBER_WINDOW_DAYS,
  STAFF_WINDOW_DAYS,
  changesCloseAt,
  localToday,
  nextFreeSlot,
  plusCoversDate,
  slotTaken,
  slotTimesFor,
  startsAtOf,
  timeIsOnGrid,
  winnerName,
} from '../domain/draws';
import { membershipOf } from '../services/memberships';
import { endVisitPages, sendVisitPage } from '../services/visitPages';
import { FieldErrors, readString } from './validate';
import { drawView } from './views';
import { requireMember } from './members';

const DRAW_STATES = ['booked', 'collected', 'ready', 'released', 'cancelled'];

async function requirePhlebotomist(id: string): Promise<PhlebotomistRow> {
  const found = await findPhlebotomist(id);
  if (!found) throw notFound();
  return found;
}

async function requireDraw(id: string): Promise<DrawRow> {
  const draw = await findDraw(id);
  if (!draw) throw notFound();
  const member = await findMember(draw.member_id);
  if (!member || member.account_state === 'erased') throw notFound();
  return draw;
}

async function viewOf(draw: DrawRow, withMemberName: boolean): Promise<unknown> {
  const member = await findMember(draw.member_id);
  const phlebotomist = await findPhlebotomist(draw.phlebotomist_id);
  return drawView(draw, {
    memberName: withMemberName ? member?.name ?? copy.erasedMember : null,
    phlebotomistName: phlebotomist?.name ?? '',
    now: new Date(),
  });
}

interface BookingInput {
  phlebotomistId: string;
  date: DateOnly;
  time: string;
  collectedAt: Date | null;
  kitCodes: string[];
}

function readBooking(
  body: Record<string, unknown>,
  member: MemberRow,
  phlebotomist: PhlebotomistRow,
  byStaff: boolean,
  now: Date,
): BookingInput {
  const errors = new FieldErrors();
  const today = localToday(member.time_zone, now);
  const rawDate = readString(body.date);
  const date = rawDate ? parseDateOnly(rawDate) : null;
  if (!date) {
    errors.add('date', copy.fieldDateForm);
  } else {
    const difference = dateOnlyDifference(today, date);
    if (byStaff) {
      if (difference < -STAFF_WINDOW_DAYS || difference > STAFF_WINDOW_DAYS) {
        errors.add('date', copy.staffDateWindow);
      }
    } else if (difference < 1 || difference > MEMBER_WINDOW_DAYS) {
      errors.add('date', copy.memberDateWindow);
    }
  }
  const time = readString(body.time) ?? '';
  if (date && !timeIsOnGrid(date, today, time, { staffSameDay: byStaff })) {
    errors.add('time', copy.slotNotPublished);
  }
  if (!phlebotomist.states.includes(member.state)) {
    errors.add('phlebotomistId', copy.phlebotomistState(stateName(member.state)));
  }
  let collectedAt: Date | null = null;
  const kitCodes: string[] = [];
  const isPast = date ? dateOnlyDifference(today, date) < 0 : false;
  if (isPast && date) {
    const rawCollected = readString(body.collectedAt);
    const parsed = rawCollected ? new Date(rawCollected) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      errors.add('collectedAt', copy.collectedAtRequired);
    } else if (localDate(parsed, member.time_zone) !== formatDateOnly(date)) {
      errors.add('collectedAt', copy.collectedAtRequired);
    } else {
      collectedAt = parsed;
    }
    const rawCodes = Array.isArray(body.kitCodes) ? body.kitCodes : [];
    if (rawCodes.length === 0) errors.add('kitCodes', copy.kitCodeShape);
    for (const raw of rawCodes) {
      const read = readKitCode(typeof raw === 'string' ? raw : '');
      if (!read.kitCode) {
        errors.add('kitCodes', read.problem === 'check' ? copy.kitCodeCheck : copy.kitCodeShape);
      } else if (!kitCodes.includes(read.kitCode)) {
        kitCodes.push(read.kitCode);
      }
    }
  }
  errors.throwIfAny();
  return {
    phlebotomistId: phlebotomist.id,
    date: date as DateOnly,
    time,
    collectedAt,
    kitCodes,
  };
}

async function refuseUnlessBookable(
  member: MemberRow,
  input: BookingInput,
  startsAt: Date,
  exceptDrawId: string | null,
  asStaff: boolean,
  now: Date,
): Promise<void> {
  if (member.account_state !== 'active') throw conflict('account_closing', copy.writeToClosing);
  const membership = await membershipOf(member.id);
  const today = localToday(member.time_zone, now);
  const isPast = dateOnlyDifference(today, input.date) < 0;
  const coverDate = isPast ? localDate(now, PRACTICE_ZONE) : localDate(startsAt, PRACTICE_ZONE);
  if (!plusCoversDate(membership, coverDate)) {
    throw conflict('plus_required', copy.plusRequired);
  }
  if (!member.address_line1) throw conflict('address_required', copy.addressRequired);
  const taken = await slotTaken(input.phlebotomistId, startsAt, exceptDrawId);
  if (taken) await slotLost(member, input, startsAt, asStaff);
}

async function slotLost(
  member: MemberRow,
  input: BookingInput,
  startsAt: Date,
  asStaff: boolean,
): Promise<never> {
  const taken = await slotTaken(input.phlebotomistId, startsAt, null);
  const free = await nextFreeSlot(
    input.phlebotomistId,
    member.time_zone,
    formatDateOnly(input.date),
    input.time,
  );
  const message = asStaff
    ? copy.slotLostStaff(
        taken ? winnerName(taken) : 'a member',
        displayDate(free.date),
        free.time,
        member.time_zone,
      )
    : copy.slotLostMember(displayDate(free.date), free.time, member.time_zone);
  throw conflict('slot_taken', message);
}

function isSlotClash(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    String((error as { constraint?: string }).constraint ?? '').includes('draws_one_per_slot')
  );
}

async function createDraw(
  member: MemberRow,
  phlebotomist: PhlebotomistRow,
  input: BookingInput,
  bookedBy: { kind: 'staff' | 'member'; name: string },
  now: Date,
): Promise<DrawRow> {
  const startsAt = startsAtOf(member.time_zone, input.date, input.time);
  const today = localToday(member.time_zone, now);
  const isPast = dateOnlyDifference(today, input.date) < 0;
  const id = newId();
  try {
    await query(
      `insert into draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time,
         time_zone, collected_at, booked_by_kind, booked_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        member.id,
        phlebotomist.id,
        isPast ? 'collected' : 'booked',
        startsAt,
        formatDateOnly(input.date),
        input.time,
        member.time_zone,
        input.collectedAt,
        bookedBy.kind,
        bookedBy.name,
      ],
    );
  } catch (error) {
    if (isSlotClash(error)) await slotLost(member, input, startsAt, bookedBy.kind === 'staff');
    throw error;
  }
  for (const kitCode of input.kitCodes) {
    await query('insert into draw_kit_codes (draw_id, kit_code) values ($1, $2)', [id, kitCode]);
  }
  const draw = await findDraw(id);
  if (!draw) throw new Error('Draw vanished after create');
  if (!isPast) await sendVisitPage(draw, member, phlebotomist);
  return draw;
}

function slotRows(
  member: MemberRow,
  phlebotomists: PhlebotomistRow[],
  date: DateOnly,
  today: DateOnly,
  staffSameDay: boolean,
): { phlebotomist: PhlebotomistRow; time: string; startsAt: Date }[] {
  const times = slotTimesFor(date, today, { staffSameDay });
  const rows: { phlebotomist: PhlebotomistRow; time: string; startsAt: Date }[] = [];
  for (const phlebotomist of phlebotomists) {
    if (!phlebotomist.states.includes(member.state)) continue;
    for (const time of times) {
      rows.push({ phlebotomist, time, startsAt: startsAtOf(member.time_zone, date, time) });
    }
  }
  return rows;
}

async function slotsReply(member: MemberRow, dateText: string | null, staffSameDay: boolean) {
  const errors = new FieldErrors();
  const date = dateText ? parseDateOnly(dateText) : null;
  if (!date) errors.add('date', copy.fieldDateForm);
  errors.throwIfAny();
  const now = new Date();
  const today = localToday(member.time_zone, now);
  const phlebotomists = await listPhlebotomists();
  const rows = slotRows(member, phlebotomists, date as DateOnly, today, staffSameDay);
  const slots = [];
  for (const row of rows) {
    const taken = await slotTaken(row.phlebotomist.id, row.startsAt, null);
    slots.push({
      phlebotomistId: row.phlebotomist.id,
      phlebotomistName: row.phlebotomist.name,
      localTime: row.time,
      startsAt: instantToIso(row.startsAt),
      free: taken === null,
    });
  }
  return { status: 200, json: { slots } };
}

async function moveDraw(
  draw: DrawRow,
  member: MemberRow,
  body: Record<string, unknown>,
  byStaff: boolean,
  booker: { kind: 'staff' | 'member'; name: string },
): Promise<DrawRow> {
  const now = new Date();
  const phlebotomistId = readString(body.phlebotomistId) ?? draw.phlebotomist_id;
  const phlebotomist = await requirePhlebotomist(phlebotomistId);
  const input = readBooking(
    { ...body, date: readString(body.date) ?? draw.local_date, time: readString(body.time) ?? draw.local_time },
    member,
    phlebotomist,
    byStaff,
    now,
  );
  if (draw.state !== 'booked') throw conflict('not_booked', copy.notBooked);
  if (!byStaff) refuseAfterCutoff(draw, now);
  const startsAt = startsAtOf(member.time_zone, input.date, input.time);
  await refuseUnlessBookable(member, input, startsAt, draw.id, byStaff, now);
  try {
    await query(
      `update draws set phlebotomist_id = $2, starts_at = $3, local_date = $4, local_time = $5,
         booked_by_kind = $6, booked_by_name = $7 where id = $1`,
      [
        draw.id,
        phlebotomist.id,
        startsAt,
        formatDateOnly(input.date),
        input.time,
        booker.kind,
        booker.name,
      ],
    );
  } catch (error) {
    if (isSlotClash(error)) await slotLost(member, input, startsAt, byStaff);
    throw error;
  }
  const moved = await findDraw(draw.id);
  if (!moved) throw new Error('Draw vanished after the move');
  await sendVisitPage(moved, member, phlebotomist);
  return moved;
}

function refuseAfterCutoff(draw: DrawRow, now: Date): void {
  const cutoff = changesCloseAt(draw.time_zone, draw.local_date);
  if (now.getTime() >= cutoff.getTime()) {
    const cutoffDate = parseDateOnly(draw.local_date);
    if (!cutoffDate) throw new Error('Bad draw date');
    const dayBefore = addDays(cutoffDate, -1);
    throw conflict(
      'changes_closed',
      copy.changesClosed(displayDate(formatDateOnly(dayBefore)), draw.time_zone),
    );
  }
}

export function bookedAnnouncement(
  draw: DrawRow,
  zone: TimeZoneId,
  byStaff: boolean,
  moved: boolean,
): string {
  const date = displayDate(draw.local_date);
  const phoenixTime = localTime(draw.starts_at, PRACTICE_ZONE);
  if (byStaff) {
    const form = twoTimeForm(date, phoenixTime, draw.local_time, zone);
    return moved ? copy.drawMovedStaff(form) : copy.drawBookedStaff(form);
  }
  return moved
    ? copy.drawMovedMember(date, draw.local_time, zone)
    : copy.drawBookedMember(date, draw.local_time, zone);
}

export const drawRoutes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/api/phlebotomists',
    access: 'any',
    handler: async () => {
      const rows = await listPhlebotomists();
      return {
        status: 200,
        json: {
          phlebotomists: rows.map((row) => ({
            id: row.id,
            name: row.name,
            states: row.states,
          })),
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/slots',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => requireMember(ctx.query.get('memberId') ?? ''),
    handler: async (ctx, member) => slotsReply(member, ctx.query.get('date'), true),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/slots',
    access: ['member'],
    handler: async (ctx) => {
      const member = await requireMember(person(ctx).id);
      return slotsReply(member, ctx.query.get('date'), false);
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const member = await requireMember(readString(body.memberId) ?? '');
      const phlebotomist = await requirePhlebotomist(readString(body.phlebotomistId) ?? '');
      return { body, member, phlebotomist };
    },
    handler: async (ctx, { body, member, phlebotomist }) => {
      const now = new Date();
      const input = readBooking(body, member, phlebotomist, true, now);
      const startsAt = startsAtOf(member.time_zone, input.date, input.time);
      await refuseUnlessBookable(member, input, startsAt, null, true, now);
      const who = person(ctx);
      const draw = await createDraw(member, phlebotomist, input, {
        kind: 'staff',
        name: who.name,
      }, now);
      return { status: 201, json: { draw: await viewOf(draw, true) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/draws',
    access: ['member'],
    resolve: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const member = await requireMember(person(ctx).id);
      const phlebotomist = await requirePhlebotomist(readString(body.phlebotomistId) ?? '');
      return { body, member, phlebotomist };
    },
    handler: async (_ctx, { body, member, phlebotomist }) => {
      const now = new Date();
      const input = readBooking(body, member, phlebotomist, false, now);
      const startsAt = startsAtOf(member.time_zone, input.date, input.time);
      await refuseUnlessBookable(member, input, startsAt, null, false, now);
      const draw = await createDraw(member, phlebotomist, input, {
        kind: 'member',
        name: member.name ?? '',
      }, now);
      return { status: 201, json: { draw: await viewOf(draw, false) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/draws',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => {
      const memberId = ctx.query.get('memberId');
      if (memberId) await requireMember(memberId);
      return null;
    },
    handler: async (ctx) => {
      const from = ctx.query.get('from');
      const to = ctx.query.get('to');
      const state = ctx.query.get('state');
      const memberId = ctx.query.get('memberId');
      const errors = new FieldErrors();
      const choices = [from !== null && to !== null, state !== null, memberId !== null].filter(
        Boolean,
      );
      if (choices.length !== 1) errors.add('from', copy.drawQueryChoice);
      errors.throwIfAny();
      let rows: DrawRow[];
      if (memberId) {
        rows = await query<DrawRow>(
          'select * from draws where member_id = $1 order by starts_at desc',
          [memberId],
        );
      } else if (state) {
        if (!DRAW_STATES.includes(state)) {
          const stateErrors = new FieldErrors();
          stateErrors.add('state', copy.fieldChooseOption);
          stateErrors.throwIfAny();
        }
        rows = await query<DrawRow>(
          `select * from draws where state = $1
           order by coalesce(collected_at, starts_at), starts_at`,
          [state],
        );
      } else {
        const fromDate = parseDateOnly(from as string);
        const toDate = parseDateOnly(to as string);
        const rangeErrors = new FieldErrors();
        if (!fromDate) rangeErrors.add('from', copy.fieldDateForm);
        if (!toDate) rangeErrors.add('to', copy.fieldDateForm);
        rangeErrors.throwIfAny();
        if (dateOnlyDifference(fromDate as DateOnly, toDate as DateOnly) > 6) {
          const windowErrors = new FieldErrors();
          windowErrors.add('to', 'Choose a range of at most 7 days.');
          windowErrors.throwIfAny();
        }
        rows = await query<DrawRow>(
          `select * from draws
           where (starts_at at time zone 'America/Phoenix')::date between $1 and $2
           order by starts_at`,
          [from, to],
        );
      }
      const views = [];
      for (const row of rows) views.push(await viewOf(row, true));
      return { status: 200, json: { draws: views } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/draws/:drawId',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (_ctx, draw) => ({ status: 200, json: { draw: await viewOf(draw, true) } }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/draws',
    access: ['member'],
    handler: async (ctx) => {
      const rows = await query<DrawRow>(
        'select * from draws where member_id = $1 order by starts_at desc',
        [person(ctx).id],
      );
      const views = [];
      for (const row of rows) views.push(await viewOf(row, false));
      return { status: 200, json: { draws: views } };
    },
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/draws/:drawId',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const member = await requireMember(draw.member_id);
      const who = person(ctx);
      const moved = await moveDraw(draw, member, body, true, { kind: 'staff', name: who.name });
      return { status: 200, json: { draw: await viewOf(moved, true) } };
    },
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/me/draws/:drawId',
    access: ['member'],
    resolve: async (ctx) => {
      const draw = await requireDraw(ctx.params.drawId as string);
      if (draw.member_id !== person(ctx).id) throw notFound();
      return draw;
    },
    handler: async (ctx, draw) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const member = await requireMember(draw.member_id);
      const moved = await moveDraw(draw, member, body, false, {
        kind: 'member',
        name: member.name ?? '',
      });
      return { status: 200, json: { draw: await viewOf(moved, false) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/cancel',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (draw.state !== 'booked') throw conflict('not_booked', copy.notBooked);
      await query("update draws set state = 'cancelled' where id = $1", [draw.id]);
      await endVisitPages(draw.id);
      const cancelled = await findDraw(draw.id);
      return { status: 200, json: { draw: await viewOf(cancelled as DrawRow, true) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/draws/:drawId/cancel',
    access: ['member'],
    resolve: async (ctx) => {
      const draw = await requireDraw(ctx.params.drawId as string);
      if (draw.member_id !== person(ctx).id) throw notFound();
      return draw;
    },
    handler: async (ctx, draw) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (draw.state !== 'booked') throw conflict('not_booked', copy.notBooked);
      refuseAfterCutoff(draw, new Date());
      await query("update draws set state = 'cancelled' where id = $1", [draw.id]);
      await endVisitPages(draw.id);
      const cancelled = await findDraw(draw.id);
      return { status: 200, json: { draw: await viewOf(cancelled as DrawRow, false) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/visit-page',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (draw.state !== 'booked') throw conflict('not_booked', copy.notBooked);
      const member = await requireMember(draw.member_id);
      const today = localToday(member.time_zone, new Date());
      const drawDate = parseDateOnly(draw.local_date);
      if (!drawDate || dateOnlyDifference(today, drawDate) < 0) {
        throw conflict('not_upcoming', copy.notUpcoming);
      }
      const phlebotomist = await requirePhlebotomist(draw.phlebotomist_id);
      const page = await sendVisitPage(draw, member, phlebotomist);
      return {
        status: 201,
        json: { visitPage: { state: 'live', endsAt: instantToIso(page.ends_at) } },
      };
    },
  }),
  defineRoute({
    method: 'DELETE',
    path: '/api/draws/:drawId/visit-page',
    access: ['owner', 'coordinator'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (_ctx, draw) => {
      await endVisitPages(draw.id);
      const page = await latestVisitPage(draw.id);
      return {
        status: 200,
        json: {
          visitPage: {
            state: 'ended',
            endsAt: page ? instantToIso(page.ends_at) : null,
          },
        },
      };
    },
  }),
];

export { requireDraw, requirePhlebotomist, viewOf as drawViewOf };
