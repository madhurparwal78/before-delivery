import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { FINISHES, MODELS, type HubId, type ModelId } from "../shared/catalogue.js";
import { HOUR_MS, istInstant, realNow } from "../shared/clock.js";
import { config } from "./config.js";
import { one, q, tx, type Db } from "./db.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scryptAsync(password, salt, 32)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS change_seq;
CREATE SEQUENCE IF NOT EXISTS wait_seq;
CREATE TABLE IF NOT EXISTS app_clock (id int PRIMARY KEY, base_real_ms bigint NOT NULL, base_app_ms bigint NOT NULL, frozen boolean NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, role text NOT NULL, name text NOT NULL, mobile text NOT NULL UNIQUE, password_hash text,
  hub text, licence_number text, licence_valid_until text, reminders_on boolean NOT NULL DEFAULT false,
  seeded boolean NOT NULL DEFAULT false, n bigserial);
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL, created_ms bigint NOT NULL, expires_ms bigint NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS hub_state (
  hub text PRIMARY KEY, seq bigint NOT NULL DEFAULT 1, sig text NOT NULL DEFAULT '', counting boolean NOT NULL DEFAULT false,
  count_started_ms bigint, stock_as_of_ms bigint NOT NULL, damaged_real_ms bigint);
CREATE TABLE IF NOT EXISTS ledger_status (id int PRIMARY KEY, down boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS stock (hub text NOT NULL, model text NOT NULL, finish text NOT NULL, on_hand int NOT NULL, PRIMARY KEY (hub, model, finish));
CREATE TABLE IF NOT EXISTS earlier_sales (hub text NOT NULL, date text NOT NULL, n int NOT NULL, PRIMARY KEY (hub, date));
CREATE TABLE IF NOT EXISTS locks (
  id text PRIMARY KEY, n bigserial, ref text NOT NULL UNIQUE, rider_id text NOT NULL, hub text NOT NULL, model text NOT NULL, finish text NOT NULL,
  state text NOT NULL, issued_ms bigint NOT NULL, expires_ms bigint, ex_showroom_paise bigint NOT NULL, road_tax_paise bigint NOT NULL,
  insurance_paise bigint NOT NULL, on_road_paise bigint NOT NULL, step_effective_from text NOT NULL, delivery_date text,
  waiting_for text, wait_seq bigint, in_ledger boolean NOT NULL DEFAULT true);
CREATE UNIQUE INDEX IF NOT EXISTS locks_one_active ON locks (rider_id, model) WHERE state IN ('requested','locked','delivery_set');
CREATE INDEX IF NOT EXISTS locks_by_rider ON locks (rider_id);
CREATE INDEX IF NOT EXISTS locks_by_trio ON locks (hub, model, finish);
CREATE INDEX IF NOT EXISTS locks_by_expiry ON locks (expires_ms) WHERE state IN ('requested','locked');
CREATE INDEX IF NOT EXISTS locks_waiting ON locks (hub, waiting_for) WHERE waiting_for IS NOT NULL;
CREATE TABLE IF NOT EXISTS sheets (lock_id text PRIMARY KEY, pdf bytea NOT NULL, created_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS rides (
  id text PRIMARY KEY, n bigserial, rider_id text NOT NULL, hub text NOT NULL, model text NOT NULL, starts_ms bigint NOT NULL,
  state text NOT NULL, moved_from_ms bigint, booked_ms bigint NOT NULL, licence_last4 text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_booked ON rides (rider_id, model) WHERE state = 'booked';
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_slot ON rides (hub, starts_ms) WHERE state IN ('booked','ridden','no_show');
CREATE INDEX IF NOT EXISTS rides_by_rider ON rides (rider_id);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY, n bigserial, kind text NOT NULL, rider_id text NOT NULL, lock_id text, ride_id text, due_ms bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending', sent_ms bigint);
CREATE INDEX IF NOT EXISTS notices_due ON notices (due_ms) WHERE state = 'pending';
CREATE TABLE IF NOT EXISTS rider_ver (rider_id text PRIMARY KEY, ver bigint NOT NULL);
`;

const SEED_CLOCK_MS = istInstant("2026-10-28", "09:00");

type SeedUser = { id: string; role: "rider" | "hub_host"; name: string; mobile: string; hub: HubId | null; licence: string | null; valid: string | null };
const SEED_USERS: SeedUser[] = [
  { id: "cc120664-18a9-41f1-95aa-3affe3861fc9", role: "hub_host", name: "Nandini Rao", mobile: "9000000101", hub: "pune", licence: null, valid: null },
  { id: "eaa28c06-c72c-4ed6-943d-7e13f41e109c", role: "hub_host", name: "Farhan Qureshi", mobile: "9000000102", hub: "bengaluru", licence: null, valid: null },
  { id: "d6c82172-5bb4-4a21-95b2-533ce2dca3f0", role: "hub_host", name: "Simran Gill", mobile: "9000000103", hub: "gurugram", licence: null, valid: null },
  { id: "1bf5b1e2-5f58-428e-9d3e-0666960b42bf", role: "hub_host", name: "Thomas Varghese", mobile: "9000000104", hub: "kochi", licence: null, valid: null },
  { id: "b03b5842-f0b1-4398-814d-1c146347d76b", role: "hub_host", name: "Leela Kamat", mobile: "9000000105", hub: "pune", licence: null, valid: null },
  { id: "01f1038c-63ea-44d8-83ff-d7a5a37fe0a8", role: "rider", name: "Kabir Menon", mobile: "9000000201", hub: null, licence: "MH1220190043210", valid: "2031-03-15" },
  { id: "16c773d9-9275-4848-904c-4dd7fd7a0899", role: "rider", name: "Ira Deshpande", mobile: "9000000202", hub: null, licence: "MH1420210098765", valid: "2026-10-29" },
  { id: "45df4b11-ce97-44c4-850e-e716ab880f86", role: "rider", name: "Tara Joseph", mobile: "9000000203", hub: null, licence: "KL0720180012345", valid: "2030-06-30" },
  { id: "2852396e-883d-4dea-86da-410732cbc3d7", role: "rider", name: "Arjun Bhatt", mobile: "9000000204", hub: null, licence: null, valid: null },
  { id: "5b21bf5b-fa53-4934-9e18-fd42ebc3e896", role: "rider", name: "Meera Pillai", mobile: "9000000205", hub: null, licence: null, valid: null },
];

/** Baseline on-hand counts: Megh 349 (slate, kesar, raat) then Desh 648 (slate, kesar, raat). */
const BASELINE: Readonly<Record<HubId, readonly number[]>> = {
  pune: [3, 1, 0, 2, 0, 1],
  bengaluru: [5, 2, 1, 1, 1, 0],
  gurugram: [2, 0, 4, 0, 2, 2],
  kochi: [1, 1, 1, 3, 1, 0],
};
const baselineRows = (): { hub: HubId; model: ModelId; finish: string; onHand: number }[] =>
  (Object.entries(BASELINE) as [HubId, readonly number[]][]).flatMap(([hub, counts]) =>
    MODELS.flatMap((m, mi) => FINISHES.map((f, fi) => ({ hub, model: m.id, finish: f.id, onHand: counts[mi * 3 + fi] as number }))),
  );

const SEED_RIDES = [
  { id: "e17ca4fc-817f-49b2-8a7c-dcee773ab943", rider: "01f1038c-63ea-44d8-83ff-d7a5a37fe0a8", model: "megh-349", start: istInstant("2026-10-28", "10:00"), last4: "3210" },
  { id: "8a539818-c337-4459-95dc-4cccf67c720d", rider: "16c773d9-9275-4848-904c-4dd7fd7a0899", model: "desh-648", start: istInstant("2026-10-28", "12:15"), last4: "8765" },
];

async function seedPasswords(): Promise<void> {
  for (const u of SEED_USERS) {
    const password = u.role === "hub_host" ? config.hostSeedPassword : config.riderSeedPassword;
    if (!password) continue;
    const row = await one<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id=$1", [u.id]);
    if (row && !(await verifyPassword(password, row.password_hash))) {
      await q("UPDATE users SET password_hash=$2 WHERE id=$1", [u.id, await hashPassword(password)]);
    }
  }
}

async function seedRides(c: Db): Promise<void> {
  for (const r of SEED_RIDES) {
    await q(
      `INSERT INTO rides (id, rider_id, hub, model, starts_ms, state, booked_ms, licence_last4) VALUES ($1,$2,'pune',$3,$4,'booked',$5,$6) ON CONFLICT DO NOTHING`,
      [r.id, r.rider, r.model, r.start, SEED_CLOCK_MS - 24 * HOUR_MS, r.last4],
      c,
    );
  }
}

async function seedStatic(c: Db): Promise<void> {
  for (const u of SEED_USERS) {
    await q(
      `INSERT INTO users (id, role, name, mobile, hub, licence_number, licence_valid_until, seeded) VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT DO NOTHING`,
      [u.id, u.role, u.name, u.mobile, u.hub, u.licence, u.valid],
      c,
    );
  }
  for (const r of baselineRows()) {
    await q("INSERT INTO stock (hub, model, finish, on_hand) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [r.hub, r.model, r.finish, r.onHand], c);
  }
  for (const hub of Object.keys(BASELINE)) {
    await q("INSERT INTO hub_state (hub, stock_as_of_ms) VALUES ($1,$2) ON CONFLICT DO NOTHING", [hub, SEED_CLOCK_MS], c);
  }
  await q("INSERT INTO earlier_sales (hub, date, n) VALUES ('pune','2026-11-06',11) ON CONFLICT DO NOTHING", [], c);
  await q("INSERT INTO app_clock (id, base_real_ms, base_app_ms, frozen) VALUES (1,$1,$2,false) ON CONFLICT DO NOTHING", [realNow(), SEED_CLOCK_MS], c);
  await q("INSERT INTO ledger_status (id, down) VALUES (1,false) ON CONFLICT DO NOTHING", [], c);
  await seedRides(c);
}

/** Creates the schema and the seed data; every step is idempotent and safe when two copies start at once. */
export async function migrate(): Promise<void> {
  await tx(async (c) => {
    await q("SELECT pg_advisory_xact_lock(7731001)", [], c);
    await q(SCHEMA, [], c);
    await seedStatic(c);
  });
  await seedPasswords();
}

/** Restores the seed data and the seeded clock, ends every session and keeps sequence numbers rising. */
export async function resetData(): Promise<void> {
  await tx(async (c) => {
    await q("LOCK TABLE stock, locks, rides, notices, users, sessions, hub_state IN EXCLUSIVE MODE", [], c);
    await q("DELETE FROM sheets", [], c);
    await q("DELETE FROM notices", [], c);
    await q("DELETE FROM locks", [], c);
    await q("DELETE FROM rides", [], c);
    await q("DELETE FROM rider_ver", [], c);
    await q("DELETE FROM sessions", [], c);
    await q("DELETE FROM users WHERE NOT seeded", [], c);
    await q("UPDATE users SET reminders_on=false", [], c);
    for (const u of SEED_USERS) await q("UPDATE users SET licence_number=$2, licence_valid_until=$3 WHERE id=$1", [u.id, u.licence, u.valid], c);
    for (const r of baselineRows()) await q("UPDATE stock SET on_hand=$4 WHERE hub=$1 AND model=$2 AND finish=$3", [r.hub, r.model, r.finish, r.onHand], c);
    await q("UPDATE hub_state SET counting=false, count_started_ms=NULL, damaged_real_ms=NULL, stock_as_of_ms=$1, seq=seq+1, sig=''", [SEED_CLOCK_MS], c);
    await q("UPDATE app_clock SET base_real_ms=$1, base_app_ms=$2, frozen=false WHERE id=1", [realNow(), SEED_CLOCK_MS], c);
    await seedRides(c);
  });
}
