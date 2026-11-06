// The seed from the brief, applied idempotently at every start: a later start never adds, re-dates
// or rewrites a seeded record or object. Seed documents are written once, with their kitchen, on the
// first start against an empty database, dated from the first-start date stored then.

import { pool, tx } from "./db.js";
import { hashPassword } from "./auth.js";
import { seedDocumentPdf } from "./documents.js";
import type { DocumentType } from "../shared/format.js";
import { addDays, localDateOf, zonedInstant } from "../shared/time.js";

const PASSWORD = "lineboard-demo";
// brief: Seed data, "Every rate takes effect from 2026-01-01 00:00 kitchen time."
const RATES_FROM_DATE = "2026-01-01";
const RATES_FROM_TIME = "00:00";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

const KITCHENS = [
  { id: "kit_northside", name: "Northside Commissary", slug: "northside", zone: "America/New_York",
    peak: [{ days: WEEKDAYS, start: "16:00", end: "19:00" }, { days: ["sat", "sun"], start: "08:00", end: "13:00" }] },
  { id: "kit_harbor", name: "Harbor Street Kitchen", slug: "harbor-street", zone: "America/Chicago",
    peak: [{ days: WEEKDAYS, start: "15:00", end: "18:00" }] },
];

const PEOPLE: Array<{ id: string; email: string; name: string; role: string; kitchen: string; member?: { id: string; business: string; hours: number } }> = [
  { id: "per_marisol", email: "ops@northside.example", name: "Marisol Vega", role: "operator", kitchen: "kit_northside" },
  { id: "per_theo", email: "lead@northside.example", name: "Theo Lindqvist", role: "shift_lead", kitchen: "kit_northside" },
  { id: "per_ada", email: "ada@bellobakes.example", name: "Ada Bello", role: "member", kitchen: "kit_northside", member: { id: "mem_ada", business: "Bello Bakes", hours: 40 } },
  { id: "per_kofi", email: "kofi@smokestack.example", name: "Kofi Mensah", role: "member", kitchen: "kit_northside", member: { id: "mem_kofi", business: "Smokestack Truck", hours: 20 } },
  { id: "per_rina", email: "rina@satopickle.example", name: "Rina Sato", role: "member", kitchen: "kit_northside", member: { id: "mem_rina", business: "Sato Pickle Co.", hours: 8 } },
  { id: "per_nadia", email: "nadia@okorospice.example", name: "Nadia Okoro", role: "member", kitchen: "kit_northside", member: { id: "mem_nadia", business: "Okoro Spice Kitchen", hours: 12 } },
  { id: "per_jonah", email: "ops@harbor.example", name: "Jonah Pierce", role: "operator", kitchen: "kit_harbor" },
  { id: "per_lena", email: "lead@harbor.example", name: "Lena Cho", role: "shift_lead", kitchen: "kit_harbor" },
  { id: "per_omar", email: "omar@haddadhummus.example", name: "Omar Haddad", role: "member", kitchen: "kit_harbor", member: { id: "mem_omar", business: "Haddad Hummus", hours: 30 } },
];

const STATIONS: Array<[string, string, string, "hourly" | "shelf", number, number, number, number | null]> = [
  ["stn_prep1", "kit_northside", "Prep Station 1", "hourly", 1875, 2610, 0, null],
  ["stn_prep2", "kit_northside", "Prep Station 2", "hourly", 1875, 2610, 0, null],
  ["stn_oven1", "kit_northside", "Oven 1", "hourly", 3750, 5225, 0, null],
  ["stn_oven2", "kit_northside", "Oven 2", "hourly", 3750, 5225, 0, null],
  ["stn_shelfA", "kit_northside", "Walk-in Shelf A", "shelf", 0, 0, 640, 3],
  ["stn_shelfB", "kit_northside", "Walk-in Shelf B", "shelf", 0, 0, 640, 2],
  ["stn_line1", "kit_harbor", "Line 1", "hourly", 2200, 3000, 0, null],
  ["stn_ovenA", "kit_harbor", "Oven A", "hourly", 4000, 5500, 0, null],
  ["stn_shelf1", "kit_harbor", "Walk-in Shelf 1", "shelf", 0, 0, 500, 4],
];

const SEED_FILES: Record<DocumentType, string> = {
  insurance_certificate: "seed-insurance-certificate.pdf",
  food_handler_card: "seed-food-handler-card.pdf",
};

/**
 * Each member's seed documents as [type, expiry in days after the first-start date]: a year for
 * everyone, Rina's card 40 days, and Nadia only an insurance certificate that ran out the day before.
 */
function seedDocuments(memberId: string): Array<[DocumentType, number]> {
  if (memberId === "mem_nadia") return [["insurance_certificate", -1]];
  return (Object.keys(SEED_FILES) as DocumentType[]).map((type) => [type, memberId === "mem_rina" && type === "food_handler_card" ? 40 : 365]);
}

export async function seed(): Promise<void> {
  const { rows: existing } = await pool.query("SELECT email FROM people");
  const known = new Set(existing.map((r) => r.email));
  const hashes = new Map<string, string>();
  for (const p of PEOPLE) if (!known.has(p.email)) hashes.set(p.email, await hashPassword(PASSWORD));
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lineboard:seed'))");
    // The first-start instant and each kitchen's kitchen-local date of it, stored once.
    const startedAt = new Date();
    const fresh = new Set<string>();
    for (const k of KITCHENS) {
      const { rowCount } = await client.query(
        `INSERT INTO kitchens (id, name, slug, time_zone, peak_windows, required_documents, seeded_on, seeded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [k.id, k.name, k.slug, k.zone, JSON.stringify(k.peak), ["insurance_certificate", "food_handler_card"], localDateOf(startedAt.getTime(), k.zone), startedAt],
      );
      if (rowCount) fresh.add(k.id);
    }
    for (const p of PEOPLE) {
      if (p.member) {
        await client.query(
          `INSERT INTO members (id, kitchen_id, name, email, business_name, plan_hours) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [p.member.id, p.kitchen, p.name, p.email, p.member.business, p.member.hours],
        );
      }
      const hash = hashes.get(p.email);
      if (hash) {
        await client.query(
          `INSERT INTO people (id, kitchen_id, email, name, role, password_hash, member_id) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [p.id, p.kitchen, p.email, p.name, p.role, hash, p.member?.id ?? null],
        );
      }
    }
    for (const [i, [id, kitchen, name, kind, off, peak, shelf, capacity]] of STATIONS.entries()) {
      await client.query("INSERT INTO stations (id, kitchen_id, name, kind, capacity, position) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING", [id, kitchen, name, kind, capacity, i]);
      const zone = KITCHENS.find((k) => k.id === kitchen)!.zone;
      await client.query(
        `INSERT INTO rate_versions (station_id, effective_from, effective_at, off_peak_cents, peak_cents, shelf_day_cents)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [id, [RATES_FROM_DATE, RATES_FROM_TIME].join("T"), new Date(zonedInstant(RATES_FROM_DATE, RATES_FROM_TIME, zone)!),
          kind === "hourly" ? off : null, kind === "hourly" ? peak : null, kind === "shelf" ? shelf : null],
      );
    }
    // The 9 seed documents, in the published order (also their listing order), only for a kitchen
    // created by this start; their objects are written by the storage work (storePendingSeedObjects).
    let order = 0;
    for (const p of PEOPLE) {
      if (!p.member) continue;
      const { rows } = await client.query("SELECT seeded_on, seeded_at FROM kitchens WHERE id = $1", [p.kitchen]);
      for (const [type, days] of seedDocuments(p.member.id)) {
        order += 1;
        if (!fresh.has(p.kitchen)) continue;
        const expiry = addDays(rows[0].seeded_on, days);
        const size = seedDocumentPdf(p.name, type, expiry).length;
        await client.query(
          `INSERT INTO documents (id, kitchen_id, member_id, type, expiry_date, file_name, content_type, size_bytes, uploaded_at, approved_at, version, object_stored, seed_order)
           VALUES ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, $8, 2, false, $9) ON CONFLICT (id) DO NOTHING`,
          [`doc_seed_${p.member.id.slice(4)}_${type === "food_handler_card" ? "card" : "insurance"}`, p.kitchen, p.member.id, type, expiry, SEED_FILES[type], size,
            rows[0].seeded_at, order],
        );
      }
    }
  });
}
