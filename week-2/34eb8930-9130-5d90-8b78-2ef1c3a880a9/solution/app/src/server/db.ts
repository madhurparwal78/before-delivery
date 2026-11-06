import pg from "pg";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import type { BlockStyle } from "../shared/types.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on("error", () => { /* an idle client dropped; the next query reconnects */ });

type Queryable = pg.Pool | pg.PoolClient;

export async function rows<T>(sql: string, params: unknown[] = [], on: Queryable = pool): Promise<T[]> {
  return (await on.query(sql, params)).rows as T[];
}

export async function one<T>(sql: string, params: unknown[] = [], on: Queryable = pool): Promise<T | undefined> {
  return (await rows<T>(sql, params, on))[0];
}

export async function transaction<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await work(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const newId = (): string => randomBytes(15).toString("base64url");

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const got = scryptSync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(hash, "hex"));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL, colour text NOT NULL,
  password_hash text NOT NULL, is_consultant boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  id text PRIMARY KEY, title text NOT NULL, client text NOT NULL, owner_id text NOT NULL REFERENCES people(id),
  revision integer NOT NULL, saved_revision integer NOT NULL DEFAULT 0, save_failed boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY, proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id), role text NOT NULL, ends_at timestamptz, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (proposal_id, person_id));
CREATE TABLE IF NOT EXISTS ops (
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, revision integer NOT NULL,
  author_id text NOT NULL, kind text NOT NULL, mode text NOT NULL, ops jsonb NOT NULL, created jsonb NOT NULL,
  closed jsonb NOT NULL, effects jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, revision));
CREATE TABLE IF NOT EXISTS suggestions (
  id text PRIMARY KEY, proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES people(id), kind text NOT NULL, inserted jsonb, deleted jsonb,
  content_deleted boolean NOT NULL DEFAULT false, status text NOT NULL, created_at timestamptz NOT NULL,
  decided_by text REFERENCES people(id), decided_at timestamptz);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY, proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  parent_id text REFERENCES comments(id) ON DELETE CASCADE, author_id text NOT NULL REFERENCES people(id),
  body text NOT NULL, mentions jsonb NOT NULL DEFAULT '[]', anchor jsonb, content_deleted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS modes (
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id),
  mode text NOT NULL, PRIMARY KEY (proposal_id, person_id));
CREATE TABLE IF NOT EXISTS recent (
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id),
  joined_at timestamptz NOT NULL, PRIMARY KEY (proposal_id, person_id));
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id),
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, kind text NOT NULL,
  actor_id text NOT NULL REFERENCES people(id), role text, comment_id text, text text NOT NULL,
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS presence (
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, person_id text NOT NULL REFERENCES people(id),
  state text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (proposal_id, person_id));
CREATE INDEX IF NOT EXISTS notices_person ON notices (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shares_person ON shares (person_id);
`;

const PASSWORD = "quillmere-demo-2026";

const SEED_PEOPLE = [
  { name: "Ines Calloway", email: "ines@quillmere.test", colour: "#1F5A48", consultant: true },
  { name: "Tomas Reyes", email: "tomas@riverbend-literacy.test", colour: "#7A2E63", consultant: false },
  { name: "Dana Whitfield", email: "dana@riverbend-literacy.test", colour: "#3F5A8A", consultant: false },
  { name: "Priya Nandakumar", email: "priya@peer-review.test", colour: "#7A5000", consultant: false },
  { name: "Lena Ostrowski", email: "lena@harborstreet-pantry.test", colour: "#A2461C", consultant: false },
  { name: "Sam Adeyemi", email: "sam@peer-review.test", colour: "#3B3C9A", consultant: false },
  { name: "Jordan Pike", email: "jordan@peer-review.test", colour: "#A3216F", consultant: false },
] as const;

interface SeedProposal {
  id: string;
  title: string;
  client: string;
  shares: [string, "editor" | "commenter" | "viewer"][];
  blocks: [BlockStyle, string][];
}

export const SEED_PROPOSALS: SeedProposal[] = [
  {
    id: "riverbend-reading-nights",
    title: "Family Reading Nights — Foundation Proposal",
    client: "Riverbend Literacy Project",
    shares: [["tomas@riverbend-literacy.test", "editor"], ["dana@riverbend-literacy.test", "viewer"], ["priya@peer-review.test", "commenter"]],
    blocks: [
      ["title", "Family Reading Nights"],
      ["heading1", "Statement of Need"],
      ["paragraph", "In the Riverbend school district, 41 percent of third graders read below grade level. Families tell us they want to read with their children but rarely have books at home or a quiet evening space."],
      ["heading1", "Program Design"],
      ["paragraph", "Each month we host four Family Reading Nights at two branch libraries. Every family leaves with two new books and a short guide for reading aloud in English and Spanish."],
      ["heading1", "Evaluation Plan"],
      ["paragraph", "We will track attendance at every session and survey families in October and May."],
      ["heading1", "Budget Justification"],
      ["paragraph", "Books for 240 families cost $9,600 for the year. Facilitator stipends total $7,200."],
    ],
  },
  {
    id: "riverbend-budget-fy27",
    title: "Budget Justification FY2027",
    client: "Riverbend Literacy Project",
    shares: [["tomas@riverbend-literacy.test", "editor"], ["dana@riverbend-literacy.test", "viewer"]],
    blocks: [
      ["title", "Budget Justification FY2027"],
      ["heading1", "Personnel"],
      ["paragraph", "A part-time program coordinator at 20 hours a week costs $26,000 including benefits."],
      ["heading1", "Supplies"],
      ["paragraph", "Books and reading guides cost $9,600."],
      ["heading2", "Notes for the finance office"],
      ["paragraph", "Coordinator hours match the program calendar. Book costs match the vendor quote."],
    ],
  },
  {
    id: "harbor-cold-storage",
    title: "Cold Storage Expansion — Federal Application",
    client: "Harbor Street Food Pantry",
    shares: [["lena@harborstreet-pantry.test", "editor"], ["sam@peer-review.test", "commenter"]],
    blocks: [
      ["title", "Cold Storage Expansion"],
      ["heading1", "Project Summary"],
      ["paragraph", "Harbor Street Food Pantry requests $148,000 to install a walk-in cooler and freezer so we can accept fresh produce donations year round."],
      ["heading1", "Budget Justification"],
      ["paragraph", "Equipment and installation total $121,500. Electrical upgrades total $26,500."],
    ],
  },
  {
    id: "harbor-volunteer-renewal",
    title: "Volunteer Program Renewal",
    client: "Harbor Street Food Pantry",
    shares: [],
    blocks: [["title", "Volunteer Program Renewal"], ["paragraph", "Draft outline to follow."]],
  },
];

const SEED_SUGGESTION = { id: "sg-seed-1", proposal: "riverbend-reading-nights", author: "tomas@riverbend-literacy.test", inserted: { at: 397, length: 23 } };
const SEED_COMMENT = {
  id: "cm-seed-1", proposal: "riverbend-reading-nights", author: "priya@peer-review.test", anchor: { at: 484, length: 34 },
  body: "Could the survey also ask how many books each family already has at home?",
};

/** Schema and seed, applied on every serve; existing rows are never overwritten. */
export async function migrateAndSeed(): Promise<void> {
  await pool.query(SCHEMA);
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(4173)");
    for (const p of SEED_PEOPLE) {
      await c.query(
        "INSERT INTO people (id, email, display_name, colour, password_hash, is_consultant) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING",
        [newId(), p.email, p.name, p.colour, hashPassword(PASSWORD), p.consultant],
      );
    }
    const ids = new Map((await rows<{ id: string; email: string }>("SELECT id, email FROM people", [], c)).map((r) => [r.email, r.id]));
    const owner = ids.get("ines@quillmere.test");
    for (const d of SEED_PROPOSALS) {
      const made = await c.query(
        "INSERT INTO proposals (id, title, client, owner_id, revision, saved_revision, is_seed) VALUES ($1,$2,$3,$4,1,0,true) ON CONFLICT (id) DO NOTHING",
        [d.id, d.title, d.client, owner],
      );
      if (!made.rowCount) continue;
      for (const [email, role] of d.shares) {
        await c.query("INSERT INTO shares (id, proposal_id, person_id, role, ends_at, status) VALUES ($1,$2,$3,$4,NULL,'active')",
          [newId(), d.id, ids.get(email), role]);
      }
      if (d.id === SEED_SUGGESTION.proposal) {
        await c.query("INSERT INTO suggestions (id, proposal_id, author_id, kind, inserted, deleted, status, created_at) VALUES ($1,$2,$3,'insert',$4,NULL,'open',now())",
          [SEED_SUGGESTION.id, d.id, ids.get(SEED_SUGGESTION.author), JSON.stringify(SEED_SUGGESTION.inserted)]);
        await c.query("INSERT INTO comments (id, proposal_id, author_id, body, mentions, anchor, status) VALUES ($1,$2,$3,$4,'[]',$5,'open')",
          [SEED_COMMENT.id, d.id, ids.get(SEED_COMMENT.author), SEED_COMMENT.body, JSON.stringify(SEED_COMMENT.anchor)]);
      }
    }
    await c.query("DELETE FROM presence");
  });
}
