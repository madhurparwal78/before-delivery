import * as crypto from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { Config } from "./config.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "lead" | "manager" | "care" | "shopper";
  operatorId: string;
  operatorName: string;
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const candidate = crypto.scryptSync(password, salt, 32).toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export class Database {
  private readonly pool: Pool;
  ready = false;

  constructor(cfg: Config) {
    this.pool = new Pool({ connectionString: cfg.database_url, max: 20 });
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async applySchemaAndSeed(): Promise<void> {
    const schemaSql = readFileSync(path.join(dirname, "schema.sql"), "utf8");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(schemaSql);
      await this.seed(client);
      await client.query("COMMIT");
      this.ready = true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async seed(client: PoolClient): Promise<void> {
    const { OPERATORS, PEOPLE, STORES, PRODUCTS, STOCK_EXCEPTIONS } = await import("../shared/domain.js");
    for (const op of OPERATORS) {
      await client.query(
        `INSERT INTO operators (id, name, order_prefix) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_prefix = EXCLUDED.order_prefix`,
        [op.id, op.name, op.prefix],
      );
    }
    const passwordHash = hashPassword("estate-demo-2026");
    for (const person of PEOPLE) {
      await client.query(
        `INSERT INTO people (id, operator_id, email, name, role, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, email = EXCLUDED.email,
           name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
        [personSeedId(person.email), person.operator, person.email, person.name, person.role, passwordHash],
      );
      await client.query("INSERT INTO carts (person_id) VALUES ($1) ON CONFLICT (person_id) DO NOTHING", [personSeedId(person.email)]);
    }
    for (const store of STORES) {
      await client.query(
        `INSERT INTO stores (id, operator_id, name, city, region, lat, lon, timezone, hours_kind, suspended, suspension_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id, name = EXCLUDED.name, city = EXCLUDED.city,
           region = EXCLUDED.region, lat = EXCLUDED.lat, lon = EXCLUDED.lon, timezone = EXCLUDED.timezone,
           hours_kind = EXCLUDED.hours_kind, suspended = EXCLUDED.suspended, suspension_reason = EXCLUDED.suspension_reason`,
        [store.id, store.operator, store.name, store.city, store.region, store.lat, store.lon, store.timezone, store.hours, store.suspended, store.suspension_reason],
      );
      for (const person of PEOPLE) {
        if (person.shops.includes(store.id)) {
          await client.query(
            "INSERT INTO store_managers (store_id, person_id) VALUES ($1,$2) ON CONFLICT (store_id, person_id) DO NOTHING",
            [store.id, personSeedId(person.email)],
          );
        }
      }
      await this.seedHoursPlan(client, store.id, store.hours);
      for (const product of PRODUCTS) {
        if (product.operator !== store.operator) continue;
        const exception = STOCK_EXCEPTIONS.find((row) => row.store === store.id && row.sku === product.sku);
        const onHand = exception ? exception.on_hand : 20;
        await client.query(
          "INSERT INTO stock_lines (store_id, sku, on_hand, held) VALUES ($1,$2,$3,0) ON CONFLICT (store_id, sku) DO NOTHING",
          [store.id, product.sku, onHand],
        );
      }
    }
    for (const product of PRODUCTS) {
      await client.query(
        `INSERT INTO products (operator_id, sku, name, unit_price_milli) VALUES ($1,$2,$3,$4)
         ON CONFLICT (operator_id, sku) DO UPDATE SET name = EXCLUDED.name, unit_price_milli = EXCLUDED.unit_price_milli`,
        [product.operator, product.sku, product.name, product.unit_price_milli],
      );
    }
    for (const op of OPERATORS) {
      await client.query("INSERT INTO operator_sequences (operator_id, last_number) VALUES ($1,0) ON CONFLICT (operator_id) DO NOTHING", [op.id]);
    }
  }

  private async seedHoursPlan(client: PoolClient, storeId: string, kind: string): Promise<void> {
    const existing = await client.query<{ count: string }>("select count(*) as count from hours_plans where store_id=$1 and kind='current'", [storeId]);
    if (Number(existing.rows[0].count) > 0) return;
    for (let weekday = 1; weekday <= 7; weekday++) {
      const open = kind === "daily" || weekday <= 6;
      const opens = open ? (kind === "daily" ? "08:00" : "09:00") : null;
      const closes = open ? (kind === "daily" ? "20:00" : weekday <= 5 ? "19:00" : "13:00") : null;
      await client.query(
        `INSERT INTO hours_plans (store_id, kind, effective_from, weekday, open, opens, closes)
         VALUES ($1,'current','2026-01-01',$2,$3,$4,$5)`,
        [storeId, weekday, open, opens === null ? null : `${opens}:00`, closes === null ? null : `${closes}:00`],
      );
    }
  }
}

const SEED_NAMESPACE_BYTES = Buffer.from("9f5a1f13-2fbd-4c01-8ef4-c0ffee000001", "hex");

export function personSeedId(email: string): string {
  const hash = crypto.createHash("sha1");
  hash.update(SEED_NAMESPACE_BYTES);
  hash.update(email, "utf8");
  const digest = hash.digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex", 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
