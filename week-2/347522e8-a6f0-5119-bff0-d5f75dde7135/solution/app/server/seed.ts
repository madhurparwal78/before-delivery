// Schema and seed, applied at every start under one advisory lock (several app copies may share a
// database). The seed loads once, when the database has no users.

import { randomUUID } from "node:crypto";
import { DOCUMENT_LABEL, type DocumentKind } from "../shared/documents.js";
import { addDays } from "../shared/kitchenTime.js";
import type { RenterStatus } from "../shared/api.js";
import { iso, kitchenToday, now } from "./clock.js";
import { type Tx, pool } from "./db.js";
import { documentKey } from "./domain/documents.js";
import { lockRenterHours, recordMovement } from "./domain/ledger.js";
import { hashPassword } from "./passwords.js";
import { SCHEMA } from "./schema.js";
import { renderPdf } from "./services/pdf.js";
import { putObject } from "./services/storage.js";

const MIGRATION_LOCK = 72_617_400;
const SEED_PASSWORD = "Railside-demo-26";

const KITCHEN = { name: "Brigade & Bench Commissary", address: "1187 West Larkin Avenue, Chicago, IL 60622" };

const STATIONS = [
  { id: "convection-1", name: "Convection oven 1", weight: 1, offPeak: 50, overageCents: 4800, buffer: 30 },
  { id: "convection-2", name: "Convection oven 2", weight: 1, offPeak: 50, overageCents: 4800, buffer: 30 },
  { id: "deck-oven", name: "Deck oven", weight: 2, offPeak: 50, overageCents: 7200, buffer: 45 },
  { id: "mixer-60", name: "60-quart mixer", weight: 1, offPeak: 100, overageCents: 3000, buffer: 15 },
  { id: "prep-3", name: "Prep table 3", weight: 1, offPeak: 100, overageCents: 2400, buffer: 15 },
];

const STAFF = [
  { name: "Marisol Teague", email: "marisol@brigadebench.example", role: "operator" },
  { name: "Dev Okafor", email: "dev@brigadebench.example", role: "shift_lead" },
] as const;

interface SeedRenter {
  contact: string;
  email: string;
  business: string;
  status: RenterStatus;
  openingMinutes: number;
  coiDays: number;
  cardDays: number;
}

const RENTERS: readonly SeedRenter[] = [
  { contact: "Wren Abernathy", email: "wren@hearthhustle.example", business: "Hearth & Hustle Bakery", status: "active", openingMinutes: 1200, coiDays: 200, cardDays: 300 },
  { contact: "Paz Ochoa", email: "paz@lomaverde.example", business: "Loma Verde Tamales", status: "active", openingMinutes: 480, coiDays: 10, cardDays: 300 },
  { contact: "Jory Kessler", email: "jory@smokesignal.example", business: "Smoke Signal BBQ", status: "active", openingMinutes: 360, coiDays: 0, cardDays: 300 },
  { contact: "Ines Marchetti", email: "ines@fennelstreet.example", business: "Fennel Street Catering", status: "active", openingMinutes: 240, coiDays: -1, cardDays: 300 },
  { contact: "Theo Banerjee", email: "theo@littlecrumb.example", business: "Little Crumb Granola", status: "documents_review", openingMinutes: 0, coiDays: 180, cardDays: 180 },
];

const LICENCE_DAYS = 365;
const SETTINGS_FROM = "2026-01-01";

interface SeededScan {
  key: string;
  pdf: Buffer;
}

function scanPdf(business: string, kind: DocumentKind, expiresOn: string): Buffer {
  return renderPdf([
    { text: business, size: 18, bold: true },
    { text: `Scan of ${DOCUMENT_LABEL[kind]}`, size: 13, gap: 8 },
    { text: `Expires ${expiresOn}`, gap: 8 },
    { text: "Invented record for the Railside demonstration kitchen.", gap: 16 },
  ]);
}

async function seed(tx: Tx): Promise<SeededScan[]> {
  const today = kitchenToday();
  const at = iso(now());
  await tx.query("INSERT INTO kitchen (name, address, seeded_on) VALUES ($1, $2, $3)", [KITCHEN.name, KITCHEN.address, today]);
  for (const [position, station] of STATIONS.entries()) {
    await tx.query("INSERT INTO stations (id, name, position) VALUES ($1, $2, $3)", [station.id, station.name, position]);
    await tx.query(
      `INSERT INTO station_settings (station_id, effective_from, hour_weight, off_peak_percent, overage_cents_per_hour, buffer_minutes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [station.id, SETTINGS_FROM, station.weight, station.offPeak, station.overageCents, station.buffer],
    );
  }
  for (const person of STAFF) {
    await tx.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)", [
      randomUUID(),
      person.email,
      person.name,
      person.role,
      await hashPassword(SEED_PASSWORD),
    ]);
  }
  const scans: SeededScan[] = [];
  for (const renter of RENTERS) {
    const renterId = randomUUID();
    await tx.query(
      "INSERT INTO renters (id, business_name, contact_name, email, phone, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [renterId, renter.business, renter.contact, renter.email, "312-555-0100", renter.status, at],
    );
    await tx.query("INSERT INTO users (id, email, name, role, password_hash, renter_id) VALUES ($1, $2, $3, 'renter', $4, $5)", [
      randomUUID(),
      renter.email,
      renter.contact,
      await hashPassword(SEED_PASSWORD),
      renterId,
    ]);
    const documents: [DocumentKind, number][] = [["coi", renter.coiDays], ["food_handler_card", renter.cardDays], ["business_licence", LICENCE_DAYS]];
    for (const [kind, days] of documents) {
      const id = randomUUID();
      const expiresOn = addDays(today, days);
      const pdf = scanPdf(renter.business, kind, expiresOn);
      const key = documentKey(renterId, id, "pdf");
      await tx.query(
        `INSERT INTO documents (id, renter_id, kind, expires_on, status, original_name, size_bytes, content_type, object_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', $8, $9)`,
        [id, renterId, kind, expiresOn, renter.status === "active" ? "approved" : "pending_review", `${kind.replace(/_/g, "-")}.pdf`, pdf.length, key, at],
      );
      scans.push({ key, pdf });
    }
    if (renter.openingMinutes > 0) {
      await lockRenterHours(tx, renterId);
      await recordMovement(tx, renterId, "opening_balance", renter.openingMinutes, { note: "Opening balance" });
    }
  }
  return scans;
}

/** Applies the schema and, on an empty database, the seed; then writes the seeded scans to storage. */
export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  let scans: SeededScan[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
    const { rowCount } = await client.query("SELECT 1 FROM users LIMIT 1");
    if (!rowCount) {
      await client.query("BEGIN");
      try {
        scans = await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  for (const scan of scans) {
    await putObject(scan.key, scan.pdf, "application/pdf").catch((error: unknown) => console.error(`seed scan ${scan.key} not stored:`, error));
  }
}
