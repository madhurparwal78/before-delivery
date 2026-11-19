import { createHash } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./passwords.js";
import { schemaSql } from "./schema.js";
import {
  seedOperators, seedPassword, seedPeople, seedProducts, seedStockDefault, seedStockExceptions, seedShops,
} from "./seedData.js";

pg.types.setTypeParser(1082, (value: string) => value); // date stays a plain YYYY-MM-DD string
pg.types.setTypeParser(20, (value: string) => Number(value)); // bigint counts

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient;
type Queryable = Pick<pg.Pool, "query">;

export async function query<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, sql, params);
  return rows[0] ?? null;
}

/** The one row a statement must produce (an UPDATE ... RETURNING on a row the caller just checked). */
export async function required<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const row = await one<T>(db, sql, params);
  if (row === null) throw new Error(`expected a row from: ${sql}`);
  return row;
}

/** Runs `work` in one transaction; rolls back on any throw. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

function stableUuid(name: string): string {
  const hex = createHash("sha1").update(`tramela-estate:${name}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

const MIGRATION_LOCK = 727_001;

/** Applies the schema and seed under an advisory lock so two copies starting together stay safe. */
export async function migrate(): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await db.query(schemaSql);
    for (const operator of seedOperators) {
      await db.query("INSERT INTO operators (id, name, prefix) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [operator.id, operator.name, operator.prefix]);
    }
    for (const shop of seedShops) {
      await db.query(
        `INSERT INTO shops (id, operator_id, name, city, region, lat, lon, timezone, vat_rate, suspended, suspension_reason, hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING`,
        [shop.id, shop.operator, shop.name, shop.city, shop.region, shop.lat, shop.lon, shop.timezone,
          shop.vatRate, shop.suspendedReason !== null, shop.suspendedReason,
          JSON.stringify(shop.hours)]);
    }
    for (const product of seedProducts) {
      await db.query("INSERT INTO products (sku, operator_id, name, unit_price_milli) VALUES ($1, $2, $3, $4) ON CONFLICT (sku) DO NOTHING",
        [product.sku, product.operator, product.name, product.price]);
    }
    for (const shop of seedShops) {
      for (const product of seedProducts) {
        if (product.operator !== shop.operator) continue;
        const onHand = seedStockExceptions[`${shop.id}/${product.sku}`] ?? seedStockDefault;
        await db.query("INSERT INTO stock (store_id, sku, on_hand) VALUES ($1, $2, $3) ON CONFLICT (store_id, sku) DO NOTHING",
          [shop.id, product.sku, onHand]);
      }
    }
    const existing = new Set((await db.query<{ email: string }>("SELECT email FROM users")).rows.map((row) => row.email));
    for (const person of seedPeople) {
      if (existing.has(person.email)) continue;
      const id = stableUuid(person.email);
      await db.query("INSERT INTO users (id, email, name, role, operator_id, password_hash) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
        [id, person.email, person.name, person.role, person.operator, await hashPassword(seedPassword)]);
      for (const shopId of person.shops) {
        await db.query("INSERT INTO user_shops (user_id, store_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, shopId]);
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    db.release();
  }
}
