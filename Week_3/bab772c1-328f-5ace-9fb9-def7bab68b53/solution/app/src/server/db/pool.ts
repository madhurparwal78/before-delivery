/** The Postgres pool, transactions and the cross-instance change notice channel. */

import pg from "pg";
import { config } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type QueryValue = string | number | boolean | null | Buffer | object;

export type Queryable = {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    values?: QueryValue[],
  ): Promise<pg.QueryResult<Row>>;
};

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 10_000,
  statement_timeout: 20_000,
});

export async function applySchema(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('perilune-schema'))");
    await tx.query(SCHEMA_SQL);
  });
}

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const MISSION_CHANGED_CHANNEL = "perilune_mission_changed";

type MissionChangeNotice = { mission_id: string; version: number };

type ChangeListener = (notice: MissionChangeNotice) => void;

const listeners = new Set<ChangeListener>();

export function onMissionChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notifies every instance, in the change's own transaction. */
export async function notifyMissionChange(
  tx: Queryable,
  missionId: string,
  version: number,
): Promise<void> {
  await tx.query("select pg_notify($1, $2)", [
    MISSION_CHANGED_CHANNEL,
    JSON.stringify({ mission_id: missionId, version }),
  ]);
}

export async function startChangeNotices(): Promise<void> {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on("notification", (message) => {
      if (message.channel !== MISSION_CHANGED_CHANNEL || !message.payload) {
        return;
      }
      const notice = JSON.parse(message.payload) as MissionChangeNotice;
      for (const listener of listeners) {
        listener(notice);
      }
    });
    client.on("error", () => {
      client.end().catch(() => undefined);
      setTimeout(() => void connect().catch(() => undefined), 1000);
    });
    await client.connect();
    await client.query(`listen ${MISSION_CHANGED_CHANNEL}`);
    // LISTEN notices are transient; reconcile open streams after every connection.
    const versions = await client.query<{ mission_id: string; version: number }>(
      "select id as mission_id, change_version as version from missions",
    );
    for (const notice of versions.rows) {
      for (const listener of listeners) listener(notice);
    }
  };
  await connect();
}
