import { agendaMinutes, handsOnShareHolds } from '../../shared/handsOnShare.js';
import { HANDS_ON_FIELD_ERROR } from '../../shared/copy.js';
import { withAgendaLock } from '../db/pool.js';
import {
  collectionOf,
  readFaq,
  readHospitality,
  readHotels,
  readSessions,
  toFaq,
  toHospitality,
  toHotel,
  toSession,
  type SessionItem,
} from '../domain/content.js';
import {
  createRecord,
  deleteRecord,
  getRecord,
  updateRecord,
  type ContentKind,
} from '../services/pocketbase.js';
import type { Route } from '../http/context.js';
import { notFound, validation } from '../http/errors.js';
import { FieldErrors, readInteger, readString } from './helpers.js';

const KINDS = new Set<ContentKind>(['sessions', 'hospitality', 'hotels', 'faq']);

function kindOf(raw: string): ContentKind {
  if (!KINDS.has(raw as ContentKind)) throw notFound();
  return raw as ContentKind;
}

function merge(
  existing: Record<string, unknown> | null,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return existing === null ? body : { ...existing, ...body };
}

function validateSession(values: Record<string, unknown>): Record<string, unknown> {
  const errors = new FieldErrors();
  const number = readInteger(values, 'number', 1, 999, errors);
  const day = readInteger(values, 'day', 1, 2, errors);
  const title = readString(values, 'title', 1, 120, errors);
  const format = values['format'];
  if (format !== 'lecture' && format !== 'hands-on') {
    errors.add('format', 'Choose Lecture or Hands-on.');
  }
  const minutes = readInteger(values, 'minutes', 15, 480, errors);
  const outcomesRaw = values['outcomes'];
  const outcomes = typeof outcomesRaw === 'string' ? outcomesRaw : '';
  if (outcomes.length > 600) errors.add('outcomes', 'Use 0 to 600 characters.');
  errors.throwIfAny();
  return { number, day, title, format, minutes, outcomes };
}

function validateHospitality(values: Record<string, unknown>): Record<string, unknown> {
  const errors = new FieldErrors();
  const title = readString(values, 'title', 1, 120, errors);
  const day = readInteger(values, 'day', 1, 2, errors);
  const startsAt = typeof values['starts_at'] === 'string' ? values['starts_at'].trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) {
    errors.add('starts_at', 'Use a 24-hour time such as 18:30.');
  }
  const venue = readString(values, 'venue', 1, 120, errors);
  const tier = values['tier'];
  if (tier !== 'all' && tier !== 'atelier') errors.add('tier', 'Choose all or atelier.');
  const description = readString(values, 'description', 1, 600, errors);
  errors.throwIfAny();
  return { title, day, starts_at: startsAt, venue, tier, description };
}

function validateHotel(values: Record<string, unknown>): Record<string, unknown> {
  const errors = new FieldErrors();
  const name = readString(values, 'name', 1, 120, errors);
  const distance = readString(values, 'distance', 1, 60, errors);
  const rate = readString(values, 'rate', 1, 60, errors);
  const mapUrl = typeof values['map_url'] === 'string' ? values['map_url'].trim() : '';
  if (!/^https:\/\/\S+$/.test(mapUrl)) errors.add('map_url', 'Use an https map link.');
  errors.throwIfAny();
  return { name, distance, rate, map_url: mapUrl };
}

function validateFaq(values: Record<string, unknown>): Record<string, unknown> {
  const errors = new FieldErrors();
  const question = readString(values, 'question', 1, 200, errors);
  const answer = readString(values, 'answer', 1, 1000, errors);
  const sort = readInteger(values, 'sort', -999, 999, errors);
  errors.throwIfAny();
  return { question, answer, sort };
}

function validateFor(kind: ContentKind, values: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'sessions') return validateSession(values);
  if (kind === 'hospitality') return validateHospitality(values);
  if (kind === 'hotels') return validateHotel(values);
  return validateFaq(values);
}

function projectedAgenda(
  sessions: readonly SessionItem[],
  change: { id: string | null; values: Record<string, unknown> | null },
): SessionItem[] {
  const others = sessions.filter((session) => session.id !== change.id);
  if (change.values === null) return others;
  const candidate = {
    id: change.id ?? 'new',
    number: change.values['number'] as number,
    day: change.values['day'] as number,
    title: change.values['title'] as string,
    format: change.values['format'] as 'lecture' | 'hands-on',
    minutes: change.values['minutes'] as number,
    outcomes: change.values['outcomes'] as string,
  };
  return [...others, candidate];
}

function checkAgenda(projected: readonly SessionItem[]): void {
  if (!handsOnShareHolds(agendaMinutes(projected))) {
    throw validation({ minutes: HANDS_ON_FIELD_ERROR });
  }
  const numbers = new Set<number>();
  for (const session of projected) {
    if (numbers.has(session.number)) {
      throw validation({ number: 'Another session already uses that number.' });
    }
    numbers.add(session.number);
  }
}

async function readItems(kind: ContentKind): Promise<unknown[]> {
  if (kind === 'sessions') return readSessions();
  if (kind === 'hospitality') return readHospitality();
  if (kind === 'hotels') return readHotels();
  return readFaq();
}

function present(kind: ContentKind, record: { id: string; [field: string]: unknown }): unknown {
  if (kind === 'sessions') return toSession(record);
  if (kind === 'hospitality') return toHospitality(record);
  if (kind === 'hotels') return toHotel(record);
  return toFaq(record);
}

export const contentRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/desk/content/:kind',
    access: ['director'],
    handler: async (ctx) => {
      const kind = kindOf(ctx.param('kind'));
      return { status: 200, body: { items: await readItems(kind) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/desk/content/:kind',
    access: ['director'],
    handler: async (ctx) => {
      const kind = kindOf(ctx.param('kind'));
      const body = ctx.json();
      const values = validateFor(kind, body);
      if (kind !== 'sessions') {
        return { status: 201, body: { item: present(kind, await createRecord(collectionOf(kind), values)) } };
      }
      const created = await withAgendaLock(async () => {
        const sessions = await readSessions();
        checkAgenda(projectedAgenda(sessions, { id: null, values }));
        return createRecord(collectionOf(kind), values);
      });
      return { status: 201, body: { item: present(kind, created) } };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/desk/content/:kind/:id',
    access: ['director'],
    handler: async (ctx) => {
      const kind = kindOf(ctx.param('kind'));
      const id = ctx.param('id');
      const body = ctx.json();
      const existing = await getRecord(collectionOf(kind), id);
      if (existing === null) throw notFound();
      const values = validateFor(kind, merge(existing, body));
      if (kind !== 'sessions') {
        const updated = await updateRecord(collectionOf(kind), id, values);
        if (updated === null) throw notFound();
        return { status: 200, body: { item: present(kind, updated) } };
      }
      const updated = await withAgendaLock(async () => {
        const sessions = await readSessions();
        checkAgenda(projectedAgenda(sessions, { id, values }));
        return updateRecord(collectionOf(kind), id, values);
      });
      if (updated === null) throw notFound();
      return { status: 200, body: { item: present(kind, updated) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/desk/content/:kind/:id',
    access: ['director'],
    handler: async (ctx) => {
      const kind = kindOf(ctx.param('kind'));
      const id = ctx.param('id');
      if (kind !== 'sessions') {
        if (!(await deleteRecord(collectionOf(kind), id))) throw notFound();
        return { status: 204, body: null };
      }
      const removed = await withAgendaLock(async () => {
        const sessions = await readSessions();
        if (!sessions.some((session) => session.id === id)) return false;
        checkAgenda(projectedAgenda(sessions, { id, values: null }));
        return deleteRecord(collectionOf(kind), id);
      });
      if (!removed) throw notFound();
      return { status: 204, body: null };
    },
  },
];
