import { Pool } from 'pg';
import { SCENARIO_ORDER, type ScenarioId } from '../shared/scenarios';
import type { ContentRecord, Scenario } from '../shared/types';
import type { GradingBody } from '../shared/validate';
import { SEED_EDITION, seedContentRecord } from './seed';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content_record (
  id integer PRIMARY KEY,
  edition integer NOT NULL,
  product json NOT NULL,
  interviews json NOT NULL,
  scenarios json NOT NULL,
  site json NOT NULL,
  CONSTRAINT content_record_single_row CHECK (id = 1)
);
`;

const RETRY_DELAY_MS = 1000;

interface ContentRow {
  edition: number;
  product: ContentRecord['product'];
  interviews: ContentRecord['interviews'];
  scenarios: ContentRecord['scenarios'];
  site: ContentRecord['site'];
}

function sortScenarios(scenarios: Scenario[]): Scenario[] {
  return [...scenarios].sort(
    (a, b) =>
      SCENARIO_ORDER.indexOf(a.id as ScenarioId) -
      SCENARIO_ORDER.indexOf(b.id as ScenarioId),
  );
}

export class ContentStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  /**
   * Creates the table and stores the starting content when the database is
   * empty. Retries until Postgres answers, so a database that is down at start
   * does not stop the app.
   */
  async connect(): Promise<void> {
    for (;;) {
      try {
        await this.pool.query(SCHEMA);
        const seed = seedContentRecord();
        await this.pool.query(
          `INSERT INTO content_record (id, edition, product, interviews, scenarios, site)
           VALUES (1, $1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            seed.edition,
            JSON.stringify(seed.product),
            JSON.stringify(seed.interviews),
            JSON.stringify(seed.scenarios),
            JSON.stringify(seed.site),
          ],
        );
        return;
      } catch (error) {
        process.stderr.write(
          `Waiting for Postgres: ${String(error instanceof Error ? error.message : error)}\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  async read(): Promise<ContentRecord> {
    const result = await this.pool.query<ContentRow>(
      'SELECT edition, product, interviews, scenarios, site FROM content_record WHERE id = 1',
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('The content record is missing.');
    }
    return {
      edition: row.edition,
      product: row.product,
      interviews: row.interviews,
      scenarios: sortScenarios(row.scenarios),
      site: row.site,
    };
  }

  /** Replaces the product, interviews and scenarios and adds one to the edition. */
  async replace(body: GradingBody): Promise<number> {
    const result = await this.pool.query<{ edition: number }>(
      `UPDATE content_record
          SET edition = edition + 1,
              product = $1,
              interviews = $2,
              scenarios = $3
        WHERE id = 1
        RETURNING edition`,
      [
        JSON.stringify(body.product),
        JSON.stringify(body.interviews),
        JSON.stringify(sortScenarios(body.scenarios)),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('The content record is missing.');
    }
    return row.edition;
  }

  /** Puts back the starting content with edition 1. */
  async restore(): Promise<number> {
    const seed = seedContentRecord();
    await this.pool.query(
      `UPDATE content_record
          SET edition = $1, product = $2, interviews = $3, scenarios = $4, site = $5
        WHERE id = 1`,
      [
        seed.edition,
        JSON.stringify(seed.product),
        JSON.stringify(seed.interviews),
        JSON.stringify(seed.scenarios),
        JSON.stringify(seed.site),
      ],
    );
    return SEED_EDITION;
  }

  async answers(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
