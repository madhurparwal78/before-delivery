import { PoolClient } from 'pg';
import { makeId, query } from '../db.js';
import { AppError, conflict, invalid } from '../errors.js';
import { chooseWhichTime, copy, missingHour } from '../copy.js';
import {
  LocalDateTime,
  instantsForWall,
  isDateString,
  isTimeString,
  readWall,
  ukDateOf,
  ukTimeOf,
} from '../../domain/time.js';
import { Language, isLanguage } from '../../domain/strings.js';
import { foldEmail, foldTelephone, isEmailAddress, isUkTelephone, makeReference } from '../../domain/text.js';
import { EnquiryState, JourneyType, Occasion } from './hires.js';
import { Party } from '../../domain/vehicles.js';

export const OCCASIONS: Occasion[] = ['school', 'weddings', 'company', 'festivals'];
export const JOURNEY_TYPES: JourneyType[] = ['oneWay', 'return', 'sameDayReturn', 'severalStops'];
export const ENQUIRY_STATES: EnquiryState[] = ['new', 'priced', 'quoted', 'won', 'lost'];

const LEGAL_STATE_CHANGES: Record<EnquiryState, EnquiryState[]> = {
  new: ['priced', 'lost'],
  priced: ['new', 'quoted', 'lost'],
  quoted: ['priced', 'won', 'lost'],
  won: ['lost'],
  lost: ['new'],
};

export function stateChangeAllowed(from: EnquiryState, to: EnquiryState): boolean {
  return from === to || LEGAL_STATE_CHANGES[from].includes(to);
}

export const QUARTER_MINUTES = ['00', '15', '30', '45'];
export const SHORT_NOTICE_MINUTES = 30;

export type EnquiryBody = {
  occasion: Occasion;
  journeyType: JourneyType;
  stops: { text: string; checked: boolean }[];
  departAt: LocalDateTime;
  departInstant: number;
  returnAt: LocalDateTime | null;
  returnInstant: number | null;
  party: Party;
  details: string | null;
  name: string;
  email: string;
  telephone: string;
  language: Language;
};

function wholeNumber(value: unknown, low: number, high: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) return null;
  return value;
}

type TimeCheckKind = 'depart' | 'return' | 'notice';

/** The pick-up clock rules, decided on the server's UK clock. */
export function readLocalDateTime(
  value: unknown,
  field: string,
  kind: TimeCheckKind,
  now: number,
  quarterHours: boolean,
): { local: LocalDateTime; instant: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(copy.enterDate, { [field]: copy.enterDate });
  }
  const body = value as Record<string, unknown>;
  const date = body.date;
  const time = body.time;
  if (!isDateString(date)) throw invalid(copy.enterDate, { [field]: copy.enterDate });
  if (!isTimeString(time)) throw invalid(copy.chooseHourAndMinutes, { [field]: copy.chooseHourAndMinutes });
  if (quarterHours && !QUARTER_MINUTES.includes(time.slice(3))) {
    throw invalid(copy.chooseHourAndMinutes, { [field]: copy.chooseHourAndMinutes });
  }
  const repeatedHour = body.repeatedHour;
  if (repeatedHour !== undefined && repeatedHour !== null && repeatedHour !== 'first' && repeatedHour !== 'second') {
    throw invalid(chooseWhichTime(time), { [field]: chooseWhichTime(time) });
  }
  const readings = instantsForWall(date, time);
  if (readings.length === 0) {
    throw invalid(missingHour(time, date), { [field]: missingHour(time, date) });
  }
  if (readings.length === 2 && kind !== 'notice' && (repeatedHour === undefined || repeatedHour === null)) {
    throw invalid(chooseWhichTime(time), { [field]: chooseWhichTime(time) });
  }
  const local: LocalDateTime = { date, time };
  if (readings.length === 2) local.repeatedHour = (repeatedHour as 'first' | 'second') ?? 'first';
  const reading = readWall(local);
  if (!reading) throw invalid(missingHour(time, date), { [field]: missingHour(time, date) });
  if (kind === 'depart') {
    const today = ukDateOf(now);
    if (date < today) throw invalid(copy.datePassed, { [field]: copy.datePassed });
    const nowWholeMinute = Math.floor(now / 60000) * 60000;
    if (reading.instant < nowWholeMinute + SHORT_NOTICE_MINUTES * 60000) {
      if (date === today && noHoursLeftToday(now)) {
        throw invalid(copy.noHoursLeft, { [field]: copy.noHoursLeft });
      }
      throw invalid(copy.shortNotice, { [field]: copy.shortNotice });
    }
  }
  return { local, instant: reading.instant };
}

/** True when no quarter-hour slot of today is at least half an hour away. */
export function noHoursLeftToday(now: number): boolean {
  const today = ukDateOf(now);
  const earliest = Math.floor(now / 60000) * 60000 + SHORT_NOTICE_MINUTES * 60000;
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minutes of QUARTER_MINUTES) {
      const time = `${String(hour).padStart(2, '0')}:${minutes}`;
      const readings = instantsForWall(today, time);
      for (const reading of readings) {
        if (reading >= earliest) return false;
      }
    }
  }
  return true;
}

export function hoursLeftToday(now: number): string[] {
  const today = ukDateOf(now);
  const earliest = Math.floor(now / 60000) * 60000 + SHORT_NOTICE_MINUTES * 60000;
  const hours: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const label = String(hour).padStart(2, '0');
    const possible = QUARTER_MINUTES.some((minutes) =>
      instantsForWall(today, `${label}:${minutes}`).some((reading) => reading >= earliest),
    );
    if (possible) hours.push(label);
  }
  return hours;
}

export function readEnquiryBody(body: Record<string, unknown>, now: number): EnquiryBody {
  const fields: Record<string, string> = {};
  const occasion = body.occasion;
  if (typeof occasion !== 'string' || !OCCASIONS.includes(occasion as Occasion)) {
    throw invalid(copy.chooseOccasion, { occasion: copy.chooseOccasion });
  }
  const journeyType = body.journeyType;
  if (typeof journeyType !== 'string' || !JOURNEY_TYPES.includes(journeyType as JourneyType)) {
    throw invalid(copy.enterPickUp, { journeyType: copy.enterPickUp });
  }
  const rawStops = Array.isArray(body.stops) ? (body.stops as unknown[]) : [];
  const stops = rawStops.map((stop) => {
    const row = stop !== null && typeof stop === 'object' ? (stop as Record<string, unknown>) : {};
    return {
      text: typeof row.text === 'string' ? row.text.trim() : '',
      checked: row.checked === true,
    };
  });
  if (stops.length < 2 || stops[0].text === '') {
    throw invalid(copy.enterPickUp, { from: copy.enterPickUp });
  }
  if (stops.length > 7) throw invalid(copy.enterDestination, { to: copy.enterDestination });
  if (stops[stops.length - 1].text === '') {
    throw invalid(copy.enterDestination, { to: copy.enterDestination });
  }
  for (let index = 1; index < stops.length - 1; index += 1) {
    if (stops[index].text === '') {
      throw invalid(copy.enterPickUp, { [`stop${index}`]: copy.enterPickUp });
    }
  }

  const depart = readLocalDateTime(body.departAt, 'departAt', 'depart', now, true);
  const journey = journeyType as JourneyType;
  let returnPart: { local: LocalDateTime; instant: number } | null = null;
  if (journey === 'return' || journey === 'sameDayReturn') {
    returnPart = readLocalDateTime(body.returnAt, 'returnAt', 'return', now, true);
    if (journey === 'sameDayReturn' && returnPart.local.date !== depart.local.date) {
      throw invalid(copy.returnTooEarly, { returnAt: copy.returnTooEarly });
    }
    if (returnPart.instant <= depart.instant) {
      throw invalid(copy.returnTooEarly, { returnAt: copy.returnTooEarly });
    }
  }

  const partyBody =
    body.party !== null && typeof body.party === 'object' && !Array.isArray(body.party)
      ? (body.party as Record<string, unknown>)
      : {};
  const people = wholeNumber(partyBody.people, 1, 400);
  if (people === null) fields.people = copy.enterPeople;
  const large = wholeNumber(partyBody.large ?? 0, 0, 40);
  const medium = wholeNumber(partyBody.medium ?? 0, 0, 40);
  const hand = wholeNumber(partyBody.hand ?? 0, 0, 40);
  if (large === null) fields.large = copy.enterBags;
  if (medium === null) fields.medium = copy.enterBags;
  if (hand === null) fields.hand = copy.enterBags;
  const wheelchairs = wholeNumber(partyBody.wheelchairs ?? 0, 0, 10);
  if (wheelchairs === null) fields.wheelchairs = copy.enterWheelchairs;

  const detailsValue = body.details;
  let details: string | null = null;
  if (typeof detailsValue === 'string') {
    details = detailsValue;
    if ([...details].length > 2000) fields.details = copy.describeStops;
  } else if (detailsValue !== null && detailsValue !== undefined) {
    fields.details = copy.describeStops;
  }
  if (journey === 'severalStops' && (details === null || details.trim() === '')) {
    fields.details = copy.describeStops;
  }

  const name = body.name;
  if (typeof name !== 'string' || name.trim() === '') fields.name = copy.enterName;
  if (!isEmailAddress(body.email)) fields.email = copy.enterEmail;
  if (!isUkTelephone(body.telephone)) fields.telephone = copy.enterTelephone;
  const language = body.language ?? 'en';
  if (!isLanguage(language)) fields.language = copy.enterName;

  if (Object.keys(fields).length > 0) {
    throw new AppError(422, 'invalidFields', Object.values(fields)[0], { fields });
  }

  return {
    occasion: occasion as Occasion,
    journeyType: journey,
    stops,
    departAt: depart.local,
    departInstant: depart.instant,
    returnAt: returnPart?.local ?? null,
    returnInstant: returnPart?.instant ?? null,
    party: {
      people: people as number,
      large: large as number,
      medium: medium as number,
      hand: hand as number,
      wheelchairs: wheelchairs as number,
    },
    details,
    name: (name as string).trim(),
    email: (body.email as string).trim(),
    telephone: (body.telephone as string).trim(),
    language: language as Language,
  };
}

export async function reusedCustomerId(
  client: PoolClient,
  deskId: string,
  person: { name: string; email: string; telephone: string; language: Language },
): Promise<string> {
  const found = await client.query<{ id: string }>(
    'select id from customers where desk_id = $1 and email_folded = $2 and removed = false and erased = false limit 1',
    [deskId, foldEmail(person.email)],
  );
  if (found.rows[0]) return found.rows[0].id;
  const id = makeId('CU');
  await client.query(
    `insert into customers (desk_id, id, name, email, email_folded, telephone, telephone_folded, language, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      deskId,
      id,
      person.name,
      person.email,
      foldEmail(person.email),
      person.telephone,
      foldTelephone(person.telephone),
      person.language,
      Date.now(),
    ],
  );
  return id;
}

export async function freshReference(client: PoolClient, deskId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reference = makeReference();
    const taken = await client.query('select 1 from enquiries where desk_id = $1 and id = $2', [deskId, reference]);
    if (taken.rowCount === 0) return reference;
  }
  throw new Error('no free reference');
}

export type StoredEnquiry = { reference: string; receivedAt: number };

export async function storeEnquiry(
  client: PoolClient,
  deskId: string,
  enquiry: EnquiryBody,
  submittedBody: string | null,
  state: EnquiryState = 'new',
): Promise<StoredEnquiry> {
  const reference = await freshReference(client, deskId);
  const now = Date.now();
  const customerId = await reusedCustomerId(client, deskId, {
    name: enquiry.name,
    email: enquiry.email,
    telephone: enquiry.telephone,
    language: enquiry.language,
  });
  await client.query(
    `insert into enquiries (desk_id, id, customer_id, occasion, state, journey_type, depart_date, depart_time,
      depart_repeated, depart_instant, return_date, return_time, return_repeated, return_instant, people, large,
      medium, hand, wheelchairs, details, language, submitted_body, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      deskId,
      reference,
      customerId,
      enquiry.occasion,
      state,
      enquiry.journeyType,
      enquiry.departAt.date,
      enquiry.departAt.time,
      enquiry.departAt.repeatedHour ?? null,
      enquiry.departInstant,
      enquiry.returnAt?.date ?? null,
      enquiry.returnAt?.time ?? null,
      enquiry.returnAt?.repeatedHour ?? null,
      enquiry.returnInstant,
      enquiry.party.people,
      enquiry.party.large,
      enquiry.party.medium,
      enquiry.party.hand,
      enquiry.party.wheelchairs,
      enquiry.details,
      enquiry.language,
      submittedBody,
      now,
    ],
  );
  for (let index = 0; index < enquiry.stops.length; index += 1) {
    await client.query(
      'insert into stops (desk_id, id, enquiry_id, position, text, checked) values ($1,$2,$3,$4,$5,$6)',
      [deskId, makeId('ST'), reference, index, enquiry.stops[index].text, enquiry.stops[index].checked],
    );
  }
  await client.query('insert into trips (desk_id, enquiry_id) values ($1, $2)', [deskId, reference]);
  await client.query("insert into hires (desk_id, id, stage) values ($1, $2, 'enquiry')", [deskId, reference]);
  return { reference, receivedAt: now };
}

export type EnquiryRowView = {
  id: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  occasion: Occasion;
  state: EnquiryState;
  departDate: string;
  departTime: string;
  departInstant: number;
  createdAt: number;
};

export type EnquiryListing = {
  rows: EnquiryRowView[];
  nextCursor: string | null;
  prevCursor: string | null;
};

export const ENQUIRY_PAGE_SIZE = 25;

function cursorOf(row: EnquiryRowView): string {
  return Buffer.from(`${row.createdAt}|${row.id}`).toString('base64url');
}

function readCursor(value: string | null): { createdAt: number; id: string } | null {
  if (!value) return null;
  try {
    const [createdAt, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt: Number(createdAt), id };
  } catch {
    return null;
  }
}

type ListRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  occasion: Occasion;
  state: EnquiryState;
  depart_date: string;
  depart_time: string;
  depart_instant: string;
  created_at: string;
};

/** Newest first, then reference, so a row added while reading neither repeats nor skips one. */
export async function listEnquiries(
  deskId: string,
  filters: { state?: string | null; occasion?: string | null; q?: string | null; after?: string | null; before?: string | null },
): Promise<EnquiryListing> {
  const values: unknown[] = [deskId];
  const where = [
    'e.desk_id = $1',
    'e.merged_into is null',
    "c.state <> 'closed'",
    'c.erased = false',
    'c.removed = false',
  ];
  if (filters.state && filters.state !== 'all' && ENQUIRY_STATES.includes(filters.state as EnquiryState)) {
    values.push(filters.state);
    where.push(`e.state = $${values.length}`);
  }
  if (filters.occasion && filters.occasion !== 'all' && OCCASIONS.includes(filters.occasion as Occasion)) {
    values.push(filters.occasion);
    where.push(`e.occasion = $${values.length}`);
  }
  if (filters.q && filters.q.trim() !== '') {
    values.push(`%${filters.q.trim().toLowerCase()}%`);
    const place = values.length;
    where.push(`(lower(e.id) like $${place} or lower(c.name) like $${place} or lower(c.email) like $${place})`);
  }
  const after = readCursor(filters.after ?? null);
  const before = readCursor(filters.before ?? null);
  let order = 'order by e.created_at desc, e.id';
  if (after) {
    values.push(after.createdAt, after.id);
    where.push(`(e.created_at, e.id) < ($${values.length - 1}, $${values.length})`);
  } else if (before) {
    values.push(before.createdAt, before.id);
    where.push(`(e.created_at, e.id) > ($${values.length - 1}, $${values.length})`);
    order = 'order by e.created_at, e.id desc';
  }
  values.push(ENQUIRY_PAGE_SIZE + 1);
  const rows = await query<ListRow>(
    `select e.id, c.name as customer_name, c.email as customer_email, e.occasion, e.state, e.depart_date,
            e.depart_time, e.depart_instant, e.created_at
     from enquiries e join customers c on c.desk_id = e.desk_id and c.id = e.customer_id
     where ${where.join(' and ')} ${order} limit $${values.length}`,
    values,
  );
  const page = rows.slice(0, ENQUIRY_PAGE_SIZE).map((row) => ({
    id: row.id,
    reference: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    occasion: row.occasion,
    state: row.state,
    departDate: row.depart_date,
    departTime: row.depart_time,
    departInstant: Number(row.depart_instant),
    createdAt: Number(row.created_at),
  }));
  if (before) page.reverse();
  const more = rows.length > ENQUIRY_PAGE_SIZE;
  const last = page.at(-1);
  const first = page.at(0);
  return {
    rows: page,
    nextCursor: before ? (first ? cursorOf(page[page.length - 1]) : null) : more && last ? cursorOf(last) : null,
    prevCursor: after && first ? cursorOf(first) : before && more && first ? cursorOf(first) : null,
  };
}

/** Requests sharing a folded email or telephone, offered for merging. */
export async function duplicatesOf(deskId: string, enquiryId: string): Promise<{ id: string; reference: string }[]> {
  const rows = await query<{ id: string }>(
    `select other.id from enquiries mine
     join customers myCustomer on myCustomer.desk_id = mine.desk_id and myCustomer.id = mine.customer_id
     join customers otherCustomer on otherCustomer.desk_id = mine.desk_id
       and (otherCustomer.email_folded = myCustomer.email_folded
            or otherCustomer.telephone_folded = myCustomer.telephone_folded)
     join enquiries other on other.desk_id = mine.desk_id and other.customer_id = otherCustomer.id
     where mine.desk_id = $1 and mine.id = $2 and other.id <> mine.id and other.merged_into is null
     order by other.created_at desc, other.id`,
    [deskId, enquiryId],
  );
  return rows.map((row) => ({ id: row.id, reference: row.id }));
}

export async function mergeEnquiries(deskId: string, ids: string[]): Promise<{ kept: string; merged: string[] }> {
  const rows = await query<{ id: string; created_at: string; email_folded: string; telephone_folded: string }>(
    `select e.id, e.created_at, c.email_folded, c.telephone_folded from enquiries e
     join customers c on c.desk_id = e.desk_id and c.id = e.customer_id
     where e.desk_id = $1 and e.id = any($2::text[]) and e.merged_into is null`,
    [deskId, ids],
  );
  if (rows.length !== ids.length) throw conflict('notDuplicates', copy.notFound);
  const emails = new Set(rows.map((row) => row.email_folded));
  const telephones = new Set(rows.map((row) => row.telephone_folded));
  if (emails.size > 1 && telephones.size > 1) {
    throw conflict('notDuplicates', 'Those enquiries are not duplicates.');
  }
  const order = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at) || (a.id < b.id ? -1 : 1));
  const kept = order[0].id;
  const merged = order.slice(1).map((row) => row.id);
  for (const id of merged) {
    await query('update enquiries set merged_into = $3 where desk_id = $1 and id = $2', [deskId, id, kept]);
  }
  return { kept, merged };
}

export async function mergedReferencesOf(deskId: string, enquiryId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    'select id from enquiries where desk_id = $1 and merged_into = $2 order by id',
    [deskId, enquiryId],
  );
  return rows.map((row) => row.id);
}

export async function enquiryIdFollowingMerges(deskId: string, id: string): Promise<string | null> {
  const row = await query<{ id: string; merged_into: string | null }>(
    'select id, merged_into from enquiries where desk_id = $1 and id = $2',
    [deskId, id],
  );
  const found = row[0];
  if (!found) return null;
  return found.merged_into ?? found.id;
}

export function nowLabel(now: number): string {
  return `${ukDateOf(now)} ${ukTimeOf(now)}`;
}
