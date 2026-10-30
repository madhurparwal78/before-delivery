/** PostgreSQL: the system of record. Schema is applied on every start; an empty database is seeded. */

import { readFileSync } from "node:fs";
import { randomUUID, randomBytes, scryptSync, createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { KitchenClock, addDays } from "../shared/kitchen-time.js";
import { Storage } from "./providers/storage.js";
import { buildPdf } from "./pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface KitchenRecord {
  name: string;
  time_zone: string;
  tax_rate_percent: string;
}

export class Db {
  readonly pool: Pool;
  readonly kitchenName: string;
  readonly taxRatePercent: string;
  readonly clock: KitchenClock;

  constructor(pool: Pool, kitchen: KitchenRecord) {
    this.pool = pool;
    this.kitchenName = kitchen.name;
    this.taxRatePercent = kitchen.tax_rate_percent;
    this.clock = new KitchenClock(kitchen.time_zone);
  }

  static async connect(connectionString: string): Promise<Db> {
    const pool = new Pool({ connectionString, max: 8 });
    const kitchen = await Db.bootstrapSchema(pool);
    return new Db(pool, kitchen);
  }

  private static async bootstrapSchema(pool: Pool): Promise<KitchenRecord> {
    const schema = readFileSync(path.join(here, "schema.sql"), "utf8");
    await pool.query(schema);
    const res = await pool.query<{ name: string; time_zone: string; tax_rate_percent: string }>(
      "SELECT name, time_zone, tax_rate_percent::text AS tax_rate_percent FROM kitchen WHERE id = 'larder-row'"
    );
    if (res.rows.length === 0) {
      return { name: "Larder Row Kitchen", time_zone: "America/Chicago", tax_rate_percent: "8.25" };
    }
    const row = res.rows[0];
    return {
      name: row.name,
      time_zone: row.time_zone,
      tax_rate_percent: row.tax_rate_percent
    };
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params as never[]);
    return res.rows;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async audit(
    actorUserId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.query(
      "INSERT INTO audit_log (id, at, actor_user_id, action, entity, entity_id, detail) VALUES ($1, now(), $2, $3, $4, $5, $6)",
      [randomUUID(), actorUserId, action, entity, entityId, JSON.stringify(detail)]
    );
  }

  /**
   * A stable two-int32 advisory lock key from a name, for "one claim at a time" rules.
   * pg_advisory_xact_lock(int4, int4) needs no hash function in the database.
   */
  advisoryLockArgs(name: string): [number, number] {
    const digest = createHash("sha256").update(name).digest();
    return [digest.readInt32BE(0), digest.readInt32BE(4)];
  }

  async advisoryXactLock(client: PoolClient, name: string): Promise<void> {
    const [a, b] = this.advisoryLockArgs(name);
    await client.query("SELECT pg_advisory_xact_lock($1::int4, $2::int4)", [a, b]);
  }
}

export const uuid = (): string => randomUUID();

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export const sessionTokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Seed the kitchen once, relative to kitchen today. Seeded documents get generated PDF files
 * written as soon as storage is reachable.
 */
export async function seedIfEmpty(db: Db, storage: Storage): Promise<boolean> {
  const existing = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  if (Number(existing[0].count) > 0) return false;

  const clock = db.clock;
  const seedDay = clock.today();
  const at = (n: number): string => addDays(seedDay, n);

  await db.withTransaction(async (client) => {
    await client.query(
      "INSERT INTO kitchen (id, name, time_zone, tax_rate_percent) VALUES ('larder-row', $1, $2, $3) ON CONFLICT DO NOTHING",
      [db.kitchenName, clock.zone, db.taxRatePercent]
    );

    const stations: Array<[string, string, string, number, number]> = [
      ["hot-line-1", "Hot Line 1", "hot_line", 3200, 1],
      ["hot-line-2", "Hot Line 2", "hot_line", 3200, 2],
      ["bake-deck", "Bake Deck", "bake_deck", 2800, 3],
      ["cold-prep-a", "Cold-Prep Bench A", "cold_prep", 1800, 4],
      ["cold-prep-b", "Cold-Prep Bench B", "cold_prep", 1800, 5]
    ];
    for (const [id, name, kind, rate, order] of stations) {
      await client.query(
        "INSERT INTO stations (id, name, kind, hourly_rate_cents, dial_order) VALUES ($1,$2,$3,$4,$5)",
        [id, name, kind, rate, order]
      );
    }

    for (const [id, name] of [
      ["W-1", "Walk-in shelf W-1"],
      ["W-2", "Walk-in shelf W-2"],
      ["W-3", "Walk-in shelf W-3"],
      ["W-4", "Walk-in shelf W-4"]
    ] as Array<[string, string]>) {
      await client.query("INSERT INTO shelves (id, name, monthly_rate_cents, tenant_id) VALUES ($1,$2,$3,NULL)", [
        id,
        name,
        4500
      ]);
    }

    await client.query(
      "INSERT INTO hour_packs (id, name, minutes, price_cents) VALUES ('10h','10-hour pack',600,29000), ('25h','25-hour pack',1500,68750)"
    );

    await client.query(
      "INSERT INTO policy_versions (version, free_window_hours, late_fee_percent, effective_at) VALUES (1, 48, 50, now())"
    );

    const tenants: Array<[string, string, string, string, string, string]> = [
      ["juniper-rye", "Juniper & Rye Catering", "active", "Imani Brooks", "owner@juniperrye.test", "Imani Brooks"],
      ["lantern-street", "Lantern Street Tacos", "active", "Rafael Quintero", "owner@lanterntacos.test", "Rafael Quintero"],
      ["saltgrass-pies", "Saltgrass Pies", "suspended", "Hollis Grant", "owner@saltgrasspies.test", "Hollis Grant"],
      ["fennel-ferment", "Fennel Ferment Co.", "applied", "June Okafor", "owner@fennelferment.test", "June Okafor"]
    ];
    for (const [id, business, status, ownerName, ownerEmail] of tenants) {
      await client.query(
        "INSERT INTO tenants (id, business_name, status, owner_name, owner_email, created_at) VALUES ($1,$2,$3,$4,$5, now())",
        [id, business, status, ownerName, ownerEmail]
      );
    }

    await client.query("UPDATE shelves SET tenant_id = 'juniper-rye' WHERE id = 'W-1'");
    await client.query("UPDATE shelves SET tenant_id = 'lantern-street' WHERE id = 'W-2'");

    const users: Array<[string, string, string, string | null]> = [
      ["operator@larderrow.test", "Dana Whitcomb", "operator", null],
      ["owner@juniperrye.test", "Imani Brooks", "owner", "juniper-rye"],
      ["cook@juniperrye.test", "Priya Castellanos", "cook", "juniper-rye"],
      ["owner@lanterntacos.test", "Rafael Quintero", "owner", "lantern-street"],
      ["cook@lanterntacos.test", "Teo Abernathy", "cook", "lantern-street"],
      ["owner@saltgrasspies.test", "Hollis Grant", "owner", "saltgrass-pies"],
      ["owner@fennelferment.test", "June Okafor", "owner", "fennel-ferment"]
    ];
    for (const [email, name, role, tenantId] of users) {
      await client.query(
        "INSERT INTO users (id, email, password_hash, name, role, tenant_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [uuid(), email, hashPassword("kitchen-demo-2026"), name, role, tenantId]
      );
    }

    const documents: Array<[string, string, string, string | null, string]> = [
      ["juniper-rye", "certificate_of_insurance", "2026-pdf", null, at(200)],
      ["juniper-rye", "health_permit", "2026-pdf", null, at(300)],
      ["juniper-rye", "food_handler_card", "2026-pdf", "Priya Castellanos", at(400)],
      ["lantern-street", "certificate_of_insurance", "2026-pdf", null, at(250)],
      ["lantern-street", "health_permit", "2026-pdf", null, at(180)],
      ["lantern-street", "food_handler_card", "2026-pdf", "Teo Abernathy", at(20)],
      ["saltgrass-pies", "certificate_of_insurance", "2026-pdf", null, at(-2)],
      ["saltgrass-pies", "health_permit", "2026-pdf", null, at(150)],
      ["saltgrass-pies", "food_handler_card", "2026-pdf", "Hollis Grant", at(90)]
    ];
    for (const [tenantId, kind, content, holderName, expiresOn] of documents) {
      const id = uuid();
      await client.query(
        `INSERT INTO documents
         (id, tenant_id, kind, holder_name, expires_on, status, file_name, content_type, size_bytes, storage_key, uploaded_at, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,'approved',$6,'application/pdf',$7,$8, now(), now())`,
        [
          id,
          tenantId,
          kind,
          holderName,
          expiresOn,
          `${kind}.pdf`,
          seededDocumentPdf(tenantId, kind, holderName, expiresOn).length,
          `tenants/${tenantId}/documents/${id}.pdf`
        ]
      );
    }

    // Seeded bookings, confirmed before Stationkeeper existed, with no Kill Bill records.
    const bookingRows: Array<[string, string, string, string, string, string, string, string | null, string]> = [
      ["SK-1001", "lantern-street", "hot-line-1", at(1), "07:00", "11:00", "account", "12800", "Brisket prep for Saturday market"],
      ["SK-1002", "juniper-rye", "cold-prep-a", at(1), "09:00", "13:00", "hour_pack", null, "Canapés for 180 covers"]
    ];
    for (const [holdRef, tenantId, stationId, date, startLocal, endLocal, payWith, amountCents, notes] of bookingRows) {
      const start = clock.localToInstant(date, startLocal as string);
      const end = clock.localToInstant(date, endLocal as string);
      if (start === null || end === null) throw new Error("seed booking instant failed");
      await client.query(
        `INSERT INTO holds (ref, tenant_id, station_id, weeks, expires_at, created_at)
         VALUES ($1,$2,$3,1, now() - interval '1 day', now() - interval '1 day')`,
        [holdRef, tenantId, stationId]
      );
      await client.query(
        `INSERT INTO bookings
         (id, ref, hold_ref, tenant_id, station_id, date, start_local, end_local, start, "end", elapsed_minutes,
          status, pay_with, amount_cents, policy_version, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,1,$14, now() - interval '1 day')`,
        [
          uuid(),
          `${holdRef}-1`,
          holdRef,
          tenantId,
          stationId,
          date,
          startLocal,
          endLocal,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
          (end - start) / 60000,
          payWith,
          amountCents === null ? null : Number(amountCents),
          notes
        ]
      );
    }

    // Hour ledger: Juniper & Rye opening balance and one hour-pack booking debit.
    const sk1002 = await client.query<{ id: string }>("SELECT id FROM bookings WHERE ref = 'SK-1002-1'");
    const bookingId = sk1002.rows[0].id;
    await writeLedgerMovement(client, uuid(), "juniper-rye", 600, "opening_balance", null);
    await writeLedgerMovement(client, uuid(), "juniper-rye", -240, "booking", bookingId);

    await client.query(
      "INSERT INTO seed_state (id, value) VALUES ('seed_document_files_pending', 'true'), ('hold_ref_sequence', '1002')"
    );
  });

  await writeSeededDocumentFiles(db, storage);
  return true;
}

/** Two opposite entries per movement: one on tenant_pack, one on kitchen_hours. */
export async function writeLedgerMovement(
  client: PoolClient,
  movementId: string,
  tenantId: string,
  minutes: number,
  reason: "opening_balance" | "pack_purchase" | "booking" | "cancellation_return" | "fee_refund",
  bookingId: string | null
): Promise<void> {
  await client.query(
    "INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id, created_at) VALUES ($1,$2,$3,'tenant_pack',$4,$5,$6, now())",
    [uuid(), movementId, tenantId, minutes, reason, bookingId]
  );
  await client.query(
    "INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id, created_at) VALUES ($1,$2,$3,'kitchen_hours',$4,$5,$6, now())",
    [uuid(), movementId, tenantId, -minutes, reason, bookingId]
  );
}

/** Small generated PDFs for seeded documents, written to storage as soon as storage is reachable. */
export async function writeSeededDocumentFiles(db: Db, storage: Storage): Promise<void> {
  const docs = await db.query<{ id: string; tenant_id: string; kind: string; holder_name: string | null; expires_on: string }>(
    "SELECT id, tenant_id, kind, holder_name, expires_on::text AS expires_on FROM documents"
  );
  const pending = await db.query<{ value: string }>(
    "SELECT value FROM seed_state WHERE id = 'seed_document_files_pending'"
  );
  if (pending.length === 0 || pending[0].value !== "true") return;
  try {
    for (const doc of docs) {
      const bytes = seededDocumentPdf(doc.tenant_id, doc.kind, doc.holder_name, doc.expires_on);
      await storage.putObject(`tenants/${doc.tenant_id}/documents/${doc.id}.pdf`, bytes, "application/pdf");
    }
    await db.query(
      "UPDATE seed_state SET value = 'false' WHERE id = 'seed_document_files_pending'"
    );
  } catch {
    // Storage unreachable; the sweep retries within one interval of it returning.
  }
}

export function seededDocumentPdf(tenantId: string, kind: string, holderName: string | null, expiresOn: string): Buffer {
  return buildPdf(`Document: ${kind}`, [
    { text: `Tenant: ${tenantId}`, size: 11 },
    { text: `Kind: ${kind}`, size: 11 },
    { text: `Holder: ${holderName ?? "n/a"}`, size: 11 },
    { text: `Expires on: ${expiresOn}`, size: 11 },
    { text: "Seeded compliance document for Larder Row Kitchen.", size: 11 }
  ]);
}
