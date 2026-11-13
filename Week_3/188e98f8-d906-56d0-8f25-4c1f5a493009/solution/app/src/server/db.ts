import pg from "pg";
import { config } from "./config";
import { SCHEMA } from "./schema";
import {
  LEAGUE,
  MARKER_CODE,
  NIGHT,
  QUIZMASTER_CODE,
  SEED_ROUNDS,
  SEED_TEAMS,
  captainCode,
  captainEmail,
  nameKey,
} from "./seed";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient | pg.Pool;

/** Advisory lock keys. */
export const LOCK = { migrate: 7001, answers: 7002, submitLog: 7003 } as const;

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}

let ready = false;
export const isReady = () => ready;

async function createDatabaseIfMissing(): Promise<void> {
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK.migrate]);
    await client.query(SCHEMA);
    const seeded = await client.query("SELECT 1 FROM league");
    if (seeded.rowCount !== 0) return;
    await client.query("INSERT INTO league (id, name, season, pub, night, table_version) VALUES (1, $1, $2, $3, $4, 1)", [
      LEAGUE.name,
      LEAGUE.season,
      LEAGUE.pub,
      NIGHT,
    ]);
    for (const [id, name, past] of SEED_TEAMS) {
      await client.query("INSERT INTO teams (id, name, name_key, captain_email) VALUES ($1, $2, $3, $4)", [
        id,
        name,
        nameKey(name),
        captainEmail(id),
      ]);
      await client.query("INSERT INTO desk_codes (code, role, team_id) VALUES ($1, 'captain', $2)", [captainCode(id), id]);
      for (const [index, score] of past.entries()) {
        await client.query("INSERT INTO past_scores (team_id, night, score) VALUES ($1, $2, $3)", [id, index + 1, score]);
      }
    }
    await client.query("INSERT INTO desk_codes (code, role) VALUES ($1, 'quizmaster'), ($2, 'marker')", [
      QUIZMASTER_CODE,
      MARKER_CODE,
    ]);
    for (const [number, title, kind] of SEED_ROUNDS) {
      await client.query("INSERT INTO rounds (number, title, kind) VALUES ($1, $2, $3)", [number, title, kind]);
    }
  });
}

/** Retries until the database is ready; health answers 503 meanwhile. */
export async function connectAndMigrate(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      ready = true;
      return;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "3D000") {
        await createDatabaseIfMissing().catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
