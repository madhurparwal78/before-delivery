// Schema and the one idempotent seed (brief: Seed data). "Seed day" is kitchen today when an empty
// database is first filled; seeded dates are written relative to it.
import { randomUUID } from "node:crypto";
import { KIND_LABELS, KITCHEN_NAME, TIME_ZONE, type DocumentKind } from "../shared/kitchen";
import { addDays, kitchenInstant, kitchenParts } from "../shared/time";
import { audit, lockFor, one, transaction, type Db, type Queryable } from "./db";
import { recordMovement } from "./ledger";
import { hashPassword } from "./passwords";
import { renderPdf } from "./pdf";
import type { DocumentRow } from "./records";
import { stationTimeCents } from "./rules";
import { applySchema } from "./schema";

const SEED_PASSWORD = "kitchen-demo-2026";
/** Kitchen sales tax 8.25%, in basis points. */
const TAX_RATE_BASIS_POINTS = 825;

const TENANTS = [
  { id: "juniper-rye", name: "Juniper & Rye Catering", lifecycle: "active" },
  { id: "lantern-street", name: "Lantern Street Tacos", lifecycle: "active" },
  { id: "saltgrass-pies", name: "Saltgrass Pies", lifecycle: "active" },
  { id: "fennel-ferment", name: "Fennel Ferment Co.", lifecycle: "applied" },
];

const USERS = [
  { email: "operator@larderrow.test", name: "Dana Whitcomb", role: "operator", tenant: null },
  { email: "owner@juniperrye.test", name: "Imani Brooks", role: "owner", tenant: "juniper-rye" },
  { email: "cook@juniperrye.test", name: "Priya Castellanos", role: "cook", tenant: "juniper-rye" },
  { email: "owner@lanterntacos.test", name: "Rafael Quintero", role: "owner", tenant: "lantern-street" },
  { email: "cook@lanterntacos.test", name: "Teo Abernathy", role: "cook", tenant: "lantern-street" },
  { email: "owner@saltgrasspies.test", name: "Hollis Grant", role: "owner", tenant: "saltgrass-pies" },
  { email: "owner@fennelferment.test", name: "June Okafor", role: "owner", tenant: "fennel-ferment" },
];

const STATIONS = [
  { id: "hot-line-1", name: "Hot Line 1", kind: "hot_line", rate: 3200 },
  { id: "hot-line-2", name: "Hot Line 2", kind: "hot_line", rate: 3200 },
  { id: "bake-deck", name: "Bake Deck", kind: "bake_deck", rate: 2800 },
  { id: "cold-prep-a", name: "Cold-Prep Bench A", kind: "cold_prep", rate: 1800 },
  { id: "cold-prep-b", name: "Cold-Prep Bench B", kind: "cold_prep", rate: 1800 },
];

const SHELVES = [
  { id: "W-1", tenant: "juniper-rye" },
  { id: "W-2", tenant: "lantern-street" },
  { id: "W-3", tenant: null },
  { id: "W-4", tenant: null },
];

const PACKS = [
  { id: "10h", name: "10-hour pack", minutes: 600, price: 29000 },
  { id: "25h", name: "25-hour pack", minutes: 1500, price: 68750 },
];

/** Approved documents as days from seed day. */
const DOCUMENTS: { tenant: string; kind: DocumentKind; days: number; holder: string | null }[] = [
  { tenant: "juniper-rye", kind: "certificate_of_insurance", days: 200, holder: null },
  { tenant: "juniper-rye", kind: "health_permit", days: 300, holder: null },
  { tenant: "juniper-rye", kind: "food_handler_card", days: 400, holder: "Priya Castellanos" },
  { tenant: "lantern-street", kind: "certificate_of_insurance", days: 250, holder: null },
  { tenant: "lantern-street", kind: "health_permit", days: 180, holder: null },
  { tenant: "lantern-street", kind: "food_handler_card", days: 20, holder: "Teo Abernathy" },
  { tenant: "saltgrass-pies", kind: "certificate_of_insurance", days: -2, holder: null },
  { tenant: "saltgrass-pies", kind: "health_permit", days: 150, holder: null },
  { tenant: "saltgrass-pies", kind: "food_handler_card", days: 90, holder: "Hollis Grant" },
];

const BOOKINGS = [
  { hold: "SK-1001", tenant: "lantern-street", station: "hot-line-1", start: 7 * 60, end: 11 * 60, pay: "account", notes: "Brisket prep for Saturday market" },
  { hold: "SK-1002", tenant: "juniper-rye", station: "cold-prep-a", start: 9 * 60, end: 13 * 60, pay: "hour_pack", notes: "Canapés for 180 covers" },
] as const;

/** The small generated PDF that stands in for a seeded document's scan. */
export async function seededDocumentFile(db: Queryable, doc: Pick<DocumentRow, "id" | "tenant_id" | "kind" | "holder_name" | "expires_on">): Promise<Buffer> {
  const tenant = (await one<{ business_name: string }>(db, "SELECT business_name FROM tenants WHERE id = $1", [doc.tenant_id])) as { business_name: string };
  return renderPdf([
    { text: KIND_LABELS[doc.kind], x: 56, y: 720, size: 20, bold: true },
    { text: tenant.business_name, x: 56, y: 690, size: 12 },
    ...(doc.holder_name ? [{ text: `Name on card: ${doc.holder_name}`, x: 56, y: 672, size: 12 }] : []),
    { text: `Expires ${doc.expires_on}`, x: 56, y: 654, size: 12 },
    { text: `On file at ${KITCHEN_NAME}. Document ${doc.id}`, x: 56, y: 620, size: 9 },
  ]);
}

async function seed(db: Db, nowMs: number): Promise<void> {
  const seedDay = kitchenParts(nowMs).date;
  const now = new Date(nowMs);
  await db.query("INSERT INTO kitchen (id, name, time_zone, tax_rate_basis_points, seed_day, seeded_at) VALUES (1, $1, $2, $3, $4, $5)", [
    KITCHEN_NAME,
    TIME_ZONE,
    TAX_RATE_BASIS_POINTS,
    seedDay,
    now,
  ]);
  for (const t of TENANTS) await db.query("INSERT INTO tenants (id, business_name, lifecycle) VALUES ($1, $2, $3)", [t.id, t.name, t.lifecycle]);
  for (const u of USERS) {
    await db.query("INSERT INTO users (id, email, name, role, tenant_id, password_hash) VALUES ($1, $2, $3, $4, $5, $6)", [
      randomUUID(),
      u.email,
      u.name,
      u.role,
      u.tenant,
      await hashPassword(SEED_PASSWORD),
    ]);
  }
  for (const [i, s] of STATIONS.entries()) {
    await db.query("INSERT INTO stations (id, name, kind, hourly_rate_cents, position) VALUES ($1, $2, $3, $4, $5)", [s.id, s.name, s.kind, s.rate, i]);
  }
  for (const [i, s] of SHELVES.entries()) {
    await db.query("INSERT INTO shelves (id, name, monthly_rate_cents, tenant_id, position) VALUES ($1, $2, 4500, $3, $4)", [s.id, `Walk-in shelf ${s.id}`, s.tenant, i]);
  }
  for (const [i, p] of PACKS.entries()) {
    await db.query("INSERT INTO hour_packs (id, name, minutes, price_cents, position) VALUES ($1, $2, $3, $4, $5)", [p.id, p.name, p.minutes, p.price, i]);
  }
  await db.query("INSERT INTO policy_versions (version, free_window_hours, late_fee_percent, effective_at) VALUES (1, 48, 50, $1)", [now]);
  for (const d of DOCUMENTS) {
    const id = randomUUID();
    const expiresOn = addDays(seedDay, d.days);
    const file = await seededDocumentFile(db, { id, tenant_id: d.tenant, kind: d.kind, holder_name: d.holder, expires_on: expiresOn });
    await db.query(
      `INSERT INTO documents (id, tenant_id, kind, holder_name, expires_on, status, file_name, content_type, size_bytes, storage_key, file_pending, uploaded_at, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, 'application/pdf', $7, $8, true, $9, $9)`,
      [id, d.tenant, d.kind, d.holder, expiresOn, `${d.kind.replace(/_/g, "-")}.pdf`, file.length, `tenants/${d.tenant}/documents/${id}.pdf`, now],
    );
  }
  const bookingDay = addDays(seedDay, 1);
  const seeded: Record<string, { id: string; elapsed: number }> = {};
  for (const b of BOOKINGS) {
    await db.query("INSERT INTO holds (ref, tenant_id, station_id, weeks, created_at, expires_at, confirmed_at) VALUES ($1, $2, $3, 1, $4, $4, $4)", [b.hold, b.tenant, b.station, now]);
    const start = new Date(kitchenInstant(bookingDay, b.start) as number);
    const end = new Date(kitchenInstant(bookingDay, b.end) as number);
    const rate = STATIONS.find((s) => s.id === b.station)?.rate as number;
    const id = randomUUID();
    const elapsed = (end.getTime() - start.getTime()) / 60_000;
    seeded[b.hold] = { id, elapsed };
    await db.query(
      `INSERT INTO bookings (id, ref, hold_ref, tenant_id, station_id, date, start_minute, end_minute, start_at, end_at, status, pay_with, amount_cents, policy_version, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', $11, $12, 1, $13, $14)`,
      [
        id,
        `${b.hold}-1`,
        b.hold,
        b.tenant,
        b.station,
        bookingDay,
        b.start,
        b.end,
        start,
        end,
        b.pay,
        b.pay === "account" ? stationTimeCents(elapsed, rate) : null,
        b.notes,
        now,
      ],
    );
  }
  await recordMovement(db, "juniper-rye", 600, "opening_balance", null, now);
  await recordMovement(db, "juniper-rye", -seeded["SK-1002"].elapsed, "booking", seeded["SK-1002"].id, now);
  await audit(db, null, "kitchen", "1", "seeded", { seed_day: seedDay });
}

/** Applies the schema and seeds an empty database, one process at a time. */
export async function prepareDatabase(nowMs: number): Promise<void> {
  await transaction(async (db) => {
    await lockFor(db, "schema");
    await applySchema(db);
    if (!(await one(db, "SELECT 1 FROM kitchen WHERE id = 1"))) await seed(db, nowMs);
  });
}
