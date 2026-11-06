import { randomUUID } from 'node:crypto';
import { COPY, fill, PRIVATE_COPY } from '../../shared/copy';
import { clockIn, dateIn, instantText, isRealDate, mondayOf, printDate, printDateTime, TOWN_NAMES, TOWN_ZONES, wallToInstant, type Town } from '../../shared/time';
import { one, pool, rows, transaction, type Row } from '../db';
import { calendarFile } from '../domain';
import { conflict, invalid, isUuid, notFound, ok, refused, route, type Context } from '../http';
import { queueMail } from '../mail';
import { languageOf, producerOfDesk } from '../records';
import { checkClock, checkDate, checkOneOf, throwIfAny, type Fields } from '../validate';
import type pg from 'pg';

const AMSTERDAM = TOWN_ZONES.amsterdam;
const CALL_SELECT = `SELECT k.*, p.name AS producer_name, p.town, p.email AS producer_email, p.language, p.client_id FROM calls k JOIN producers p ON p.id = k.producer_id`;

function callLine(startsAt: number, town: Town): string {
  return fill(COPY.callLine, { when: printDateTime(startsAt, town), amsterdam: clockIn(startsAt, AMSTERDAM) });
}

function callJson(call: Row): Row {
  const startsAt = (call.starts_at as Date).getTime();
  return {
    id: call.id,
    producerId: call.producer_id,
    producerName: call.producer_name,
    town: call.town,
    date: call.date,
    time: call.time,
    minutes: call.minutes,
    note: call.note,
    startsAt: instantText(startsAt),
    endsAt: instantText((call.ends_at as Date).getTime()),
    text: callLine(startsAt, call.town),
    uid: call.uid,
    sequence: call.sequence,
    state: call.state,
  };
}

function judgeWall(date: string, time: string, town: Town, now: number): number {
  const startsAt = wallToInstant(date, time, TOWN_ZONES[town]);
  if (startsAt === null) throw invalid({ time: fill(COPY.callNoSuchTime, { time, town: TOWN_NAMES[town], date: printDate(date) }) });
  if (startsAt <= now) throw invalid({ date: COPY.callPast });
  return startsAt;
}

/** Holds the desk's calendar for this transaction, then refuses a slot another booked call covers. */
async function assertSlotFree(tx: pg.PoolClient, deskId: string, startsAt: number, endsAt: number, except: string | null): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`calls:${deskId}`]);
  const taken = await one(
    tx,
    `SELECT created_at FROM calls WHERE desk_id = $1 AND state = 'booked' AND starts_at < $2 AND ends_at > $3 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1`,
    [deskId, new Date(endsAt), new Date(startsAt), except],
  );
  if (taken) throw conflict(fill(COPY.callTaken, { time: clockIn((taken.created_at as Date).getTime(), AMSTERDAM) }));
}

async function mailCall(tx: pg.PoolClient, call: Row, method: 'REQUEST' | 'CANCEL', now: number): Promise<void> {
  const copy = PRIVATE_COPY[languageOf(call)];
  const subject = fill(method === 'CANCEL' ? copy.mailCancelledCallSubject : copy.mailCallSubject, { date: call.date });
  const calendar = calendarFile(
    {
      uid: call.uid,
      sequence: call.sequence,
      producerName: call.producer_name,
      producerEmail: call.producer_email,
      note: call.note,
      startsAt: (call.starts_at as Date).getTime(),
      endsAt: (call.ends_at as Date).getTime(),
    },
    method,
    now,
  );
  await queueMail(tx, { clientId: call.client_id, to: call.producer_email, subject, body: `${callLine((call.starts_at as Date).getTime(), call.town)}\n`, calendar: { text: calendar, method } });
}

route('GET', '/api/today', {}, async ({ now }) => {
  const date = dateIn(now, AMSTERDAM);
  return ok({ date, weekStart: mondayOf(date) });
});

route('GET', '/api/calls', {}, async ({ desk, query }) => {
  const from = query.get('from');
  const to = query.get('to');
  const fields: Fields = {};
  if (from !== null && !isRealDate(from)) fields.from = COPY.typeDate;
  if (to !== null && !isRealDate(to)) fields.to = COPY.typeDate;
  throwIfAny(fields);
  const calls = await rows(pool, `${CALL_SELECT} WHERE k.desk_id = $1 ORDER BY k.starts_at, k.id`, [desk.id]);
  const shown = calls.filter((call) => {
    const local = dateIn((call.starts_at as Date).getTime(), AMSTERDAM);
    return (from === null || local >= from) && (to === null || local <= to);
  });
  return ok({ calls: shown.map(callJson) });
});

route('POST', '/api/calls', {}, async ({ body, desk, now }) => {
  const fields: Fields = {};
  if (typeof body.producerId !== 'string' || !body.producerId) fields.producerId = COPY.typeName;
  const date = checkDate(fields, 'date', body.date);
  const time = checkClock(fields, 'time', body.time);
  const minutes = checkOneOf(fields, 'minutes', body.minutes, [30, 60], 'Pick the minutes.');
  throwIfAny(fields);
  const producer = await producerOfDesk(pool, body.producerId, desk.id);
  const startsAt = judgeWall(date, time, producer.town, now);
  if (producer.client_state !== 'active') throw conflict(COPY.clientClosing);
  const endsAt = startsAt + minutes * 60_000;
  return transaction(async (tx) => {
    await assertSlotFree(tx, desk.id, startsAt, endsAt, null);
    const id = randomUUID();
    await tx.query(
      `INSERT INTO calls (id, desk_id, producer_id, date, time, minutes, note, starts_at, ends_at, uid, sequence, state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'booked', $11)`,
      [id, desk.id, producer.id, date, time, minutes, typeof body.note === 'string' ? body.note : '', new Date(startsAt), new Date(endsAt), `${randomUUID()}@noorbakkerboards.example`, new Date(now)],
    );
    const call = (await one(tx, `${CALL_SELECT} WHERE k.id = $1`, [id])) as Row;
    await mailCall(tx, call, 'REQUEST', now);
    return ok(callJson(call), 201);
  });
});

async function loadCall(context: Context): Promise<Row> {
  if (!isUuid(context.params.id)) throw notFound();
  const call = await one(pool, `${CALL_SELECT} WHERE k.id = $1 AND k.desk_id = $2`, [context.params.id, context.desk.id]);
  if (!call) throw notFound();
  return call;
}

route('PATCH', '/api/calls/:id', { load: loadCall }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const date = 'date' in body ? checkDate(fields, 'date', body.date) : (found.date as string);
  const time = 'time' in body ? checkClock(fields, 'time', body.time) : (found.time as string);
  const minutes = 'minutes' in body ? checkOneOf(fields, 'minutes', body.minutes, [30, 60], 'Pick the minutes.') : (found.minutes as number);
  throwIfAny(fields);
  const startsAt = judgeWall(date, time, found.town, now);
  if (found.state !== 'booked') throw refused(COPY.callCancelled);
  const endsAt = startsAt + minutes * 60_000;
  return transaction(async (tx) => {
    await assertSlotFree(tx, desk.id, startsAt, endsAt, found.id);
    await tx.query('UPDATE calls SET date = $1, time = $2, minutes = $3, starts_at = $4, ends_at = $5, sequence = sequence + 1 WHERE id = $6', [date, time, minutes, new Date(startsAt), new Date(endsAt), found.id]);
    const call = (await one(tx, `${CALL_SELECT} WHERE k.id = $1`, [found.id])) as Row;
    await mailCall(tx, call, 'REQUEST', now);
    return ok(callJson(call));
  });
});

route('POST', '/api/calls/:id/cancel', { load: loadCall, body: 'none' }, async ({ found, now }) => {
  if (found.state !== 'booked') return ok(callJson(found));
  return transaction(async (tx) => {
    await tx.query(`UPDATE calls SET state = 'cancelled', sequence = sequence + 1 WHERE id = $1`, [found.id]);
    const call = (await one(tx, `${CALL_SELECT} WHERE k.id = $1`, [found.id])) as Row;
    await mailCall(tx, call, 'CANCEL', now);
    return ok(callJson(call));
  });
});
