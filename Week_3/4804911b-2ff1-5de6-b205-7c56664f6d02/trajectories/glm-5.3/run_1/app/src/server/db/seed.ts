/**
 * The seed data section ships exactly as printed, with no leftover development
 * or test records. Seed only an empty database.
 */
import type { PoolClient } from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

export interface SeedSku {
  code: string;
  drinkId: string;
  variant: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sizeMl: number;
  shelfDays: number;
  launchMrpPaise: number;
}

export interface SeedRow {
  skuCode: string;
  name: string;
  kind: 'sticker' | 'new_print';
  oldMrpPaise: number;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
}

const DRINKS = [
  { id: 'kairi-panna', name: 'Kairi Panna', carbonated: false, sugarMgPer100ml: 9000 },
  { id: 'balcony-soda', name: 'Balcony Soda', carbonated: true, sugarMgPer100ml: 7500 },
  { id: 'second-show-jeera', name: 'Second Show Jeera', carbonated: true, sugarMgPer100ml: 6200 },
  { id: 'matinee-kokum', name: 'Matinee Kokum', carbonated: false, sugarMgPer100ml: 8400 },
  { id: 'ticket-nimbu', name: 'Ticket Nimbu', carbonated: false, sugarMgPer100ml: 5500 },
  { id: 'reel-gulab', name: 'Reel Gulab', carbonated: false, sugarMgPer100ml: 10500 },
];

const SKUS: SeedSku[] = [
  { code: 'KP-200-CTN', drinkId: 'kairi-panna', variant: '200 ml Carton', format: 'carton', sizeMl: 200, shelfDays: 365, launchMrpPaise: 2000 },
  { code: 'KP-600-PET', drinkId: 'kairi-panna', variant: '600 ml PET', format: 'pet', sizeMl: 600, shelfDays: 365, launchMrpPaise: 4500 },
  { code: 'KP-1200-PET', drinkId: 'kairi-panna', variant: '1.2 L PET', format: 'pet', sizeMl: 1200, shelfDays: 365, launchMrpPaise: 8000 },
  { code: 'BS-300-GLS', drinkId: 'balcony-soda', variant: '300 ml Glass', format: 'glass', sizeMl: 300, shelfDays: 365, launchMrpPaise: 2500 },
  { code: 'BS-300-CAN', drinkId: 'balcony-soda', variant: '300 ml Can', format: 'can', sizeMl: 300, shelfDays: 365, launchMrpPaise: 3000 },
  { code: 'BS-750-PET', drinkId: 'balcony-soda', variant: '750 ml PET', format: 'pet', sizeMl: 750, shelfDays: 365, launchMrpPaise: 4500 },
  { code: 'SJ-300-CAN', drinkId: 'second-show-jeera', variant: '300 ml Can', format: 'can', sizeMl: 300, shelfDays: 365, launchMrpPaise: 3500 },
  { code: 'SJ-1000-PET', drinkId: 'second-show-jeera', variant: '1 L PET', format: 'pet', sizeMl: 1000, shelfDays: 365, launchMrpPaise: 9000 },
  { code: 'MK-200-CTN', drinkId: 'matinee-kokum', variant: '200 ml Carton', format: 'carton', sizeMl: 200, shelfDays: 365, launchMrpPaise: 2000 },
  { code: 'MK-1000-PET', drinkId: 'matinee-kokum', variant: '1 L PET', format: 'pet', sizeMl: 1000, shelfDays: 365, launchMrpPaise: 8000 },
  { code: 'TN-500-PET', drinkId: 'ticket-nimbu', variant: '500 ml PET', format: 'pet', sizeMl: 500, shelfDays: 365, launchMrpPaise: 2000 },
  { code: 'TN-200-CTN', drinkId: 'ticket-nimbu', variant: '200 ml Carton', format: 'carton', sizeMl: 200, shelfDays: 365, launchMrpPaise: 1000 },
  { code: 'RG-300-GLS', drinkId: 'reel-gulab', variant: '300 ml Glass', format: 'glass', sizeMl: 300, shelfDays: 180, launchMrpPaise: 3000 },
  { code: 'RG-2000-PET', drinkId: 'reel-gulab', variant: '2 L PET', format: 'pet', sizeMl: 2000, shelfDays: 365, launchMrpPaise: 12000 },
];

const ALIASES: Array<[string, string]> = [
  ['KP-200-CTN', 'panna ctn 200'],
  ['TN-500-PET', 'nimbu half ltr 500ml'],
];

const NOTICES = [
  {
    number: 'VT-2026-01',
    versions: [
      {
        version: 1,
        title: 'Ticket Nimbu new print',
        effectiveDate: '2026-08-01',
        runOutUntil: null,
        publishedAt: '2026-07-20T10:00:00Z',
        reason: null,
        rows: [
          { skuCode: 'TN-500-PET', name: 'Ticket Nimbu 500 ml PET', kind: 'new_print', oldMrpPaise: 2000, revisedMrpPaise: 2400, oldRate: null, newRate: null },
          { skuCode: 'TN-200-CTN', name: 'Ticket Nimbu 200 ml Carton', kind: 'new_print', oldMrpPaise: 1000, revisedMrpPaise: 1200, oldRate: null, newRate: null },
        ] as SeedRow[],
      },
      {
        version: 2,
        title: 'Ticket Nimbu new print',
        effectiveDate: '2026-08-01',
        runOutUntil: null,
        publishedAt: '2026-07-24T10:00:00Z',
        reason: 'Corrected the Ticket Nimbu 500 ml new-print price.',
        rows: [
          { skuCode: 'TN-500-PET', name: 'Ticket Nimbu 500 ml PET', kind: 'new_print', oldMrpPaise: 2000, revisedMrpPaise: 2250, oldRate: null, newRate: null },
          { skuCode: 'TN-200-CTN', name: 'Ticket Nimbu 200 ml Carton', kind: 'new_print', oldMrpPaise: 1000, revisedMrpPaise: 1200, oldRate: null, newRate: null },
        ] as SeedRow[],
      },
    ],
  },
  {
    number: 'VT-2026-02',
    versions: [
      {
        version: 1,
        title: 'Fruit drinks rate change',
        effectiveDate: '2026-10-01',
        runOutUntil: '2026-12-31',
        publishedAt: '2026-09-25T10:00:00Z',
        reason: null,
        rows: [
          { skuCode: 'KP-200-CTN', name: 'Kairi Panna 200 ml Carton', kind: 'sticker', oldMrpPaise: 2000, revisedMrpPaise: 1875, oldRate: 12, newRate: 5 },
          { skuCode: 'KP-600-PET', name: 'Kairi Panna 600 ml PET', kind: 'sticker', oldMrpPaise: 4500, revisedMrpPaise: 4200, oldRate: 12, newRate: 5 },
          { skuCode: 'KP-1200-PET', name: 'Kairi Panna 1.2 L PET', kind: 'sticker', oldMrpPaise: 8000, revisedMrpPaise: 7500, oldRate: 12, newRate: 5 },
          { skuCode: 'MK-200-CTN', name: 'Matinee Kokum 200 ml Carton', kind: 'sticker', oldMrpPaise: 2000, revisedMrpPaise: 1875, oldRate: 12, newRate: 5 },
          { skuCode: 'MK-1000-PET', name: 'Matinee Kokum 1 L PET', kind: 'sticker', oldMrpPaise: 8000, revisedMrpPaise: 7500, oldRate: 12, newRate: 5 },
        ] as SeedRow[],
      },
    ],
  },
  {
    number: 'VT-2026-03',
    versions: [
      {
        version: 1,
        title: 'Aerated drinks rate change',
        effectiveDate: '2026-10-15',
        runOutUntil: null,
        publishedAt: '2026-10-08T10:00:00Z',
        reason: null,
        rows: [
          { skuCode: 'BS-300-GLS', name: 'Balcony Soda 300 ml Glass', kind: 'sticker', oldMrpPaise: 2500, revisedMrpPaise: 2700, oldRate: 28, newRate: 40 },
          { skuCode: 'BS-300-CAN', name: 'Balcony Soda 300 ml Can', kind: 'sticker', oldMrpPaise: 3000, revisedMrpPaise: 3200, oldRate: 28, newRate: 40 },
        ] as SeedRow[],
      },
    ],
  },
  {
    number: 'VT-2026-04',
    versions: [
      {
        version: 1,
        title: 'Second Show Jeera rate change (scheduled)',
        effectiveDate: '2028-04-01',
        runOutUntil: null,
        publishedAt: '2026-10-25T10:00:00Z',
        reason: null,
        rows: [
          { skuCode: 'SJ-300-CAN', name: 'Second Show Jeera 300 ml Can', kind: 'sticker', oldMrpPaise: 3500, revisedMrpPaise: 2950, oldRate: 40, newRate: 18 },
          { skuCode: 'SJ-1000-PET', name: 'Second Show Jeera 1 L PET', kind: 'sticker', oldMrpPaise: 9000, revisedMrpPaise: 7500, oldRate: 40, newRate: 18 },
        ] as SeedRow[],
      },
    ],
  },
];

const BATCHES: Array<{ code: string; skuCode: string; packedDate: string }> = [
  { code: 'NSK-260915-07', skuCode: 'KP-200-CTN', packedDate: '2026-09-15' },
  { code: 'NSK-261005-02', skuCode: 'KP-200-CTN', packedDate: '2026-10-05' },
  { code: 'NSK-260918-01', skuCode: 'KP-600-PET', packedDate: '2026-09-18' },
  { code: 'PUN-260920-03', skuCode: 'KP-1200-PET', packedDate: '2026-09-20' },
  { code: 'NSK-261001-04', skuCode: 'BS-300-GLS', packedDate: '2026-10-01' },
  { code: 'PUN-261002-01', skuCode: 'BS-300-CAN', packedDate: '2026-10-02' },
  { code: 'NSK-261010-08', skuCode: 'BS-750-PET', packedDate: '2026-10-10' },
  { code: 'PUN-261020-06', skuCode: 'SJ-300-CAN', packedDate: '2026-10-20' },
  { code: 'PUN-261012-03', skuCode: 'SJ-1000-PET', packedDate: '2026-10-12' },
  { code: 'NSK-260922-06', skuCode: 'MK-200-CTN', packedDate: '2026-09-22' },
  { code: 'NSK-260925-09', skuCode: 'MK-1000-PET', packedDate: '2026-09-25' },
  { code: 'NSK-260720-05', skuCode: 'TN-500-PET', packedDate: '2026-07-20' },
  { code: 'NSK-260810-05', skuCode: 'TN-500-PET', packedDate: '2026-08-10' },
  { code: 'PUN-260905-02', skuCode: 'TN-200-CTN', packedDate: '2026-09-05' },
  { code: 'NSK-250301-03', skuCode: 'RG-300-GLS', packedDate: '2025-03-01' },
  { code: 'PUN-260915-02', skuCode: 'RG-2000-PET', packedDate: '2026-09-15' },
];

const ACCOUNTS = [
  { role: 'editor', displayName: 'Vasant Talkies Desk', email: 'editor@vasant-talkies.example', password: 'Interval-Editor-2026' },
  { role: 'stockist', displayName: 'Sagar Traders', email: 'orders@sagar-traders.example', password: 'Interval-Stock-A1' },
  { role: 'stockist', displayName: 'Deccan Cold Chain', email: 'orders@deccan-cold.example', password: 'Interval-Stock-B2' },
];

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

/** Copy identity: random hexadecimal, written once to Postgres at first seed. */
export async function seed(client: PoolClient): Promise<void> {
  const existing = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM app_meta WHERE key = 'copy_id'");
  if (Number(existing.rows[0].count) > 0) return;
  const copyId = randomBytes(8).toString('hex');
  await client.query("INSERT INTO app_meta (key, value) VALUES ('copy_id', $1)", [copyId]);
  await client.query("INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')");

  for (const d of DRINKS) {
    await client.query(
      'INSERT INTO drinks (id, name, carbonated, lineup_order) VALUES ($1, $2, $3, $4)',
      [d.id, d.name, d.carbonated, DRINKS.indexOf(d)]
    );
  }
  for (const s of SKUS) {
    const drink = DRINKS.find((d) => d.id === s.drinkId)!;
    await client.query(
      'INSERT INTO skus (code, drink_id, variant, format, size_ml, shelf_days, sugar_mg_per_100ml, launch_mrp_paise, catalogue_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [s.code, s.drinkId, s.variant, s.format, s.sizeMl, s.shelfDays, drink.sugarMgPer100ml, s.launchMrpPaise, SKUS.indexOf(s)]
    );
  }
  for (const [skuCode, alias] of ALIASES) {
    await client.query('INSERT INTO aliases (sku_code, alias) VALUES ($1, $2)', [skuCode, alias]);
  }
  for (const n of NOTICES) {
    const year = Number(n.number.split('-')[1]);
    const seq = Number(n.number.split('-')[2]);
    await client.query('INSERT INTO notices (number, publish_year, sequence_in_year) VALUES ($1, $2, $3)', [n.number, year, seq]);
    for (const v of n.versions) {
      await client.query(
        'INSERT INTO notice_versions (number, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [n.number, v.version, v.title, v.effectiveDate, v.runOutUntil, v.publishedAt, v.reason, 'pending', null]
      );
      for (const r of v.rows) {
        await client.query(
          'INSERT INTO notice_rows (number, version, row_index, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [n.number, v.version, v.rows.indexOf(r), r.skuCode, r.name, r.kind, r.oldMrpPaise, r.revisedMrpPaise, r.oldRate, r.newRate]
        );
      }
    }
  }
  for (const b of BATCHES) {
    await client.query(
      'INSERT INTO batches (code, sku_code, packed_date, old_wrapper) VALUES ($1, $2, $3, $4)',
      [b.code, b.skuCode, b.packedDate, false]
    );
  }
  for (const a of ACCOUNTS) {
    const { salt, hash } = hashPassword(a.password);
    await client.query(
      'INSERT INTO accounts (id, role, display_name, email, password_salt, password_hash) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomBytes(12).toString('hex'), a.role, a.displayName, a.email, salt, hash]
    );
  }
}
