import { randomUUID } from 'node:crypto';
import { pool, withTransaction, type Transaction } from './pool.js';
import { hashPassword } from '../services/session.js';
import { renderPdf } from '../providers/pdf.js';
import { KITCHEN, type DocumentKind, type TenantStatus, type UserRole } from '../domain/constants.js';
import { DOCUMENT_KIND_LABELS } from '../domain/constants.js';
import { addDays, kitchenToday, resolveLocalOrTransition, parseLocalTime } from '../domain/time.js';

const SEED_PASSWORD = 'kitchen-demo-2026';

const STATIONS = [
  { id: 'hot-line-1', name: 'Hot Line 1', kind: 'hot_line', rate: 3200 },
  { id: 'hot-line-2', name: 'Hot Line 2', kind: 'hot_line', rate: 3200 },
  { id: 'bake-deck', name: 'Bake Deck', kind: 'bake_deck', rate: 2800 },
  { id: 'cold-prep-a', name: 'Cold-Prep Bench A', kind: 'cold_prep', rate: 1800 },
  { id: 'cold-prep-b', name: 'Cold-Prep Bench B', kind: 'cold_prep', rate: 1800 },
] as const;

const SHELVES = [
  { id: 'W-1', name: 'Walk-in shelf W-1', tenantId: 'juniper-rye' },
  { id: 'W-2', name: 'Walk-in shelf W-2', tenantId: 'lantern-street' },
  { id: 'W-3', name: 'Walk-in shelf W-3', tenantId: null },
  { id: 'W-4', name: 'Walk-in shelf W-4', tenantId: null },
] as const;

const HOUR_PACKS = [
  { id: '10h', name: '10-hour pack', minutes: 600, priceCents: 29000 },
  { id: '25h', name: '25-hour pack', minutes: 1500, priceCents: 68750 },
] as const;

interface SeedTenant {
  id: string;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  status: TenantStatus;
  documents: { kind: DocumentKind; holderName: string | null; expiresInDays: number }[];
}

const TENANTS: SeedTenant[] = [
  {
    id: 'juniper-rye',
    businessName: 'Juniper & Rye Catering',
    ownerName: 'Imani Brooks',
    ownerEmail: 'owner@juniperrye.test',
    status: 'active',
    documents: [
      { kind: 'certificate_of_insurance', holderName: null, expiresInDays: 200 },
      { kind: 'health_permit', holderName: null, expiresInDays: 300 },
      { kind: 'food_handler_card', holderName: 'Priya Castellanos', expiresInDays: 400 },
    ],
  },
  {
    id: 'lantern-street',
    businessName: 'Lantern Street Tacos',
    ownerName: 'Rafael Quintero',
    ownerEmail: 'owner@lanterntacos.test',
    status: 'active',
    documents: [
      { kind: 'certificate_of_insurance', holderName: null, expiresInDays: 250 },
      { kind: 'health_permit', holderName: null, expiresInDays: 180 },
      { kind: 'food_handler_card', holderName: 'Teo Abernathy', expiresInDays: 20 },
    ],
  },
  {
    id: 'saltgrass-pies',
    businessName: 'Saltgrass Pies',
    ownerName: 'Hollis Grant',
    ownerEmail: 'owner@saltgrasspies.test',
    status: 'suspended',
    documents: [
      { kind: 'certificate_of_insurance', holderName: null, expiresInDays: -2 },
      { kind: 'health_permit', holderName: null, expiresInDays: 150 },
      { kind: 'food_handler_card', holderName: 'Hollis Grant', expiresInDays: 90 },
    ],
  },
  {
    id: 'fennel-ferment',
    businessName: 'Fennel Ferment Co.',
    ownerName: 'June Okafor',
    ownerEmail: 'owner@fennelferment.test',
    status: 'applied',
    documents: [],
  },
];

const USERS: { email: string; name: string; role: UserRole; tenantId: string | null }[] = [
  { email: 'operator@larderrow.test', name: 'Dana Whitcomb', role: 'operator', tenantId: null },
  { email: 'owner@juniperrye.test', name: 'Imani Brooks', role: 'owner', tenantId: 'juniper-rye' },
  { email: 'cook@juniperrye.test', name: 'Priya Castellanos', role: 'cook', tenantId: 'juniper-rye' },
  { email: 'owner@lanterntacos.test', name: 'Rafael Quintero', role: 'owner', tenantId: 'lantern-street' },
  { email: 'cook@lanterntacos.test', name: 'Teo Abernathy', role: 'cook', tenantId: 'lantern-street' },
  { email: 'owner@saltgrasspies.test', name: 'Hollis Grant', role: 'owner', tenantId: 'saltgrass-pies' },
  { email: 'owner@fennelferment.test', name: 'June Okafor', role: 'owner', tenantId: 'fennel-ferment' },
];

interface SeedBooking {
  holdRef: string;
  tenantId: string;
  stationId: string;
  dayOffset: number;
  startLocal: string;
  endLocal: string;
  payWith: 'account' | 'hour_pack';
  amountCents: number | null;
  notes: string;
}

const BOOKINGS: SeedBooking[] = [
  {
    holdRef: 'SK-1001',
    tenantId: 'lantern-street',
    stationId: 'hot-line-1',
    dayOffset: 1,
    startLocal: '07:00',
    endLocal: '11:00',
    payWith: 'account',
    amountCents: 12800,
    notes: 'Brisket prep for Saturday market',
  },
  {
    holdRef: 'SK-1002',
    tenantId: 'juniper-rye',
    stationId: 'cold-prep-a',
    dayOffset: 1,
    startLocal: '09:00',
    endLocal: '13:00',
    payWith: 'hour_pack',
    amountCents: null,
    notes: 'Canapés for 180 covers',
  },
];

function documentPdf(businessName: string, kind: DocumentKind, holderName: string | null, expiresOn: string): Buffer {
  return renderPdf([
    { text: KITCHEN.name, bold: true, size: 16 },
    { text: DOCUMENT_KIND_LABELS[kind], bold: true, size: 13 },
    { text: '' },
    { text: `Business: ${businessName}` },
    ...(holderName ? [{ text: `Name on card: ${holderName}` }] : []),
    { text: `Expires on: ${expiresOn}` },
  ]);
}

async function seedDocuments(tx: Transaction, tenant: SeedTenant, seedDay: string): Promise<void> {
  for (const document of tenant.documents) {
    const id = randomUUID();
    const expiresOn = addDays(seedDay, document.expiresInDays);
    const storageKey = `tenants/${tenant.id}/documents/${id}.pdf`;
    const fileName = `${document.kind.replace(/_/g, '-')}.pdf`;
    await tx.query(
      `INSERT INTO documents (id, tenant_id, kind, holder_name, expires_on, status, file_name,
         content_type, size_bytes, storage_key, uploaded_at, reviewed_at, seed_pdf)
       VALUES ($1,$2,$3,$4,$5,'approved',$6,'application/pdf',$7,$8,now(),now(),$9)`,
      [
        id,
        tenant.id,
        document.kind,
        document.holderName,
        expiresOn,
        fileName,
        0,
        storageKey,
        documentPdf(tenant.businessName, document.kind, document.holderName, expiresOn),
      ],
    );
    await tx.query('UPDATE documents SET size_bytes = length(seed_pdf) WHERE id = $1', [id]);
  }
}

async function seedBookings(tx: Transaction, seedDay: string): Promise<void> {
  for (const booking of BOOKINGS) {
    const date = addDays(seedDay, booking.dayOffset);
    const startMinute = parseLocalTime(booking.startLocal)!;
    const endMinute = parseLocalTime(booking.endLocal)!;
    const startAt = resolveLocalOrTransition(date, startMinute);
    const endAt = resolveLocalOrTransition(date, endMinute);
    const elapsed = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
    await tx.query(
      `INSERT INTO holds (ref, tenant_id, station_id, weeks, notes, created_at, expires_at, confirmed_at)
       VALUES ($1,$2,$3,1,$4, now(), now(), now())`,
      [booking.holdRef, booking.tenantId, booking.stationId, booking.notes],
    );
    await tx.query(
      `INSERT INTO bookings (id, ref, hold_ref, tenant_id, station_id, booking_date, start_local,
         end_local, start_at, end_at, start_minute, end_minute, elapsed_minutes, status, pay_with,
         amount_cents, policy_version, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'confirmed',$14,$15,1,$16, now())`,
      [
        randomUUID(),
        `${booking.holdRef}-1`,
        booking.holdRef,
        booking.tenantId,
        booking.stationId,
        date,
        booking.startLocal,
        booking.endLocal,
        startAt,
        endAt,
        startMinute,
        endMinute,
        elapsed,
        booking.payWith,
        booking.amountCents,
        booking.notes,
      ],
    );
  }
}

async function seedLedger(tx: Transaction): Promise<void> {
  const booking = await tx.query<{ id: string }>('SELECT id FROM bookings WHERE ref = $1', [
    'SK-1002-1',
  ]);
  const bookingId = booking.rows[0]!.id;
  const movements: { minutes: number; reason: string; bookingId: string | null }[] = [
    { minutes: 600, reason: 'opening_balance', bookingId: null },
    { minutes: -240, reason: 'booking', bookingId },
  ];
  for (const movement of movements) {
    const movementId = randomUUID();
    await tx.query(
      `INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id)
       VALUES ($1,$2,'juniper-rye','tenant_pack',$3,$4,$5), ($6,$2,'juniper-rye','kitchen_hours',$7,$4,$5)`,
      [randomUUID(), movementId, movement.minutes, movement.reason, movement.bookingId, randomUUID(), -movement.minutes],
    );
  }
}

export async function seedIfEmpty(): Promise<void> {
  const existing = await pool.query('SELECT 1 FROM seed_state');
  if ((existing.rowCount ?? 0) > 0) return;

  const seedDay = kitchenToday();
  await withTransaction(async (tx) => {
    const claimed = await tx.query(
      'INSERT INTO seed_state (id, seed_day) VALUES (true, $1) ON CONFLICT DO NOTHING',
      [seedDay],
    );
    if (claimed.rowCount !== 1) return;

    for (const [position, station] of STATIONS.entries()) {
      await tx.query(
        'INSERT INTO stations (id, name, kind, hourly_rate_cents, position) VALUES ($1,$2,$3,$4,$5)',
        [station.id, station.name, station.kind, station.rate, position],
      );
    }
    for (const [position, pack] of HOUR_PACKS.entries()) {
      await tx.query(
        'INSERT INTO hour_packs (id, name, minutes, price_cents, position) VALUES ($1,$2,$3,$4,$5)',
        [pack.id, pack.name, pack.minutes, pack.priceCents, position],
      );
    }
    for (const tenant of TENANTS) {
      await tx.query(
        'INSERT INTO tenants (id, business_name, owner_name, owner_email, status) VALUES ($1,$2,$3,$4,$5)',
        [tenant.id, tenant.businessName, tenant.ownerName, tenant.ownerEmail, tenant.status],
      );
    }
    for (const [position, shelf] of SHELVES.entries()) {
      await tx.query(
        'INSERT INTO shelves (id, name, monthly_rate_cents, tenant_id, position) VALUES ($1,$2,4500,$3,$4)',
        [shelf.id, shelf.name, shelf.tenantId, position],
      );
    }
    const passwordHash = hashPassword(SEED_PASSWORD);
    for (const user of USERS) {
      await tx.query(
        `INSERT INTO users (id, email, name, role, tenant_id, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), user.email, user.name, user.role, user.tenantId, passwordHash],
      );
    }
    await tx.query(
      `INSERT INTO cancellation_policies (version, free_window_hours, late_fee_percent, effective_at)
       VALUES (1, 48, 50, now())`,
    );
    for (const tenant of TENANTS) {
      await seedDocuments(tx, tenant, seedDay);
    }
    await seedBookings(tx, seedDay);
    await seedLedger(tx);
  });
}
