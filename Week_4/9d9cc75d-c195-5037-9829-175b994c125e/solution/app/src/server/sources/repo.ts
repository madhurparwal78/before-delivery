import type { Relation } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import type { Column } from './csv.ts';
import type { DerivedDef, FieldRecord } from './fields.ts';

export const sourceSchema = [
  `CREATE TABLE IF NOT EXISTS sources (
     id text PRIMARY KEY,
     project_id text NOT NULL REFERENCES projects(id),
     name text NOT NULL,
     version integer NOT NULL DEFAULT 1,
     rev integer NOT NULL DEFAULT 1,
     relation jsonb,
     hierarchy jsonb,
     security_field text,
     entitlements jsonb NOT NULL DEFAULT '{}',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS sources_project ON sources (project_id)`,
  `CREATE TABLE IF NOT EXISTS source_tables (
     source_id text NOT NULL REFERENCES sources(id),
     name text NOT NULL,
     position integer NOT NULL,
     sha256 text NOT NULL,
     row_count integer NOT NULL,
     columns jsonb NOT NULL,
     PRIMARY KEY (source_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS source_fields (
     id text PRIMARY KEY,
     source_id text NOT NULL REFERENCES sources(id),
     position integer NOT NULL,
     name text NOT NULL,
     table_name text,
     column_name text,
     type text NOT NULL,
     kind text NOT NULL,
     continuous boolean NOT NULL,
     hidden boolean NOT NULL DEFAULT false,
     dropped boolean NOT NULL DEFAULT false,
     derived jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS source_fields_source ON source_fields (source_id, position)`,
];

export interface SourceRow {
  id: string;
  project_id: string;
  name: string;
  version: number;
  rev: number;
  relation: Relation | null;
  /** Field ids, top level first. */
  hierarchy: { name: string; fields: string[] } | null;
  /** The security field's id. */
  security_field: string | null;
  /** Lower-case username to allowed values. */
  entitlements: Record<string, string[]>;
}

interface TableRow {
  name: string;
  position: number;
  sha256: string;
  row_count: number;
  columns: Column[];
}

interface FieldDbRow {
  id: string;
  name: string;
  table_name: string | null;
  column_name: string | null;
  type: FieldRecord['type'];
  kind: FieldRecord['kind'];
  continuous: boolean;
  hidden: boolean;
  dropped: boolean;
  derived: DerivedDef | null;
}

export function getSource(q: Queryable, sourceId: string): Promise<SourceRow | null> {
  return q.row<SourceRow>(
    `SELECT id, project_id, name, version, rev, relation, hierarchy, security_field, entitlements
       FROM sources WHERE id = $1`,
    [sourceId],
  );
}

/** Takes the source's row lock until the transaction ends, so edits of one source run one after another; 404 when gone. */
export async function lockSource(tx: Queryable, sourceId: string): Promise<void> {
  if (!(await tx.row(`SELECT id FROM sources WHERE id = $1 FOR UPDATE`, [sourceId]))) throw notFound();
}

export function getTables(q: Queryable, sourceId: string): Promise<TableRow[]> {
  return q.rows<TableRow>(
    `SELECT name, position, sha256, row_count, columns FROM source_tables WHERE source_id = $1 ORDER BY position`,
    [sourceId],
  );
}

/** Every stored field in list order, join-dropped ones included. */
export async function getFields(q: Queryable, sourceId: string): Promise<FieldRecord[]> {
  const rows = await q.rows<FieldDbRow>(
    `SELECT id, name, table_name, column_name, type, kind, continuous, hidden, dropped, derived
       FROM source_fields WHERE source_id = $1 ORDER BY position`,
    [sourceId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    table: r.table_name,
    type: r.type,
    kind: r.kind,
    continuous: r.continuous,
    hidden: r.hidden,
    column: r.column_name,
    dropped: r.dropped,
    derived: r.derived,
  }));
}

/** Replaces the source's whole field list and bumps `rev` so cached models are rebuilt. */
export async function saveFields(q: Queryable, sourceId: string, fields: readonly FieldRecord[]): Promise<void> {
  await q.exec(`DELETE FROM source_fields WHERE source_id = $1`, [sourceId]);
  let position = 0;
  for (const f of fields) {
    await q.exec(
      `INSERT INTO source_fields
         (id, source_id, position, name, table_name, column_name, type, kind, continuous, hidden, dropped, derived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        f.id,
        sourceId,
        position++,
        f.name,
        f.table,
        f.column,
        f.type,
        f.kind,
        f.continuous,
        f.hidden,
        f.dropped,
        f.derived === null ? null : JSON.stringify(f.derived),
      ],
    );
  }
  await touch(q, sourceId);
}

/** Marks a field, relation, hierarchy or security edit: engine models built before it are stale. */
export function touch(q: Queryable, sourceId: string): Promise<number> {
  return q.exec(`UPDATE sources SET rev = rev + 1 WHERE id = $1`, [sourceId]);
}
