import pg from "pg";
import type { Content, ContentRecord, Interview, InterviewDetail, InterviewLink, Product, Scenario } from "../shared/content.js";
import { modeOf, scenarioPosition, type ScenarioId } from "../shared/scenarios.js";
import { STARTING_CONTENT } from "./seed.js";

/** A scenario as stored: its mode is the prefix of its id, so it is derived when read. */
type StoredScenario = Omit<Scenario, "mode">;

interface StoredRow {
  edition: number;
  product: Product;
  interviews: Interview[];
  scenarios: StoredScenario[];
}

const FIRST_EDITION = 1;
/** An arbitrary advisory-lock key that serialises start-up migrations of several copies of the site. */
const MIGRATION_LOCK_KEY = 20261107;
const RETRY_MS = 1000;

function linkTo(interview: Interview): InterviewLink {
  return { slug: interview.slug, name: interview.name };
}

function withMode(scenario: StoredScenario): Scenario {
  const { id, name, title, time, copy, moment } = scenario;
  return { id, mode: modeOf(id), name, title, time, copy, moment };
}

/** Scenarios are stored in the published scenario order, whatever order the grading body used. */
function recordParameters(record: ContentRecord): [string, string, string] {
  const ordered = record.scenarios
    .map(({ mode, ...stored }) => stored)
    .sort((a, b) => scenarioPosition(a.id) - scenarioPosition(b.id));
  return [JSON.stringify(record.product), JSON.stringify(record.interviews), JSON.stringify(ordered)];
}

/** The one published content record, kept in a single Postgres row. */
export class ContentStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    this.pool.on("error", (error) => console.error("postgres pool:", error.message));
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Creates the table and stores the starting content when the database is empty; retries until Postgres answers. */
  async open(): Promise<void> {
    for (;;) {
      try {
        await this.migrate();
        this.ready = true;
        return;
      } catch (error) {
        console.error("postgres is not ready:", error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`CREATE TABLE IF NOT EXISTS content_record (
        id smallint PRIMARY KEY CHECK (id = 1),
        edition integer NOT NULL CHECK (edition >= 1),
        product json NOT NULL,
        interviews json NOT NULL,
        scenarios json NOT NULL)`);
      await client.query(
        "INSERT INTO content_record (id, edition, product, interviews, scenarios) VALUES (1, $1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
        [FIRST_EDITION, ...recordParameters(STARTING_CONTENT)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async row(): Promise<StoredRow> {
    const result = await this.pool.query<StoredRow>("SELECT edition, product, interviews, scenarios FROM content_record WHERE id = 1");
    return result.rows[0];
  }

  async content(): Promise<Content> {
    const { edition, product, interviews, scenarios } = await this.row();
    return {
      edition,
      product,
      interviews: interviews.map(({ slug, name, role, category, lede, hue }) => ({ slug, name, role, category, lede, hue })),
      scenarios: scenarios.map(withMode).map(({ id, mode, name }) => ({ id, mode, name })),
    };
  }

  async interviewDetail(slug: string): Promise<InterviewDetail | null> {
    const { interviews } = await this.row();
    const index = interviews.findIndex((interview) => interview.slug === slug);
    if (index < 0) return null;
    return {
      ...interviews[index],
      previous: index > 0 ? linkTo(interviews[index - 1]) : null,
      next: index < interviews.length - 1 ? linkTo(interviews[index + 1]) : null,
    };
  }

  async scenario(id: ScenarioId): Promise<Scenario | null> {
    const { scenarios } = await this.row();
    const stored = scenarios.find((scenario) => scenario.id === id);
    return stored ? withMode(stored) : null;
  }

  async product(): Promise<Pick<StoredRow, "edition" | "product">> {
    const { edition, product } = await this.row();
    return { edition, product };
  }

  /** Replaces the whole record and adds one to the edition. */
  async replace(record: ContentRecord): Promise<number> {
    const result = await this.pool.query<{ edition: number }>(
      "UPDATE content_record SET edition = edition + 1, product = $1, interviews = $2, scenarios = $3 WHERE id = 1 RETURNING edition",
      recordParameters(record),
    );
    return result.rows[0].edition;
  }

  /** Puts the starting content back at the first edition. */
  async restore(): Promise<number> {
    const result = await this.pool.query<{ edition: number }>(
      "UPDATE content_record SET edition = $1, product = $2, interviews = $3, scenarios = $4 WHERE id = 1 RETURNING edition",
      [FIRST_EDITION, ...recordParameters(STARTING_CONTENT)],
    );
    return result.rows[0].edition;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
