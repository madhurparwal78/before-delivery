import { Pool } from "pg";
import { newId } from "./crypto.js";
import type { DbPerson, DbOrganisation } from "./db_types.js";

export type Session = { id: string; person_id: string };

export class SessionStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private ensureTable(): Promise<void> {
    return this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS session (
           token text PRIMARY KEY,
           person_id text NOT NULL REFERENCES person(id),
           created_at timestamptz NOT NULL DEFAULT now()
         )`,
      )
      .then(() => undefined);
  }

  async create(personId: string): Promise<string> {
    await this.ensureTable();
    const token = newId("sess");
    await this.pool.query("INSERT INTO session (token, person_id) VALUES ($1, $2)", [token, personId]);
    return token;
  }

  async person(token: string | null): Promise<DbPerson | null> {
    if (!token) return null;
    await this.ensureTable();
    const { rows } = await this.pool.query<DbPerson>(
      `SELECT p.* FROM session s JOIN person p ON p.id = s.person_id WHERE s.token = $1`,
      [token],
    );
    return rows[0] ?? null;
  }

  async delete(token: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query("DELETE FROM session WHERE token = $1", [token]);
  }

  async organisation(person: DbPerson): Promise<DbOrganisation | null> {
    if (!person.organisation_id) return null;
    const { rows } = await this.pool.query<DbOrganisation>(
      "SELECT * FROM organisation WHERE id = $1",
      [person.organisation_id],
    );
    return rows[0] ?? null;
  }
}
