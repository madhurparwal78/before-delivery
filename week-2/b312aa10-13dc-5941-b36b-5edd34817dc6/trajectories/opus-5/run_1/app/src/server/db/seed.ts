/** The seed and its first-start date, applied idempotently at every start. */
import { addDays } from '../../shared/calendar.js';
import { documentTypeLabel, type DocumentType } from '../../shared/format.js';
import { hashPassword } from '../domain/passwords.js';
import { localDateOf, localToInstant } from '../domain/time.js';
import { renderPdf } from '../services/pdf.js';
import { documentKey, putObject } from '../services/storage.js';
import { db, type Queryable } from './pool.js';

type SeedKitchen = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  peakWindows: Array<{ days: string[]; start: string; end: string }>;
  requiredDocuments: string[];
};

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];

const kitchens: SeedKitchen[] = [
  {
    id: 'kit_northside',
    name: 'Northside Commissary',
    slug: 'northside',
    timeZone: 'America/New_York',
    peakWindows: [
      { days: weekdays, start: '16:00', end: '19:00' },
      { days: ['sat', 'sun'], start: '08:00', end: '13:00' },
    ],
    requiredDocuments: ['insurance_certificate', 'food_handler_card'],
  },
  {
    id: 'kit_harbor',
    name: 'Harbor Street Kitchen',
    slug: 'harbor-street',
    timeZone: 'America/Chicago',
    peakWindows: [{ days: weekdays, start: '15:00', end: '18:00' }],
    requiredDocuments: ['insurance_certificate', 'food_handler_card'],
  },
];

type SeedPerson = {
  id: string;
  email: string;
  name: string;
  role: 'operator' | 'shift_lead' | 'member';
  kitchenId: string;
  memberId?: string;
  business?: string;
  allowanceHours?: number;
};

const people: SeedPerson[] = [
  { id: 'per_marisol', email: 'ops@northside.example', name: 'Marisol Vega', role: 'operator', kitchenId: 'kit_northside' },
  { id: 'per_theo', email: 'lead@northside.example', name: 'Theo Lindqvist', role: 'shift_lead', kitchenId: 'kit_northside' },
  { id: 'per_ada', email: 'ada@bellobakes.example', name: 'Ada Bello', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_ada', business: 'Bello Bakes', allowanceHours: 40 },
  { id: 'per_kofi', email: 'kofi@smokestack.example', name: 'Kofi Mensah', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_kofi', business: 'Smokestack Truck', allowanceHours: 20 },
  { id: 'per_rina', email: 'rina@satopickle.example', name: 'Rina Sato', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_rina', business: 'Sato Pickle Co.', allowanceHours: 8 },
  { id: 'per_nadia', email: 'nadia@okorospice.example', name: 'Nadia Okoro', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_nadia', business: 'Okoro Spice Kitchen', allowanceHours: 12 },
  { id: 'per_jonah', email: 'ops@harbor.example', name: 'Jonah Pierce', role: 'operator', kitchenId: 'kit_harbor' },
  { id: 'per_lena', email: 'lead@harbor.example', name: 'Lena Cho', role: 'shift_lead', kitchenId: 'kit_harbor' },
  { id: 'per_omar', email: 'omar@haddadhummus.example', name: 'Omar Haddad', role: 'member', kitchenId: 'kit_harbor', memberId: 'mem_omar', business: 'Haddad Hummus', allowanceHours: 30 },
];

type SeedStation = {
  id: string;
  kitchenId: string;
  name: string;
  kind: 'hourly' | 'shelf';
  capacity: number | null;
  offPeak: number | null;
  peak: number | null;
  shelfDay: number | null;
};

const stations: SeedStation[] = [
  { id: 'stn_prep1', kitchenId: 'kit_northside', name: 'Prep Station 1', kind: 'hourly', capacity: null, offPeak: 1875, peak: 2610, shelfDay: null },
  { id: 'stn_prep2', kitchenId: 'kit_northside', name: 'Prep Station 2', kind: 'hourly', capacity: null, offPeak: 1875, peak: 2610, shelfDay: null },
  { id: 'stn_oven1', kitchenId: 'kit_northside', name: 'Oven 1', kind: 'hourly', capacity: null, offPeak: 3750, peak: 5225, shelfDay: null },
  { id: 'stn_oven2', kitchenId: 'kit_northside', name: 'Oven 2', kind: 'hourly', capacity: null, offPeak: 3750, peak: 5225, shelfDay: null },
  { id: 'stn_shelfA', kitchenId: 'kit_northside', name: 'Walk-in Shelf A', kind: 'shelf', capacity: 3, offPeak: null, peak: null, shelfDay: 640 },
  { id: 'stn_shelfB', kitchenId: 'kit_northside', name: 'Walk-in Shelf B', kind: 'shelf', capacity: 2, offPeak: null, peak: null, shelfDay: 640 },
  { id: 'stn_line1', kitchenId: 'kit_harbor', name: 'Line 1', kind: 'hourly', capacity: null, offPeak: 2200, peak: 3000, shelfDay: null },
  { id: 'stn_ovenA', kitchenId: 'kit_harbor', name: 'Oven A', kind: 'hourly', capacity: null, offPeak: 4000, peak: 5500, shelfDay: null },
  { id: 'stn_shelf1', kitchenId: 'kit_harbor', name: 'Walk-in Shelf 1', kind: 'shelf', capacity: 4, offPeak: null, peak: null, shelfDay: 500 },
];

type SeedDocument = {
  id: string;
  memberId: string;
  kitchenId: string;
  type: DocumentType;
  fileName: string;
  expiryOffsetDays: number;
};

const seedDocuments: SeedDocument[] = [
  { id: 'doc_seed_ada_ins', memberId: 'mem_ada', kitchenId: 'kit_northside', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_ada_fhc', memberId: 'mem_ada', kitchenId: 'kit_northside', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_kofi_ins', memberId: 'mem_kofi', kitchenId: 'kit_northside', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_kofi_fhc', memberId: 'mem_kofi', kitchenId: 'kit_northside', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_rina_ins', memberId: 'mem_rina', kitchenId: 'kit_northside', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_rina_fhc', memberId: 'mem_rina', kitchenId: 'kit_northside', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', expiryOffsetDays: 40 },
  { id: 'doc_seed_nadia_ins', memberId: 'mem_nadia', kitchenId: 'kit_northside', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', expiryOffsetDays: -1 },
  { id: 'doc_seed_omar_ins', memberId: 'mem_omar', kitchenId: 'kit_harbor', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', expiryOffsetDays: 365 },
  { id: 'doc_seed_omar_fhc', memberId: 'mem_omar', kitchenId: 'kit_harbor', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', expiryOffsetDays: 365 },
];

/** Deterministic bytes, so a later start never rewrites a seeded object. */
export function seedDocumentBytes(document: {
  id: string;
  type: DocumentType;
  fileName: string;
  expiryDate: string;
}): Buffer {
  return renderPdf([
    { text: 'Lineboard seed document', bold: true, size: 14 },
    { text: '' },
    { text: `Document: ${documentTypeLabel(document.type)}` },
    { text: `File: ${document.fileName}` },
    { text: `Expires: ${document.expiryDate}` },
    { text: `Reference: ${document.id}` },
  ]);
}

export async function applySeed(): Promise<void> {
  const client = db();
  await client.query(
    `insert into install (id, started_at) values (1, now()) on conflict (id) do nothing`,
  );
  const install = await client.query<{ started_at: Date }>(`select started_at from install where id = 1`);
  const startedAt = install.rows[0]!.started_at.getTime();

  for (const kitchen of kitchens) {
    await client.query(
      `insert into kitchens (id, name, slug, time_zone, peak_windows, required_documents,
                             rules_version, first_start_date, first_start_at)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,1,$7,$8)
       on conflict (id) do nothing`,
      [
        kitchen.id,
        kitchen.name,
        kitchen.slug,
        kitchen.timeZone,
        JSON.stringify(kitchen.peakWindows),
        JSON.stringify(kitchen.requiredDocuments),
        localDateOf(kitchen.timeZone, startedAt),
        new Date(startedAt).toISOString(),
      ],
    );
  }

  const passwordHash = hashPassword('lineboard-demo');
  for (const person of people) {
    await client.query(
      `insert into people (id, kitchen_id, email, name, role, password_hash)
       values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [person.id, person.kitchenId, person.email, person.name, person.role, passwordHash],
    );
    if (person.memberId) {
      await client.query(
        `insert into members (id, kitchen_id, person_id, business_name, allowance_quarters)
         values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
        [person.memberId, person.kitchenId, person.id, person.business, (person.allowanceHours ?? 0) * 4],
      );
    }
  }

  for (const [index, station] of stations.entries()) {
    await client.query(
      `insert into stations (id, kitchen_id, name, kind, capacity, lane_order)
       values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
      [station.id, station.kitchenId, station.name, station.kind, station.capacity, index],
    );
    const kitchen = kitchens.find((candidate) => candidate.id === station.kitchenId)!;
    const effectiveAt = localToInstant(kitchen.timeZone, '2026-01-01', '00:00');
    await client.query(
      `insert into rate_versions (id, station_id, effective_from, effective_at,
                                  off_peak_hourly_cents, peak_hourly_cents, shelf_day_cents)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [
        `rv_seed_${station.id}`,
        station.id,
        '2026-01-01T00:00',
        new Date(effectiveAt!).toISOString(),
        station.offPeak,
        station.peak,
        station.shelfDay,
      ],
    );
  }

  const kitchenRows = await client.query<{ id: string; first_start_date: string; first_start_at: Date }>(
    `select id, first_start_date, first_start_at from kitchens`,
  );
  for (const document of seedDocuments) {
    const kitchen = kitchenRows.rows.find((row) => row.id === document.kitchenId);
    if (!kitchen) continue;
    const expiryDate = addDays(kitchen.first_start_date, document.expiryOffsetDays);
    const bytes = seedDocumentBytes({ ...document, expiryDate });
    const inserted = await client.query(
      `insert into documents (id, kitchen_id, member_id, type, expiry_date, status, file_name,
                              content_type, size_bytes, uploaded_at, approved_at, version, object_pending)
       values ($1,$2,$3,$4,$5,'approved',$6,'application/pdf',$7,$8,$8,2,true)
       on conflict (id) do nothing`,
      [
        document.id,
        document.kitchenId,
        document.memberId,
        document.type,
        expiryDate,
        document.fileName,
        bytes.byteLength,
        kitchen.first_start_at.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) continue;
    await storeSeedObject(client, document.kitchenId, document.memberId, document.id, bytes);
  }

  for (const person of people) {
    if (person.memberId) {
      await client.query(
        `insert into kb_accounts (member_id, account_id) values ($1, null)
         on conflict (member_id) do nothing`,
        [person.memberId],
      );
    }
  }
}

async function storeSeedObject(
  client: Queryable,
  kitchenId: string,
  memberId: string,
  documentId: string,
  bytes: Buffer,
): Promise<void> {
  try {
    await putObject(documentKey(kitchenId, memberId, documentId), bytes, 'application/pdf');
    await client.query(`update documents set object_pending = false where id = $1`, [documentId]);
  } catch {
    // Written later by the recovery worker; the record stays approved meanwhile.
  }
}

/** Writes any seed objects that storage could not take at first start. */
export async function storePendingSeedObjects(): Promise<void> {
  const client = db();
  const rows = await client.query<{
    id: string;
    kitchen_id: string;
    member_id: string;
    type: DocumentType;
    file_name: string;
    expiry_date: string;
  }>(
    `select id, kitchen_id, member_id, type, file_name, expiry_date
       from documents where object_pending = true`,
  );
  for (const row of rows.rows) {
    const bytes = seedDocumentBytes({
      id: row.id,
      type: row.type,
      fileName: row.file_name,
      expiryDate: row.expiry_date,
    });
    await storeSeedObject(client, row.kitchen_id, row.member_id, row.id, bytes);
  }
}
