// Idempotent seed rows (brief: Seed data). Re-running after a restart changes nothing.
import type { PoolClient } from "pg";
import { productSeedRows } from "./catalog.ts";
import { hashPassword } from "./passwords.ts";

const STAFF = [
  { email: "staff@ternfoils.com", password: "StaffPass2026", role: "admin" },
  { email: "dealer@ternfoils.com", password: "DealerPass2026", role: "dealer" },
  { email: "support@ternfoils.com", password: "SupportPass2026", role: "support" },
];

const COUNTERS = [
  { name: "order", start: 100001 },
  { name: "callback", start: 10001 },
  { name: "case", start: 50001 },
];

const LOCATIONS = [
  { id: 1, name: "Bayfront Demo Center", city: "San Juan", country: "PR", lat: "18.4655", lon: "-66.1057", timezone: "America/Puerto_Rico" },
  { id: 2, name: "Harbor Point Rentals", city: "Miami", country: "US", lat: "25.7617", lon: "-80.1918", timezone: "America/New_York" },
  { id: 3, name: "Lakeside Foil Club", city: "Austin", country: "US", lat: "30.2672", lon: "-97.7431", timezone: "America/Chicago" },
  { id: 4, name: "North Shore Watersports", city: "Toronto", country: "CA", lat: "43.6532", lon: "-79.3832", timezone: "America/Toronto" },
  { id: 5, name: "Elbe Foil Station", city: "Hamburg", country: "DE", lat: "53.5511", lon: "9.9937", timezone: "Europe/Berlin" },
  { id: 6, name: "Riviera Foil Lab", city: "Nice", country: "FR", lat: "43.7102", lon: "7.2620", timezone: "Europe/Paris" },
  { id: 7, name: "Coastline Demo Hub", city: "Sydney", country: "AU", lat: "-33.8688", lon: "151.2093", timezone: "Australia/Sydney" },
];

const OPENING_HOURS = "Mon-Sun 9:00-17:00";

function slotSeed(): { id: number; location: number; starts: string; ends: string; capacity: number }[] {
  const june = LOCATIONS.flatMap(({ id }) => [
    { id: 3 * id - 2, location: id, starts: "2030-06-15T10:00:00Z", ends: "2030-06-15T12:00:00Z", capacity: 2 },
    { id: 3 * id - 1, location: id, starts: "2030-06-15T11:00:00Z", ends: "2030-06-15T13:00:00Z", capacity: 1 },
    { id: 3 * id, location: id, starts: "2030-06-15T12:00:00Z", ends: "2030-06-15T14:00:00Z", capacity: 3 },
  ]);
  return [
    ...june,
    { id: 22, location: 5, starts: "2030-10-26T08:00:00Z", ends: "2030-10-26T10:00:00Z", capacity: 4 },
    { id: 23, location: 5, starts: "2030-10-27T09:00:00Z", ends: "2030-10-27T11:00:00Z", capacity: 4 },
    { id: 24, location: 2, starts: "2030-11-02T14:00:00Z", ends: "2030-11-02T16:00:00Z", capacity: 4 },
    { id: 25, location: 2, starts: "2030-11-03T15:00:00Z", ends: "2030-11-03T17:00:00Z", capacity: 4 },
  ];
}

const EVENTS = [
  { id: 1, title: "Spring Demo Tour", location: 2, starts: "2030-04-10", ends: "2030-04-12" },
  { id: 2, title: "Euro Demo Days", location: 5, starts: "2030-05-20", ends: "2030-05-22" },
  { id: 3, title: "Island Glide Weekend", location: 1, starts: "2030-07-04", ends: "2030-07-06" },
  { id: 4, title: "Winter Demo (past)", location: 3, starts: "2020-01-13", ends: "2020-01-15" },
];

export async function seed(client: PoolClient): Promise<void> {
  for (const [position, p] of productSeedRows().entries()) {
    await client.query(
      `INSERT INTO products (sku, kind, position, name, price_cents, details, stock, seeded_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (sku) DO UPDATE SET details = EXCLUDED.details`,
      [p.sku, p.kind, position, p.name, p.price_cents, JSON.stringify(p.details), p.stock],
    );
  }
  for (const s of STAFF) {
    const exists = await client.query("SELECT 1 FROM users WHERE email = $1", [s.email]);
    if (exists.rowCount) continue;
    await client.query(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT (email) DO NOTHING",
      [s.email, await hashPassword(s.password), s.role],
    );
  }
  for (const c of COUNTERS) {
    await client.query("INSERT INTO counters (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [c.name, c.start - 1]);
  }
  for (const l of LOCATIONS) {
    await client.query(
      `INSERT INTO locations (id, name, city, country, lat, lon, timezone, opening_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [l.id, l.name, l.city, l.country, l.lat, l.lon, l.timezone, OPENING_HOURS],
    );
  }
  for (const s of slotSeed()) {
    await client.query(
      "INSERT INTO slots (id, location_id, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
      [s.id, s.location, s.starts, s.ends, s.capacity],
    );
  }
  await client.query("SELECT setval('slots_id_seq', GREATEST((SELECT max(id) FROM slots), 25))");
  for (const e of EVENTS) {
    await client.query(
      "INSERT INTO events (id, title, location_id, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
      [e.id, e.title, e.location, e.starts, e.ends],
    );
  }
}
