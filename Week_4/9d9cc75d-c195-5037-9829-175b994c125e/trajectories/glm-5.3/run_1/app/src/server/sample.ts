import type { Db } from "./db.js";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { parseCsv, type ColumnMeta } from "./csv.js";
import { ORDERS_CSV, STOCKISTS_CSV } from "./sample-data.js";
import { newId } from "./ids.js";

export { ORDERS_CSV, STOCKISTS_CSV };

export interface JoinedRow {
  values: Record<string, string | null>;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Left join the first table to the second on one key column from each. A left
 * row with no match keeps every left field and gets null right fields. If a
 * right key appears more than once, the first line is kept.
 */
export function joinRows(
  left: { columns: ColumnMeta[]; records: (string | null)[][] },
  right: { columns: ColumnMeta[]; records: (string | null)[][] },
  leftKey?: string,
  rightKey?: string,
): { rows: JoinedRow[]; duplicates: number; firstDup: string | null } {
  const lKey = leftKey ?? left.columns[0]?.name;
  const rKey = rightKey ?? lKey;
  const lIdx = left.columns.findIndex((c) => c.name === lKey);
  const rIdx = right.columns.findIndex((c) => c.name === rKey);
  const seen = new Map<string, (string | null)[]>();
  let duplicates = 0;
  let firstDup: string | null = null;
  for (const r of right.records) {
    const k = r[rIdx];
    if (k === null || k === undefined) continue;
    if (seen.has(k)) {
      duplicates++;
      if (firstDup === null) firstDup = k;
      continue;
    }
    seen.set(k, r);
  }
  const rows: JoinedRow[] = [];
  for (const l of left.records) {
    const values: Record<string, string | null> = {};
    left.columns.forEach((c, i) => {
      values[c.name] = l[i] ?? null;
    });
    const key = l[lIdx];
    const match = key === null || key === undefined ? undefined : seen.get(key);
    right.columns.forEach((c, i) => {
      values[c.name] = match ? (match[i] ?? null) : null;
    });
    rows.push({ values });
  }
  return { rows, duplicates, firstDup };
}

/**
 * The home page's sample sheet reads the bundled Fernhollow Tea sample. The
 * grading seed route loads the same sample with {"sample":"fernhollow"}.
 */
export async function seedHomeSample(db: Db): Promise<void> {
  const existing = await db.query("SELECT id FROM sources WHERE name = 'Fernhollow Tea' AND project_id IS NULL");
  if (existing.rows.length > 0) return;
  await createSampleSource(db, null);
}

export async function createSampleSource(db: Db, projectId: string | null): Promise<string> {
  const state = (globalThis as { lozAppState?: import("./auth.js").AppState }).lozAppState;
  const ordersBytes = Buffer.from(ORDERS_CSV, "utf8");
  const stockistsBytes = Buffer.from(STOCKISTS_CSV, "utf8");
  const sourceId = newId();
  await db.query(
    "INSERT INTO sources (id, project_id, name, version, relation, hierarchy, notices) VALUES ($1, $2, 'Fernhollow Tea', 1, $3, $4, '[]'::jsonb)",
    [
      sourceId,
      projectId,
      JSON.stringify({ left_table: "orders", left_key: "Stockist ID", right_table: "stockists", right_key: "Stockist ID" }),
      JSON.stringify({ name: "Geography", fields: ["Region", "Stockist"] }),
    ],
  );
  const orders = parseCsv(ordersBytes, { rowMax: 100000 });
  const stockists = parseCsv(stockistsBytes, { rowMax: 100000 });
  // The uploaded files are stored byte for byte under their published key.
  if (state) {
    try {
      await state.storage.put(`uploads/${sourceId}/orders/${sha256Of(ordersBytes)}.csv`, ordersBytes);
      await state.storage.put(`uploads/${sourceId}/stockists/${sha256Of(stockistsBytes)}.csv`, stockistsBytes);
    } catch {
      // Storage outage: the source is created and refreshes keep the last
      // good snapshot; the app never restarts to recover.
    }
  }
  await db.query(
    "INSERT INTO tables (source_id, name, rows_count, sha256, columns) VALUES ($1, 'orders', $2, $3, $4)",
    [sourceId, orders.rowCount, sha256Of(ordersBytes), JSON.stringify(orders.columns)],
  );
  await db.query(
    "INSERT INTO tables (source_id, name, rows_count, sha256, columns) VALUES ($1, 'stockists', $2, $3, $4)",
    [sourceId, stockists.rowCount, sha256Of(stockistsBytes), JSON.stringify(stockists.columns)],
  );
  for (const [table, parsed] of [["orders", orders], ["stockists", stockists]] as const) {
    for (const c of parsed.columns) {
      const kind = c.name === "Order" ? "dimension" : c.type === "number" ? "measure" : "dimension";
      await db.query(
        "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'null'::jsonb)",
        [newId(), sourceId, c.name, table, c.type, kind, c.type === "date"],
      );
    }
  }
  const snapshot = joinRows(orders, stockists, "Stockist ID", "Stockist ID");
  await db.query("INSERT INTO snapshots (source_id, version, rows) VALUES ($1, 1, $2)", [sourceId, JSON.stringify(snapshot.rows)]);
  await db.query(
    "INSERT INTO extracts (source_id, state, stale, rows_count) VALUES ($1, 'live', false, $2)",
    [sourceId, snapshot.rows.length],
  );
  return sourceId;
}

/** Load a source's fields, tables and snapshot for query building. */
export async function loadSource(
  db: Db,
  sourceId: string,
): Promise<{
  sourceId: string;
  name: string;
  version: number;
  relation: { left_table: string; left_key: string; right_table: string; right_key: string } | null;
  hierarchy: { name: string; fields: string[] } | null;
  entitlementField: string | null;
  entitlementUsers: Record<string, string[]> | null;
  fields: {
    id: string;
    name: string;
    table: string;
    type: ColumnMeta["type"];
    kind: "dimension" | "measure";
    continuous: boolean;
    hidden: boolean;
    origin: { kind: "column" | "bin" | "group"; field?: string; size?: number; groups?: { name: string; members: string[] }[] } | null;
  }[];
  rows: JoinedRow[];
} | null> {
  const res = await db.query("SELECT * FROM sources WHERE id = $1", [sourceId]);
  const s = res.rows[0];
  if (!s) return null;
  const fieldsRes = await db.query("SELECT * FROM fields WHERE source_id = $1 ORDER BY name", [sourceId]);
  const snapRes = await db.query("SELECT rows FROM snapshots WHERE source_id = $1 ORDER BY version DESC LIMIT 1", [sourceId]);
  return {
    sourceId,
    name: s.name,
    version: s.version,
    relation: s.relation,
    hierarchy: s.hierarchy,
    entitlementField: s.entitlement_field,
    entitlementUsers: s.entitlement_users,
    fields: fieldsRes.rows.map((f) => ({
      id: f.id,
      name: f.name,
      table: f.table_name,
      type: f.type,
      kind: f.kind,
      continuous: f.continuous,
      hidden: f.hidden,
      origin: f.origin,
    })),
    rows: snapRes.rows[0]?.rows ?? [],
  };
}
