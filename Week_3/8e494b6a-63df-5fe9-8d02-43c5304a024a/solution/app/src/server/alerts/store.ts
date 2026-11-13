// Rules, groups, history and inbox items as rows, and the views the API and live messages send.
import { config } from "../config";
import { formatIso } from "../../shared/time";
import { pool, type Queryable } from "../db";
import type { Filter } from "../search/filters";
import { windowActiveAt, nextStart, type MaintenanceWindow } from "./maintenance";

export type GroupState = "inactive" | "pending" | "active" | "recovered";

export type Frequency = { kind: "change" } | { kind: "check" } | { kind: "throttle"; every_ms: number };

export interface RuleRow {
  id: number;
  spaceId: number;
  name: string;
  stream: string;
  filter: Filter | null;
  measure: "count" | "avg" | "max" | "min" | "sum";
  measureField: string | null;
  groupBy: string | null;
  windowMs: number;
  comparison: ">" | ">=" | "<" | "<=";
  threshold: number;
  frequency: Frequency;
  lastCheckMs: number | null;
  lastCheckFailed: boolean | null;
}

export interface GroupRow {
  name: string;
  state: GroupState;
  sinceMs: number | null;
  streak: number;
  changeFlags: boolean[];
  snoozedUntilMs: number | null;
  snoozeUntilRecovered: boolean;
  acknowledgedBy: string | null;
  lastActionMs: number | null;
  heldWindow: string | null;
}

export async function loadRule(db: Queryable, spaceId: number, id: number): Promise<RuleRow | null> {
  const { rows } = await db.query<Record<string, never>>("SELECT * FROM rules WHERE id = $1 AND space_id = $2", [id, spaceId]);
  return rows[0] ? ruleRow(rows[0]) : null;
}

export async function loadRules(db: Queryable, spaceId: number): Promise<RuleRow[]> {
  const { rows } = await db.query<Record<string, never>>("SELECT * FROM rules WHERE space_id = $1 ORDER BY name", [spaceId]);
  return rows.map(ruleRow);
}

function ruleRow(row: Record<string, unknown>): RuleRow {
  return {
    id: row.id as number, spaceId: row.space_id as number, name: row.name as string, stream: row.stream as string,
    filter: row.filter as Filter | null, measure: row.measure as RuleRow["measure"], measureField: row.measure_field as string | null,
    groupBy: row.group_by as string | null, windowMs: row.window_ms as number, comparison: row.comparison as RuleRow["comparison"],
    threshold: row.threshold as number, frequency: row.frequency as Frequency, lastCheckMs: row.last_check_ms as number | null,
    lastCheckFailed: row.last_check_failed as boolean | null,
  };
}

export async function loadGroups(db: Queryable, ruleId: number): Promise<GroupRow[]> {
  const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM rule_groups WHERE rule_id = $1 ORDER BY name", [ruleId]);
  return rows.map((row) => ({
    name: row.name as string, state: row.state as GroupState, sinceMs: row.since_ms as number | null, streak: row.streak as number,
    changeFlags: row.change_flags as boolean[], snoozedUntilMs: row.snoozed_until_ms as number | null,
    snoozeUntilRecovered: row.snooze_until_recovered as boolean, acknowledgedBy: row.acknowledged_by as string | null,
    lastActionMs: row.last_action_ms as number | null, heldWindow: row.held_window as string | null,
  }));
}

export async function loadWindows(db: Queryable, spaceId: number, ruleId?: number): Promise<Array<MaintenanceWindow & { ruleName: string }>> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT w.*, r.name AS rule_name FROM maintenance_windows w JOIN rules r ON r.id = w.rule_id
     WHERE w.space_id = $1 AND ($2::int IS NULL OR w.rule_id = $2) ORDER BY w.id`,
    [spaceId, ruleId ?? null],
  );
  return rows.map((row) => ({
    id: row.id as number, name: row.name as string, timeZone: row.time_zone as string, days: row.days as string[], start: row.start as string,
    durationMs: row.duration_ms as number, ruleId: row.rule_id as number, ruleName: row.rule_name as string,
  }));
}

export const isFlapping = (flags: boolean[]): boolean =>
  flags.slice(-config.settings.flapChecks).filter(Boolean).length >= config.settings.flapChanges;

export const isSnoozed = (group: GroupRow, at: number): boolean =>
  group.snoozeUntilRecovered || (group.snoozedUntilMs !== null && group.snoozedUntilMs > at);

export const maintenanceName = (windows: MaintenanceWindow[], at: number): string | null =>
  windows.find((window) => windowActiveAt(window, at))?.name ?? null;

export function groupView(group: GroupRow, windows: MaintenanceWindow[], at: number) {
  return {
    group: group.name,
    state: group.state,
    since: group.sinceMs === null ? null : formatIso(group.sinceMs),
    flapping: isFlapping(group.changeFlags),
    snoozed: isSnoozed(group, at),
    snoozed_until: group.snoozedUntilMs !== null && group.snoozedUntilMs > at && !group.snoozeUntilRecovered ? formatIso(group.snoozedUntilMs) : null,
    in_maintenance: maintenanceName(windows, at) !== null,
    acknowledged_by: group.acknowledgedBy,
  };
}

export interface HistoryEntry {
  at: string;
  group: string;
  from: GroupState;
  to: GroupState;
}

async function loadHistory(db: Queryable, ruleId: number): Promise<HistoryEntry[]> {
  const { rows } = await db.query<{ at_ms: number; group_name: string; from_state: GroupState; to_state: GroupState }>(
    "SELECT at_ms, group_name, from_state, to_state FROM rule_history WHERE rule_id = $1 ORDER BY id", [ruleId],
  );
  return rows.map((row) => ({ at: formatIso(row.at_ms), group: row.group_name, from: row.from_state, to: row.to_state }));
}

export const lastCheckView = (rule: RuleRow) =>
  rule.lastCheckMs === null ? null : { at: formatIso(rule.lastCheckMs), failed: rule.lastCheckFailed === true };

export async function ruleView(db: Queryable, rule: RuleRow, at: number, withHistory = true) {
  const [groups, windows, history] = await Promise.all([
    loadGroups(db, rule.id), loadWindows(db, rule.spaceId, rule.id), withHistory ? loadHistory(db, rule.id) : Promise.resolve([]),
  ]);
  return {
    id: rule.id, name: rule.name, stream: rule.stream, filter: rule.filter, measure: rule.measure, measure_field: rule.measureField,
    group_by: rule.groupBy, window_ms: rule.windowMs, comparison: rule.comparison, threshold: rule.threshold, frequency: rule.frequency,
    groups: groups.map((group) => groupView(group, windows, at)), last_check: lastCheckView(rule), history,
  };
}

export interface InboxRow {
  id: number;
  rule_id: number;
  group_name: string;
  text: string;
  at_ms: number;
  acknowledged_by: string | null;
}

export const inboxView = (row: InboxRow) => ({
  id: row.id, rule: row.rule_id, group: row.group_name, text: row.text, at: formatIso(row.at_ms), acknowledged_by: row.acknowledged_by,
});

export async function loadInbox(spaceId: number): Promise<InboxRow[]> {
  const { rows } = await pool.query<InboxRow>("SELECT id, rule_id, group_name, text, at_ms, acknowledged_by FROM inbox_items WHERE space_id = $1 ORDER BY at_ms DESC, id DESC", [spaceId]);
  return rows;
}

export const maintenanceView = (window: MaintenanceWindow & { ruleName: string }, at: number) => {
  const next = nextStart(window, at);
  return {
    id: window.id, name: window.name, time_zone: window.timeZone, days: window.days, start: window.start, duration_ms: window.durationMs,
    rule: window.ruleId, rule_name: window.ruleName, next_start: next === null ? null : formatIso(next),
  };
};
