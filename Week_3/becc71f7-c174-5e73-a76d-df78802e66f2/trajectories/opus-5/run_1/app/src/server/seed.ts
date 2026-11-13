/**
 * The shop's starting data. `S` is the Brussels date on which this copy first started on
 * its empty database; it is written down then and never moves afterwards.
 */

import { randomUUID } from 'node:crypto';
import { inTransaction, instantParam, type Database, type Queryable } from './db.js';
import { addDays, brusselsDate, brusselsInstant, startOfBrusselsDay } from '../shared/brussels.js';
import { hashPassword } from './http/sessions.js';
import { tagCodeForSerial } from './domain/tagCode.js';
import { splitSale } from './domain/sale.js';
import { normaliseIban } from './domain/iban.js';
import type { Choice, Condition, Payment, Role } from '../shared/options.js';

const SEED_LOCK = 8_421_774;

interface SeedMember {
  name: string;
  email: string;
  password: string;
  role: Role;
}

const MEMBERS: readonly SeedMember[] = [
  { name: 'Margaux', email: 'margaux@atelier-ourlet.example', password: 'ourlet-owner-2027', role: 'owner' },
  { name: 'Noor', email: 'noor@atelier-ourlet.example', password: 'ourlet-noor-2027', role: 'assistant' },
  { name: 'Jules', email: 'jules@atelier-ourlet.example', password: 'ourlet-jules-2027', role: 'assistant' },
  { name: 'Ines', email: 'ines@atelier-ourlet.example', password: 'ourlet-ines-2027', role: 'bookkeeper' },
];

interface SeedConsignor {
  key: string;
  name: string;
  email: string;
  phone: string;
  iban: string;
}

const CONSIGNORS: readonly SeedConsignor[] = [
  {
    key: 'zoe',
    name: 'Zo\u00eb \u00d8rsted-H\u00e6k',
    email: 'zoe.orsted@consignors.example',
    phone: '+32 470 11 22 33',
    iban: 'BE21 0012 3456 7803',
  },
  {
    key: 'segolene',
    name: 'S\u00e9gol\u00e8ne D\u2019Hondt',
    email: 'segolene.dhondt@consignors.example',
    phone: '+32 470 12 34 56',
    iban: 'BE35 3101 2345 6737',
  },
  {
    key: 'maarten',
    name: 'Maarten De Smet',
    email: 'maarten.desmet@consignors.example',
    phone: '+32 471 98 76 54',
    iban: 'BE94 7350 0123 4514',
  },
  {
    key: 'lotte',
    name: 'Lotte Janssens',
    email: 'lotte.janssens@consignors.example',
    phone: '+32 472 45 67 89',
    iban: 'BE68 5390 0754 7035',
  },
];

interface SeedPiece {
  serial: number;
  consignor: string;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: Condition;
  askingPriceCents: number;
  intakeDaysBack: number;
  choice?: Choice;
  archived?: boolean;
}

const PIECES: readonly SeedPiece[] = [
  { serial: 1000042, consignor: 'zoe', category: 'coats', brand: 'Maison Arlo', description: 'Wool wrap coat, camel', size: 'm', condition: 'very_good', askingPriceCents: 4990, intakeDaysBack: 35 },
  { serial: 1000043, consignor: 'segolene', category: 'dresses', brand: 'Linnea', description: 'Silk slip dress, ink blue', size: 's', condition: 'very_good', askingPriceCents: 1990, intakeDaysBack: 3 },
  { serial: 1000044, consignor: 'maarten', category: 'shoes', brand: 'Calder & Fils', description: 'Leather Chelsea boots', size: '42', condition: 'good', askingPriceCents: 12000, intakeDaysBack: 65 },
  { serial: 1000045, consignor: 'zoe', category: 'bags', brand: 'Oriel', description: 'Leather shoulder bag, cognac', size: 'one_size', condition: 'excellent', askingPriceCents: 31245, intakeDaysBack: 20 },
  { serial: 1000046, consignor: 'lotte', category: 'knitwear', brand: 'Fjell', description: 'Merino cardigan, oatmeal', size: 'm', condition: 'very_good', askingPriceCents: 3900, intakeDaysBack: 80 },
  { serial: 1000047, consignor: 'segolene', category: 'jackets', brand: 'Atelier Nord', description: 'Denim trucker jacket', size: 'l', condition: 'good', askingPriceCents: 4500, intakeDaysBack: 92, choice: 'return' },
  { serial: 1000048, consignor: 'maarten', category: 'trousers', brand: 'Pell', description: 'Pleated wool trousers, grey', size: 'm', condition: 'good', askingPriceCents: 6500, intakeDaysBack: 95 },
  { serial: 1000049, consignor: 'zoe', category: 'skirts', brand: 'Linnea', description: 'Pleated midi skirt, black', size: 's', condition: 'excellent', askingPriceCents: 5500, intakeDaysBack: 50 },
  { serial: 1000050, consignor: 'segolene', category: 'shirts', brand: 'Marlowe', description: 'Poplin shirt, white', size: 'm', condition: 'very_good', askingPriceCents: 2990, intakeDaysBack: 45 },
  { serial: 1000051, consignor: 'maarten', category: 'accessories', brand: 'Oriel', description: 'Silk scarf, rust print', size: 'one_size', condition: 'excellent', askingPriceCents: 3500, intakeDaysBack: 10 },
  { serial: 1000052, consignor: 'lotte', category: 'coats', brand: 'Fjell', description: 'Boiled wool coat, forest', size: 'l', condition: 'good', askingPriceCents: 8900, intakeDaysBack: 31 },
  { serial: 1000053, consignor: 'zoe', category: 'shoes', brand: 'Calder & Fils', description: 'Suede loafers', size: '38', condition: 'very_good', askingPriceCents: 7500, intakeDaysBack: 200, archived: true },
];

interface SeedSale {
  serial: number;
  daysBack: number;
  hour: number;
  minute: number;
  soldBy: string;
  payment: Payment;
  priceCents: number;
}

const SALES: readonly SeedSale[] = [
  { serial: 1000045, daysBack: 10, hour: 14, minute: 5, soldBy: 'Noor', payment: 'card', priceCents: 31245 },
  { serial: 1000050, daysBack: 12, hour: 11, minute: 30, soldBy: 'Noor', payment: 'cash', priceCents: 2243 },
  { serial: 1000049, daysBack: 40, hour: 16, minute: 20, soldBy: 'Jules', payment: 'cash', priceCents: 5500 },
];

async function insertSeed(tx: Queryable, now: number): Promise<void> {
  const startedOn = brusselsDate(now);
  await tx.query(`INSERT INTO shop_state (started_on, seeded_at) VALUES ($1, $2)`, [
    startedOn,
    instantParam(now),
  ]);

  const memberIds = new Map<string, string>();
  for (const member of MEMBERS) {
    const id = randomUUID();
    memberIds.set(member.name, id);
    await tx.query(
      `INSERT INTO members (id, name, email, email_lower, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        member.name,
        member.email,
        member.email.toLowerCase(),
        hashPassword(member.password),
        member.role,
        instantParam(now),
      ],
    );
  }

  const consignorIds = new Map<string, string>();
  for (const consignor of CONSIGNORS) {
    const id = randomUUID();
    consignorIds.set(consignor.key, id);
    await tx.query(
      `INSERT INTO consignors (id, name, email, email_lower, phone, iban, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [
        id,
        consignor.name,
        consignor.email,
        consignor.email.toLowerCase(),
        consignor.phone,
        normaliseIban(consignor.iban),
        instantParam(now),
      ],
    );
  }

  const ladderId = randomUUID();
  await tx.query(
    `INSERT INTO ladders (id, effective_on, first_markdown_percent, first_markdown_day,
                          second_markdown_percent, second_markdown_day, period_end_day, created_at)
     VALUES ($1, '2024-01-01', 25, 30, 50, 60, 90, $2)`,
    [ladderId, instantParam(now)],
  );

  const pieceIds = new Map<number, string>();
  for (const piece of PIECES) {
    const id = randomUUID();
    pieceIds.set(piece.serial, id);
    const intakeDate = addDays(startedOn, -piece.intakeDaysBack);
    await tx.query(
      `INSERT INTO pieces (id, serial, tag_code, consignor_id, category, brand, description, size,
                           condition, asking_price_cents, intake_date, ladder_id, choice,
                           archived_at, version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15)`,
      [
        id,
        piece.serial,
        tagCodeForSerial(piece.serial),
        consignorIds.get(piece.consignor),
        piece.category,
        piece.brand,
        piece.description,
        piece.size,
        piece.condition,
        piece.askingPriceCents,
        intakeDate,
        ladderId,
        piece.choice ?? null,
        piece.archived === true ? instantParam(now) : null,
        instantParam(startOfBrusselsDay(intakeDate)),
      ],
    );
    await tx.query(
      `INSERT INTO asking_prices (id, piece_id, asking_price_cents, effective_from)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), id, piece.askingPriceCents, instantParam(startOfBrusselsDay(intakeDate))],
    );
  }

  for (const sale of SALES) {
    const soldAt = brusselsInstant(addDays(startedOn, -sale.daysBack), sale.hour, sale.minute);
    const split = splitSale(sale.priceCents);
    await tx.query(
      `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents,
                          commission_cents, vat_cents, payment, sold_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $3)`,
      [
        randomUUID(),
        pieceIds.get(sale.serial),
        instantParam(soldAt),
        split.priceCents,
        split.consignorShareCents,
        split.commissionCents,
        split.vatCents,
        sale.payment,
        memberIds.get(sale.soldBy),
      ],
    );
  }
}

/** Applies the starting data once, to this copy's own database alone. */
export async function applySeed(db: Database, now: number): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const { rows } = await tx.query(`SELECT started_on FROM shop_state`);
    if (rows.length > 0) return;
    await insertSeed(tx, now);
  });
}
