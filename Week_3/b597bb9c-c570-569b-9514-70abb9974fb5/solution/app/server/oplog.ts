import type { LoggedOp, OpChanges, OpResult, OpSummary } from "../shared/types";
import { one, query } from "./db";
import type { Step } from "./timeline/effects";

export interface OpRow {
  version: number;
  person_id: string;
  summary: OpSummary;
  changes: OpChanges;
  removed: string[];
  stopped: OpResult["stopped"];
  touched: string[];
  forward: Step | null;
  inverse: Step | null;
}

export const resultOf = (row: OpRow): OpResult => ({ version: row.version, changes: row.changes, removed: row.removed, stopped: row.stopped });

export async function replayOf(projectId: string, personId: string, opId: string): Promise<OpResult | null> {
  const row = await one<OpRow>("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, personId, opId]);
  return row ? resultOf(row) : null;
}

export async function listOps(projectId: string, after: number): Promise<LoggedOp[]> {
  const rows = await query<OpRow & { author_name: string }>(
    `SELECT o.*, p.name AS author_name FROM ops o JOIN people p ON p.id = o.person_id
      WHERE o.project_id = $1 AND o.version > $2 ORDER BY o.version`,
    [projectId, after],
  );
  return rows.map((row) => ({ ...resultOf(row), author: { id: row.person_id, name: row.author_name }, op: row.summary }));
}

