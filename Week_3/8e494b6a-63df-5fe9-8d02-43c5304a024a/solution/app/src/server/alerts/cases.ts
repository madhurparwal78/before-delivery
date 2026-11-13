// Cases (Business rules L): numbered per space, moved one published step at a time.
import { now } from "../clock";
import { pool, tx } from "../db";
import { errors } from "../errors";
import { emit } from "../live";

export const CASE_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** The one place a case moves: one step forward, or resolved back to investigating. */
const CASE_FLOW: Record<CaseStatus, CaseStatus[]> = {
  open: ["investigating"],
  investigating: ["resolved"],
  resolved: ["closed", "investigating"],
  closed: [],
};

interface CaseRow {
  id: number;
  number: number;
  title: string;
  status: CaseStatus;
}

export const caseSummary = (row: CaseRow) => ({ number: row.number, title: row.title, status: row.status });

export async function listCases(spaceId: number): Promise<CaseRow[]> {
  const { rows } = await pool.query<CaseRow>("SELECT id, number, title, status FROM cases WHERE space_id = $1 ORDER BY number DESC", [spaceId]);
  return rows;
}

export async function findCase(spaceId: number, number: number): Promise<CaseRow | null> {
  const { rows } = await pool.query<CaseRow>("SELECT id, number, title, status FROM cases WHERE space_id = $1 AND number = $2", [spaceId, number]);
  return rows[0] ?? null;
}

export async function caseView(row: CaseRow) {
  const { rows } = await pool.query<{ kind: string; rule_id: number | null; rule_name: string | null; group_name: string | null; inbox_id: number | null; inbox_text: string | null; trace_id: string | null }>(
    `SELECT i.kind, i.rule_id, r.name AS rule_name, i.group_name, i.inbox_id, b.text AS inbox_text, i.trace_id
     FROM case_items i LEFT JOIN rules r ON r.id = i.rule_id LEFT JOIN inbox_items b ON b.id = i.inbox_id
     WHERE i.case_id = $1 ORDER BY i.id`,
    [row.id],
  );
  const items = rows.map((item) =>
    item.kind === "group"
      ? { kind: "group", rule: item.rule_id, rule_name: item.rule_name, group: item.group_name, text: `Group ${item.group_name} on rule ${item.rule_name}` }
      : item.kind === "inbox"
        ? { kind: "inbox", id: item.inbox_id, text: `Inbox item: ${item.inbox_text}` }
        : { kind: "trace", trace_id: item.trace_id, text: `Trace ${item.trace_id}` },
  );
  return { ...caseSummary(row), items };
}

export async function createCase(spaceId: number, title: string): Promise<{ row: CaseRow; seq: number }> {
  const row = await tx(async (client) => {
    const { rows: counter } = await client.query<{ case_seq: number }>("UPDATE spaces SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq", [spaceId]);
    const { rows } = await client.query<CaseRow>(
      "INSERT INTO cases (space_id, number, title, status, created_ms) VALUES ($1, $2, $3, 'open', $4) RETURNING id, number, title, status",
      [spaceId, (counter[0] as { case_seq: number }).case_seq, title, now()],
    );
    return rows[0] as CaseRow;
  });
  return { row, seq: await emit(spaceId, [{ type: "case", data: { case: caseSummary(row), announcements: [] } }]) };
}

export async function moveCase(spaceId: number, number: number, to: CaseStatus): Promise<{ row: CaseRow; seq: number }> {
  const row = await tx(async (client) => {
    const { rows } = await client.query<CaseRow>("SELECT id, number, title, status FROM cases WHERE space_id = $1 AND number = $2 FOR UPDATE", [spaceId, number]);
    const current = rows[0] as CaseRow;
    if (!CASE_FLOW[current.status].includes(to)) throw errors.caseFlow(current.status, to);
    await client.query("UPDATE cases SET status = $2 WHERE id = $1", [current.id, to]);
    return { ...current, status: to };
  });
  return { row, seq: await emit(spaceId, [{ type: "case", data: { case: caseSummary(row), announcements: [`Case ${row.number} is now ${row.status}`] } }]) };
}

export type CaseItemRef = { rule: number; group: string } | { inbox_item: number } | { trace_id: string };

export async function addCaseItem(spaceId: number, row: CaseRow, item: CaseItemRef): Promise<number> {
  if ("rule" in item) {
    await pool.query(
      `INSERT INTO case_items (case_id, kind, rule_id, group_name) SELECT $1, 'group', $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM case_items WHERE case_id = $1 AND kind = 'group' AND rule_id = $2 AND group_name = $3)`,
      [row.id, item.rule, item.group],
    );
  } else if ("inbox_item" in item) {
    await pool.query(
      `INSERT INTO case_items (case_id, kind, inbox_id) SELECT $1, 'inbox', $2
       WHERE NOT EXISTS (SELECT 1 FROM case_items WHERE case_id = $1 AND kind = 'inbox' AND inbox_id = $2)`,
      [row.id, item.inbox_item],
    );
  } else {
    await pool.query(
      `INSERT INTO case_items (case_id, kind, trace_id) SELECT $1, 'trace', $2
       WHERE NOT EXISTS (SELECT 1 FROM case_items WHERE case_id = $1 AND kind = 'trace' AND trace_id = $2)`,
      [row.id, item.trace_id],
    );
  }
  return emit(spaceId, [{ type: "case", data: { case: caseSummary(row), announcements: [] } }]);
}
