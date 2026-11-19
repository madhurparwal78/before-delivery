import { Pool, type PoolClient, type QueryResult } from "pg";
import type { Content, Project, Statistic } from "../domain/model.js";
import { SEED_CONTENT } from "../domain/seed.js";

export interface StoredEnquiry {
  reference: string;
  name: string;
  email: string;
  project_type: string;
  budget: string;
  description: string;
  mail: "sent" | "not_sent";
}

export interface EnquiryRecord extends StoredEnquiry {
  submissionId: string;
  briefToken: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS content_edition (
  id integer PRIMARY KEY CHECK (id = 1),
  edition integer NOT NULL
);
INSERT INTO content_edition (id, edition) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS projects (
  position integer PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS statistics (
  position integer PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  reference text PRIMARY KEY,
  submission_id uuid UNIQUE NOT NULL,
  brief_token text UNIQUE NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  project_type text NOT NULL,
  budget text NOT NULL,
  description text NOT NULL,
  mail text NOT NULL CHECK (mail IN ('sent', 'not_sent')),
  stored_at timestamptz NOT NULL DEFAULT now()
);
`;

interface EnquiryRow extends Record<string, unknown> {
  reference: string;
  submission_id: string;
  brief_token: string;
  name: string;
  email: string;
  project_type: string;
  budget: string;
  description: string;
  mail: string;
}

function toEnquiryRecord(row: EnquiryRow | undefined): EnquiryRecord | null {
  if (!row) return null;
  return {
    reference: row.reference,
    submissionId: row.submission_id,
    briefToken: row.brief_token,
    name: row.name,
    email: row.email,
    project_type: row.project_type,
    budget: row.budget,
    description: row.description,
    mail: row.mail as "sent" | "not_sent",
  };
}

export class Database {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async connect(retry: (attempt: number) => void = () => {}, intervalMs = 2000): Promise<void> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const client = await this.pool.connect();
        client.release();
        return;
      } catch (error) {
        retry(attempt);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  async setup(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(SCHEMA_SQL);
      const result = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM projects");
      if (result.rows[0].count === "0") {
        await this.storeSeedContent(client);
      }
    } finally {
      client.release();
    }
  }

  private async storeSeedContent(client: PoolClient): Promise<void> {
    await this.writeContent(client, SEED_CONTENT);
  }

  private async writeContent(client: PoolClient, content: Content): Promise<void> {
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM projects");
      await client.query("DELETE FROM statistics");
      for (let i = 0; i < content.projects.length; i++) {
        await client.query("INSERT INTO projects (position, data) VALUES ($1, $2)", [i, JSON.stringify(content.projects[i])]);
      }
      for (let i = 0; i < content.stats.length; i++) {
        await client.query("INSERT INTO statistics (position, data) VALUES ($1, $2)", [i, JSON.stringify(content.stats[i])]);
      }
      await client.query("UPDATE content_edition SET edition = edition + 1 WHERE id = 1");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
    return this.pool.query(sql, params as never[]);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection already broken
      }
      client.release();
      throw error;
    }
  }

  async replaceContent(content: Content): Promise<number> {
    return this.transaction(async (client) => {
      await this.writeContent(client, content);
      const result = await client.query<{ edition: number }>("SELECT edition FROM content_edition WHERE id = 1");
      return result.rows[0].edition;
    });
  }

  async restoreContent(): Promise<number> {
    await this.transaction(async (client) => {
      await this.writeContent(client, SEED_CONTENT);
      await client.query("UPDATE content_edition SET edition = 1 WHERE id = 1");
      await client.query("DELETE FROM enquiries");
    });
    const result = await this.query<{ edition: number }>("SELECT edition FROM content_edition WHERE id = 1");
    return result.rows[0].edition;
  }

  async loadContent(): Promise<Content> {
    const [projectsResult, statsResult] = await Promise.all([
      this.query("SELECT data FROM projects ORDER BY position"),
      this.query("SELECT data FROM statistics ORDER BY position"),
    ]);
    return {
      projects: projectsResult.rows.map((row) => row.data as Project),
      stats: statsResult.rows.map((row) => row.data as Statistic),
    };
  }

  async listEnquiries(): Promise<StoredEnquiry[]> {
    const result = await this.query<{
      reference: string; name: string; email: string; project_type: string; budget: string; description: string; mail: string;
    }>("SELECT reference, name, email, project_type, budget, description, mail FROM enquiries ORDER BY stored_at, reference");
    return result.rows.map((row) => ({
      reference: row.reference,
      name: row.name,
      email: row.email,
      project_type: row.project_type,
      budget: row.budget,
      description: row.description,
      mail: row.mail as "sent" | "not_sent",
    }));
  }

  async storeEnquiry(record: EnquiryRecord): Promise<void> {
    await this.query(
      `INSERT INTO enquiries (reference, submission_id, brief_token, name, email, project_type, budget, description, mail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [record.reference, record.submissionId, record.briefToken, record.name, record.email, record.project_type, record.budget, record.description, record.mail]
    );
  }

  async findEnquiryBySubmission(submissionId: string): Promise<EnquiryRecord | null> {
    const result = await this.query<EnquiryRow>(
      "SELECT reference, submission_id, brief_token, name, email, project_type, budget, description, mail FROM enquiries WHERE submission_id = $1",
      [submissionId]
    );
    return toEnquiryRecord(result.rows[0]);
  }

  async findEnquiryByToken(token: string): Promise<EnquiryRecord | null> {
    const result = await this.query<EnquiryRow>(
      "SELECT reference, submission_id, brief_token, name, email, project_type, budget, description, mail FROM enquiries WHERE brief_token = $1",
      [token]
    );
    return toEnquiryRecord(result.rows[0]);
  }



  async close(): Promise<void> {
    await this.pool.end();
  }
}
