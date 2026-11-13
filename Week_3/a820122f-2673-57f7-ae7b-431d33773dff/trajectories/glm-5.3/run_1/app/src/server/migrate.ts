import { pool, query } from "./db.js";
import { hashPasscode } from "./passcode.js";

/**
 * Applies the schema and seed data at every start. Idempotent: existing
 * objects are left alone, changed rows are never overwritten.
 */
export async function migrateAndSeed(): Promise<void> {
  await ensureSchema();
  await seed();
}

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS owners (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      passcode_hash text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vessels (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES owners(id),
      name text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('workboat','survey_boat','coaster','charter_yacht')),
      initial_offset_minutes integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crew (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      name text NOT NULL,
      rank text NOT NULL,
      email text NOT NULL UNIQUE,
      passcode_hash text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fixes (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      at_utc text NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      UNIQUE (vessel_id, at_utc)
    );
    CREATE TABLE IF NOT EXISTS clock_changes (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      changes_at_utc text NOT NULL,
      old_offset_minutes integer NOT NULL,
      new_offset_minutes integer NOT NULL,
      fix_id text REFERENCES fixes(id)
    );
    CREATE TABLE IF NOT EXISTS rota_watches (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      crew_id text NOT NULL REFERENCES crew(id),
      label text NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      from_date text NOT NULL,
      to_date text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rule_sets (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      rule_set text NOT NULL CHECK (rule_set IN ('flag_exception')),
      effective_from_utc text NOT NULL,
      effective_until_utc text NOT NULL,
      flag_reference text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watch_entries (
      id text PRIMARY KEY,
      crew_id text NOT NULL REFERENCES crew(id),
      entry_key text NOT NULL,
      start_utc text NOT NULL,
      end_utc text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('rest','work')),
      ship_date text NOT NULL,
      late boolean NOT NULL DEFAULT false,
      applied boolean NOT NULL DEFAULT true,
      received_at_utc text NOT NULL,
      applied_order bigint NOT NULL,
      UNIQUE (crew_id, entry_key)
    );
    CREATE INDEX IF NOT EXISTS watch_entries_time_idx ON watch_entries (crew_id, start_utc);
    CREATE TABLE IF NOT EXISTS day_states (
      crew_id text NOT NULL REFERENCES crew(id),
      ship_date text NOT NULL,
      state text NOT NULL CHECK (state IN ('open','closed','signed','countersigned')),
      signed_at_utc text,
      countersigned_at_utc text,
      PRIMARY KEY (crew_id, ship_date)
    );
    CREATE TABLE IF NOT EXISTS notes (
      id text PRIMARY KEY,
      crew_id text NOT NULL REFERENCES crew(id),
      ship_date text NOT NULL,
      text text NOT NULL,
      event_id text,
      author_role text NOT NULL CHECK (author_role IN ('owner_master','crew')),
      created_at_utc text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      crew_id text NOT NULL REFERENCES crew(id),
      kind text NOT NULL CHECK (kind IN ('drill','call_out')),
      start_utc text NOT NULL,
      end_utc text NOT NULL,
      description text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS breaches (
      id text PRIMARY KEY,
      crew_id text NOT NULL REFERENCES crew(id),
      rule text NOT NULL,
      window_hours integer NOT NULL CHECK (window_hours IN (24,168)),
      window_start_utc text NOT NULL,
      window_end_utc text NOT NULL,
      rule_set text NOT NULL CHECK (rule_set IN ('standard','flag_exception')),
      rest_hours double precision NOT NULL,
      recorded_at_utc text NOT NULL,
      UNIQUE (crew_id, rule, window_hours, window_start_utc)
    );
    CREATE TABLE IF NOT EXISTS months (
      crew_id text NOT NULL REFERENCES crew(id),
      month text NOT NULL,
      state text NOT NULL CHECK (state IN ('open','awaiting_archive','sealed')),
      label text,
      record_key text,
      record_sha256 text,
      copy_key text,
      sealed_at_utc text,
      PRIMARY KEY (crew_id, month)
    );
    CREATE TABLE IF NOT EXISTS inspection_links (
      id text PRIMARY KEY,
      vessel_id text NOT NULL REFERENCES vessels(id),
      token text UNIQUE NOT NULL,
      from_date text NOT NULL,
      to_date text NOT NULL,
      expires_at_utc text NOT NULL,
      state text NOT NULL CHECK (state IN ('active','expired','revoked'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      person_id text NOT NULL,
      role text NOT NULL CHECK (role IN ('owner_master','crew')),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS watch_entries_crew_idx ON watch_entries (crew_id, ship_date);
    CREATE OR REPLACE FUNCTION offset_at(p_crew text, p_at timestamptz) RETURNS integer
    LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(
        (SELECT cc.new_offset_minutes FROM clock_changes cc
          JOIN crew c ON c.id = p_crew
          WHERE cc.vessel_id = c.vessel_id AND cc.changes_at_utc::timestamptz <= p_at
          ORDER BY cc.changes_at_utc DESC LIMIT 1),
        (SELECT v.initial_offset_minutes FROM vessels v JOIN crew c ON c.id = p_crew WHERE v.id = c.vessel_id))
    $fn$;
    CREATE OR REPLACE FUNCTION ship_date_of(p_crew text, p_at text) RETURNS text
    LANGUAGE sql STABLE AS $fn$
      SELECT to_char(p_at::timestamptz + offset_at(p_crew, p_at::timestamptz) * interval '1 minute', 'YYYY-MM-DD')
    $fn$;

    CREATE INDEX IF NOT EXISTS watch_entries_applied_idx ON watch_entries (crew_id, applied, applied_order);
  `);
}

interface SeedPerson { id: string; name: string; email: string; passcode: string; rank?: string; vesselId?: string }
interface SeedVessel { id: string; name: string; kind: "workboat" | "survey_boat" | "coaster" | "charter_yacht"; initialOffset: number; ownerId: string }
interface SeedClockChange { vesselId: string; at: string; fromOffset: number; toOffset: number }
interface SeedFix { vesselId: string; at: string; lat: number; lng: number }

const seedOwners: SeedPerson[] = [
  { id: "owner-ailsa", name: "Ailsa Tregenna", email: "ailsa@tidewrack.example", passcode: "fathom-ailsa-2741" },
  { id: "owner-bram", name: "Bram Okafor", email: "bram@skerry.example", passcode: "fathom-bram-8830" },
];

const seedVessels: SeedVessel[] = [
  { id: "vessel-surveyor", name: "Tidewrack Surveyor", kind: "survey_boat", initialOffset: 0, ownerId: "owner-ailsa" },
  { id: "vessel-kittiwake", name: "Kittiwake", kind: "workboat", initialOffset: 60, ownerId: "owner-ailsa" },
  { id: "vessel-skerry-lass", name: "Skerry Lass", kind: "coaster", initialOffset: 0, ownerId: "owner-bram" },
];

const seedCrew: SeedPerson[] = [
  { id: "crew-ines", name: "Ines Duarte", email: "ines@tidewrack.example", passcode: "watch-ines-1192", rank: "Mate", vesselId: "vessel-surveyor" },
  { id: "crew-tomas", name: "Tomas Berg", email: "tomas@tidewrack.example", passcode: "watch-tomas-3365", rank: "Engineer", vesselId: "vessel-surveyor" },
  { id: "crew-petra", name: "Petra Vance", email: "petra@tidewrack.example", passcode: "watch-petra-5507", rank: "Deckhand", vesselId: "vessel-surveyor" },
  { id: "crew-jonah", name: "Jonah Reyes", email: "jonah@tidewrack.example", passcode: "watch-jonah-7741", rank: "Deckhand", vesselId: "vessel-kittiwake" },
  { id: "crew-noor", name: "Noor Haddad", email: "noor@skerry.example", passcode: "watch-noor-9014", rank: "Mate", vesselId: "vessel-skerry-lass" },
];

const seedClockChanges: SeedClockChange[] = [
  { vesselId: "vessel-surveyor", at: "2026-09-10T02:00:00Z", fromOffset: 0, toOffset: -60 },
  { vesselId: "vessel-surveyor", at: "2026-09-16T03:00:00Z", fromOffset: -60, toOffset: 0 },
];

const seedFixes: SeedFix[] = [
  { vesselId: "vessel-surveyor", at: "2026-09-07T00:00:00Z", lat: 50.10, lng: -5.00 },
  { vesselId: "vessel-surveyor", at: "2026-09-10T02:00:00Z", lat: 49.00, lng: -12.00 },
  { vesselId: "vessel-surveyor", at: "2026-09-13T12:00:00Z", lat: 47.00, lng: -16.00 },
  { vesselId: "vessel-surveyor", at: "2026-09-16T03:00:00Z", lat: 48.00, lng: -8.00 },
  { vesselId: "vessel-surveyor", at: "2026-09-21T00:00:00Z", lat: 50.10, lng: -5.00 },
];

/** Seed: from 2026-09-07T00:00:00Z to 2026-09-21T00:00:00Z. */
const SEED_LOG_START = Date.parse("2026-09-07T00:00:00Z");
const SEED_LOG_END = Date.parse("2026-09-21T00:00:00Z");
const HALF = 30 * 60 * 1000;

/** crew-ines: work 00-04, rest 04-12, work 12-16, rest 16-24; 2026-09-12 work 00-20, rest 20-24. */
function inesKindOf(utcMs: number): "rest" | "work" {
  const day = new Date(utcMs).toISOString().slice(0, 10);
  if (day === "2026-09-12") {
    const minutes = new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes();
    return minutes >= 20 * 60 ? "rest" : "work";
  }
  const minutes = new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes();
  if (minutes >= 0 && minutes < 4 * 60) return "work";
  if (minutes >= 4 * 60 && minutes < 12 * 60) return "rest";
  if (minutes >= 12 * 60 && minutes < 16 * 60) return "work";
  return "rest";
}

/** crew-tomas: work 00-06:30, rest 06:30-12:00, work 12:00-18:30, rest 18:30-24:00. */
function tomasKindOf(utcMs: number): "rest" | "work" {
  const minutes = new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes();
  if (minutes < 6 * 60 + 30) return "work";
  if (minutes < 12 * 60) return "rest";
  if (minutes < 18 * 60 + 30) return "work";
  return "rest";
}

/** crew-petra: work 00-14, rest 14-24. */
function petraKindOf(utcMs: number): "rest" | "work" {
  const minutes = new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes();
  return minutes < 14 * 60 ? "work" : "rest";
}

async function seed(): Promise<void> {
  for (const owner of seedOwners) {
    await upsertOwner(owner);
  }
  for (const vessel of seedVessels) {
    await query(`INSERT INTO vessels (id, owner_id, name, kind, initial_offset_minutes) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO NOTHING`, [vessel.id, vessel.ownerId, vessel.name, vessel.kind, vessel.initialOffset]);
  }
  for (const crew of seedCrew) {
    if (!crew.vesselId || !crew.rank) continue;
    await query(`INSERT INTO crew (id, vessel_id, name, rank, email, passcode_hash) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING`, [crew.id, crew.vesselId, crew.name, crew.rank, crew.email, hashPasscode(crew.passcode)]);
  }
  for (const fix of seedFixes) {
    await query(`INSERT INTO fixes (id, vessel_id, at_utc, latitude, longitude) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (vessel_id, at_utc) DO NOTHING`,
      [`fix-${fix.vesselId}-${fix.at}`, fix.vesselId, fix.at, fix.lat, fix.lng]);
  }
  for (const change of seedClockChanges) {
    const fix = seedFixes.find((f) => f.vesselId === change.vesselId && f.at === change.at);
    await query(`INSERT INTO clock_changes (id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [`change-${change.at}`, change.vesselId, change.at, change.fromOffset, change.toOffset,
        fix ? `fix-${change.vesselId}-${change.at}` : null]);
  }
  await query(`INSERT INTO rule_sets (id, vessel_id, rule_set, effective_from_utc, effective_until_utc, flag_reference)
    VALUES ('ruleset-flag-2026-117','vessel-surveyor','flag_exception','2026-09-16T00:00:00Z','2026-09-22T00:00:00Z','Flag dispensation 2026-117')
    ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO rota_watches (id, vessel_id, crew_id, label, start_time, end_time, from_date, to_date)
    VALUES ('rota-ines-morning','vessel-surveyor','crew-ines','Morning watch','00:00','04:00','2026-09-07','2026-09-20')
    ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO events (id, vessel_id, crew_id, kind, start_utc, end_utc, description)
    VALUES ('event-callout-ines','vessel-surveyor','crew-ines','call_out','2026-09-08T05:00:00Z','2026-09-08T06:00:00Z','Anchor watch call-out')
    ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO notes (id, crew_id, ship_date, text, event_id, author_role, created_at_utc)
    VALUES ('note-ailsa-0911','crew-ines','2026-09-11','Deck log shows the survey line finished at 18:00.',null,'owner_master','2026-09-25T09:00:00Z')
    ON CONFLICT (id) DO NOTHING`);

  await seedLoggedHours();
  await seedSignatures();
}

async function upsertOwner(owner: SeedPerson): Promise<void> {
  await query(`INSERT INTO owners (id, name, email, passcode_hash) VALUES ($1,$2,$3,$4)
    ON CONFLICT (id) DO NOTHING`, [owner.id, owner.name, owner.email, hashPasscode(owner.passcode)]);
}

async function seedLoggedHours(): Promise<void> {
  const existing = await query<{ n: string }>(`SELECT count(*)::text AS n FROM watch_entries WHERE entry_key LIKE 'seed-%'`);
  if (Number(existing[0]?.n ?? 0) > 0) return;
  let order = 0;
  for (const crewId of ["crew-ines", "crew-tomas", "crew-petra"]) {
    const kindOf = crewId === "crew-ines" ? inesKindOf : crewId === "crew-tomas" ? tomasKindOf : petraKindOf;
    const flat: unknown[] = [];
    const tuples: string[] = [];
    let inChunk = 0;
    for (let t = SEED_LOG_START; t < SEED_LOG_END; t += HALF) {
      const utc = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
      const end = new Date(t + HALF).toISOString().replace(/\.\d{3}Z$/, "Z");
      const base = inChunk * 6;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
      flat.push(`seed-${crewId}-${t}`, crewId, utc, end, kindOf(t), ++order);
      inChunk++;
      if (inChunk === 200) {
        await insertSeedEntries(tuples, flat);
        tuples.length = 0;
        flat.length = 0;
        inChunk = 0;
      }
    }
    if (inChunk > 0) await insertSeedEntries(tuples, flat);
  }
}

async function insertSeedEntries(tuples: string[], flat: unknown[]): Promise<void> {
  await pool.query(`
    INSERT INTO watch_entries (id, entry_key, crew_id, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc, applied_order)
    SELECT v.k, v.k, v.crew, v.s, v.e, v.kd, ship_date_of(v.crew, v.s), false, true, '2026-09-21T00:00:00Z', v.o::bigint
    FROM (VALUES ${tuples.join(",")}) AS v(k, crew, s, e, kd, o)
    ON CONFLICT (crew_id, entry_key) DO NOTHING
  `, flat);
}

async function seedSignatures(): Promise<void> {
  // ship_date values are on vessel-surveyor whose offset timeline gives these dates:
  // entries run 2026-09-07..2026-09-20 in ship's days (offset 0 then -60 then 0).
  // We compute ship dates from the timeline to stay correct.
  const dayRows: { crew_id: string; ship_date: string }[] = [];
  for (const crewId of ["crew-tomas", "crew-ines", "crew-petra"]) {
    const dates = new Set<string>();
    for (let t = SEED_LOG_START; t < SEED_LOG_END; t += HALF) {
      dates.add(shipDateOfSeedInstant(t));
    }
    for (const shipDate of [...dates].sort()) dayRows.push({ crew_id: crewId, ship_date: shipDate });
  }
  for (const row of dayRows) {
    const isTomas = row.crew_id === "crew-tomas";
    const isInes = row.crew_id === "crew-ines";
    const inesUnsigned = isInes && row.ship_date === "2026-09-20";
    const state = isTomas ? "countersigned" : isInes ? (inesUnsigned ? "closed" : "countersigned") : "closed";
    const signed = state === "countersigned";
    await pool.query(`INSERT INTO day_states (crew_id, ship_date, state, signed_at_utc, countersigned_at_utc)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (crew_id, ship_date) DO NOTHING`,
      [row.crew_id, row.ship_date, state,
        signed ? "2026-09-25T10:00:00Z" : null,
        state === "countersigned" ? "2026-09-25T11:00:00Z" : null]);
  }
}

function shipDateOfSeedInstant(ms: number): string {
  // vessel-surveyor offsets: 0 until 2026-09-10T02:00Z, -60 until 2026-09-16T03:00Z, then 0.
  const retard = Date.parse("2026-09-10T02:00:00Z");
  const advance = Date.parse("2026-09-16T03:00:00Z");
  let offset = 0;
  if (ms >= retard && ms < advance) offset = -60;
  return new Date(ms + offset * 60000).toISOString().slice(0, 10);
}
