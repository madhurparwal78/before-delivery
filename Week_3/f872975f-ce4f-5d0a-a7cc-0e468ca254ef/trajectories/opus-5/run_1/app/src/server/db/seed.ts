import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PoolClient } from 'pg';
import { DefectZone } from '../../shared/geometry';
import { volumeMm3 } from '../../shared/money';
import { hashPassword } from '../password';
import { LOCK_SCOPE_MIGRATE, advisoryLock, transaction } from './pool';

const SEED_INSTANT = '2026-01-01T00:00:00Z';

interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'owner' | 'hand' | 'maker';
}

const USERS: SeedUser[] = [
  { id: 'U-0001', name: 'Dana Whitlock', email: 'owner@kerfwell.test', password: 'rack-owner-2026', role: 'owner' },
  { id: 'U-0002', name: 'Teo Varga', email: 'hand@kerfwell.test', password: 'rack-hand-2026', role: 'hand' },
  { id: 'U-0003', name: 'Ines Albrecht', email: 'ines@makers.test', password: 'rack-maker-2026', role: 'maker' },
  { id: 'U-0004', name: 'Joel Mbeki', email: 'joel@makers.test', password: 'rack-maker-2026', role: 'maker' },
  { id: 'U-0005', name: 'Ruth Calloway', email: 'ruth@makers.test', password: 'rack-maker-2026', role: 'maker' }
];

const LOTS = [
  { id: 'LOT-01', name: 'Hollis Road dairy barn', origin: 'Timber-frame dairy barn, taken down August 2026', built_year: 1911 },
  { id: 'LOT-02', name: 'Pell Street shoe factory', origin: 'Four-storey mill floor and joists', built_year: 1924 },
  { id: 'LOT-03', name: 'Marsh Lane farmhouse', origin: 'Farmhouse floorboards and mantel stock', built_year: 1880 }
];

const RATES: Array<[string, number, number, number]> = [
  ['White oak', 1450, 1100, 800],
  ['Black walnut', 2400, 1850, 1300],
  ['Douglas fir', 900, 700, 500],
  ['Heart pine', 1600, 1250, 900],
  ['Chestnut', 2800, 2200, 1600]
];

interface SeedBoard {
  tag: string;
  species: string;
  grade: string | null;
  lot: string;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  status: string;
  defects: DefectZone[];
}

const BOARDS: SeedBoard[] = [
  {
    tag: 'KW-0001',
    species: 'White oak',
    grade: 'Character',
    lot: 'LOT-01',
    length_mm: 2440,
    width_mm: 190,
    thickness_mm: 32,
    status: 'available',
    defects: [
      { kind: 'nail hole', start_mm: 610, end_mm: 640 },
      { kind: 'check', start_mm: 1500, end_mm: 1720 },
      { kind: 'nail hole', start_mm: 2200, end_mm: 2230 }
    ]
  },
  {
    tag: 'KW-0002',
    species: 'Black walnut',
    grade: 'Select',
    lot: 'LOT-03',
    length_mm: 2100,
    width_mm: 305,
    thickness_mm: 45,
    status: 'available',
    defects: [
      { kind: 'check', start_mm: 0, end_mm: 120 },
      { kind: 'bolt hole', start_mm: 1340, end_mm: 1380 }
    ]
  },
  {
    tag: 'KW-0003',
    species: 'Black walnut',
    grade: 'Character',
    lot: 'LOT-03',
    length_mm: 1830,
    width_mm: 210,
    thickness_mm: 25,
    status: 'available',
    defects: [
      { kind: 'nail hole', start_mm: 400, end_mm: 420 },
      { kind: 'nail hole', start_mm: 900, end_mm: 920 }
    ]
  },
  {
    tag: 'KW-0004',
    species: 'Douglas fir',
    grade: 'Rustic',
    lot: 'LOT-02',
    length_mm: 4880,
    width_mm: 235,
    thickness_mm: 70,
    status: 'available',
    defects: [
      { kind: 'bolt hole', start_mm: 1200, end_mm: 1260 },
      { kind: 'bolt hole', start_mm: 3600, end_mm: 3660 },
      { kind: 'check', start_mm: 4500, end_mm: 4880 }
    ]
  },
  {
    tag: 'KW-0005',
    species: 'Heart pine',
    grade: 'Select',
    lot: 'LOT-02',
    length_mm: 3050,
    width_mm: 140,
    thickness_mm: 38,
    status: 'available',
    defects: []
  },
  {
    tag: 'KW-0006',
    species: 'Chestnut',
    grade: 'Character',
    lot: 'LOT-03',
    length_mm: 2740,
    width_mm: 250,
    thickness_mm: 28,
    status: 'available',
    defects: [
      { kind: 'nail hole', start_mm: 300, end_mm: 330 },
      { kind: 'check', start_mm: 2000, end_mm: 2300 }
    ]
  },
  {
    tag: 'KW-0007',
    species: 'White oak',
    grade: 'Rustic',
    lot: 'LOT-01',
    length_mm: 3660,
    width_mm: 200,
    thickness_mm: 50,
    status: 'available',
    defects: [
      { kind: 'nail hole', start_mm: 900, end_mm: 930 },
      { kind: 'nail hole', start_mm: 1800, end_mm: 1830 },
      { kind: 'bolt hole', start_mm: 2700, end_mm: 2760 }
    ]
  },
  {
    tag: 'KW-0008',
    species: 'Heart pine',
    grade: null,
    lot: 'LOT-02',
    length_mm: 2400,
    width_mm: 180,
    thickness_mm: 38,
    status: 'tagged',
    defects: [{ kind: 'nail hole', start_mm: 1000, end_mm: 1020 }]
  },
  {
    tag: 'KW-0009',
    species: 'Douglas fir',
    grade: 'Character',
    lot: 'LOT-02',
    length_mm: 3000,
    width_mm: 185,
    thickness_mm: 45,
    status: 'graded',
    defects: []
  },
  {
    tag: 'KW-0010',
    species: 'Black walnut',
    grade: 'Select',
    lot: 'LOT-03',
    length_mm: 1220,
    width_mm: 330,
    thickness_mm: 50,
    status: 'available',
    defects: []
  }
];

function schemaSql(): string {
  return readFileSync(join(__dirname, 'schema.sql'), 'utf8');
}

async function seedUsers(client: PoolClient): Promise<void> {
  for (const user of USERS) {
    const existing = await client.query('SELECT 1 FROM users WHERE id = $1', [user.id]);
    if (existing.rowCount !== null && existing.rowCount > 0) continue;
    const hash = await hashPassword(user.password);
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [user.id, user.name, user.email, hash, user.role]
    );
  }
}

async function seedLots(client: PoolClient): Promise<void> {
  for (const lot of LOTS) {
    await client.query(
      `INSERT INTO lots (id, name, origin, built_year) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [lot.id, lot.name, lot.origin, lot.built_year]
    );
  }
}

async function seedRates(client: PoolClient): Promise<void> {
  for (const [species, select, character, rustic] of RATES) {
    const byGrade: Array<[string, number]> = [
      ['Select', select],
      ['Character', character],
      ['Rustic', rustic]
    ];
    for (const [grade, rate] of byGrade) {
      await client.query(
        `INSERT INTO rate_versions (species, grade, rate_cents, effective_at, created_at)
         SELECT $1, $2, $3, $4::timestamptz, $4::timestamptz
         WHERE NOT EXISTS (
           SELECT 1 FROM rate_versions WHERE species = $1 AND grade = $2 AND effective_at = $4::timestamptz
         )`,
        [species, grade, rate, SEED_INSTANT]
      );
    }
  }
}

async function seedBoards(client: PoolClient): Promise<void> {
  for (const board of BOARDS) {
    const existing = await client.query('SELECT 1 FROM boards WHERE tag = $1', [board.tag]);
    if (existing.rowCount !== null && existing.rowCount > 0) continue;
    await client.query(
      `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)`,
      [
        board.tag,
        board.species,
        board.grade,
        board.status,
        board.lot,
        board.length_mm,
        board.width_mm,
        board.thickness_mm,
        JSON.stringify(board.defects),
        SEED_INSTANT
      ]
    );
    const volume = volumeMm3(board.thickness_mm, board.width_mm, board.length_mm);
    const movement = await client.query<{ id: string }>(
      `INSERT INTO movements (kind, created_at, ticket_id, by_user_id)
       VALUES ('intake', $1::timestamptz, NULL, NULL) RETURNING id`,
      [SEED_INSTANT]
    );
    const movementId = movement.rows[0]?.id;
    if (movementId === undefined) throw new Error('seed movement was not created');
    await client.query(
      `INSERT INTO movement_entries (movement_id, account, volume_mm3)
       VALUES ($1, 'intake', $2), ($1, $3, $4)`,
      [movementId, -volume, `board:${board.tag}`, volume]
    );
  }
}

async function seedYardId(client: PoolClient): Promise<void> {
  await client.query(`INSERT INTO app_meta (key, value) VALUES ('yard_id', $1) ON CONFLICT DO NOTHING`, [
    randomBytes(6).toString('hex')
  ]);
}

export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (client) => {
    await advisoryLock(client, LOCK_SCOPE_MIGRATE, 'schema');
    await client.query(schemaSql());
    await seedUsers(client);
    await seedLots(client);
    await seedRates(client);
    await seedBoards(client);
    await seedYardId(client);
  });
}
