import { query, transaction } from '../db.js';
import { conflict, notFound, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { findTalentById, type TalentRow } from '../data/talent.js';
import { findClient, type ClientRow } from '../data/clients.js';
import { listRateCards } from '../data/ratecards.js';
import {
  bookingViews,
  findBookingRow,
  listBookingRows,
  bookingView,
} from '../data/bookings.js';
import { dayOptions, findOption, lockDay, markReleased, type OptionWithClient } from '../data/options.js';
import { computeFees, rateCardFor, type ComputedFees, type TalentFeeInput, type UsageRow } from '../domain/fees.js';
import { clientAccount, talentAccount, writeMovement } from '../data/ledger.js';
import { buildCalendar } from '../domain/ics.js';
import { bookingConfirmationEmail } from '../emails.js';
import { queueMail } from '../services/mail.js';
import {
  commitInvoice,
  createDraftInvoice,
  ensureAccount,
  voidInvoice,
} from '../services/killbill.js';
import { nextCounter } from '../schema.js';
import { newId } from '../ids.js';
import { formatMoneyCents } from '../../shared/format.js';
import { addDays, formatIsoDate, parseIsoDate, toIsoInstant } from '../../shared/zone.js';
import { json, readArray, readNumber, readString } from './helpers.js';
import { bookingOf, queueChallengeOutcome } from './options.js';
import {
  MEDIA_VALUES,
  OFFICES,
  TERM_MONTH_VALUES,
  TERRITORY_VALUES,
  type DayType,
  type Media,
  type OfficeId,
  type RateCard,
  type Territory,
} from '../../shared/types.js';

type ConfirmRequest = {
  option: OptionWithClient;
  talent: TalentRow;
  dayType: DayType;
  overtimeMinutes: number;
  usage: UsageRow[];
};

const MAX_OVERTIME_MINUTES = 600;

function parseUsage(raw: unknown[]): UsageRow[] | null {
  const usage: UsageRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const media = readString(row, 'media') ?? '';
    const territory = readString(row, 'territory') ?? '';
    const termMonths = readNumber(row, 'termMonths') ?? 0;
    if (!MEDIA_VALUES.includes(media as Media)) return null;
    if (!TERRITORY_VALUES.includes(territory as Territory)) return null;
    if (!TERM_MONTH_VALUES.includes(termMonths)) return null;
    usage.push({ media: media as Media, territory: territory as Territory, termMonths });
  }
  return usage;
}

type ConfirmationWrite = {
  bookingId: string;
  reference: string;
  requests: ConfirmRequest[];
  fees: ComputedFees;
  card: RateCard;
  client: ClientRow;
  member: MemberRow;
  calendar: string;
  invoiceId: string;
  office: OfficeId;
  jobTitle: string;
  nowMs: number;
};

/**
 * Writes the booking, its fee lines, the paired ledger movement, the
 * confirmation email and the option changes in one transaction, so a confirm
 * either lands whole or not at all.
 */
async function recordConfirmation(input: ConfirmationWrite): Promise<void> {
  const { bookingId, reference, requests, fees, member, nowMs } = input;
  const first = requests[0].option;
  await transaction(async (tx) => {
    await lockDay(tx, first.talent_id, first.job_date);
    for (const request of requests) {
      const onDay = await dayOptions(tx, request.option.talent_id, request.option.job_date);
      const current = onDay.find((candidate) => candidate.id === request.option.id);
      if (!current || current.state === 'confirmed' || current.rank !== 1) {
        throw conflict('already_booked', { bookedBy: null, bookedAt: null, bookingId: null });
      }
    }

    await tx.query(
      `INSERT INTO bookings (
         id, reference, state, job_date, office_id, client_id, job_title, rate_card_id,
         talent_fees_cents, service_fee_cents, tax_cents, total_cents, killbill_invoice_id,
         confirmed_by, confirmed_by_name, confirmed_at
       ) VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        bookingId,
        reference,
        first.job_date,
        input.office,
        first.client_id,
        input.jobTitle,
        input.card.id,
        fees.talentFeesCents,
        fees.serviceFeeCents,
        fees.taxCents,
        fees.totalCents,
        input.invoiceId,
        member.id,
        member.name,
        new Date(nowMs),
      ],
    );
    for (const [index, entry] of fees.talent.entries()) {
      await tx.query(
        `INSERT INTO booking_talent (booking_id, talent_id, position, display_name, talent_fees_cents, service_fee_share_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bookingId, entry.talentId, index, entry.displayName, entry.talentFeesCents, entry.serviceFeeShareCents],
      );
    }
    for (const [index, line] of fees.lines.entries()) {
      await tx.query(
        `INSERT INTO booking_lines (booking_id, idx, kind, label, talent_id, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bookingId, index, line.kind, line.label, line.talentId, line.amountCents],
      );
    }

    await writeMovement(tx, {
      kind: 'booking',
      reference,
      talentId: null,
      bookingId,
      clientId: first.client_id,
      reversalOf: null,
      description: input.jobTitle,
      createdBy: member.id,
      createdByName: member.name,
      officeDate: first.job_date,
      nowMs,
      entries: [
        ...fees.talent.map((entry) => ({
          account: talentAccount(entry.talentId),
          amountCents: entry.talentFeesCents,
        })),
        { account: 'agency_fees', amountCents: fees.serviceFeeCents },
        { account: 'tax_payable', amountCents: fees.taxCents },
        { account: clientAccount(first.client_id), amountCents: -fees.totalCents },
      ].filter((entry) => entry.amountCents !== 0),
    });

    for (const request of requests) {
      await tx.query(
        `UPDATE options SET state = 'confirmed', booking_id = $2, challenge_deadline = NULL,
                challenged_by_option_id = NULL, version = version + 1, feed_sequence = feed_sequence + 1,
                saved_by_name = $3, saved_at = $4
         WHERE id = $1`,
        [request.option.id, bookingId, member.name, new Date(nowMs)],
      );
      const onDay = await dayOptions(tx, request.option.talent_id, request.option.job_date);
      const challenger = request.option.challenged_by_option_id
        ? onDay.find((candidate) => candidate.id === request.option.challenged_by_option_id) ?? null
        : null;
      if (request.option.state === 'challenged') {
        await queueChallengeOutcome(tx, {
          talent: request.talent,
          date: request.option.job_date,
          firstOption: request.option,
          challengerOption: challenger,
          event: 'confirmed',
        });
      }
      for (const other of onDay) {
        if (other.id === request.option.id) continue;
        if (other.state !== 'placed' && other.state !== 'challenged') continue;
        await markReleased(tx, other.id, 'day_booked', nowMs);
      }
    }

    await queueMail(
      bookingConfirmationEmail({
        recipient: input.client.contact_email,
        reference,
        jobTitle: input.jobTitle,
        date: first.job_date,
        talentNames: requests.map((request) => request.talent.display_name),
        lines: fees.lines,
        totalCents: fees.totalCents,
        rateCardName: input.card.name,
        calendar: input.calendar,
      }),
      tx,
    );
  });
}

export const bookingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/bookings',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const rawOptions = readArray(ctx.json, 'options') ?? [];
      if (rawOptions.length === 0) throw validation({ options: 'Choose at least one option to confirm.' });

      type Parsed = { optionId: string; dayType: string; overtimeMinutes: number; usage: unknown[] };
      const parsed: Parsed[] = [];
      for (const entry of rawOptions) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          throw validation({ options: 'Choose at least one option to confirm.' });
        }
        const row = entry as Record<string, unknown>;
        parsed.push({
          optionId: readString(row, 'optionId') ?? '',
          dayType: readString(row, 'dayType') ?? '',
          overtimeMinutes: readNumber(row, 'overtimeMinutes') ?? 0,
          usage: readArray(row, 'usage') ?? [],
        });
      }

      const options: OptionWithClient[] = [];
      for (const entry of parsed) {
        const option = await findOption(entry.optionId);
        if (!option) throw notFound();
        options.push(option);
      }

      // Step 8: state conflicts, in one published order.
      for (const option of options) {
        if (option.state === 'confirmed') {
          const booking = await bookingOf(option.id);
          throw conflict('already_booked', {
            bookedBy: booking.bookedBy,
            bookedAt: booking.bookedAt ? toIsoInstant(booking.bookedAt.getTime()) : null,
            bookingId: booking.bookingId,
          });
        }
      }
      for (const option of options) {
        if (option.state === 'released' || option.state === 'expired') {
          throw conflict('option_released', {
            releasedAt: option.released_at ? toIsoInstant(option.released_at.getTime()) : null,
          });
        }
      }
      for (const option of options) {
        if (
          option.state === 'challenged'
          && option.challenge_deadline
          && ctx.nowMs >= option.challenge_deadline.getTime()
        ) {
          throw conflict('challenge_expired', {
            challengeDeadline: toIsoInstant(option.challenge_deadline.getTime()),
          });
        }
      }
      for (const option of options) {
        if (option.rank !== 1) throw conflict('not_first');
      }

      // Step 9: field validation, including a mixed group.
      const talent: TalentRow[] = [];
      for (const option of options) {
        const row = await findTalentById(option.talent_id);
        if (!row) throw notFound();
        talent.push(row);
      }
      const first = options[0];
      const office = talent[0].office_id;
      const mixed =
        options.some((option) => option.client_id !== first.client_id)
        || options.some((option) => option.job_date !== first.job_date)
        || talent.some((row) => row.office_id !== office)
        || new Set(options.map((option) => option.talent_id)).size !== options.length;
      if (mixed) {
        throw validation({
          options: 'Every option must be a 1st option for the same client, day and office, for different talent.',
        });
      }
      const requests: ConfirmRequest[] = [];
      for (const [index, entry] of parsed.entries()) {
        if (entry.dayType !== 'full_day' && entry.dayType !== 'half_day') {
          throw validation({ dayType: 'Choose full day or half day.' });
        }
        if (
          !Number.isInteger(entry.overtimeMinutes)
          || entry.overtimeMinutes < 0
          || entry.overtimeMinutes > MAX_OVERTIME_MINUTES
        ) {
          throw validation({ overtimeMinutes: 'Enter overtime minutes between 0 and 600.' });
        }
        const usage = parseUsage(entry.usage);
        if (!usage) throw validation({ usage: 'Choose a media, territory and term for every usage line.' });
        requests.push({
          option: options[index],
          talent: talent[index],
          dayType: entry.dayType,
          overtimeMinutes: entry.overtimeMinutes,
          usage,
        });
      }

      const card = rateCardFor(await listRateCards(), first.job_date);
      if (!card) throw validation({ options: 'No rate card is in effect on that day.' });
      const client = await findClient(first.client_id);
      if (!client) throw notFound();

      const fees = computeFees({
        card,
        office,
        talent: requests.map(
          (request): TalentFeeInput => ({
            talentId: request.talent.id,
            displayName: request.talent.display_name,
            board: request.talent.board,
            dayType: request.dayType,
            overtimeMinutes: request.overtimeMinutes,
            usage: request.usage,
          }),
        ),
      });

      // The draft invoice comes first; nothing is written in the app if billing fails.
      const accountId = await ensureAccount(client);
      const invoiceId = await createDraftInvoice(
        accountId,
        fees.lines.map((line) => ({ description: line.label, amountCents: line.amountCents })),
      );

      try {
        const bookingId = newId('bkg');
        const year = first.job_date.slice(0, 4);
        const reference = `VR-${year}-${String(await nextCounter(`booking:${year}`)).padStart(4, '0')}`;
        const jobTitle = first.job_title;
        const jobDate = parseIsoDate(first.job_date);
        if (!jobDate) throw validation({ options: 'That job day is not a date.' });

        const calendar = buildCalendar({
          method: 'PUBLISH',
          stampMs: ctx.nowMs,
          events: [
            {
              uid: `booking-${reference}@rungboard.vesperrowe.example`,
              date: first.job_date,
              endDate: formatIsoDate(addDays(jobDate, 1)),
              sequence: 0,
              status: 'CONFIRMED',
              summary: `${jobTitle}: ${requests.map((request) => request.talent.display_name).join(', ')}`,
              description: `Total ${formatMoneyCents(fees.totalCents)}`,
            },
          ],
        });

        await recordConfirmation({
          bookingId,
          reference,
          requests,
          fees,
          card,
          client,
          member,
          calendar,
          invoiceId,
          office,
          jobTitle,
          nowMs: ctx.nowMs,
        });

        return json(201, { booking: await bookingView(bookingId) });
      } catch (error) {
        await voidInvoice(invoiceId);
        throw error;
      }
    },
  },
  {
    method: 'GET',
    path: '/api/bookings',
    auth: 'session',
    roles: ['booker', 'accounts_lead', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const office = ctx.url.searchParams.get('office');
      const month = ctx.url.searchParams.get('month');
      if (office && !OFFICES.includes(office as OfficeId)) {
        throw validation({ office: 'Choose one of the published offices.' });
      }
      if (month && !/^\d{4}-\d{2}$/.test(month)) throw validation({ month: 'Enter a month as YYYY-MM.' });
      const rows = await listBookingRows({
        ...(office ? { office: office as OfficeId } : {}),
        ...(month ? { month } : {}),
      });
      return json(200, { bookings: await bookingViews(rows) });
    },
  },
  {
    method: 'GET',
    path: '/api/bookings/:id',
    auth: 'session',
    roles: ['booker', 'accounts_lead', 'agency_director'],
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findBookingRow(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> =>
      json(200, { booking: await bookingView(ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/api/bookings/:id/issue',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findBookingRow(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const booking = await findBookingRow(ctx.params.id);
      if (!booking) throw notFound();
      if (booking.state === 'invoiced') {
        throw conflict('already_invoiced', {
          issuedBy: booking.issued_by_name,
          issuedAt: booking.issued_at ? toIsoInstant(booking.issued_at.getTime()) : null,
        });
      }
      if (booking.killbill_invoice_id) await commitInvoice(booking.killbill_invoice_id);
      await query(
        `UPDATE bookings SET state = 'invoiced', issued_by = $2, issued_by_name = $3, issued_at = $4
         WHERE id = $1`,
        [booking.id, member.id, member.name, new Date(ctx.nowMs)],
      );
      return json(200, { booking: await bookingView(booking.id) });
    },
  },
];
