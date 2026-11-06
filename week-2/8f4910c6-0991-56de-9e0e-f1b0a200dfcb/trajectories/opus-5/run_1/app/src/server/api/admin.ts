import { query, queryOne } from '../db.js';
import { validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import { STAFF_ROLES } from '../data/members.js';
import { clientView, insertClient, listClients } from '../data/clients.js';
import { insertRateCard, listRateCards } from '../data/ratecards.js';
import { loadOffice, loadOffices } from '../data/offices.js';
import { automaticReleaseInstant } from '../domain/offices.js';
import { recomputeAutoReleases } from '../data/options.js';
import { EMAIL_PATTERN, FieldErrors, cleanSingleLine, fieldCopy, json, readNumber, readRecord, readString } from './helpers.js';
import { formatIsoDate, parseIsoDate } from '../../shared/zone.js';
import {
  BOARDS,
  MEDIA_VALUES,
  OFFICES,
  type Board,
  type Media,
  type OfficeId,
  type RateCardBoardRates,
} from '../../shared/types.js';

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const adminRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/clients',
    auth: 'session',
    roles: STAFF_ROLES,
    handler: async (): Promise<Reply> =>
      json(200, { clients: (await listClients()).map((row) => clientView(row)) }),
  },
  {
    method: 'POST',
    path: '/api/clients',
    auth: 'session',
    roles: ['booker', 'accounts_lead', 'agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = new FieldErrors();
      const company = cleanSingleLine(readString(ctx.json, 'company') ?? '');
      const contactName = cleanSingleLine(readString(ctx.json, 'contactName') ?? '');
      const contactEmail = cleanSingleLine(readString(ctx.json, 'contactEmail') ?? '');
      const timeZone = cleanSingleLine(readString(ctx.json, 'timeZone') ?? '');
      if (!company) fields.add('company', fieldCopy.required('Company'));
      if (!contactName) fields.add('contactName', fieldCopy.required('Contact name'));
      if (!contactEmail) fields.add('contactEmail', fieldCopy.required('Contact email'));
      else if (!EMAIL_PATTERN.test(contactEmail)) fields.add('contactEmail', fieldCopy.email());
      if (!timeZone || !isValidTimeZone(timeZone)) {
        fields.add('timeZone', 'Enter an IANA time zone like America/Toronto.');
      }
      fields.throwIfAny();
      const row = await insertClient({ company, contactName, contactEmail, timeZone });
      return json(201, clientView(row));
    },
  },
  {
    method: 'GET',
    path: '/api/rate-cards',
    auth: 'session',
    roles: STAFF_ROLES,
    handler: async (): Promise<Reply> => json(200, { rateCards: await listRateCards() }),
  },
  {
    method: 'POST',
    path: '/api/rate-cards',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = new FieldErrors();
      const name = cleanSingleLine(readString(ctx.json, 'name') ?? '');
      const effectiveFrom = readString(ctx.json, 'effectiveFrom') ?? '';
      if (!name) fields.add('name', fieldCopy.required('Name'));
      if (!parseIsoDate(effectiveFrom)) fields.add('effectiveFrom', fieldCopy.required('Effective from'));
      const existing = await listRateCards();
      if (existing.some((card) => card.effectiveFrom >= effectiveFrom)) {
        fields.add('effectiveFrom', 'Choose a date later than every existing rate card.');
      }
      const boardsInput = readRecord(ctx.json, 'boards') ?? {};
      const boards: Record<Board, RateCardBoardRates> = {} as Record<Board, RateCardBoardRates>;
      for (const board of BOARDS) {
        const entry = readRecord(boardsInput, board);
        const full = entry ? readNumber(entry, 'fullDayCents') : null;
        const half = entry ? readNumber(entry, 'halfDayCents') : null;
        const overtime = entry ? readNumber(entry, 'overtimeQuarterHourCents') : null;
        if (full === null || half === null || overtime === null) {
          fields.add('boards', 'Enter a full day, half day and overtime rate for every board.');
          continue;
        }
        boards[board] = { fullDayCents: full, halfDayCents: half, overtimeQuarterHourCents: overtime };
      }
      const usageInput = readRecord(ctx.json, 'usageBaseCents') ?? {};
      const usageBaseCents: Record<Media, number> = {} as Record<Media, number>;
      for (const media of MEDIA_VALUES) {
        const value = readNumber(usageInput, media);
        if (value === null) {
          fields.add('usageBaseCents', 'Enter a base fee for every media.');
          continue;
        }
        usageBaseCents[media] = value;
      }
      fields.throwIfAny();
      const card = await insertRateCard({ name, effectiveFrom, boards, usageBaseCents });
      return json(201, card);
    },
  },
  {
    method: 'POST',
    path: '/api/offices/:office/closures',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const office = ctx.params.office as OfficeId;
      if (!OFFICES.includes(office)) throw validation({ office: fieldCopy.required('Office') });
      const dateText = readString(ctx.json, 'date') ?? '';
      const date = parseIsoDate(dateText);
      if (!date || date.year < 2026 || date.year > 2027) {
        throw validation({ date: 'Enter a closure date inside 2026 or 2027.' });
      }
      const duplicate = await queryOne<{ closure_date: string }>(
        'SELECT closure_date FROM office_closures WHERE office_id = $1 AND closure_date = $2',
        [office, dateText],
      );
      if (duplicate) throw validation({ date: 'That closure date is already recorded.' });
      await query('INSERT INTO office_closures (office_id, closure_date) VALUES ($1, $2)', [office, dateText]);

      const updated = await loadOffice(office);
      await recomputeAutoReleases(
        office,
        (jobDate) => {
          const parsed = parseIsoDate(jobDate);
          if (!parsed) throw new Error('bad job date');
          return automaticReleaseInstant(updated, parsed);
        },
        ctx.nowMs,
      );
      const offices = await loadOffices();
      const refreshed = offices.get(office);
      return json(201, {
        office,
        closures: refreshed ? [...refreshed.closures].sort() : [formatIsoDate(date)],
      });
    },
  },
];
