import { config } from '../config.js';
import { query, transaction, type Tx } from '../db.js';
import { conflict, notFound, staleVersion, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import { STAFF_ROLES, type MemberRow } from '../data/members.js';
import { findTalentById, type TalentRow } from '../data/talent.js';
import { loadOffice } from '../data/offices.js';
import {
  dayOptions,
  findOption,
  insertOption,
  liveDayOptions,
  lockDay,
  markReleased,
  optionView,
  optionsBetween,
  refuseWhenChallengeExpired,
  refuseWhenNotLive,
  reRank,
  startChallenge,
  type OptionWithClient,
} from '../data/options.js';
import { automaticReleaseInstant, resolveHoldUntil, type OfficeInfo } from '../domain/offices.js';
import { formatOfficeTime } from '../../shared/format.js';
import {
  addDays,
  formatIsoDate,
  officeDate,
  parseIsoDate,
  toIsoInstant,
  type CivilDate,
} from '../../shared/zone.js';
import { FieldErrors, cleanSingleLine, fieldCopy, json, readNumber, readString } from './helpers.js';
import { challengeOutcomeEmail, type ChallengeOutcome } from '../emails.js';
import { queueMail } from '../services/mail.js';

const LAST_BOOKABLE_DATE = '2027-12-31';
const RECENT_RELEASE_WINDOW_MS = 180_000;

type ClientRow = { id: string; company: string; contact_email: string };

export async function bookingOf(optionId: string): Promise<{
  bookedBy: string | null;
  bookedAt: Date | null;
  bookingId: string | null;
}> {
  const row = await query<{ id: string; confirmed_by_name: string | null; confirmed_at: Date | null }>(
    `SELECT b.id, b.confirmed_by_name, b.confirmed_at FROM bookings b
     JOIN options o ON o.booking_id = b.id WHERE o.id = $1`,
    [optionId],
  );
  const booking = row[0];
  return {
    bookedBy: booking?.confirmed_by_name ?? null,
    bookedAt: booking?.confirmed_at ?? null,
    bookingId: booking?.id ?? null,
  };
}

/** The job day must still have its automatic release ahead, and be in range. */
function validateJobDay(fields: FieldErrors, office: OfficeInfo, date: CivilDate, nowMs: number): number {
  const autoReleaseMs = automaticReleaseInstant(office, date);
  if (autoReleaseMs <= nowMs || formatIsoDate(date) > LAST_BOOKABLE_DATE) {
    fields.add('date', fieldCopy.jobDayOutOfRange());
  }
  return autoReleaseMs;
}

function validateHoldUntil(
  fields: FieldErrors,
  office: OfficeInfo,
  value: string | null,
  autoReleaseMs: number,
  nowMs: number,
): number | null {
  if (value === null || value === '') return null;
  const resolved = resolveHoldUntil(office, value);
  if (resolved.kind === 'malformed') {
    fields.add('holdUntilLocal', fieldCopy.required('Hold until'));
    return null;
  }
  if (resolved.kind === 'gap') {
    fields.add('holdUntilLocal', fieldCopy.springForwardGap(office.city));
    return null;
  }
  if (resolved.instantMs <= nowMs) {
    fields.add('holdUntilLocal', fieldCopy.holdNotFuture());
    return null;
  }
  if (resolved.instantMs >= autoReleaseMs) {
    fields.add(
      'holdUntilLocal',
      fieldCopy.holdNotBeforeRelease(formatOfficeTime(autoReleaseMs, office.timeZone, office.city)),
    );
    return null;
  }
  return resolved.instantMs;
}

async function clientsByIds(ids: string[]): Promise<Map<string, ClientRow>> {
  const rows = await query<ClientRow>(
    'SELECT id, company, contact_email FROM clients WHERE id = ANY($1::text[])',
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** One challenge outcome email per client, exactly once across app copies. */
export async function queueChallengeOutcome(
  tx: Tx,
  input: {
    talent: TalentRow;
    date: string;
    firstOption: OptionWithClient;
    challengerOption: OptionWithClient | null;
    event: 'released' | 'confirmed' | 'timeout';
  },
): Promise<void> {
  const outcomes: Array<{ option: OptionWithClient; outcome: ChallengeOutcome }> = [];
  if (input.event === 'confirmed') {
    outcomes.push({ option: input.firstOption, outcome: 'confirmed' });
    if (input.challengerOption) outcomes.push({ option: input.challengerOption, outcome: 'day_booked' });
  } else {
    outcomes.push({ option: input.firstOption, outcome: 'released' });
    if (input.challengerOption) outcomes.push({ option: input.challengerOption, outcome: 'now_first' });
  }
  const clients = await clientsByIds(outcomes.map((entry) => entry.option.client_id));
  for (const entry of outcomes) {
    const client = clients.get(entry.option.client_id);
    if (!client) continue;
    await queueMail(
      challengeOutcomeEmail({
        recipient: client.contact_email,
        talentName: input.talent.display_name,
        date: input.date,
        outcome: entry.outcome,
        talentId: input.talent.id,
        dedupeKey: `challenge:${input.firstOption.id}:${input.event}:${entry.option.client_id}`,
      }),
      tx,
    );
  }
}

async function loadTalentOrNotFound(id: string): Promise<TalentRow> {
  const talent = await findTalentById(id);
  if (!talent || talent.state === 'erased') throw notFound();
  return talent;
}

export const optionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/talent/:id/ladder',
    auth: 'session',
    roles: STAFF_ROLES,
    load: async (ctx: Ctx): Promise<void> => {
      await loadTalentOrNotFound(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const talent = await loadTalentOrNotFound(ctx.params.id);
      const office = await loadOffice(talent.office_id);
      const fromParam = ctx.url.searchParams.get('from');
      const from = (fromParam ? parseIsoDate(fromParam) : null) ?? officeDate(office.timeZone, ctx.nowMs);
      const days = Math.min(60, Math.max(1, Number.parseInt(ctx.url.searchParams.get('days') ?? '14', 10) || 14));
      const last = addDays(from, days - 1);
      const options = await optionsBetween(talent.id, formatIsoDate(from), formatIsoDate(last));

      const dayList = [];
      for (let index = 0; index < days; index += 1) {
        const date = formatIsoDate(addDays(from, index));
        const onDay = options.filter((option) => option.job_date === date);
        const confirmed = onDay.find((option) => option.state === 'confirmed');
        const live = onDay.filter((option) => option.state === 'placed' || option.state === 'challenged');
        dayList.push({
          date,
          dayState: confirmed ? 'booked' : live.length > 0 ? 'held' : 'open',
          options: (confirmed ? [confirmed, ...live] : live).map((option) => optionView(option)),
          bookingId: confirmed?.booking_id ?? null,
        });
      }
      const recentReleases = options
        .filter(
          (option) =>
            (option.state === 'released' || option.state === 'expired')
            && option.released_at !== null
            && ctx.nowMs - option.released_at.getTime() <= RECENT_RELEASE_WINDOW_MS
            && option.release_reason !== 'manual'
            && option.release_reason !== 'day_booked',
        )
        .map((option) => ({
          optionId: option.id,
          clientCompany: option.client_company,
          date: option.job_date,
          releasedAt: toIsoInstant((option.released_at as Date).getTime()),
        }));

      return json(200, { talentId: talent.id, office: talent.office_id, days: dayList, recentReleases });
    },
  },
  {
    method: 'POST',
    path: '/api/options',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    idempotency: true,
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const talentId = readString(ctx.json, 'talentId') ?? '';
      const clientId = readString(ctx.json, 'clientId') ?? '';
      const talent = await loadTalentOrNotFound(talentId);
      const client = (await clientsByIds([clientId])).get(clientId);
      if (!client) throw notFound();
      const office = await loadOffice(talent.office_id);

      const dateText = readString(ctx.json, 'date') ?? '';
      const date = parseIsoDate(dateText);
      if (!date) throw validation({ date: fieldCopy.required('Job day') });

      return transaction(async (tx) => {
        await lockDay(tx, talent.id, dateText);
        const onDay = await dayOptions(tx, talent.id, dateText);
        if (onDay.some((option) => option.state === 'confirmed')) throw conflict('day_booked');
        const live = onDay.filter((option) => option.state === 'placed' || option.state === 'challenged');
        if (live.length >= 3) throw conflict('ladder_full');
        if (live.some((option) => option.client_id === clientId)) throw conflict('client_already_holds');

        const fields = new FieldErrors();
        const jobTitle = cleanSingleLine(readString(ctx.json, 'jobTitle') ?? '');
        if (!jobTitle) fields.add('jobTitle', fieldCopy.required('Job title'));
        const autoReleaseMs = validateJobDay(fields, office, date, ctx.nowMs);
        const holdUntilLocal = readString(ctx.json, 'holdUntilLocal');
        const holdUntilMs = validateHoldUntil(fields, office, holdUntilLocal, autoReleaseMs, ctx.nowMs);
        fields.throwIfAny();

        const option = await insertOption(tx, {
          talentId: talent.id,
          clientId,
          date: dateText,
          jobTitle,
          note: readString(ctx.json, 'note') ?? null,
          holdUntilMs,
          holdUntilLocal: holdUntilMs === null ? null : holdUntilLocal,
          autoReleaseMs,
          rank: live.length + 1,
          placedBy: member.id,
          placedByName: member.name,
          nowMs: ctx.nowMs,
        });
        return json(201, { option: optionView(option) });
      });
    },
  },
  {
    method: 'GET',
    path: '/api/options/:id',
    auth: 'session',
    roles: STAFF_ROLES,
    handler: async (ctx: Ctx): Promise<Reply> => {
      const option = await findOption(ctx.params.id);
      if (!option) throw notFound();
      return json(200, { option: optionView(option) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/options/:id',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findOption(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const current = await findOption(ctx.params.id);
      if (!current) throw notFound();
      const talent = await loadTalentOrNotFound(current.talent_id);
      const office = await loadOffice(talent.office_id);

      return transaction(async (tx) => {
        await lockDay(tx, current.talent_id, current.job_date);
        const option = (await dayOptions(tx, current.talent_id, current.job_date)).find(
          (candidate) => candidate.id === current.id,
        );
        if (!option) throw notFound();
        refuseWhenNotLive(option, await bookingOf(option.id));
        const version = readNumber(ctx.json, 'version');
        if (version !== null && version !== option.version) {
          throw staleVersion(option.saved_by_name, toIsoInstant(option.saved_at.getTime()));
        }
        const fields = new FieldErrors();
        const hasHold = Object.prototype.hasOwnProperty.call(ctx.json, 'holdUntilLocal');
        const holdUntilLocal = hasHold ? readString(ctx.json, 'holdUntilLocal') : option.hold_until_local;
        const holdUntilMs = validateHoldUntil(
          fields,
          office,
          holdUntilLocal,
          option.auto_release_at.getTime(),
          ctx.nowMs,
        );
        const hasNote = Object.prototype.hasOwnProperty.call(ctx.json, 'note');
        fields.throwIfAny();

        await tx.query(
          `UPDATE options
           SET hold_until = $2, hold_until_local = $3, note = CASE WHEN $4 THEN $5 ELSE note END,
               version = version + 1,
               feed_sequence = feed_sequence + CASE WHEN $6 THEN 1 ELSE 0 END,
               saved_by_name = $7, saved_at = $8
           WHERE id = $1`,
          [
            option.id,
            holdUntilMs === null ? null : new Date(holdUntilMs),
            holdUntilMs === null ? null : holdUntilLocal,
            hasNote,
            readString(ctx.json, 'note'),
            hasHold,
            member.name,
            new Date(ctx.nowMs),
          ],
        );
        const updated = (await dayOptions(tx, option.talent_id, option.job_date)).find(
          (candidate) => candidate.id === option.id,
        );
        if (!updated) throw notFound();
        return json(200, { option: optionView(updated) });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/options/:id/release',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findOption(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const current = await findOption(ctx.params.id);
      if (!current) throw notFound();
      const talent = await loadTalentOrNotFound(current.talent_id);

      return transaction(async (tx) => {
        await lockDay(tx, current.talent_id, current.job_date);
        const onDay = await dayOptions(tx, current.talent_id, current.job_date);
        const option = onDay.find((candidate) => candidate.id === current.id);
        if (!option) throw notFound();
        refuseWhenNotLive(option, await bookingOf(option.id));
        refuseWhenChallengeExpired(option, ctx.nowMs);

        const challenger = option.challenged_by_option_id
          ? onDay.find((candidate) => candidate.id === option.challenged_by_option_id) ?? null
          : null;
        if (option.state === 'challenged') {
          await queueChallengeOutcome(tx, {
            talent,
            date: option.job_date,
            firstOption: option,
            challengerOption: challenger,
            event: 'released',
          });
        }
        await markReleased(tx, option.id, 'manual', ctx.nowMs);
        await tx.query('UPDATE options SET saved_by_name = $2, saved_at = $3 WHERE id = $1', [
          option.id,
          member.name,
          new Date(ctx.nowMs),
        ]);
        await reRank(tx, option.talent_id, option.job_date);

        const after = await dayOptions(tx, option.talent_id, option.job_date);
        const released = after.find((candidate) => candidate.id === option.id);
        if (!released) throw notFound();
        return json(200, {
          option: optionView(released),
          ladder: after
            .filter((candidate) => candidate.state === 'placed' || candidate.state === 'challenged')
            .map((candidate) => optionView(candidate)),
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/options/:id/challenge',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findOption(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const current = await findOption(ctx.params.id);
      if (!current) throw notFound();

      return transaction(async (tx) => {
        await lockDay(tx, current.talent_id, current.job_date);
        const onDay = await dayOptions(tx, current.talent_id, current.job_date);
        const option = onDay.find((candidate) => candidate.id === current.id);
        if (!option) throw notFound();
        refuseWhenNotLive(option, await bookingOf(option.id));
        if (option.rank !== 2) throw conflict('not_second');
        const first = onDay.find((candidate) => candidate.rank === 1);
        if (!first) throw conflict('not_second');
        if (first.state === 'challenged' && first.challenge_deadline) {
          throw conflict('already_challenged', {
            challengeDeadline: toIsoInstant(first.challenge_deadline.getTime()),
          });
        }
        const deadlineMs = Math.floor(ctx.nowMs / 1000) * 1000 + config.optionChallengeSeconds * 1000;
        await startChallenge(tx, first.id, option.id, deadlineMs);
        const after = await liveDayOptions(tx, option.talent_id, option.job_date);
        return json(200, { ladder: after.map((candidate) => optionView(candidate)) });
      });
    },
  },
];
