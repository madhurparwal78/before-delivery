import pg from "pg";
import { seedContent } from "./seed.js";
import type { Content, PriceType } from "../shared/types.js";

const SCHEMA_LOCK = 7_340_221;
const RETRY_MS = 2000;

const schema = `
CREATE TABLE IF NOT EXISTS industries (
  id text PRIMARY KEY,
  position integer NOT NULL,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id text PRIMARY KEY,
  position integer NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  deliverables jsonb NOT NULL,
  steps jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  slug text PRIMARY KEY,
  position integer NOT NULL,
  name text NOT NULL,
  industry_id text NOT NULL REFERENCES industries (id),
  services jsonb NOT NULL,
  colours jsonb NOT NULL,
  display_face text NOT NULL,
  body_face text NOT NULL,
  sections jsonb NOT NULL,
  captions jsonb NOT NULL,
  deliverables jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS worlds (
  slug text PRIMARY KEY REFERENCES projects (slug),
  ring_index integer NOT NULL UNIQUE,
  summary text NOT NULL,
  overview text NOT NULL,
  decisions jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS price_items (
  id text PRIMARY KEY,
  position integer NOT NULL,
  category text NOT NULL REFERENCES services (id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('fixed', 'custom')),
  price_text text NOT NULL,
  delivery text NOT NULL,
  revisions text NOT NULL,
  inclusions jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  position integer NOT NULL,
  question text NOT NULL,
  answer jsonb NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS enquiry_reference_seq;
CREATE TABLE IF NOT EXISTS enquiries (
  reference text PRIMARY KEY,
  submission_id text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  business_name text NOT NULL,
  service text NOT NULL,
  budget text NOT NULL,
  description text NOT NULL,
  item text,
  intake_state text NOT NULL CHECK (intake_state IN ('pending', 'sent', 'failed')),
  intake_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enquiries_email_created ON enquiries (lower(email), created_at);
`;

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3000 });
  pool.on("error", () => console.log("A Postgres connection was lost."));
  return pool;
}

async function seed(client: pg.PoolClient): Promise<void> {
  const c = seedContent;
  for (const [i, x] of c.industries.entries())
    await client.query("INSERT INTO industries (id, position, name) VALUES ($1, $2, $3)", [x.id, i + 1, x.name]);
  for (const [i, s] of c.services.entries())
    await client.query(
      "INSERT INTO services (id, position, name, purpose, deliverables, steps) VALUES ($1, $2, $3, $4, $5, $6)",
      [s.id, i + 1, s.name, s.purpose, JSON.stringify(s.deliverables), JSON.stringify(s.steps)],
    );
  for (const [i, p] of c.projects.entries()) {
    await client.query(
      `INSERT INTO projects (slug, position, name, industry_id, services, colours, display_face, body_face, sections, captions, deliverables)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        p.slug,
        i + 1,
        p.name,
        p.industry_id,
        JSON.stringify(p.services),
        JSON.stringify(p.colours),
        p.display_face,
        p.body_face,
        JSON.stringify(p.sections),
        JSON.stringify(p.captions),
        JSON.stringify(p.deliverables),
      ],
    );
    if (p.world !== null)
      await client.query("INSERT INTO worlds (slug, ring_index, summary, overview, decisions) VALUES ($1, $2, $3, $4, $5)", [
        p.slug,
        p.world.index,
        p.world.summary,
        p.world.overview,
        JSON.stringify(p.world.decisions),
      ]);
  }
  for (const [i, x] of c.prices.entries())
    await client.query(
      `INSERT INTO price_items (id, position, category, name, type, price_text, delivery, revisions, inclusions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [x.id, i + 1, x.category, x.name, x.type, x.price_text, x.delivery, x.revisions, JSON.stringify(x.inclusions)],
    );
  for (const [i, q] of c.questions.entries())
    await client.query("INSERT INTO questions (id, position, question, answer) VALUES ($1, $2, $3, $4)", [
      q.id,
      i + 1,
      q.question,
      JSON.stringify(q.answer),
    ]);
}

async function prepare(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await client.query(schema);
    const { rows } = await client.query<{ count: string }>("SELECT count(*) AS count FROM projects");
    if (rows[0].count === "0") await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadContent(pool: pg.Pool): Promise<Content> {
  const industries = await pool.query<{ id: string; name: string }>("SELECT id, name FROM industries ORDER BY position");
  const services = await pool.query("SELECT id, name, purpose, deliverables, steps FROM services ORDER BY position");
  const projects = await pool.query(
    `SELECT p.slug, p.name, p.industry_id, p.services, p.colours, p.display_face, p.body_face, p.sections, p.captions, p.deliverables,
            w.ring_index, w.summary, w.overview, w.decisions
       FROM projects p LEFT JOIN worlds w ON w.slug = p.slug
      ORDER BY p.position`,
  );
  const prices = await pool.query(
    "SELECT id, category, name, type, price_text, delivery, revisions, inclusions FROM price_items ORDER BY position",
  );
  const questions = await pool.query("SELECT id, question, answer FROM questions ORDER BY position");
  return {
    industries: industries.rows,
    services: services.rows,
    projects: projects.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      industry_id: r.industry_id,
      services: r.services,
      colours: { ground: r.colours.ground, ink: r.colours.ink, accent: r.colours.accent },
      display_face: r.display_face,
      body_face: r.body_face,
      sections: {
        brief: r.sections.brief,
        strategy: r.sections.strategy,
        identity: r.sections.identity,
        digital_design: r.sections.digital_design,
        implementation: r.sections.implementation,
      },
      captions: r.captions,
      deliverables: r.deliverables,
      world:
        r.ring_index === null
          ? null
          : { index: r.ring_index, summary: r.summary, overview: r.overview, decisions: r.decisions },
    })),
    prices: prices.rows.map((r) => ({ ...r, type: r.type as PriceType })),
    questions: questions.rows,
  };
}

/** Applies the schema, stores the starting content when empty and loads it, retrying until Postgres answers. */
export async function connectContent(pool: pg.Pool): Promise<Content> {
  for (;;) {
    try {
      await prepare(pool);
      return await loadContent(pool);
    } catch {
      console.log("Postgres unavailable; retrying.");
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

export async function databaseAnswers(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
