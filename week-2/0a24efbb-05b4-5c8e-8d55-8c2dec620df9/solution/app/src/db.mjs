import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { config } from "./config.mjs";

// Loaded through require so the ESM bridge never touches pg's lazy `native` getter.
const pg = createRequire(import.meta.url)("pg");

// Business dates and claimed times stay as the strings postgres writes; instants arrive as Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.TIME, (value) => value.slice(0, 5));

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
// An idle client that loses its connection is dropped by the pool; the next query reconnects.
pool.on("error", (error) => console.error(`postgres idle client lost: ${error.message}`));

const RELATIONS = [
  "employer", "person", "attendance_day", "leave_day", "regularisation_request", "policy", "audit_event",
  "share_link", "sign_in_attempt",
];

export async function rows(text, params = [], client = pool) {
  return (await client.query(text, params)).rows;
}

export async function one(text, params = [], client = pool) {
  return (await rows(text, params, client))[0];
}

let storeReached = false;

/** Dependency down at boot: until postgres has answered once, this throws so every call answers the 500. */
export async function requireStoreReached() {
  if (storeReached) return;
  await pool.query("SELECT 1");
  storeReached = true;
}

/** Run `work` on one client inside one transaction; any failure rolls the whole of it back. */
export async function tx(work) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A client whose rollback fails is destroyed rather than returned to the pool.
    await client.query("ROLLBACK").catch((rollbackError) => {
      broken = rollbackError;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** Hold a cross-process lock on one client while `work` creates the schema and the seed. */
export async function withBootLock(work) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('rostara.boot'))");
    try {
      await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('rostara.boot'))");
    }
  } finally {
    client.release();
  }
}

/** Whether every relation exists and the seed has committed (it commits in one transaction with the employer). */
export async function storeFlags() {
  const found = await one(
    "SELECT count(*)::int AS present FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NOT NULL",
    [RELATIONS],
  );
  const schema = found.present === RELATIONS.length;
  const seeded = schema && Boolean(await one("SELECT 1 AS yes FROM employer WHERE id = 1"));
  return { schema, seeded };
}

export function isUniqueViolation(error, constraint) {
  return error?.code === "23505" && (!constraint || error.constraint === constraint);
}
