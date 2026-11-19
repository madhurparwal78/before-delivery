/** Rule sets (current at the request instant) and the loft working calendar. */
import { one, rows, type Queryable, type Row } from "./db.js";
import { instant } from "./time.js";
import type { RuleSet } from "../shared/types.js";

export interface RuleSetRow {
  version: number;
  effective_at: Date;
  seam_overlap_mm: number;
  roach_permille: number;
  tolerance_mm: number;
  min_offcut_width_mm: number;
  min_offcut_length_mm: number;
  revision: number;
}

export async function currentRuleSet(db: Queryable, at: Date): Promise<RuleSetRow> {
  const found = await one<RuleSetRow>(db, "SELECT * FROM ruleset WHERE effective_at <= $1 ORDER BY effective_at DESC, version DESC LIMIT 1", [at]);
  if (!found) throw new Error("no rule set is in force");
  return found;
}

export async function ruleSetByVersion(db: Queryable, version: number): Promise<RuleSetRow> {
  const found = await one<RuleSetRow>(db, "SELECT * FROM ruleset WHERE version = $1", [version]);
  if (!found) throw new Error(`unknown rule set v${version}`);
  return found;
}

export function ruleSetView(row: Row, currentVersion: number): RuleSet {
  return {
    version: row.version,
    effective_at: instant(row.effective_at),
    current: row.version === currentVersion,
    seam_overlap_mm: row.seam_overlap_mm,
    roach_permille: row.roach_permille,
    tolerance_mm: row.tolerance_mm,
    min_offcut_width_mm: row.min_offcut_width_mm,
    min_offcut_length_mm: row.min_offcut_length_mm,
    revision: row.revision,
  };
}

const REMEASURE_WORKING_DAYS = 5;
const DAY_MS = 86_400_000;

/** The fifth loft working day after a date: Monday to Friday, skipping closures. */
export async function remeasureDueDates(db: Queryable, measuredOn: string[]): Promise<Map<string, string>> {
  const closures = new Set((await rows<{ day: string }>(db, "SELECT day FROM closure")).map((row) => row.day));
  const due = new Map<string, string>();
  for (const start of new Set(measuredOn)) {
    let cursor = Date.parse(`${start}T00:00:00Z`);
    let counted = 0;
    while (counted < REMEASURE_WORKING_DAYS) {
      cursor += DAY_MS;
      const day = new Date(cursor).toISOString().slice(0, 10);
      const weekday = new Date(cursor).getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !closures.has(day)) counted++;
    }
    due.set(start, new Date(cursor).toISOString().slice(0, 10));
  }
  return due;
}
