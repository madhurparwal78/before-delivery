import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { withTransaction } from './pool.js';
import { dateFromBatchStamp } from '../domain/dates.js';

const SEED_LOCK = 8472193;

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

const accounts = [
  {
    role: 'editor',
    displayName: 'Vasant Talkies Desk',
    email: 'editor@vasant-talkies.example',
    password: 'Interval-Editor-2026',
  },
  {
    role: 'stockist',
    displayName: 'Sagar Traders',
    email: 'orders@sagar-traders.example',
    password: 'Interval-Stock-A1',
  },
  {
    role: 'stockist',
    displayName: 'Deccan Cold Chain',
    email: 'orders@deccan-cold.example',
    password: 'Interval-Stock-B2',
  },
];

const drinks = [
  { id: 'kairi-panna', name: 'Kairi Panna', carbonated: false, sugar: 9000 },
  { id: 'balcony-soda', name: 'Balcony Soda', carbonated: true, sugar: 7500 },
  { id: 'second-show-jeera', name: 'Second Show Jeera', carbonated: true, sugar: 6200 },
  { id: 'matinee-kokum', name: 'Matinee Kokum', carbonated: false, sugar: 8400 },
  { id: 'ticket-nimbu', name: 'Ticket Nimbu', carbonated: false, sugar: 5500 },
  { id: 'reel-gulab', name: 'Reel Gulab', carbonated: false, sugar: 10500 },
];

const skus = [
  { code: 'KP-200-CTN', drink: 'kairi-panna', variant: '200 ml Carton', format: 'carton', size: 200, shelf: 365, mrp: 2000 },
  { code: 'KP-600-PET', drink: 'kairi-panna', variant: '600 ml PET', format: 'pet', size: 600, shelf: 365, mrp: 4500 },
  { code: 'KP-1200-PET', drink: 'kairi-panna', variant: '1.2 L PET', format: 'pet', size: 1200, shelf: 365, mrp: 8000 },
  { code: 'BS-300-GLS', drink: 'balcony-soda', variant: '300 ml Glass', format: 'glass', size: 300, shelf: 365, mrp: 2500 },
  { code: 'BS-300-CAN', drink: 'balcony-soda', variant: '300 ml Can', format: 'can', size: 300, shelf: 365, mrp: 3000 },
  { code: 'BS-750-PET', drink: 'balcony-soda', variant: '750 ml PET', format: 'pet', size: 750, shelf: 365, mrp: 4500 },
  { code: 'SJ-300-CAN', drink: 'second-show-jeera', variant: '300 ml Can', format: 'can', size: 300, shelf: 365, mrp: 3500 },
  { code: 'SJ-1000-PET', drink: 'second-show-jeera', variant: '1 L PET', format: 'pet', size: 1000, shelf: 365, mrp: 9000 },
  { code: 'MK-200-CTN', drink: 'matinee-kokum', variant: '200 ml Carton', format: 'carton', size: 200, shelf: 365, mrp: 2000 },
  { code: 'MK-1000-PET', drink: 'matinee-kokum', variant: '1 L PET', format: 'pet', size: 1000, shelf: 365, mrp: 8000 },
  { code: 'TN-500-PET', drink: 'ticket-nimbu', variant: '500 ml PET', format: 'pet', size: 500, shelf: 365, mrp: 2000 },
  { code: 'TN-200-CTN', drink: 'ticket-nimbu', variant: '200 ml Carton', format: 'carton', size: 200, shelf: 365, mrp: 1000 },
  { code: 'RG-300-GLS', drink: 'reel-gulab', variant: '300 ml Glass', format: 'glass', size: 300, shelf: 180, mrp: 3000 },
  { code: 'RG-2000-PET', drink: 'reel-gulab', variant: '2 L PET', format: 'pet', size: 2000, shelf: 365, mrp: 12000 },
];

const aliases = [
  { normalised: 'panna ctn 200', sku: 'KP-200-CTN' },
  { normalised: 'nimbu half ltr 500ml', sku: 'TN-500-PET' },
];

const batches = [
  { code: 'NSK-260915-07', sku: 'KP-200-CTN' },
  { code: 'NSK-261005-02', sku: 'KP-200-CTN' },
  { code: 'NSK-260918-01', sku: 'KP-600-PET' },
  { code: 'PUN-260920-03', sku: 'KP-1200-PET' },
  { code: 'NSK-261001-04', sku: 'BS-300-GLS' },
  { code: 'PUN-261002-01', sku: 'BS-300-CAN' },
  { code: 'NSK-261010-08', sku: 'BS-750-PET' },
  { code: 'PUN-261020-06', sku: 'SJ-300-CAN' },
  { code: 'PUN-261012-03', sku: 'SJ-1000-PET' },
  { code: 'NSK-260922-06', sku: 'MK-200-CTN' },
  { code: 'NSK-260925-09', sku: 'MK-1000-PET' },
  { code: 'NSK-260720-05', sku: 'TN-500-PET' },
  { code: 'NSK-260810-05', sku: 'TN-500-PET' },
  { code: 'PUN-260905-02', sku: 'TN-200-CTN' },
  { code: 'NSK-250301-03', sku: 'RG-300-GLS' },
  { code: 'PUN-260915-02', sku: 'RG-2000-PET' },
];

interface SeedRow {
  sku: string;
  kind: 'sticker' | 'new_print';
  oldMrp: number;
  revisedMrp: number;
  oldRate: number | null;
  newRate: number | null;
}

interface SeedVersion {
  version: number;
  publishedAt: string;
  reason: string | null;
  rows: SeedRow[];
}

interface SeedNotice {
  number: string;
  year: number;
  sequence: number;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  versions: SeedVersion[];
}

function stickerRow(sku: string, oldMrp: number, revisedMrp: number, oldRate: number, newRate: number): SeedRow {
  return { sku, kind: 'sticker', oldMrp, revisedMrp, oldRate, newRate };
}

function newPrintRow(sku: string, oldMrp: number, revisedMrp: number): SeedRow {
  return { sku, kind: 'new_print', oldMrp, revisedMrp, oldRate: null, newRate: null };
}

const notices: SeedNotice[] = [
  {
    number: 'VT-2026-01',
    year: 2026,
    sequence: 1,
    title: 'Ticket Nimbu new print',
    effectiveDate: '2026-08-01',
    runOutUntil: null,
    versions: [
      {
        version: 1,
        publishedAt: '2026-07-20T10:00:00+05:30',
        reason: null,
        rows: [newPrintRow('TN-500-PET', 2000, 2400), newPrintRow('TN-200-CTN', 1000, 1200)],
      },
      {
        version: 2,
        publishedAt: '2026-07-24T10:00:00+05:30',
        reason: 'Corrected the Ticket Nimbu 500 ml new-print price.',
        rows: [newPrintRow('TN-500-PET', 2000, 2250), newPrintRow('TN-200-CTN', 1000, 1200)],
      },
    ],
  },
  {
    number: 'VT-2026-02',
    year: 2026,
    sequence: 2,
    title: 'Fruit drinks rate change',
    effectiveDate: '2026-10-01',
    runOutUntil: '2026-12-31',
    versions: [
      {
        version: 1,
        publishedAt: '2026-09-25T10:00:00+05:30',
        reason: null,
        rows: [
          stickerRow('KP-200-CTN', 2000, 1875, 12, 5),
          stickerRow('KP-600-PET', 4500, 4200, 12, 5),
          stickerRow('KP-1200-PET', 8000, 7500, 12, 5),
          stickerRow('MK-200-CTN', 2000, 1875, 12, 5),
          stickerRow('MK-1000-PET', 8000, 7500, 12, 5),
        ],
      },
    ],
  },
  {
    number: 'VT-2026-03',
    year: 2026,
    sequence: 3,
    title: 'Aerated drinks rate change',
    effectiveDate: '2026-10-15',
    runOutUntil: null,
    versions: [
      {
        version: 1,
        publishedAt: '2026-10-08T10:00:00+05:30',
        reason: null,
        rows: [stickerRow('BS-300-GLS', 2500, 2700, 28, 40), stickerRow('BS-300-CAN', 3000, 3200, 28, 40)],
      },
    ],
  },
  {
    number: 'VT-2026-04',
    year: 2026,
    sequence: 4,
    title: 'Second Show Jeera rate change (scheduled)',
    effectiveDate: '2028-04-01',
    runOutUntil: null,
    versions: [
      {
        version: 1,
        publishedAt: '2026-10-25T10:00:00+05:30',
        reason: null,
        rows: [stickerRow('SJ-300-CAN', 3500, 2950, 40, 18), stickerRow('SJ-1000-PET', 9000, 7500, 40, 18)],
      },
    ],
  },
];

async function schemaText(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFile(join(here, 'schema.sql'), 'utf8');
}

/** Applies the schema and seeds only an empty database. Repeating it changes nothing. */
export async function applySchemaAndSeed(): Promise<string> {
  const schema = await schemaText();
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [SEED_LOCK]);
    await client.query(schema);
    const existing = await client.query<{ copy_id: string }>('select copy_id from copy_identity');
    if (existing.rowCount && existing.rowCount > 0) return existing.rows[0].copy_id;
    const copyId = randomBytes(8).toString('hex');
    await client.query('insert into copy_identity (only_row, copy_id) values (true, $1)', [copyId]);
    await seedRecords(client);
    return copyId;
  });
}

async function seedRecords(client: PoolClient): Promise<void> {
  for (const account of accounts) {
    const salt = randomBytes(16).toString('hex');
    await client.query(
      `insert into accounts (id, role, display_name, email, password_hash, password_salt)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), account.role, account.displayName, account.email, hashPassword(account.password, salt), salt],
    );
  }

  for (const [index, drink] of drinks.entries()) {
    await client.query(
      'insert into drinks (id, name, carbonated, sugar_mg_per_100ml, position) values ($1, $2, $3, $4, $5)',
      [drink.id, drink.name, drink.carbonated, drink.sugar, index],
    );
  }

  for (const [index, sku] of skus.entries()) {
    await client.query(
      `insert into skus (code, drink_id, variant, format, size_ml, shelf_days, launch_mrp_paise, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sku.code, sku.drink, sku.variant, sku.format, sku.size, sku.shelf, sku.mrp, index],
    );
  }

  for (const alias of aliases) {
    await client.query('insert into aliases (normalised, sku_code) values ($1, $2)', [alias.normalised, alias.sku]);
  }

  for (const batch of batches) {
    const packedDate = dateFromBatchStamp(batch.code.split('-')[1]);
    await client.query('insert into batches (code, sku_code, packed_date, old_wrapper) values ($1, $2, $3, false)', [
      batch.code,
      batch.sku,
      packedDate,
    ]);
  }

  const skuNames = new Map<string, string>();
  for (const sku of skus) {
    const drink = drinks.find((entry) => entry.id === sku.drink);
    skuNames.set(sku.code, `${drink?.name ?? ''} ${sku.variant}`);
  }

  for (const notice of notices) {
    const noticeId = randomUUID();
    await client.query('insert into notices (id, number, year, sequence, created_at) values ($1, $2, $3, $4, $5)', [
      noticeId,
      notice.number,
      notice.year,
      notice.sequence,
      notice.versions[0].publishedAt,
    ]);
    for (const version of notice.versions) {
      await client.query(
        `insert into notice_versions
           (notice_id, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id)
         values ($1, $2, $3, $4, $5, $6, $7, 'pending', null)`,
        [
          noticeId,
          version.version,
          notice.title,
          notice.effectiveDate,
          notice.runOutUntil,
          version.publishedAt,
          version.reason,
        ],
      );
      for (const [position, row] of version.rows.entries()) {
        await client.query(
          `insert into notice_rows
             (notice_id, version, position, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            noticeId,
            version.version,
            position,
            row.sku,
            skuNames.get(row.sku),
            row.kind,
            row.oldMrp,
            row.revisedMrp,
            row.oldRate,
            row.newRate,
          ],
        );
      }
    }
    await client.query(
      `insert into notice_sequence (year, last_sequence) values ($1, $2)
       on conflict (year) do update set last_sequence = greatest(notice_sequence.last_sequence, $2)`,
      [notice.year, notice.sequence],
    );
  }

  await client.query("insert into counters (name, value) values ('held_work', 0)");
}
