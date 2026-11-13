/**
 * The seeded catalogue, editions, club roster, bank holidays and operator account. The
 * seed is loaded only when the catalogue is empty, so a restart never disturbs live work.
 */

import type { PoolClient } from 'pg';

import { config } from '../config';
import { hashPassword } from '../services/passwords';

const OPERATOR_EMAIL = 'operator@holmgarth.example';
const OPERATOR_PASSWORD = 'fan-out-2026-desk';

interface SeedPart {
  booklet: number;
  partNumber: string;
  name: string;
  priceMinor: number;
  weightG: number;
  longestSideMm: number;
  bin: number;
  status?: 'withdrawn';
}

interface SeedModel {
  slug: string;
  name: string;
  axis: 'x' | 'y' | 'iso' | null;
  retiredNames: readonly string[];
  parts: readonly SeedPart[];
}

const MODELS: readonly SeedModel[] = [
  {
    slug: 'aldra-wardrobe',
    name: 'Aldra Wardrobe',
    axis: 'y',
    retiredNames: ['Aldra Robe', 'Aldra 2-Door', 'Holm Classic'],
    parts: [
      { booklet: 1, partNumber: '40218831', name: 'Side panel', priceMinor: 4800, weightG: 14200, longestSideMm: 1990, bin: 0 },
      { booklet: 2, partNumber: '40218848', name: 'Top panel', priceMinor: 3600, weightG: 6800, longestSideMm: 980, bin: 0 },
      { booklet: 3, partNumber: '102944', name: 'Shelf', priceMinor: 1450, weightG: 2100, longestSideMm: 940, bin: 3 },
      { booklet: 4, partNumber: '118320', name: 'Hanging rail', priceMinor: 950, weightG: 600, longestSideMm: 900, bin: 6 },
      { booklet: 5, partNumber: '100823', name: 'Cam lock', priceMinor: 45, weightG: 12, longestSideMm: 15, bin: 400 },
      { booklet: 6, partNumber: '100824', name: 'Cam bolt', priceMinor: 35, weightG: 9, longestSideMm: 34, bin: 400 },
    ],
  },
  {
    slug: 'bramwell-sofa-frame',
    name: 'Bramwell Sofa Frame',
    axis: 'x',
    retiredNames: ['Bramwell 3-Seater', 'Holm Classic'],
    parts: [
      { booklet: 1, partNumber: '50331207', name: 'Back rail', priceMinor: 2250, weightG: 3100, longestSideMm: 1820, bin: 0 },
      { booklet: 2, partNumber: '503319', name: 'Seat slat', priceMinor: 690, weightG: 700, longestSideMm: 760, bin: 12 },
      { booklet: 3, partNumber: '112903', name: 'Front leg', priceMinor: 1125, weightG: 450, longestSideMm: 140, bin: 8 },
      { booklet: 4, partNumber: '112911', name: 'Corner block', priceMinor: 365, weightG: 120, longestSideMm: 90, bin: 30 },
      { booklet: 5, partNumber: '100190', name: 'Bolt M8 × 80', priceMinor: 85, weightG: 40, longestSideMm: 80, bin: 200 },
    ],
  },
  {
    slug: 'kestle-shelving-unit',
    name: 'Kestle Shelving Unit',
    axis: 'iso',
    retiredNames: ['Kestle Tall Shelf', 'Kestle 5-Tier'],
    parts: [
      { booklet: 1, partNumber: '60770016', name: 'Upright', priceMinor: 2900, weightG: 3900, longestSideMm: 1810, bin: 0 },
      { booklet: 2, partNumber: '607701', name: 'Shelf board', priceMinor: 1675, weightG: 2600, longestSideMm: 790, bin: 4 },
      { booklet: 3, partNumber: '101345', name: 'Shelf pin', priceMinor: 15, weightG: 3, longestSideMm: 16, bin: 1000 },
      { booklet: 4, partNumber: '120456', name: 'Wall bracket', priceMinor: 255, weightG: 60, longestSideMm: 70, bin: 25 },
      { booklet: 5, partNumber: '607744', name: 'Back brace', priceMinor: 740, weightG: 800, longestSideMm: 760, bin: 2, status: 'withdrawn' },
    ],
  },
  {
    slug: 'fenwick-bed-frame',
    name: 'Fenwick Bed Frame',
    axis: null,
    retiredNames: ['Fenwick Double'],
    parts: [
      { booklet: 1, partNumber: '70110025', name: 'Headboard', priceMinor: 5400, weightG: 9800, longestSideMm: 1420, bin: 0 },
      { booklet: 2, partNumber: '701102', name: 'Side rail', priceMinor: 1990, weightG: 3300, longestSideMm: 1960, bin: 2 },
      { booklet: 3, partNumber: '701109', name: 'Slat', priceMinor: 320, weightG: 400, longestSideMm: 1380, bin: 40 },
      { booklet: 4, partNumber: '120870', name: 'Centre leg', priceMinor: 410, weightG: 300, longestSideMm: 250, bin: 10 },
    ],
  },
];

const CLUB_ROSTER: readonly [string, string][] = [
  ['ines.kowalczyk@example.org', '2023-04-02'],
  ['tom.ashby@example.net', '2025-09-10'],
];

const BANK_HOLIDAYS: readonly string[] = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
  '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03',
  '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
];

const COUNTERS = ['decided_claims', 'decided_inside', 'decided_outside'];

export async function seedDesk(client: PoolClient): Promise<void> {
  for (const name of COUNTERS) {
    await client.query('INSERT INTO desk_counters (name, value) VALUES ($1, 0) ON CONFLICT (name) DO NOTHING', [name]);
  }

  await client.query(
    'INSERT INTO operators (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
    [OPERATOR_EMAIL, hashPassword(OPERATOR_PASSWORD)],
  );

  for (const holiday of BANK_HOLIDAYS) {
    await client.query('INSERT INTO bank_holidays (holiday) VALUES ($1) ON CONFLICT DO NOTHING', [holiday]);
  }

  const catalogue = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM models');
  if (catalogue.rows[0]?.count !== '0') return;

  // Both seeded editions take their months from the desk settings.
  const editions: readonly [string, string, string, number][] = [
    ['AC-2025', 'Aftercare 2025', '2025-01-01', 0],
    ['AC-2026', 'Aftercare 2026', '2026-07-15', 25],
  ];
  for (const [code, title, startsOn, percent] of editions) {
    await client.query(
      `INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING`,
      [code, title, startsOn, config.aftercareStandardMonths, config.aftercareClubMonths, percent],
    );
  }

  for (const [index, model] of MODELS.entries()) {
    await client.query('INSERT INTO models (slug, name, axis, sort_order) VALUES ($1, $2, $3, $4)', [
      model.slug,
      model.name,
      model.axis,
      index,
    ]);
    for (const retired of model.retiredNames) {
      await client.query('INSERT INTO model_retired_names (slug, retired_name) VALUES ($1, $2)', [model.slug, retired]);
    }
    for (const part of model.parts) {
      await client.query(
        `INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g,
                            longest_side_mm, status, bin_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          model.slug,
          part.booklet,
          part.partNumber,
          part.name,
          part.priceMinor,
          part.weightG,
          part.longestSideMm,
          part.status ?? 'active',
          part.bin,
        ],
      );
    }
  }

  for (const [email, joinedOn] of CLUB_ROSTER) {
    await client.query('INSERT INTO club_roster (email, joined_on) VALUES ($1, $2)', [email, joinedOn]);
  }
}
