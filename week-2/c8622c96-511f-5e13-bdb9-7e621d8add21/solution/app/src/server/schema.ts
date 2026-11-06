// Schema and seed data, applied idempotently on every serve under an advisory lock so that several
// instances sharing one database never race. Seed imagery is written to storage separately (seed-media.ts).
import type pg from "pg";
import { resolveWall } from "../shared/coop-time.js";
import { hashPassword } from "./passwords.js";

const DDL = `
CREATE TABLE IF NOT EXISTS newsrooms (
  slug text PRIMARY KEY, name text NOT NULL, home_zone text NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('contributor','picture_editor','licensing_manager','desk_editor','treasurer')),
  newsroom text REFERENCES newsrooms(slug), handle text UNIQUE, payout_account text, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_clock (id int PRIMARY KEY CHECK (id = 1), offset_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS essays (
  id text PRIMARY KEY, version int NOT NULL, title text NOT NULL, caption text NOT NULL,
  lift_local text NOT NULL, lift_at timestamptz NOT NULL, lift_resolution text NOT NULL,
  exclusive_days int NOT NULL, standard_days int NOT NULL,
  exclusive_price_minor int NOT NULL, standard_price_minor int NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','in_review','embargoed','live','withdrawn','taken_down')),
  withdrawal_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, submitted_at timestamptz, takedown_reference text,
  frame_seq int NOT NULL DEFAULT 0, storage_purge_pending boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS credits (
  essay_id text NOT NULL REFERENCES essays(id), position int NOT NULL, handle text NOT NULL REFERENCES people(handle),
  split_bp int NOT NULL CHECK (split_bp BETWEEN 1 AND 10000), PRIMARY KEY (essay_id, position), UNIQUE (essay_id, handle));
CREATE TABLE IF NOT EXISTS frames (
  id text PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), position int NOT NULL, caption text NOT NULL,
  filename text NOT NULL, bytes int NOT NULL, type text NOT NULL, width int NOT NULL, height int NOT NULL,
  UNIQUE (essay_id, position) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE IF NOT EXISTS desk_notes (
  id bigserial PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), note text NOT NULL, at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS follows (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id), essay_id text REFERENCES essays(id),
  contributor text REFERENCES people(handle), created_at timestamptz NOT NULL,
  CHECK ((essay_id IS NULL) <> (contributor IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS follows_one_essay ON follows(person_id, essay_id) WHERE essay_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follows_one_contributor ON follows(person_id, contributor) WHERE contributor IS NOT NULL;
CREATE TABLE IF NOT EXISTS shortlist_items (
  id text PRIMARY KEY, newsroom text NOT NULL REFERENCES newsrooms(slug), frame_id text NOT NULL REFERENCES frames(id),
  added_by text NOT NULL REFERENCES people(id), added_at timestamptz NOT NULL, UNIQUE (newsroom, frame_id));
CREATE TABLE IF NOT EXISTS commission_rates (effective_from date PRIMARY KEY, rate_bp int NOT NULL);
CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY, essay_id text NOT NULL REFERENCES essays(id), newsroom text NOT NULL REFERENCES newsrooms(slug),
  licensed_by text NOT NULL REFERENCES people(id), kind text NOT NULL CHECK (kind IN ('exclusive','standard')),
  status text NOT NULL CHECK (status IN ('pending','active','expired','removed','revoked')),
  confirmed_at timestamptz NOT NULL, window_end timestamptz NOT NULL, hold_until timestamptz NOT NULL,
  amount_minor int NOT NULL, rate_bp int NOT NULL, invoice_raised boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0, attempt_started_at timestamptz, warning_queued boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS licences_one_exclusive_per_essay
  ON licences(essay_id) WHERE kind = 'exclusive' AND status IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS licences_one_per_newsroom_per_essay
  ON licences(essay_id, newsroom) WHERE status IN ('pending','active');
CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL REFERENCES people(id), key text NOT NULL, essay_id text NOT NULL, kind text NOT NULL,
  status int, body jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (person_id, key));
CREATE TABLE IF NOT EXISTS statements (month text PRIMARY KEY, body jsonb NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS payouts (
  month text NOT NULL REFERENCES statements(month), handle text NOT NULL, amount_minor int NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','recorded')), PRIMARY KEY (month, handle));
CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('alert','receipt','warning','takedown')),
  essay_id text, licence_id text, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sent','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz);
CREATE INDEX IF NOT EXISTS mail_queue_queued ON mail_queue(id) WHERE state = 'queued';
`;

const SEED_PASSWORD = "darkroom-proof-26";
const START_CLOCK = Date.parse("2026-10-28T12:00:00Z");

const NEWSROOMS: [string, string, string][] = [
  ["harbor-light", "Harbor Light Herald", "America/New_York"],
  ["mesa-sentinel", "Mesa Daily Sentinel", "America/Phoenix"],
  ["thames-post", "Thames Evening Post", "Europe/London"],
];

type SeedPerson = [id: string, name: string, email: string, role: string, newsroom: string | null,
  handle: string | null, payoutAccount: string | null];

const PEOPLE: SeedPerson[] = [
  ["ines", "Ines Okafor-Lund", "ines@saltprint.example", "desk_editor", null, null, null],
  ["bram", "Bram Kettleworth", "bram@saltprint.example", "treasurer", null, null, null],
  ["ada", "Ada Reyes", "ada@contributors.saltprint.example", "contributor", null, "ada-reyes",
    "Ozark Teachers Credit Union ••4417"],
  ["tomas", "Tomas Whitcombe", "tomas@contributors.saltprint.example", "contributor", null, "tomas-whitcombe",
    "Prairie Mutual Savings ••0932"],
  ["noor", "Noor Haddad", "noor@contributors.saltprint.example", "contributor", null, "noor-haddad",
    "Gulfside Community Bank ••2268"],
  ["priya", "Priya Lowell", "priya@harbor-light.example", "picture_editor", "harbor-light", null, null],
  ["dev", "Dev Marsh", "dev@harbor-light.example", "picture_editor", "harbor-light", null, null],
  ["june", "June Castellanos", "june@harbor-light.example", "licensing_manager", "harbor-light", null, null],
  ["wes", "Wes Tallbridge", "wes@mesa-sentinel.example", "picture_editor", "mesa-sentinel", null, null],
  ["carmen", "Carmen Oduya", "carmen@mesa-sentinel.example", "licensing_manager", "mesa-sentinel", null, null],
  ["hollis", "Hollis Brandt", "hollis@thames-post.example", "picture_editor", "thames-post", null, null],
  ["margot", "Margot Fenwick", "margot@thames-post.example", "licensing_manager", "thames-post", null, null],
];

interface SeedEssay {
  id: string;
  title: string;
  caption: string;
  credits: [string, number][];
  state: string;
  liftLocal: string;
  exclusive: [number, number];
  standard: [number, number];
  frames: number;
}

export const SEED_ESSAYS: SeedEssay[] = [
  { id: "floodplain-ledger", title: "Floodplain Ledger", caption: "Six months on the levee road after the spring crest.",
    credits: [["ada-reyes", 6000], ["noor-haddad", 4000]], state: "live", liftLocal: "2026-10-20T09:00",
    exclusive: [3, 45000], standard: [7, 12000], frames: 6 },
  { id: "night-shift-grain", title: "Night Shift at the Grain Elevator",
    caption: "Harvest crews working the overnight load-out.", credits: [["tomas-whitcombe", 10000]],
    state: "embargoed", liftLocal: "2026-11-01T01:30", exclusive: [2, 30000], standard: [5, 9000], frames: 4 },
  { id: "salt-marsh-census", title: "Salt Marsh Census", caption: "Volunteers counting nesting rails at dawn.",
    credits: [["ada-reyes", 5000], ["tomas-whitcombe", 3333], ["noor-haddad", 1667]], state: "live",
    liftLocal: "2026-10-12T07:00", exclusive: [1, 25000], standard: [3, 8000], frames: 5 },
  { id: "border-choir", title: "Border Choir", caption: "A church choir that rehearses on both banks.",
    credits: [["noor-haddad", 10000]], state: "in_review", liftLocal: "2026-11-05T07:00",
    exclusive: [2, 20000], standard: [7, 6000], frames: 3 },
  { id: "river-series-draft", title: "Untitled river series", caption: "", credits: [["ada-reyes", 10000]],
    state: "draft", liftLocal: "2026-11-20T08:00", exclusive: [3, 15000], standard: [7, 5000], frames: 2 },
];

export const SEED_FRAME_SIZE = { width: 1600, height: 1200 };

export async function applySchema(client: pg.PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(417301)");
    await client.query(DDL);
    const seeded = await client.query("SELECT 1 FROM people LIMIT 1");
    if (seeded.rowCount === 0) await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function seed(client: pg.PoolClient): Promise<void> {
  await client.query(
    "INSERT INTO app_clock (id, offset_ms) VALUES (1, $1::bigint - (extract(epoch FROM clock_timestamp()) * 1000)::bigint)",
    [START_CLOCK],
  );
  for (const [slug, name, zone] of NEWSROOMS) {
    await client.query("INSERT INTO newsrooms (slug, name, home_zone) VALUES ($1, $2, $3)", [slug, name, zone]);
  }
  for (const [id, name, email, role, newsroom, handle, payout] of PEOPLE) {
    await client.query(
      `INSERT INTO people (id, name, email, role, newsroom, handle, payout_account, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, email, role, newsroom, handle, payout, await hashPassword(SEED_PASSWORD)],
    );
  }
  await client.query("INSERT INTO commission_rates (effective_from, rate_bp) VALUES ('2026-01-01', 3000)");
  const created = new Date("2026-10-01T15:00:00Z");
  for (const essay of SEED_ESSAYS) {
    const lift = resolveWall(essay.liftLocal);
    if (!lift) throw new Error(`seed lift ${essay.liftLocal} does not resolve`);
    await client.query(
      `INSERT INTO essays (id, version, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, created_at, submitted_at, frame_seq)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [essay.id, essay.title, essay.caption, essay.liftLocal, lift.at, lift.resolution, essay.exclusive[0],
        essay.standard[0], essay.exclusive[1], essay.standard[1], essay.state, created,
        essay.state === "draft" ? null : created, essay.frames],
    );
    for (const [index, [handle, split]] of essay.credits.entries()) {
      await client.query("INSERT INTO credits (essay_id, position, handle, split_bp) VALUES ($1, $2, $3, $4)",
        [essay.id, index + 1, handle, split]);
    }
    for (let n = 1; n <= essay.frames; n += 1) {
      await client.query(
        `INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
         VALUES ($1, $2, $3, $4, $5, 0, 'image/jpeg', $6, $7)`,
        [`${essay.id}-f${n}`, essay.id, n, `${essay.title}, frame ${n}`, `${essay.id}-f${n}.jpg`,
          SEED_FRAME_SIZE.width, SEED_FRAME_SIZE.height],
      );
    }
  }
  await client.query("INSERT INTO desk_notes (essay_id, note, at) VALUES ('floodplain-ledger', $1, $2)",
    ["Family on frame 4 gave consent by phone; keep this off newsroom copy.", new Date("2026-10-19T16:20:00Z")]);
}
