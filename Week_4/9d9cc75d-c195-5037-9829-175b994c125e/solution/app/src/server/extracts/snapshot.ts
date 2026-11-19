import type { Cell } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { Queryable } from '../db/database.ts';
import type { Column } from '../sources/csv.ts';

export const snapshotSchema = [
  `CREATE TABLE IF NOT EXISTS extracts (
     source_id text PRIMARY KEY REFERENCES sources(id),
     state text NOT NULL DEFAULT 'live',
     last_success_at timestamptz,
     last_failure_at timestamptz,
     last_run_at timestamptz,
     snapshot_id text NOT NULL,
     rows integer NOT NULL DEFAULT 0,
     schedule_every integer,
     schedule_kind text,
     schedule_key text,
     schedule_saved_at timestamptz,
     forced_failures integer NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_tables (
     source_id text NOT NULL REFERENCES sources(id),
     table_name text NOT NULL,
     snapshot_id text NOT NULL,
     columns jsonb NOT NULL,
     row_count integer NOT NULL,
     PRIMARY KEY (source_id, table_name)
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_rows (
     snapshot_id text NOT NULL,
     seq integer NOT NULL,
     cells jsonb NOT NULL,
     PRIMARY KEY (snapshot_id, seq)
   )`,
];

interface SnapshotTable {
  table_name: string;
  snapshot_id: string;
  columns: Column[];
  row_count: number;
}

export interface TableContent {
  name: string;
  columns: Column[];
  rows: Cell[][];
}

const CHUNK = 2000;

/** The current snapshot of each table of the source, in table order. */
export function snapshotTables(q: Queryable, sourceId: string): Promise<SnapshotTable[]> {
  return q.rows<SnapshotTable>(
    `SELECT st.table_name, st.snapshot_id, st.columns, st.row_count
       FROM snapshot_tables st JOIN source_tables t ON t.source_id = st.source_id AND t.name = st.table_name
      WHERE st.source_id = $1 ORDER BY t.position`,
    [sourceId],
  );
}

export async function readRows(q: Queryable, snapshotId: string): Promise<Cell[][]> {
  const rows = await q.rows<{ cells: Cell[] }>(`SELECT cells FROM snapshot_rows WHERE snapshot_id = $1 ORDER BY seq`, [
    snapshotId,
  ]);
  return rows.map((r) => r.cells);
}

/**
 * Swaps the given tables' snapshots in, inside the caller's transaction: readers see the old rows or the new ones,
 * never a mix. Also gives the extract a new generation id and recounts its rows.
 */
export async function swapSnapshot(tx: Queryable, sourceId: string, tables: readonly TableContent[]): Promise<void> {
  for (const table of tables) {
    const old = await tx.row<{ snapshot_id: string }>(
      `SELECT snapshot_id FROM snapshot_tables WHERE source_id = $1 AND table_name = $2`,
      [sourceId, table.name],
    );
    const id = newId();
    for (let from = 0; from < table.rows.length; from += CHUNK) {
      await tx.exec(
        `INSERT INTO snapshot_rows (snapshot_id, seq, cells)
         SELECT $1, $3 + t.ord - 1, t.value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(value, ord)`,
        [id, JSON.stringify(table.rows.slice(from, from + CHUNK)), from],
      );
    }
    await tx.exec(
      `INSERT INTO snapshot_tables (source_id, table_name, snapshot_id, columns, row_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, table_name)
       DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id, columns = EXCLUDED.columns, row_count = EXCLUDED.row_count`,
      [sourceId, table.name, id, JSON.stringify(table.columns), table.rows.length],
    );
    if (old) await tx.exec(`DELETE FROM snapshot_rows WHERE snapshot_id = $1`, [old.snapshot_id]);
  }
  await tx.exec(
    `UPDATE extracts e SET snapshot_id = $2, rows = COALESCE((
       SELECT st.row_count FROM snapshot_tables st
        WHERE st.source_id = e.source_id AND st.table_name = COALESCE(
          (SELECT s.relation->>'left_table' FROM sources s WHERE s.id = e.source_id),
          (SELECT t.name FROM source_tables t WHERE t.source_id = e.source_id ORDER BY t.position LIMIT 1))
     ), 0)
     WHERE e.source_id = $1`,
    [sourceId, newId()],
  );
}
