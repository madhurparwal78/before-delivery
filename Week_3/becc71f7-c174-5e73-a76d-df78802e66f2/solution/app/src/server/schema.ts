import { randomUUID } from "node:crypto";
import { addDays, brusselsDate, brusselsInstant } from "../shared/brussels";
import { hashPassword } from "./passwords";
import { lockKey, pool, transaction } from "./db";
import { storedIban } from "./rules/iban";
import { markdownPrice, splitSale } from "./rules/money";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text NOT NULL, role text NOT NULL,
  created_at timestamptz NOT NULL, removed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, ends_at timestamptz NOT NULL, ended_at timestamptz);
CREATE TABLE IF NOT EXISTS consignors (
  id uuid PRIMARY KEY, name text NOT NULL, email text, phone text, iban text, status text NOT NULL, created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS consignors_email ON consignors (lower(email));
CREATE TABLE IF NOT EXISTS ladders (
  id uuid PRIMARY KEY, effective_on date NOT NULL UNIQUE, first_percent int NOT NULL, first_day int NOT NULL,
  second_percent int NOT NULL, second_day int NOT NULL, period_end_day int NOT NULL);
CREATE TABLE IF NOT EXISTS tag_counter (last_number int NOT NULL);
CREATE TABLE IF NOT EXISTS pieces (
  id uuid PRIMARY KEY, tag_number int NOT NULL UNIQUE, consignor_id uuid NOT NULL REFERENCES consignors,
  category text NOT NULL, brand text NOT NULL, description text NOT NULL, size text NOT NULL, condition text NOT NULL,
  intake_date date NOT NULL, ladder_id uuid NOT NULL REFERENCES ladders, choice text, version int NOT NULL DEFAULT 1,
  archived_at timestamptz, collected_at timestamptz);
CREATE TABLE IF NOT EXISTS asking_prices (
  id bigserial PRIMARY KEY, piece_id uuid NOT NULL REFERENCES pieces, cents int NOT NULL, from_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS asking_prices_piece ON asking_prices (piece_id, id);
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY, piece_id uuid NOT NULL REFERENCES pieces, content_type text NOT NULL, original_type text NOT NULL,
  width int NOT NULL, height int NOT NULL, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS photos_piece ON photos (piece_id, created_at);
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY, piece_id uuid NOT NULL REFERENCES pieces, shopper_name text NOT NULL, shopper_email text NOT NULL,
  token_hash text NOT NULL UNIQUE, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, released_at timestamptz, ended_at timestamptz);
CREATE INDEX IF NOT EXISTS holds_piece ON holds (piece_id);
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY, piece_id uuid NOT NULL REFERENCES pieces, sold_at timestamptz NOT NULL, price_cents int NOT NULL,
  consignor_share_cents int NOT NULL, commission_cents int NOT NULL, vat_cents int NOT NULL, payment text NOT NULL,
  sold_by uuid NOT NULL REFERENCES members, refunded_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS sales_live_piece ON sales (piece_id) WHERE refunded_at IS NULL;
CREATE TABLE IF NOT EXISTS request_keys (
  member_id uuid NOT NULL REFERENCES members, key text NOT NULL, body_hash text NOT NULL, status int NOT NULL,
  response text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (member_id, key));
CREATE TABLE IF NOT EXISTS payout_runs (
  month text PRIMARY KEY, started_at timestamptz NOT NULL, started_by uuid NOT NULL REFERENCES members,
  ready_at timestamptz NOT NULL, control_sum_cents int NOT NULL);
CREATE TABLE IF NOT EXISTS payouts (
  id text PRIMARY KEY, month text NOT NULL REFERENCES payout_runs, consignor_id uuid NOT NULL REFERENCES consignors,
  iban text, amount_cents int NOT NULL, status text NOT NULL, reason text);
CREATE TABLE IF NOT EXISTS payout_sales (
  payout_id text NOT NULL REFERENCES payouts, sale_id uuid NOT NULL REFERENCES sales, PRIMARY KEY (payout_id, sale_id));
CREATE TABLE IF NOT EXISTS portal_pages (
  token_hash text PRIMARY KEY, consignor_id uuid NOT NULL REFERENCES consignors, ends_at timestamptz NOT NULL, ended_at timestamptz);
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, name text NOT NULL, email text NOT NULL,
  token_hash text NOT NULL UNIQUE, cancelled_at timestamptz, created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot ON appointments (starts_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_email ON appointments (lower(email), created_at);
CREATE TABLE IF NOT EXISTS book_downloads (member_id uuid NOT NULL REFERENCES members, at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS import_items (item_no text PRIMARY KEY, piece_id uuid NOT NULL REFERENCES pieces);
`;

const SEED_MEMBERS = [
  { name: "Margaux", email: "margaux@atelier-ourlet.example", password: "ourlet-owner-2027", role: "owner" },
  { name: "Noor", email: "noor@atelier-ourlet.example", password: "ourlet-noor-2027", role: "assistant" },
  { name: "Jules", email: "jules@atelier-ourlet.example", password: "ourlet-jules-2027", role: "assistant" },
  { name: "Ines", email: "ines@atelier-ourlet.example", password: "ourlet-ines-2027", role: "bookkeeper" },
];

const SEED_CONSIGNORS = {
  zoe: { name: "Zoë Ørsted-Hæk", email: "zoe.orsted@consignors.example", phone: "+32 470 11 22 33", iban: "BE21 0012 3456 7803" },
  segolene: { name: "Ségolène D’Hondt", email: "segolene.dhondt@consignors.example", phone: "+32 470 12 34 56", iban: "BE35 3101 2345 6737" },
  maarten: { name: "Maarten De Smet", email: "maarten.desmet@consignors.example", phone: "+32 471 98 76 54", iban: "BE94 7350 0123 4514" },
  lotte: { name: "Lotte Janssens", email: "lotte.janssens@consignors.example", phone: "+32 472 45 67 89", iban: "BE68 5390 0754 7035" },
};

type SeedConsignor = keyof typeof SEED_CONSIGNORS;

interface SeedPiece {
  tag: number;
  consignor: SeedConsignor;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  askingCents: number;
  back: number;
  choice?: string;
  archived?: boolean;
  sale?: { back: number; hour: number; minute: number; by: string; payment: string; percentOff: number };
}

const SEED_PIECES: SeedPiece[] = [
  { tag: 1000042, consignor: "zoe", category: "coats", brand: "Maison Arlo", description: "Wool wrap coat, camel", size: "m", condition: "very_good", askingCents: 4990, back: 35 },
  { tag: 1000043, consignor: "segolene", category: "dresses", brand: "Linnea", description: "Silk slip dress, ink blue", size: "s", condition: "very_good", askingCents: 1990, back: 3 },
  { tag: 1000044, consignor: "maarten", category: "shoes", brand: "Calder & Fils", description: "Leather Chelsea boots", size: "42", condition: "good", askingCents: 12000, back: 65 },
  { tag: 1000045, consignor: "zoe", category: "bags", brand: "Oriel", description: "Leather shoulder bag, cognac", size: "one_size", condition: "excellent", askingCents: 31245, back: 20, sale: { back: 10, hour: 14, minute: 5, by: "Noor", payment: "card", percentOff: 0 } },
  { tag: 1000046, consignor: "lotte", category: "knitwear", brand: "Fjell", description: "Merino cardigan, oatmeal", size: "m", condition: "very_good", askingCents: 3900, back: 80 },
  { tag: 1000047, consignor: "segolene", category: "jackets", brand: "Atelier Nord", description: "Denim trucker jacket", size: "l", condition: "good", askingCents: 4500, back: 92, choice: "return" },
  { tag: 1000048, consignor: "maarten", category: "trousers", brand: "Pell", description: "Pleated wool trousers, grey", size: "m", condition: "good", askingCents: 6500, back: 95 },
  { tag: 1000049, consignor: "zoe", category: "skirts", brand: "Linnea", description: "Pleated midi skirt, black", size: "s", condition: "excellent", askingCents: 5500, back: 50, sale: { back: 40, hour: 16, minute: 20, by: "Jules", payment: "cash", percentOff: 0 } },
  { tag: 1000050, consignor: "segolene", category: "shirts", brand: "Marlowe", description: "Poplin shirt, white", size: "m", condition: "very_good", askingCents: 2990, back: 45, sale: { back: 12, hour: 11, minute: 30, by: "Noor", payment: "cash", percentOff: 25 } },
  { tag: 1000051, consignor: "maarten", category: "accessories", brand: "Oriel", description: "Silk scarf, rust print", size: "one_size", condition: "excellent", askingCents: 3500, back: 10 },
  { tag: 1000052, consignor: "lotte", category: "coats", brand: "Fjell", description: "Boiled wool coat, forest", size: "l", condition: "good", askingCents: 8900, back: 31 },
  { tag: 1000053, consignor: "zoe", category: "shoes", brand: "Calder & Fils", description: "Suede loafers", size: "38", condition: "very_good", askingCents: 7500, back: 200, archived: true },
];

const HIGHEST_SEEDED_TAG = 1000053;

async function seed(now: Date): Promise<void> {
  await transaction(async (db) => {
    await lockKey(db, "ourlet-seed");
    const { rowCount } = await db.query("SELECT 1 FROM members LIMIT 1");
    if (rowCount) return;

    const memberIds = new Map<string, string>();
    for (const member of SEED_MEMBERS) {
      const id = randomUUID();
      memberIds.set(member.name, id);
      await db.query("INSERT INTO members (id, name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
        id, member.name, member.email, await hashPassword(member.password), member.role, now,
      ]);
    }

    const consignorIds = new Map<SeedConsignor, string>();
    for (const key of ["zoe", "segolene", "maarten", "lotte"] as const) {
      const id = randomUUID();
      consignorIds.set(key, id);
      const consignor = SEED_CONSIGNORS[key];
      await db.query("INSERT INTO consignors (id, name, email, phone, iban, status, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)", [
        id, consignor.name, consignor.email, consignor.phone, storedIban(consignor.iban), now,
      ]);
    }

    const ladderId = randomUUID();
    await db.query("INSERT INTO ladders (id, effective_on, first_percent, first_day, second_percent, second_day, period_end_day) VALUES ($1, '2024-01-01', 25, 30, 50, 60, 90)", [ladderId]);
    await db.query("INSERT INTO tag_counter (last_number) VALUES ($1)", [HIGHEST_SEEDED_TAG]);

    const start = brusselsDate(now);
    for (const piece of SEED_PIECES) {
      const id = randomUUID();
      const intakeDate = addDays(start, -piece.back);
      await db.query(
        `INSERT INTO pieces (id, tag_number, consignor_id, category, brand, description, size, condition, intake_date, ladder_id, choice, archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, piece.tag, consignorIds.get(piece.consignor), piece.category, piece.brand, piece.description, piece.size, piece.condition, intakeDate, ladderId, piece.choice ?? null, piece.archived ? now : null],
      );
      await db.query("INSERT INTO asking_prices (piece_id, cents, from_at) VALUES ($1, $2, $3)", [id, piece.askingCents, brusselsInstant(intakeDate)]);
      if (piece.sale) {
        const priceCents = markdownPrice(piece.askingCents, piece.sale.percentOff);
        const split = splitSale(priceCents);
        await db.query(
          `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents, commission_cents, vat_cents, payment, sold_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), id, brusselsInstant(addDays(start, -piece.sale.back), piece.sale.hour, piece.sale.minute), priceCents, split.consignorShareCents, split.commissionCents, split.vatCents, piece.sale.payment, memberIds.get(piece.sale.by)],
        );
      }
    }
  });
}

const BOOT_RETRY_SECONDS = 60;

/** Waits for Postgres for up to a minute, then applies the schema and the starting data once. */
export async function prepareDatabase(): Promise<void> {
  const deadline = Date.now() + BOOT_RETRY_SECONDS * 1000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await transaction(async (db) => {
    await lockKey(db, "ourlet-schema");
    await db.query(SCHEMA);
  });
  await seed(new Date());
}
