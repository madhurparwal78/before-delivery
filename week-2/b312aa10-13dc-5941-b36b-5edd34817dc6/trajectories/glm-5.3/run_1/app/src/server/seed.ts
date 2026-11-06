import type { PoolClient } from 'pg';
import { scryptSync, randomBytes } from 'node:crypto';
import { addDays, localDateInZone } from './time.js';

export const DEMO_PASSWORD = 'lineboard-demo';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32).toString('hex');
  return candidate.length === hash.length &&
    candidate.split('').every((c, i) => c === hash[i] || (hash.charCodeAt(i) ^ candidate.charCodeAt(i)) === 0) &&
    candidate === hash;
}

interface KitchenSeed {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  peakWindows: { days: string[]; start: string; end: string }[];
  requiredDocuments: string[];
}

const KITCHENS: KitchenSeed[] = [
  {
    id: 'kit_northside',
    name: 'Northside Commissary',
    slug: 'northside',
    timeZone: 'America/New_York',
    peakWindows: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '16:00', end: '19:00' },
      { days: ['sat', 'sun'], start: '08:00', end: '13:00' },
    ],
    requiredDocuments: ['insurance_certificate', 'food_handler_card'],
  },
  {
    id: 'kit_harbor',
    name: 'Harbor Street Kitchen',
    slug: 'harbor-street',
    timeZone: 'America/Chicago',
    peakWindows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '15:00', end: '18:00' }],
    requiredDocuments: ['insurance_certificate', 'food_handler_card'],
  },
];

interface PersonSeed {
  id: string;
  email: string;
  name: string;
  role: 'operator' | 'shift_lead' | 'member';
  kitchenId: string;
  memberId: string | null;
  business: string | null;
  allowance: number | null;
}

const PEOPLE: PersonSeed[] = [
  { id: 'per_marisol', email: 'ops@northside.example', name: 'Marisol Vega', role: 'operator', kitchenId: 'kit_northside', memberId: null, business: null, allowance: null },
  { id: 'per_theo', email: 'lead@northside.example', name: 'Theo Lindqvist', role: 'shift_lead', kitchenId: 'kit_northside', memberId: null, business: null, allowance: null },
  { id: 'per_ada', email: 'ada@bellobakes.example', name: 'Ada Bello', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_ada', business: 'Bello Bakes', allowance: 40 },
  { id: 'per_kofi', email: 'kofi@smokestack.example', name: 'Kofi Mensah', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_kofi', business: 'Smokestack Truck', allowance: 20 },
  { id: 'per_rina', email: 'rina@satopickle.example', name: 'Rina Sato', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_rina', business: 'Sato Pickle Co.', allowance: 8 },
  { id: 'per_nadia', email: 'nadia@okorospice.example', name: 'Nadia Okoro', role: 'member', kitchenId: 'kit_northside', memberId: 'mem_nadia', business: 'Okoro Spice Kitchen', allowance: 12 },
  { id: 'per_jonah', email: 'ops@harbor.example', name: 'Jonah Pierce', role: 'operator', kitchenId: 'kit_harbor', memberId: null, business: null, allowance: null },
  { id: 'per_lena', email: 'lead@harbor.example', name: 'Lena Cho', role: 'shift_lead', kitchenId: 'kit_harbor', memberId: null, business: null, allowance: null },
  { id: 'per_omar', email: 'omar@haddadhummus.example', name: 'Omar Haddad', role: 'member', kitchenId: 'kit_harbor', memberId: 'mem_omar', business: 'Haddad Hummus', allowance: 30 },
];

interface StationSeed {
  id: string;
  kitchenId: string;
  name: string;
  kind: 'hourly' | 'shelf';
  capacity: number | null;
  offPeakCents: number | null;
  peakCents: number | null;
  shelfDayCents: number | null;
  laneOrder: number;
}

const STATIONS: StationSeed[] = [
  { id: 'stn_prep1', kitchenId: 'kit_northside', name: 'Prep Station 1', kind: 'hourly', capacity: null, offPeakCents: 1875, peakCents: 2610, shelfDayCents: null, laneOrder: 1 },
  { id: 'stn_prep2', kitchenId: 'kit_northside', name: 'Prep Station 2', kind: 'hourly', capacity: null, offPeakCents: 1875, peakCents: 2610, shelfDayCents: null, laneOrder: 2 },
  { id: 'stn_oven1', kitchenId: 'kit_northside', name: 'Oven 1', kind: 'hourly', capacity: null, offPeakCents: 3750, peakCents: 5225, shelfDayCents: null, laneOrder: 3 },
  { id: 'stn_oven2', kitchenId: 'kit_northside', name: 'Oven 2', kind: 'hourly', capacity: null, offPeakCents: 3750, peakCents: 5225, shelfDayCents: null, laneOrder: 4 },
  { id: 'stn_shelfA', kitchenId: 'kit_northside', name: 'Walk-in Shelf A', kind: 'shelf', capacity: 3, offPeakCents: null, peakCents: null, shelfDayCents: 640, laneOrder: 5 },
  { id: 'stn_shelfB', kitchenId: 'kit_northside', name: 'Walk-in Shelf B', kind: 'shelf', capacity: 2, offPeakCents: null, peakCents: null, shelfDayCents: 640, laneOrder: 6 },
  { id: 'stn_line1', kitchenId: 'kit_harbor', name: 'Line 1', kind: 'hourly', capacity: null, offPeakCents: 2200, peakCents: 3000, shelfDayCents: null, laneOrder: 1 },
  { id: 'stn_ovenA', kitchenId: 'kit_harbor', name: 'Oven A', kind: 'hourly', capacity: null, offPeakCents: 4000, peakCents: 5500, shelfDayCents: null, laneOrder: 2 },
  { id: 'stn_shelf1', kitchenId: 'kit_harbor', name: 'Walk-in Shelf 1', kind: 'shelf', capacity: 4, offPeakCents: null, peakCents: null, shelfDayCents: 500, laneOrder: 3 },
];

interface SeedDocument {
  memberId: string;
  type: 'insurance_certificate' | 'food_handler_card';
  fileName: string;
  offsetDays: number;
}

const SEED_DOCUMENTS: SeedDocument[] = [
  { memberId: 'mem_ada', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', offsetDays: 365 },
  { memberId: 'mem_ada', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', offsetDays: 365 },
  { memberId: 'mem_kofi', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', offsetDays: 365 },
  { memberId: 'mem_kofi', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', offsetDays: 365 },
  { memberId: 'mem_rina', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', offsetDays: 365 },
  { memberId: 'mem_rina', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', offsetDays: 40 },
  { memberId: 'mem_nadia', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', offsetDays: -1 },
  { memberId: 'mem_omar', type: 'insurance_certificate', fileName: 'seed-insurance-certificate.pdf', offsetDays: 365 },
  { memberId: 'mem_omar', type: 'food_handler_card', fileName: 'seed-food-handler-card.pdf', offsetDays: 365 },
];

/** A one-page PDF whose bytes begin with %PDF-. */
export function seedPdfBytes(memberId: string, type: string): Buffer {
  const text = `Seed document ${type} for ${memberId}`;
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * The seed is applied idempotently at start: a later start never adds, re-dates
 * or rewrites a seeded record or object. The first-start date is stored once.
 */
export async function applySeed(client: PoolClient, now: Date): Promise<void> {
  for (const kitchen of KITCHENS) {
    await client.query(
      `INSERT INTO kitchens (id, name, slug, time_zone, rules_version, peak_windows, required_documents)
       VALUES ($1,$2,$3,$4,1,$5::jsonb,$6)
       ON CONFLICT (id) DO NOTHING`,
      [kitchen.id, kitchen.name, kitchen.slug, kitchen.timeZone, JSON.stringify(kitchen.peakWindows), kitchen.requiredDocuments],
    );
  }
  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const person of PEOPLE) {
    await client.query(
      `INSERT INTO people (id, email, password_hash, name, role, kitchen_id, member_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [person.id, person.email, passwordHash, person.name, person.role, person.kitchenId, person.memberId],
    );
    if (person.memberId) {
      await client.query(
        `INSERT INTO members (id, kitchen_id, person_id, business_name, allowance_hours)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [person.memberId, person.kitchenId, person.id, person.business, person.allowance],
      );
    }
  }
  for (const station of STATIONS) {
    await client.query(
      `INSERT INTO stations (id, kitchen_id, name, kind, capacity, lane_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [station.id, station.kitchenId, station.name, station.kind, station.capacity, station.laneOrder],
    );
    const effectiveFrom = '2026-01-01T00:00';
    await client.query(
      `INSERT INTO rate_versions (id, station_id, effective_from_local, effective_at, off_peak_cents, peak_cents, shelf_day_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (station_id, effective_at) DO NOTHING`,
      [
        `rate_${station.id}`,
        station.id,
        effectiveFrom,
        new Date('2026-01-01T06:00:00Z'),
        station.offPeakCents,
        station.peakCents,
        station.shelfDayCents,
      ],
    );
  }
  // First-start date: stored once per kitchen, never recomputed.
  for (const kitchen of KITCHENS) {
    const stored = await client.query<{ first_start_date: string }>(
      `SELECT first_start_date FROM kitchens WHERE id=$1`,
      [kitchen.id],
    );
    if (!stored.rows[0].first_start_date) {
      const firstDate = localDateInZone(now, kitchen.timeZone);
      await client.query(
        `UPDATE kitchens SET first_start_date=$2, first_start_instant=$3, seeded=true WHERE id=$1`,
        [kitchen.id, firstDate, now],
      );
      const firstStart = firstDate;
      for (const doc of SEED_DOCUMENTS) {
        if (doc.memberId === 'mem_omar' && kitchen.id !== 'kit_harbor') continue;
        if (doc.memberId !== 'mem_omar' && kitchen.id !== 'kit_northside') continue;
        const bytes = seedPdfBytes(doc.memberId, doc.type);
        const kitchenId = kitchen.id;
        const docId = `doc_${doc.memberId}_${doc.type === 'insurance_certificate' ? 'ins' : 'fhc'}`;
        const expiry = addDays(firstStart, doc.offsetDays);
        const inserted = await client.query(
          `INSERT INTO documents (id, kitchen_id, member_id, type, expiry_date, status, file_name, content_type, size_bytes, uploaded_at, approved_at, version, superseded, seed)
           VALUES ($1,$2,$3,$4,$5,'approved',$6,'application/pdf',$7,$8,$8,2,false,true)
           ON CONFLICT (id) DO NOTHING`,
          [docId, kitchenId, doc.memberId, doc.type, expiry, doc.fileName, bytes.length, now],
        );
        if (inserted.rowCount && inserted.rowCount > 0) {
          await client.query(`INSERT INTO seed_objects_pending (document_id) VALUES ($1) ON CONFLICT DO NOTHING`, [docId]);
        }
      }
    }
  }
}
