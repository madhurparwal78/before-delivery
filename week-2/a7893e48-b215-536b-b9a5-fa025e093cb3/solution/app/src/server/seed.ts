import type pg from "pg";
import { hashPassword } from "./auth.js";
import { one, pool } from "./db.js";
import { move } from "./ledger.js";
import { renderPdf } from "./pdf.js";
import { unpaidCutoff } from "./rules.js";
import { documentKey, objectReadable, putObject } from "./s3.js";
import { SCHEMA } from "./schema.js";
import { addDays, elapsedMinutes, localDate, resolveLocal } from "./time.js";

const SEED_PASSWORD = "hearth-demo-2026";

const OPERATORS = [["op-ember", "Ember Row Kitchens"], ["op-cedar", "Cedar Commons"]] as const;

const SITES = [
  { id: "site-halsted", operator: "op-ember", name: "Ember Row — Halsted", zone: "America/Chicago", deposit: 7500, cleaning: 3500, notice: 24, manager: "Odile Marchetti",
    stations: [["st-deck-1", "Deck oven 1", 3800], ["st-deck-2", "Deck oven 2", 3800], ["st-range-a", "Range line A", 3200], ["st-prep-3", "Prep table 3", 2000], ["st-walkin-4", "Walk-in shelf 4", 600]] },
  { id: "site-corktown", operator: "op-ember", name: "Ember Row — Corktown", zone: "America/Detroit", deposit: 7500, cleaning: 3500, notice: 24, manager: "Odile Marchetti",
    stations: [["st-ct-deck", "Deck oven", 3600], ["st-ct-range", "Range line", 3000], ["st-ct-prep", "Prep table", 1800]] },
  { id: "site-fremont", operator: "op-cedar", name: "Cedar Commons — Fremont", zone: "America/Los_Angeles", deposit: 6000, cleaning: 3000, notice: 48, manager: "Wen Hollis",
    stations: [["st-fr-deck", "Deck oven", 4000], ["st-fr-range", "Range line", 3400], ["st-fr-prep", "Prep table", 2200]] },
] as const;

const STAFF = [
  ["us-odile", "odile@emberrow.test", "Odile Marchetti", "manager", "op-ember", null],
  ["us-priya", "desk.halsted@emberrow.test", "Priya Lindqvist", "front_desk", "op-ember", "site-halsted"],
  ["us-marcus", "desk.corktown@emberrow.test", "Marcus Feld", "front_desk", "op-ember", "site-corktown"],
  ["us-wen", "wen@cedarcommons.test", "Wen Hollis", "manager", "op-cedar", null],
  ["us-ada", "desk@cedarcommons.test", "Ada Moreno", "front_desk", "op-cedar", "site-fremont"],
] as const;

type SeedDocument = readonly [kind: "liability" | "food_handler", from: string, to: string, type: "pdf" | "png"];

const RENTERS: readonly { id: string; email: string; name: string; business: string; phone: string; home: string; operator: string; documents: SeedDocument[] }[] = [
  { id: "rn-juniper", email: "tamsin@junipercrumb.test", name: "Tamsin Okoro", business: "Juniper Crumb Bakery", phone: "+1-312-555-0141", home: "site-halsted", operator: "op-ember",
    documents: [["liability", "2026-01-01", "2030-12-31", "pdf"], ["food_handler", "2026-01-01", "2030-06-30", "png"]] },
  { id: "rn-saltbox", email: "rafa@saltboxtacos.test", name: "Rafa Quintero", business: "Saltbox Tacos", phone: "+1-312-555-0172", home: "site-halsted", operator: "op-ember",
    documents: [["liability", "2026-01-01", "2030-12-31", "pdf"], ["food_handler", "2026-01-01", "2030-12-31", "pdf"]] },
  { id: "rn-ledger", email: "june@littleledger.test", name: "June Abernathy", business: "Little Ledger Meal Prep", phone: "+1-313-555-0118", home: "site-corktown", operator: "op-ember",
    documents: [["food_handler", "2026-01-01", "2030-12-31", "pdf"]] },
  { id: "rn-nightjar", email: "ike@nightjarpies.test", name: "Ike Brennan", business: "Nightjar Pies", phone: "+1-312-555-0190", home: "site-halsted", operator: "op-ember",
    documents: [["liability", "2025-02-01", "2026-01-31", "pdf"], ["food_handler", "2026-01-01", "2030-12-31", "pdf"]] },
  { id: "rn-fennel", email: "noor@fennelfig.test", name: "Noor Haddad", business: "Fennel & Fig Catering", phone: "+1-510-555-0133", home: "site-fremont", operator: "op-cedar",
    documents: [["liability", "2026-01-01", "2030-12-31", "pdf"], ["food_handler", "2026-01-01", "2030-12-31", "pdf"]] },
];

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

function seedFile(type: "pdf" | "png", title: string, holder: string, from: string, to: string): Buffer {
  if (type === "png") return PNG_1PX;
  return renderPdf([{ text: title, size: 18, bold: true }, { text: holder, size: 12, gap: 8 }, { text: `Valid ${from} to ${to}`, size: 12 }]);
}

async function seedRecords(client: pg.PoolClient): Promise<void> {
  const now = new Date();
  for (const [id, name] of OPERATORS) await client.query("INSERT INTO operators (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, name]);
  for (const [position, site] of SITES.entries()) {
    await client.query(
      "INSERT INTO sites (id, operator_id, name, time_zone, deposit_cents, cleaning_fee_cents, position) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [site.id, site.operator, site.name, site.zone, site.deposit, site.cleaning, position]);
    for (const [index, [stationId, name, rate]] of site.stations.entries()) {
      await client.query("INSERT INTO stations (id, site_id, name, rate_cents, position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [stationId, site.id, name, rate, index]);
    }
    const effectiveAt = resolveLocal(site.zone, "2026-01-01", "00:00");
    await client.query(
      `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by_name, created_at)
       VALUES ($1,$2,$3,'2026-01-01',$4,$5,$4) ON CONFLICT DO NOTHING`,
      [`pv-seed-${site.id.replace("site-", "")}`, site.id, site.notice, effectiveAt, site.manager]);
  }
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const [id, email, name, role, operator, site] of STAFF) {
    await client.query(
      "INSERT INTO users (id, email, name, role, operator_id, site_id, renter_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7) ON CONFLICT DO NOTHING",
      [id, email, name, role, operator, site, passwordHash]);
  }
  for (const renter of RENTERS) {
    await client.query(
      "INSERT INTO renters (id, operator_id, home_site_id, name, business, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [renter.id, renter.operator, renter.home, renter.name, renter.business, renter.email, renter.phone]);
    await client.query(
      "INSERT INTO users (id, email, name, role, operator_id, site_id, renter_id, password_hash) VALUES ($1,$2,$3,'renter',$4,NULL,$5,$6) ON CONFLICT DO NOTHING",
      [`us-${renter.id}`, renter.email, renter.name, renter.operator, renter.id, passwordHash]);
    for (const [kind, from, to, type] of renter.documents) {
      const body = seedFile(type, kind === "liability" ? "Certificate of liability insurance" : "Food handler card", `${renter.name}, ${renter.business}`, from, to);
      await client.query(
        `INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, uploaded_at, reminder_queued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT DO NOTHING`,
        [`doc-seed-${renter.id.replace("rn-", "")}-${kind.replace("_", "-")}`, renter.id, kind, from, to, type === "pdf" ? "application/pdf" : "image/png", body.length, now]);
    }
  }
  await seedPacksAndBookings(client, now);
}

/** Seeded bookings fall on each site's local date following the day the database was seeded. */
async function seedPacksAndBookings(client: pg.PoolClient, now: Date): Promise<void> {
  const seeded = await one<{ value: string }>(client, "SELECT value FROM meta WHERE key = 'seeded_at'");
  if (seeded) return;
  await client.query("INSERT INTO meta (key, value) VALUES ('seeded_at', $1)", [now.toISOString()]);
  const halsted = SITES[0];
  const fremont = SITES[2];
  const bookings = [
    { id: "bk-seed-juniper-0", renter: "rn-juniper", site: halsted, station: "st-deck-1", date: "2026-10-01", start: "04:00", end: "10:00", status: "settled" },
    { id: "bk-seed-juniper-1", renter: "rn-juniper", site: halsted, station: "st-deck-1", date: addDays(localDate(halsted.zone, now), 1), start: "04:00", end: "08:00", status: "confirmed" },
    { id: "bk-seed-fennel-1", renter: "rn-fennel", site: fremont, station: "st-fr-deck", date: addDays(localDate(fremont.zone, now), 1), start: "05:00", end: "09:00", status: "confirmed" },
  ];
  for (const [renterId, packId] of [["rn-juniper", "pk-seed-juniper"], ["rn-fennel", "pk-seed-fennel"]] as const) {
    await client.query("INSERT INTO packs (id, renter_id, minutes, price_cents, kb_payment_id, created_at) VALUES ($1,$2,1200,56000,NULL,$3)", [packId, renterId, now]);
    await move(client, { renterId, reason: "purchase", minutes: 1200, at: now, packId, movementId: `mv-seed-${packId}` });
  }
  for (const booking of bookings) {
    const startAt = resolveLocal(booking.site.zone, booking.date, booking.start);
    const endAt = resolveLocal(booking.site.zone, booking.date, booking.end);
    const minutes = elapsedMinutes(startAt, endAt);
    const settled = booking.status === "settled";
    await client.query(
      `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes, pack_minutes, card_minutes,
         card_cents, deposit_cents, cutoff_at, policy_version_id, confirmed_at, checked_in_at, checked_out_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $8, 0, 0, 0, $9, $10, $11, $12, $13)`,
      [booking.id, booking.site.id, booking.station, booking.renter, booking.status, startAt, endAt, minutes,
        unpaidCutoff(booking.site.zone, startAt), `pv-seed-${booking.site.id.replace("site-", "")}`, now,
        settled ? startAt : null, settled ? endAt : null]);
    await move(client, { renterId: booking.renter, reason: "reserve", minutes, at: now, bookingId: booking.id, movementId: `mv-seed-${booking.id}-reserve` });
    if (settled) await move(client, { renterId: booking.renter, reason: "use", minutes, at: now, bookingId: booking.id, movementId: `mv-seed-${booking.id}-use` });
    await client.query(
      `INSERT INTO audit_events (booking_id, at, actor_name, actor_role, action, from_status, to_status, reason)
       VALUES ($1, $2, 'System', 'system', 'seed', NULL, $3, NULL)`, [booking.id, now, booking.status]);
  }
}

/** Seeded documents are written to MinIO whenever the object is missing (a fresh bucket). */
async function seedObjects(): Promise<void> {
  for (const renter of RENTERS) {
    for (const [kind, from, to, type] of renter.documents) {
      const key = documentKey(renter.id, `doc-seed-${renter.id.replace("rn-", "")}-${kind.replace("_", "-")}`);
      if (await objectReadable(key)) continue;
      const body = seedFile(type, kind === "liability" ? "Certificate of liability insurance" : "Food handler card", `${renter.name}, ${renter.business}`, from, to);
      await putObject(key, body, type === "pdf" ? "application/pdf" : "image/png");
    }
  }
}

/** Schema and seed, applied idempotently on every serve. */
export async function prepareDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(4173001)");
    await client.query(SCHEMA);
    await client.query("BEGIN");
    await seedRecords(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(4173001)");
    client.release();
  }
  await seedObjects();
}
