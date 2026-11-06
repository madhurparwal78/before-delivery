/**
 * The demo seed, loaded once when the app finds an empty database at serve
 * time. Every person, business, email address and street address is invented.
 */

import { randomUUID } from 'node:crypto';
import { db, transaction, withAdvisoryLock, type Db } from './db.js';
import { hashPassword } from './http/auth.js';
import { kitchenToday } from './domain/clock.js';
import { addDays } from '../shared/kitchenTime.js';
import { DOCUMENT_LABELS } from '../shared/copy.js';
import { renderTextPdf } from './services/pdf.js';
import { documentObjectKey, ensureBucket, putObject } from './services/storage.js';
import type { DocumentKind, DocumentStatus, RenterStatus } from '../shared/types.js';

const SEED_PASSWORD = 'Railside-demo-26';
const SEED_LOCK = 0x5241_494c;

const KITCHEN = {
  name: 'Brigade & Bench Commissary',
  address: '1187 West Larkin Avenue, Chicago, IL 60622',
  timeZone: 'America/Chicago',
};

const STATIONS = [
  { id: 'convection-1', name: 'Convection oven 1', weight: 1, offPeak: 50, overage: '48.00', buffer: 30 },
  { id: 'convection-2', name: 'Convection oven 2', weight: 1, offPeak: 50, overage: '48.00', buffer: 30 },
  { id: 'deck-oven', name: 'Deck oven', weight: 2, offPeak: 50, overage: '72.00', buffer: 45 },
  { id: 'mixer-60', name: '60-quart mixer', weight: 1, offPeak: 100, overage: '30.00', buffer: 15 },
  { id: 'prep-3', name: 'Prep table 3', weight: 1, offPeak: 100, overage: '24.00', buffer: 15 },
];

const STATION_SETTINGS_FROM = '2026-01-01';

const PACKS = [
  { id: 'pack-10', name: '10-hour pack', hours: 10, amount: '290.00' },
  { id: 'pack-20', name: '20-hour pack', hours: 20, amount: '540.00' },
  { id: 'pack-40', name: '40-hour pack', hours: 40, amount: '1000.00' },
];

interface SeedRenter {
  contactName: string;
  email: string;
  businessName: string;
  phone: string;
  status: RenterStatus;
  openingMinutes: number;
  /** Days from the seed date `D`. */
  coiDays: number;
  cardDays: number;
  licenceDays: number;
  documentStatus: DocumentStatus;
}

const RENTERS: SeedRenter[] = [
  {
    contactName: 'Wren Abernathy',
    email: 'wren@hearthhustle.example',
    businessName: 'Hearth & Hustle Bakery',
    phone: '312-555-0141',
    status: 'active',
    openingMinutes: 1200,
    coiDays: 200,
    cardDays: 300,
    licenceDays: 365,
    documentStatus: 'approved',
  },
  {
    contactName: 'Paz Ochoa',
    email: 'paz@lomaverde.example',
    businessName: 'Loma Verde Tamales',
    phone: '312-555-0172',
    status: 'active',
    openingMinutes: 480,
    coiDays: 10,
    cardDays: 300,
    licenceDays: 365,
    documentStatus: 'approved',
  },
  {
    contactName: 'Jory Kessler',
    email: 'jory@smokesignal.example',
    businessName: 'Smoke Signal BBQ',
    phone: '312-555-0188',
    status: 'active',
    openingMinutes: 360,
    coiDays: 0,
    cardDays: 300,
    licenceDays: 365,
    documentStatus: 'approved',
  },
  {
    contactName: 'Ines Marchetti',
    email: 'ines@fennelstreet.example',
    businessName: 'Fennel Street Catering',
    phone: '312-555-0193',
    status: 'active',
    openingMinutes: 240,
    coiDays: -1,
    cardDays: 300,
    licenceDays: 365,
    documentStatus: 'approved',
  },
  {
    contactName: 'Theo Banerjee',
    email: 'theo@littlecrumb.example',
    businessName: 'Little Crumb Granola',
    phone: '312-555-0117',
    status: 'documents_review',
    openingMinutes: 0,
    coiDays: 180,
    cardDays: 180,
    licenceDays: 365,
    documentStatus: 'pending_review',
  },
];

function specimenScan(businessName: string, kind: DocumentKind, expiresOn: string): Buffer {
  return renderTextPdf([
    [
      { text: KITCHEN.name, bold: true, size: 16 },
      { text: DOCUMENT_LABELS[kind], bold: true, size: 13 },
      { text: '' },
      { text: `Holder: ${businessName}` },
      { text: `Expires: ${expiresOn}` },
      { text: '' },
      { text: 'Specimen scan held on file for kitchen compliance.' },
    ],
  ]);
}

async function seedReferenceData(tx: Db): Promise<void> {
  await tx.query(
    'INSERT INTO kitchen (singleton, name, address, time_zone) VALUES (true, $1, $2, $3)',
    [KITCHEN.name, KITCHEN.address, KITCHEN.timeZone],
  );
  for (let index = 0; index < STATIONS.length; index += 1) {
    const station = STATIONS[index];
    await tx.query('INSERT INTO stations (id, name, sort_order) VALUES ($1, $2, $3)', [
      station.id,
      station.name,
      index,
    ]);
    await tx.query(
      `INSERT INTO station_settings
         (station_id, effective_from, hour_weight, off_peak_percent, overage_usd_per_hour, buffer_minutes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        station.id,
        STATION_SETTINGS_FROM,
        station.weight,
        station.offPeak,
        station.overage,
        station.buffer,
      ],
    );
  }
  for (let index = 0; index < PACKS.length; index += 1) {
    const pack = PACKS[index];
    await tx.query(
      'INSERT INTO packs (id, name, hours, amount_usd, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [pack.id, pack.name, pack.hours, pack.amount, index],
    );
  }
}

interface PreparedDocument {
  id: string;
  kind: DocumentKind;
  expiresOn: string;
  objectKey: string;
  bytes: Buffer;
}

export async function loadSeed(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    const existing = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM users');
    if (existing.count !== '0') return;

    const day = kitchenToday();
    const passwordHash = await hashPassword(SEED_PASSWORD);

    // Storage comes first: a seeded document always has its scan on file.
    const prepared = new Map<string, PreparedDocument[]>();
    const renterIds = new Map<string, string>();
    for (const renter of RENTERS) {
      const renterId = randomUUID();
      renterIds.set(renter.email, renterId);
      const kinds: { kind: DocumentKind; days: number }[] = [
        { kind: 'coi', days: renter.coiDays },
        { kind: 'food_handler_card', days: renter.cardDays },
        { kind: 'business_licence', days: renter.licenceDays },
      ];
      const documents = kinds.map(({ kind, days }) => {
        const documentId = randomUUID();
        const expiresOn = addDays(day, days);
        return {
          id: documentId,
          kind,
          expiresOn,
          objectKey: documentObjectKey(renterId, documentId, 'pdf'),
          bytes: specimenScan(renter.businessName, kind, expiresOn),
        };
      });
      prepared.set(renter.email, documents);
    }

    await ensureBucket();
    for (const documents of prepared.values()) {
      for (const document of documents) {
        await putObject(document.objectKey, document.bytes, 'application/pdf');
      }
    }

    await transaction(async (tx) => {
      await seedReferenceData(tx);

      for (const staff of [
        { name: 'Marisol Teague', email: 'marisol@brigadebench.example', role: 'operator' },
        { name: 'Dev Okafor', email: 'dev@brigadebench.example', role: 'shift_lead' },
      ]) {
        await tx.query(
          'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)',
          [staff.email, staff.name, staff.role, passwordHash],
        );
      }

      for (const renter of RENTERS) {
        const renterId = renterIds.get(renter.email);
        if (renterId === undefined) throw new Error('seed renter id missing');
        const user = await tx.one<{ id: string }>(
          `INSERT INTO users (email, name, role, password_hash)
           VALUES ($1, $2, 'renter', $3) RETURNING id`,
          [renter.email, renter.contactName, passwordHash],
        );
        await tx.query(
          `INSERT INTO renters
             (id, user_id, business_name, contact_name, email, phone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            renterId,
            user.id,
            renter.businessName,
            renter.contactName,
            renter.email,
            renter.phone,
            renter.status,
          ],
        );

        for (const document of prepared.get(renter.email) ?? []) {
          await tx.query(
            `INSERT INTO documents
               (id, renter_id, kind, expires_on, status, original_name, size_bytes,
                content_type, object_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', $8)`,
            [
              document.id,
              renterId,
              document.kind,
              document.expiresOn,
              renter.documentStatus,
              `${document.kind}.pdf`,
              document.bytes.length,
              document.objectKey,
            ],
          );
        }

        if (renter.openingMinutes > 0) {
          const movement = await tx.one<{ id: string }>(
            `INSERT INTO movements (renter_id, kind, minutes, note)
             VALUES ($1, 'opening_balance', $2, 'opening balance') RETURNING id`,
            [renterId, renter.openingMinutes],
          );
          await tx.query(
            `INSERT INTO ledger_entries (movement_id, renter_id, account, direction, minutes)
             VALUES ($1, $2, 'kitchen:opening', 'debit', $4),
                    ($1, $2, $3, 'credit', $4)`,
            [movement.id, renterId, `renter:${renterId}:available`, renter.openingMinutes],
          );
        }
      }
    });

    process.stdout.write('seed loaded\n');
  });
}
