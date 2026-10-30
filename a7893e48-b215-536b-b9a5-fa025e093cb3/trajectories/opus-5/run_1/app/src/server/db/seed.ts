import type { DocumentKind } from '../../shared/types.js';
import { writeMovement } from '../domain/pack.js';
import { unpaidCutoff } from '../domain/policy.js';
import { addDays, elapsedMinutes, localDate, resolveLocal, startOfLocalDay } from '../domain/zone.js';
import { hashPassword } from '../http/session.js';
import { buildPdf } from '../services/pdf.js';
import { objectExists, putObject } from '../services/storage.js';
import { pool, queryOne, transaction } from './pool.js';

const SEED_PASSWORD = 'hearth-demo-2026';
const PACK_MINUTES = 1200;
const PACK_PRICE_CENTS = 56000;

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

interface SeedSite {
  id: string;
  operatorId: string;
  name: string;
  zone: string;
  depositCents: number;
  cleaningFeeCents: number;
  noticeHours: number;
}

const OPERATORS: { id: string; name: string }[] = [
  { id: 'op-ember', name: 'Ember Row Kitchens' },
  { id: 'op-cedar', name: 'Cedar Commons' },
];

const SITES: SeedSite[] = [
  {
    id: 'site-halsted',
    operatorId: 'op-ember',
    name: 'Ember Row — Halsted',
    zone: 'America/Chicago',
    depositCents: 7500,
    cleaningFeeCents: 3500,
    noticeHours: 24,
  },
  {
    id: 'site-corktown',
    operatorId: 'op-ember',
    name: 'Ember Row — Corktown',
    zone: 'America/Detroit',
    depositCents: 7500,
    cleaningFeeCents: 3500,
    noticeHours: 24,
  },
  {
    id: 'site-fremont',
    operatorId: 'op-cedar',
    name: 'Cedar Commons — Fremont',
    zone: 'America/Los_Angeles',
    depositCents: 6000,
    cleaningFeeCents: 3000,
    noticeHours: 48,
  },
];

const STATIONS: { id: string; siteId: string; name: string; rateCents: number }[] = [
  { id: 'st-deck-1', siteId: 'site-halsted', name: 'Deck oven 1', rateCents: 3800 },
  { id: 'st-deck-2', siteId: 'site-halsted', name: 'Deck oven 2', rateCents: 3800 },
  { id: 'st-range-a', siteId: 'site-halsted', name: 'Range line A', rateCents: 3200 },
  { id: 'st-prep-3', siteId: 'site-halsted', name: 'Prep table 3', rateCents: 2000 },
  { id: 'st-walkin-4', siteId: 'site-halsted', name: 'Walk-in shelf 4', rateCents: 600 },
  { id: 'st-ct-deck', siteId: 'site-corktown', name: 'Deck oven', rateCents: 3600 },
  { id: 'st-ct-range', siteId: 'site-corktown', name: 'Range line', rateCents: 3000 },
  { id: 'st-ct-prep', siteId: 'site-corktown', name: 'Prep table', rateCents: 1800 },
  { id: 'st-fr-deck', siteId: 'site-fremont', name: 'Deck oven', rateCents: 4000 },
  { id: 'st-fr-range', siteId: 'site-fremont', name: 'Range line', rateCents: 3400 },
  { id: 'st-fr-prep', siteId: 'site-fremont', name: 'Prep table', rateCents: 2200 },
];

const RENTERS: {
  id: string;
  operatorId: string;
  email: string;
  name: string;
  business: string;
  phone: string;
  homeSiteId: string;
}[] = [
  {
    id: 'rn-juniper',
    operatorId: 'op-ember',
    email: 'tamsin@junipercrumb.test',
    name: 'Tamsin Okoro',
    business: 'Juniper Crumb Bakery',
    phone: '+1-312-555-0141',
    homeSiteId: 'site-halsted',
  },
  {
    id: 'rn-saltbox',
    operatorId: 'op-ember',
    email: 'rafa@saltboxtacos.test',
    name: 'Rafa Quintero',
    business: 'Saltbox Tacos',
    phone: '+1-312-555-0172',
    homeSiteId: 'site-halsted',
  },
  {
    id: 'rn-ledger',
    operatorId: 'op-ember',
    email: 'june@littleledger.test',
    name: 'June Abernathy',
    business: 'Little Ledger Meal Prep',
    phone: '+1-313-555-0118',
    homeSiteId: 'site-corktown',
  },
  {
    id: 'rn-nightjar',
    operatorId: 'op-ember',
    email: 'ike@nightjarpies.test',
    name: 'Ike Brennan',
    business: 'Nightjar Pies',
    phone: '+1-312-555-0190',
    homeSiteId: 'site-halsted',
  },
  {
    id: 'rn-fennel',
    operatorId: 'op-cedar',
    email: 'noor@fennelfig.test',
    name: 'Noor Haddad',
    business: 'Fennel & Fig Catering',
    phone: '+1-510-555-0133',
    homeSiteId: 'site-fremont',
  },
];

const STAFF: {
  id: string;
  operatorId: string;
  siteId: string | null;
  email: string;
  name: string;
  role: 'manager' | 'front_desk';
}[] = [
  {
    id: 'us-odile',
    operatorId: 'op-ember',
    siteId: null,
    email: 'odile@emberrow.test',
    name: 'Odile Marchetti',
    role: 'manager',
  },
  {
    id: 'us-priya',
    operatorId: 'op-ember',
    siteId: 'site-halsted',
    email: 'desk.halsted@emberrow.test',
    name: 'Priya Lindqvist',
    role: 'front_desk',
  },
  {
    id: 'us-marcus',
    operatorId: 'op-ember',
    siteId: 'site-corktown',
    email: 'desk.corktown@emberrow.test',
    name: 'Marcus Feld',
    role: 'front_desk',
  },
  {
    id: 'us-wen',
    operatorId: 'op-cedar',
    siteId: null,
    email: 'wen@cedarcommons.test',
    name: 'Wen Hollis',
    role: 'manager',
  },
  {
    id: 'us-ada',
    operatorId: 'op-cedar',
    siteId: 'site-fremont',
    email: 'desk@cedarcommons.test',
    name: 'Ada Moreno',
    role: 'front_desk',
  },
];

const DOCUMENTS: {
  id: string;
  renterId: string;
  kind: DocumentKind;
  validFrom: string;
  expiresOn: string;
  format: 'pdf' | 'png';
}[] = [
  {
    id: 'doc-juniper-liability',
    renterId: 'rn-juniper',
    kind: 'liability',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-juniper-food',
    renterId: 'rn-juniper',
    kind: 'food_handler',
    validFrom: '2026-01-01',
    expiresOn: '2030-06-30',
    format: 'png',
  },
  {
    id: 'doc-saltbox-liability',
    renterId: 'rn-saltbox',
    kind: 'liability',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-saltbox-food',
    renterId: 'rn-saltbox',
    kind: 'food_handler',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-ledger-food',
    renterId: 'rn-ledger',
    kind: 'food_handler',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-nightjar-liability',
    renterId: 'rn-nightjar',
    kind: 'liability',
    validFrom: '2025-02-01',
    expiresOn: '2026-01-31',
    format: 'pdf',
  },
  {
    id: 'doc-nightjar-food',
    renterId: 'rn-nightjar',
    kind: 'food_handler',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-fennel-liability',
    renterId: 'rn-fennel',
    kind: 'liability',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
  {
    id: 'doc-fennel-food',
    renterId: 'rn-fennel',
    kind: 'food_handler',
    validFrom: '2026-01-01',
    expiresOn: '2030-12-31',
    format: 'pdf',
  },
];

export function documentKey(renterId: string, documentId: string): string {
  return `renters/${renterId}/documents/${documentId}`;
}

function documentBytes(format: 'pdf' | 'png', title: string): { bytes: Buffer; type: string } {
  if (format === 'png') return { bytes: TINY_PNG, type: 'image/png' };
  return { bytes: buildPdf([{ text: title, bold: true }]), type: 'application/pdf' };
}

async function seedReferenceData(): Promise<void> {
  await transaction(async (client) => {
    for (const operator of OPERATORS) {
      await client.query('INSERT INTO operators (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        operator.id,
        operator.name,
      ]);
    }
    for (const [index, site] of SITES.entries()) {
      await client.query(
        `INSERT INTO sites (id, operator_id, name, time_zone, deposit_cents, cleaning_fee_cents, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          site.id,
          site.operatorId,
          site.name,
          site.zone,
          site.depositCents,
          site.cleaningFeeCents,
          index,
        ],
      );
      const effectiveAt = startOfLocalDay(site.zone, '2026-01-01');
      await client.query(
        `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $5) ON CONFLICT DO NOTHING`,
        [
          `pv-seed-${site.id}`,
          site.id,
          site.noticeHours,
          '2026-01-01',
          effectiveAt,
          'Hearthshift setup',
        ],
      );
    }
    for (const [index, station] of STATIONS.entries()) {
      await client.query(
        `INSERT INTO stations (id, site_id, name, rate_cents, sort_order)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [station.id, station.siteId, station.name, station.rateCents, index],
      );
    }
    for (const renter of RENTERS) {
      await client.query(
        `INSERT INTO renters (id, operator_id, name, business, email, phone, home_site_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          renter.id,
          renter.operatorId,
          renter.name,
          renter.business,
          renter.email,
          renter.phone,
          renter.homeSiteId,
        ],
      );
      await client.query(
        `INSERT INTO users (id, operator_id, site_id, renter_id, email, name, role, password_hash)
         VALUES ($1, $2, NULL, $3, $4, $5, 'renter', $6) ON CONFLICT DO NOTHING`,
        [
          `us-${renter.id}`,
          renter.operatorId,
          renter.id,
          renter.email,
          renter.name,
          hashPassword(SEED_PASSWORD),
        ],
      );
    }
    for (const user of STAFF) {
      await client.query(
        `INSERT INTO users (id, operator_id, site_id, renter_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          user.id,
          user.operatorId,
          user.siteId,
          user.email,
          user.name,
          user.role,
          hashPassword(SEED_PASSWORD),
        ],
      );
    }
  });
}

async function seedDocuments(): Promise<void> {
  for (const document of DOCUMENTS) {
    const renter = RENTERS.find((entry) => entry.id === document.renterId);
    if (renter === undefined) throw new Error(`unknown renter ${document.renterId}`);
    const key = documentKey(document.renterId, document.id);
    const title = `${document.kind === 'liability' ? 'Liability certificate' : 'Food handler card'} — ${renter.business}`;
    const payload = documentBytes(document.format, title);
    if (!(await objectExists(key))) {
      await putObject(key, payload.bytes, payload.type);
    }
    await pool.query(
      `INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, storage_key, uploaded_at, reminder_queued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), NULL) ON CONFLICT DO NOTHING`,
      [
        document.id,
        document.renterId,
        document.kind,
        document.validFrom,
        document.expiresOn,
        payload.type,
        payload.bytes.length,
        key,
      ],
    );
  }
}

interface SeedBooking {
  id: string;
  renterId: string;
  stationId: string;
  siteId: string;
  date: string;
  start: string;
  end: string;
  status: 'confirmed' | 'settled';
}

async function seedBooking(booking: SeedBooking): Promise<void> {
  const existing = await queryOne<{ id: string }>(pool, 'SELECT id FROM bookings WHERE id = $1', [
    booking.id,
  ]);
  if (existing) return;
  const site = SITES.find((entry) => entry.id === booking.siteId);
  const renter = RENTERS.find((entry) => entry.id === booking.renterId);
  if (site === undefined || renter === undefined) throw new Error('bad seed booking');
  const startAt = resolveLocal(site.zone, booking.date, booking.start);
  const endAt = resolveLocal(site.zone, booking.date, booking.end);
  const minutes = elapsedMinutes(startAt, endAt);
  const holdId = `hold-${booking.id}`;
  const confirmedAt = new Date(startAt.getTime() - 7 * 86_400_000);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO holds (id, site_id, station_id, renter_id, status, repeat_weeks, created_at, expires_at, expiry_notified)
       VALUES ($1, $2, $3, $4, 'confirmed', 1, $5, $5, true)`,
      [holdId, booking.siteId, booking.stationId, booking.renterId, confirmedAt],
    );
    await client.query(
      `INSERT INTO hold_occurrences (hold_id, seq, local_date, local_start, local_end, start_at, end_at, minutes)
       VALUES ($1, 0, $2, $3, $4, $5, $6, $7)`,
      [holdId, booking.date, booking.start, booking.end, startAt, endAt, minutes],
    );
    await client.query(
      `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes,
                             pack_minutes, card_minutes, card_cents, deposit_cents, time_paid, balance_due_by,
                             policy_version_id, confirmed_at, checked_in_at, checked_out_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 0, 0, 0, false, $10, $11, $12, $13, $14)`,
      [
        booking.id,
        holdId,
        booking.siteId,
        booking.stationId,
        booking.renterId,
        booking.status,
        startAt,
        endAt,
        minutes,
        unpaidCutoff(site.zone, startAt),
        `pv-seed-${booking.siteId}`,
        confirmedAt,
        booking.status === 'settled' ? startAt : null,
        booking.status === 'settled' ? endAt : null,
      ],
    );
    await client.query(
      `INSERT INTO audit_events (booking_id, hold_id, at, actor_name, actor_role, action, from_status, to_status)
       VALUES ($1, $2, $3, $4, 'renter', 'confirm', 'held', 'confirmed')`,
      [booking.id, holdId, confirmedAt, renter.name],
    );
    await writeMovement(client, {
      renterId: booking.renterId,
      reason: 'reserve',
      minutes,
      bookingId: booking.id,
      at: confirmedAt,
    });
    if (booking.status === 'settled') {
      await writeMovement(client, {
        renterId: booking.renterId,
        reason: 'use',
        minutes,
        bookingId: booking.id,
        at: endAt,
      });
      await client.query(
        `INSERT INTO audit_events (booking_id, at, actor_name, actor_role, action, from_status, to_status)
         VALUES ($1, $2, 'Priya Lindqvist', 'front_desk', 'settle', 'checked_out', 'settled')`,
        [booking.id, endAt],
      );
    }
  });
}

async function seedPacks(): Promise<void> {
  for (const renterId of ['rn-juniper', 'rn-fennel']) {
    const packId = `pack-seed-${renterId}`;
    const existing = await queryOne<{ id: string }>(pool, 'SELECT id FROM packs WHERE id = $1', [
      packId,
    ]);
    if (existing) continue;
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO packs (id, renter_id, product, minutes, price_cents) VALUES ($1, $2, '20h', $3, $4)`,
        [packId, renterId, PACK_MINUTES, PACK_PRICE_CENTS],
      );
      await writeMovement(client, {
        renterId,
        reason: 'purchase',
        minutes: PACK_MINUTES,
        packId,
      });
    });
  }
}

export async function seedDatabase(): Promise<void> {
  await seedReferenceData();
  await seedPacks();
  const halsted = SITES[0] as SeedSite;
  const fremont = SITES[2] as SeedSite;
  await seedBooking({
    id: 'bk-seed-juniper-0',
    renterId: 'rn-juniper',
    stationId: 'st-deck-1',
    siteId: 'site-halsted',
    date: '2026-10-01',
    start: '04:00',
    end: '10:00',
    status: 'settled',
  });
  await seedBooking({
    id: 'bk-seed-juniper-1',
    renterId: 'rn-juniper',
    stationId: 'st-deck-1',
    siteId: 'site-halsted',
    date: addDays(localDate(halsted.zone, new Date()), 1),
    start: '04:00',
    end: '08:00',
    status: 'confirmed',
  });
  await seedBooking({
    id: 'bk-seed-fennel-1',
    renterId: 'rn-fennel',
    stationId: 'st-fr-deck',
    siteId: 'site-fremont',
    date: addDays(localDate(fremont.zone, new Date()), 1),
    start: '05:00',
    end: '09:00',
    status: 'confirmed',
  });
  await seedDocuments();
}
