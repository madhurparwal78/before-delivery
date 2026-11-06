import { query, queryOne } from '../db.js';
import { notFound } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { findTalentById, type TalentRow } from '../data/talent.js';
import { loadOffice } from '../data/offices.js';
import { optionsOfTalent, type OptionWithClient } from '../data/options.js';
import { buildCalendar, type FeedEvent } from '../domain/ics.js';
import { formatOfficeTime, ordinalRank } from '../../shared/format.js';
import { addDays, formatIsoDate, parseIsoDate } from '../../shared/zone.js';
import { newToken } from '../ids.js';
import { appBaseUrl } from '../config.js';
import { json } from './helpers.js';

function feedUrl(token: string): string {
  return `${appBaseUrl()}/feeds/${token}.ics`;
}

/** Options appear as tentative events, bookings as confirmed ones. */
function eventFor(option: OptionWithClient, zone: string, city: string): FeedEvent {
  const date = parseIsoDate(option.job_date);
  if (!date) throw new Error('bad job date');
  const tentativeSummary = (rank: number): string =>
    `${ordinalRank(rank)} option: ${option.job_title} for ${option.client_company}, releases ${formatOfficeTime(option.release_at.getTime(), zone, city)}`;
  const bookedSummary = `Booked: ${option.job_title} for ${option.client_company}`;

  const status = option.state === 'confirmed'
    ? 'CONFIRMED'
    : option.state === 'placed' || option.state === 'challenged'
      ? 'TENTATIVE'
      : 'CANCELLED';
  const summary = option.state === 'confirmed'
    ? bookedSummary
    : option.rank !== null
      ? tentativeSummary(option.rank)
      : option.booking_id !== null
        ? bookedSummary
        : tentativeSummary(option.last_rank ?? 1);

  return {
    uid: `option-${option.id}@rungboard.vesperrowe.example`,
    date: option.job_date,
    endDate: formatIsoDate(addDays(date, 1)),
    sequence: option.feed_sequence,
    status,
    summary,
  };
}

async function calendarFor(talent: TalentRow, nowMs: number): Promise<string> {
  const office = await loadOffice(talent.office_id);
  const options = await optionsOfTalent(talent.id);
  return buildCalendar({
    calendarName: `${talent.display_name} — Rungboard`,
    stampMs: nowMs,
    events: options.map((option) => eventFor(option, office.timeZone, office.city)),
  });
}

export const feedRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/me/calendar-feed',
    auth: 'session',
    roles: ['talent'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const talent = member.talent_id ? await findTalentById(member.talent_id) : null;
      if (!talent || !talent.feed_token) throw notFound();
      return json(200, { url: feedUrl(talent.feed_token) });
    },
  },
  {
    method: 'POST',
    path: '/api/me/calendar-feed',
    auth: 'session',
    roles: ['talent'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const talent = member.talent_id ? await findTalentById(member.talent_id) : null;
      if (!talent) throw notFound();
      const token = newToken();
      await query('UPDATE talent SET feed_token = $2 WHERE id = $1', [talent.id, token]);
      return json(201, { url: feedUrl(token) });
    },
  },
  {
    method: 'GET',
    path: '/feeds/:token.ics',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const talent = await queryOne<TalentRow>('SELECT * FROM talent WHERE feed_token = $1', [
        ctx.params.token,
      ]);
      if (!talent || talent.state !== 'active') throw notFound();
      return {
        status: 200,
        body: await calendarFor(talent, ctx.nowMs),
        contentType: 'text/calendar; charset=utf-8',
        headers: { 'Cache-Control': 'no-store' },
      };
    },
  },
];
