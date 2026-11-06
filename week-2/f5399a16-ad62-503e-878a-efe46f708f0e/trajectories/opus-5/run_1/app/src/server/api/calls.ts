import { randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { calendarFile } from '../../domain/ics.js';
import { privateCopy } from '../../domain/privateCopy.js';
import {
  clockTimeIn,
  isIsoDate,
  isoDateIn,
  longDateIn,
  mondayOfIso,
  resolveWallTime,
  splitIsoDate,
  toInstantText,
  townLabel,
} from '../../domain/time.js';
import type { Town } from '../../domain/time.js';
import { MAIL_ADDRESS } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query, withDeskLock } from '../infra/db.js';
import { queueMail } from '../mail.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { isoDateText, requireProducer } from './support.js';

const MINUTES = [30, 60] as const;

type CallRow = {
  id: string;
  desk_id: string;
  producer_id: string;
  date: Date;
  time: string;
  minutes: number;
  note: string;
  starts_at: Date;
  ends_at: Date;
  uid: string;
  sequence: number;
  state: string;
  created_at: Date;
  producer_name: string;
  town: Town;
  language: 'en' | 'nl' | 'fr' | 'ar';
  producer_email: string;
};

function callJson(call: CallRow): Record<string, unknown> {
  const date = isoDateText(call.date);
  return {
    id: call.id,
    producerId: call.producer_id,
    producerName: call.producer_name,
    town: call.town,
    date,
    time: call.time,
    minutes: call.minutes,
    note: call.note,
    startsAt: toInstantText(call.starts_at),
    endsAt: toInstantText(call.ends_at),
    text: say.callLine(
      longDateIn(call.starts_at, call.town),
      clockTimeIn(call.starts_at, call.town),
      townLabel(call.town),
      clockTimeIn(call.starts_at, 'amsterdam'),
    ),
    uid: call.uid,
    sequence: call.sequence,
    state: call.state,
  };
}

const CALL_SELECT = `
  select c.*, p.name as producer_name, p.town, p.language, p.email as producer_email
    from calls c join producers p on p.id = c.producer_id
`;

async function callOf(deskId: string, callId: string): Promise<CallRow> {
  const call = await one<CallRow>(`${CALL_SELECT} where c.id = $1 and c.desk_id = $2`, [
    callId,
    deskId,
  ]);
  if (!call) throw refuse.notFound();
  return call;
}

/**
 * A wall time the clock change skips is refused; one that happens twice takes
 * the first of the two.
 */
function resolveStart(town: Town, date: string, time: string): Date {
  const parts = splitIsoDate(date);
  const [hour = '0', minute = '0'] = time.split(':');
  const resolved = resolveWallTime(town, parts, {
    hour: Number(hour),
    minute: Number(minute),
  });
  if (resolved.kind === 'skipped') {
    throw refuse.value(
      say.timeMissing(time, townLabel(town), longDateOfPlainDate(date)),
    );
  }
  return resolved.instant;
}

function longDateOfPlainDate(date: string): string {
  const parts = splitIsoDate(date);
  return longDateIn(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)), 'amsterdam');
}

/** A call overlapping another on the desk answers 409; a cancelled call holds no slot. */
async function requireFreeSlot(
  deskId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId: string | null,
): Promise<void> {
  const clash = await one<{ created_at: Date }>(
    `select created_at from calls
      where desk_id = $1 and state = 'booked' and ($4::uuid is null or id <> $4)
        and starts_at < $3 and ends_at > $2
      order by created_at asc limit 1`,
    [deskId, startsAt, endsAt, exceptId],
  );
  if (clash) {
    throw refuse.state(say.slotTaken(clockTimeIn(clash.created_at, 'amsterdam')));
  }
}

async function mailCall(call: CallRow, cancelled: boolean): Promise<void> {
  const file = calendarFile({
    uid: call.uid,
    sequence: call.sequence,
    startsAt: call.starts_at,
    endsAt: call.ends_at,
    producerName: call.producer_name,
    producerEmail: call.producer_email,
    organiserEmail: MAIL_ADDRESS,
    note: call.note,
    cancelled,
  });
  const clientId = await one<{ client_id: string }>(
    'select client_id from producers where id = $1',
    [call.producer_id],
  );
  await queueMail({
    clientId: clientId?.client_id ?? null,
    recipient: call.producer_email,
    subject: privateCopy(
      cancelled ? 'mailCancelledCallSubject' : 'mailCallSubject',
      call.language,
      { date: isoDateText(call.date) },
    ),
    body: say.callLine(
      longDateIn(call.starts_at, call.town),
      clockTimeIn(call.starts_at, call.town),
      townLabel(call.town),
      clockTimeIn(call.starts_at, 'amsterdam'),
    ),
    attachments: [
      {
        fileName: 'call.ics',
        contentType: `text/calendar; method=${cancelled ? 'CANCEL' : 'REQUEST'}; charset=utf-8`,
        body: file,
      },
    ],
  });
}

export const callRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/today',
    handler: async (context) => {
      requireIdentity(context);
      const date = isoDateIn(new Date(), 'amsterdam');
      return { status: 200, body: { date, weekStart: mondayOfIso(date) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/calls',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const from = context.query.get('from');
      const to = context.query.get('to');
      for (const value of [from, to]) {
        if (value !== null && !isIsoDate(value)) throw refuse.value(COPY.typeDate);
      }
      const calls = await query<CallRow>(
        `${CALL_SELECT} where c.desk_id = $1 order by c.starts_at asc, c.id asc`,
        [desk.id],
      );
      const wanted = calls.filter((call) => {
        const amsterdamDate = isoDateIn(call.starts_at, 'amsterdam');
        if (from !== null && amsterdamDate < from) return false;
        if (to !== null && amsterdamDate > to) return false;
        return true;
      });
      return { status: 200, body: { calls: wanted.map(callJson) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/calls',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const producerId = fields.uuid(body, 'producerId');
      const date = fields.isoDate(body, 'date');
      const time = fields.clockTime(body, 'time');
      const minutes = fields.numberChoice(body, 'minutes', MINUTES);
      const note = fields.optionalText(body, 'note');
      fields.done();
      const producer = await requireProducer(desk.id, producerId);
      const startsAt = resolveStart(producer.town, date, time);
      if (startsAt.getTime() <= Date.now()) throw refuse.value(COPY.callPassed);
      const endsAt = new Date(startsAt.getTime() + minutes * 60000);
      const id = randomUUID();
      await withDeskLock(desk.id, async () => {
        await requireFreeSlot(desk.id, startsAt, endsAt, null);
        await query(
          `insert into calls (id, desk_id, producer_id, date, time, minutes, note, starts_at,
                              ends_at, uid, sequence, state, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'booked',now())`,
          [
            id,
            desk.id,
            producer.id,
            date,
            time,
            minutes,
            note,
            startsAt,
            endsAt,
            `${id}@noorbakkerboards.example`,
          ],
        );
      });
      const made = await callOf(desk.id, id);
      await mailCall(made, false);
      return { status: 201, body: callJson(made) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/calls/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const call = await callOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const date = 'date' in body ? fields.isoDate(body, 'date') : isoDateText(call.date);
      const time = 'time' in body ? fields.clockTime(body, 'time') : call.time;
      const minutes =
        'minutes' in body ? fields.numberChoice(body, 'minutes', MINUTES) : call.minutes;
      const note = 'note' in body ? fields.optionalText(body, 'note') : call.note;
      fields.done();
      if (call.state !== 'booked') throw refuse.state(COPY.callPassed);
      const startsAt = resolveStart(call.town, date, time);
      if (startsAt.getTime() <= Date.now()) throw refuse.value(COPY.callPassed);
      const endsAt = new Date(startsAt.getTime() + minutes * 60000);
      await withDeskLock(desk.id, async () => {
        await requireFreeSlot(desk.id, startsAt, endsAt, call.id);
        await query(
          `update calls set date = $1, time = $2, minutes = $3, note = $4, starts_at = $5,
                            ends_at = $6, sequence = sequence + 1 where id = $7`,
          [date, time, minutes, note, startsAt, endsAt, call.id],
        );
      });
      const moved = await callOf(desk.id, call.id);
      await mailCall(moved, false);
      return { status: 200, body: callJson(moved) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/calls/:id/cancel',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const call = await callOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      if (call.state === 'cancelled') return { status: 200, body: callJson(call) };
      await query(
        "update calls set state = 'cancelled', sequence = sequence + 1 where id = $1",
        [call.id],
      );
      const cancelled = await callOf(desk.id, call.id);
      await mailCall(cancelled, true);
      return { status: 200, body: callJson(cancelled) };
    },
  },
];
