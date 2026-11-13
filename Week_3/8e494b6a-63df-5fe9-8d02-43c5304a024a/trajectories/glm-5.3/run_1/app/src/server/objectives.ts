/**
 * Objectives (rule M): error budgets and burn rates.
 */
import type { PoolClient } from "pg";
import { flatten, fmtFixedExact, valuesOf } from "../shared/util";
import { nowMs } from "./clock";

export interface ObjectiveRow {
  id: string;
  space_id: string;
  service: string;
  name: string;
  stream_id: string;
  target: number;
  objective_window_ms: number;
  bad: { field: string; op: string; value: unknown };
  fixed_counts: { objective: Counts; long: Counts; short: Counts } | null;
}

export interface Counts {
  bad: number;
  total: number;
}

const LONG_WINDOW = 3600000;
const SHORT_WINDOW = 300000;

/** Normalise BIGINT-typed columns into numbers after a pg read. */
function toObjectiveRow(r: Record<string, unknown>): ObjectiveRow {
  return {
    id: String(r.id),
    space_id: String(r.space_id),
    service: String(r.service),
    name: String(r.name),
    stream_id: String(r.stream_id),
    target: Number(r.target),
    objective_window_ms: Number(r.objective_window_ms),
    bad: r.bad as ObjectiveRow["bad"],
    fixed_counts: (r.fixed_counts as ObjectiveRow["fixed_counts"]) ?? null,
  };
}

export function objectiveRows(rows: Record<string, unknown>[]): ObjectiveRow[] {
  return rows.map(toObjectiveRow);
}

function badHolds(bad: ObjectiveRow["bad"], fields: Record<string, unknown>): boolean {
  const v = fields[bad.field];
  switch (bad.op) {
    case "eq":
      return valuesOf(v).some((x) => x === bad.value);
    case "ne":
      return !valuesOf(v).some((x) => x === bad.value);
    case "exists":
      return valuesOf(v).length > 0;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const t = typeof bad.value === "number" ? bad.value : Number(bad.value);
      const nums = valuesOf(v).filter((x): x is number => typeof x === "number");
      if (bad.op === "gt") return nums.some((x) => x > t);
      if (bad.op === "gte") return nums.some((x) => x >= t);
      if (bad.op === "lt") return nums.some((x) => x < t);
      return nums.some((x) => x <= t);
    }
  }
  return false;
}

async function countWindow(
  db: PoolClient,
  objective: ObjectiveRow,
  windowMs: number,
): Promise<Counts> {
  const now = nowMs();
  const params: unknown[] = [objective.stream_id];
  let sql = "SELECT fields FROM events WHERE generation_id IN (SELECT id FROM generations WHERE stream_id = $1)";
  params.push(new Date(now - windowMs));
  sql += ` AND ts > $${params.length}`;
  params.push(new Date(now));
  sql += ` AND ts <= $${params.length}`;
  const res = await db.query<{ fields: Record<string, unknown> }>(sql, params);
  let total = 0;
  let bad = 0;
  for (const row of res.rows) {
    const flat = flatten(row.fields);
    if (String(valuesOf(flat.service)[0] ?? "") !== objective.service) continue;
    total += 1;
    if (badHolds(objective.bad, flat)) bad += 1;
  }
  return { bad, total };
}

export interface ObjectiveView {
  id: string;
  service: string;
  name: string;
  target: number;
  budget_remaining: string;
  long: { bad: number; total: number; burn: string };
  short: { bad: number; total: number; burn: string };
  status: string;
  objective_counts: { bad: number; total: number };
}

export async function objectiveView(db: PoolClient, objective: ObjectiveRow): Promise<ObjectiveView> {
  const now = nowMs();
  const objectiveCounts = objective.fixed_counts?.objective ?? (await countWindow(db, objective, objective.objective_window_ms));
  const longCounts = objective.fixed_counts?.long ?? (await countWindow(db, objective, LONG_WINDOW));
  const shortCounts = objective.fixed_counts?.short ?? (await countWindow(db, objective, SHORT_WINDOW));
  const budget = 1 - objective.target / 100;
  const budgetRemaining =
    objectiveCounts.total === 0 ? 100 : (1 - (objectiveCounts.bad / objectiveCounts.total) / budget) * 100;
  const burn = (c: Counts): number => (c.total === 0 ? 0 : ((c.bad / c.total) / budget));
  const longBurn = burn(longCounts);
  const shortBurn = burn(shortCounts);
  const status =
    longBurn >= 14.4 && shortBurn >= 14.4 ? "Burning fast" : longBurn >= 6 && shortBurn >= 6 ? "Burning" : "OK";
  return {
    id: objective.id,
    service: objective.service,
    name: objective.name,
    target: objective.target,
    budget_remaining: fmtFixedExact(budgetRemaining, 2),
    long: { bad: longCounts.bad, total: longCounts.total, burn: fmtFixedExact(longBurn, 2) },
    short: { bad: shortCounts.bad, total: shortCounts.total, burn: fmtFixedExact(shortBurn, 2) },
    status,
    objective_counts: objectiveCounts,
  };
}
