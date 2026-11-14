import pg from "pg";
import type { Config } from "./config";
import { INDUSTRY_SEED, PRICE_SEED, PROJECT_SEED, QUESTION_SEED, SERVICE_SEED, STUDIO_SEED, WORLD_SEED } from "./seed/catalog-seed";
import { neighboursOf } from "../shared/gallery";
import type { Catalog, Project, Service, Studio, World } from "../shared/types";
import { yawOf } from "../shared/stage-rules";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS industries (id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS services (id text PRIMARY KEY, name text NOT NULL, purpose text NOT NULL, deliverables jsonb NOT NULL, steps jsonb NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  slug text PRIMARY KEY, name text NOT NULL, position integer NOT NULL, industry_id text NOT NULL REFERENCES industries(id),
  service_ids text[] NOT NULL, ground text NOT NULL, ink text NOT NULL, accent text NOT NULL, display_face text NOT NULL,
  body_face text NOT NULL, sections jsonb NOT NULL, captions text[] NOT NULL, deliverables jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS worlds (slug text PRIMARY KEY REFERENCES projects(slug), position integer NOT NULL, summary text NOT NULL, overview text NOT NULL, decisions jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS price_items (id text PRIMARY KEY, position integer NOT NULL, category text NOT NULL REFERENCES services(id), name text NOT NULL, type text NOT NULL, price_text text NOT NULL, delivery text NOT NULL, revisions text NOT NULL, inclusions jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS questions (id text PRIMARY KEY, position integer NOT NULL, question text NOT NULL, answer jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS studio_content (principles jsonb NOT NULL, people jsonb NOT NULL, stages jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS enquiries (
  sequence integer PRIMARY KEY, reference text NOT NULL UNIQUE, submission_id text NOT NULL, name text NOT NULL, email text NOT NULL,
  business_name text NOT NULL, service text NOT NULL, budget text NOT NULL, description text NOT NULL, item text,
  intake_state text NOT NULL, intake_reference text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS enquiries_email_created ON enquiries (lower(email), created_at);
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_submission_id ON enquiries (lower(submission_id));
`;

/** Advisory lock keys: one for the starting content, one for storing enquiries in order. */
export const LOCKS = { seed: 4173001, enquiry: 4173002 };

export type Db = pg.Pool;

export function connect(config: Config): Db {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000, max: 10 });
  pool.on("error", () => undefined);
  return pool;
}

/** Applies the schema and stores the starting content once, however many instances start together. */
export async function prepare(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCKS.seed]);
    await client.query(SCHEMA);
    const { rows } = await client.query<{ count: string }>("SELECT count(*) FROM projects");
    if (Number(rows[0]?.count) === 0) await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seed(client: pg.PoolClient): Promise<void> {
  for (const [position, industry] of INDUSTRY_SEED.entries()) {
    await client.query("INSERT INTO industries (id, name, position) VALUES ($1, $2, $3)", [industry.id, industry.name, position]);
  }
  for (const [position, service] of SERVICE_SEED.entries()) {
    await client.query("INSERT INTO services (id, name, purpose, deliverables, steps, position) VALUES ($1, $2, $3, $4, $5, $6)", [
      service.id, service.name, service.purpose, JSON.stringify(service.deliverables), JSON.stringify(service.steps), position,
    ]);
  }
  for (const [position, project] of PROJECT_SEED.entries()) {
    const world = WORLD_SEED.find((candidate) => candidate.slug === project.slug);
    const deliverables = world?.deliverables ?? (project.deliverables as string[]);
    const sections = { brief: project.brief, strategy: project.strategy, identity: project.identity, digital_design: project.digital, implementation: project.implementation };
    await client.query(
      "INSERT INTO projects (slug, name, position, industry_id, service_ids, ground, ink, accent, display_face, body_face, sections, captions, deliverables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Figtree',$10,$11,$12)",
      [project.slug, project.name, position, project.industry, project.services, project.ground, project.ink, project.accent, project.face, JSON.stringify(sections), project.captions, JSON.stringify(deliverables)],
    );
  }
  for (const [position, world] of WORLD_SEED.entries()) {
    await client.query("INSERT INTO worlds (slug, position, summary, overview, decisions) VALUES ($1, $2, $3, $4, $5)", [
      world.slug, position, world.summary, world.overview, JSON.stringify(world.decisions),
    ]);
  }
  for (const [position, item] of PRICE_SEED.entries()) {
    await client.query("INSERT INTO price_items (id, position, category, name, type, price_text, delivery, revisions, inclusions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      item.id, position, item.category, item.name, item.type, item.price_text, item.delivery, item.revisions, JSON.stringify(item.inclusions),
    ]);
  }
  for (const [position, question] of QUESTION_SEED.entries()) {
    await client.query("INSERT INTO questions (id, position, question, answer) VALUES ($1, $2, $3, $4)", [question.id, position, question.question, JSON.stringify(question.answer)]);
  }
  await client.query("INSERT INTO studio_content (principles, people, stages) VALUES ($1, $2, $3)", [
    JSON.stringify(STUDIO_SEED.principles), JSON.stringify(STUDIO_SEED.people), JSON.stringify(STUDIO_SEED.stages),
  ]);
}

interface ProjectRow {
  slug: string; name: string; industry_id: string; service_ids: string[]; ground: string; ink: string; accent: string;
  display_face: string; body_face: string; sections: Project["sections"]; captions: string[]; deliverables: string[];
}

/** Reads the published content: the catalog is rebuilt from Postgres on every request, so nothing drifts. */
export async function loadCatalog(db: Db): Promise<Catalog> {
  const [industries, services, projects, worlds, prices, questions, studio] = await Promise.all([
    db.query<{ id: string; name: string }>("SELECT id, name FROM industries ORDER BY position"),
    db.query<Service>("SELECT id, name, purpose, deliverables, steps FROM services ORDER BY position"),
    db.query<ProjectRow>("SELECT slug, name, industry_id, service_ids, ground, ink, accent, display_face, body_face, sections, captions, deliverables FROM projects ORDER BY position"),
    db.query<{ slug: string; summary: string; overview: string; decisions: World["decisions"] }>("SELECT slug, summary, overview, decisions FROM worlds ORDER BY position"),
    db.query<Catalog["prices"][number]>("SELECT id, category, name, type, price_text, delivery, revisions, inclusions FROM price_items ORDER BY position"),
    db.query<Catalog["questions"][number]>("SELECT id, question, answer FROM questions ORDER BY position"),
    db.query<Studio>("SELECT principles, people, stages FROM studio_content"),
  ]);
  const industryName = new Map(industries.rows.map((row) => [row.id, row.name]));
  const projectList: Project[] = projects.rows.map((row) => {
    const worldAt = worlds.rows.findIndex((world) => world.slug === row.slug);
    return {
      slug: row.slug,
      name: row.name,
      industry_id: row.industry_id,
      industry: industryName.get(row.industry_id) as string,
      services: services.rows.map((service) => service.id).filter((id) => row.service_ids.includes(id)),
      world_slug: worldAt >= 0 ? row.slug : null,
      colours: { ground: `#${row.ground}`, ink: `#${row.ink}`, accent: `#${row.accent}` },
      display_face: row.display_face,
      body_face: row.body_face,
      sections: row.sections,
      gallery: row.captions.map((caption, at) => ({ n: at + 1, caption, src: `/media/${row.slug}/${at + 1}.svg` })),
      deliverables: row.deliverables,
    };
  });
  const worldList: World[] = worlds.rows.map((row, at) => {
    const project = projectList.find((candidate) => candidate.slug === row.slug) as Project;
    return {
      slug: row.slug, name: project.name, index: at + 1, industry_id: project.industry_id, industry: project.industry, services: project.services,
      summary: row.summary, overview: row.overview, decisions: row.decisions, colours: project.colours, display_face: project.display_face,
      deliverables: project.deliverables, yaw: yawOf(at + 1),
    };
  });
  return { industries: industries.rows, services: services.rows, projects: projectList, worlds: worldList, prices: prices.rows, questions: questions.rows, studio: studio.rows[0] as Studio };
}

export function projectDetail(catalog: Catalog, slug: string) {
  const project = catalog.projects.find((candidate) => candidate.slug === slug);
  return project ? { ...project, ...neighboursOf(catalog.projects, slug) } : undefined;
}
