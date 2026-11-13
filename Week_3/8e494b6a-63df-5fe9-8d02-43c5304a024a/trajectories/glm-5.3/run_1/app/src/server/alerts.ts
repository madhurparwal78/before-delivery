/**
 * Alert rules (rule K) and alert handling (rule L): the group state machine, checks,
 * flapping, snoozes, maintenance windows and actions.
 */
import type { PoolClient } from "pg";
import type { Comparison, Filter, GroupState } from "../shared/types";
import { config } from "./config";
import { nowMs } from "./clock";
import { errors } from "./errors";
import { flatten, valuesOf } from "../shared/util";
import { broadcastToSpace } from "./bus";
import { nextId } from "./db";

export type Measure = "count" | "avg" | "max" | "min" | "sum";
export type Frequency =
  | { kind: "change" }
  | { kind: "check" }
  | { kind: "throttle"; every_ms: number };

export interface RuleRow {
  id: string;
  space_id: string;
  name: string;
  stream_id: string;
  filter: { field: string; op: Filter["op"]; value: unknown } | null;
  measure: Measure;
  measure_field: string | null;
  group_by: string | null;
  window_ms: number;
  comparison: Comparison;
  threshold: number;
  frequency: Frequency;
  last_check_at: Date | null;
  last_check_failed: boolean;
}

export interface GroupRow {
  id: string;
  rule_id: string;
  group: string;
  state: GroupState;
  since: Date;
  entered_at: Date;
  streak: number;
  snoozed_until: Date | null;
  snooze_kind: string | null;
  acknowledged_by: string | null;
  held_action: boolean;
  history: { at: string; from: GroupState; to: GroupState }[];
  change_log: { at: string; changed: boolean }[];
  last_action_at: Date | null;
}

export interface CheckResult {
  group: string;
  state: GroupState;
  value: number;
  flapping: boolean;
  snoozed: boolean;
  in_maintenance: boolean;
  action: "fired" | "held" | "none";
  changed: boolean;
}

const TRANSITIONS: Record<GroupState, { breached: GroupState; cleared: GroupState }> = {
  inactive: { breached: "pending", cleared: "inactive" },
  pending: { breached: "active", cleared: "inactive" },
  active: { breached: "active", cleared: "recovered" },
  recovered: { breached: "pending", cleared: "inactive" },
};

export async function getRule(db: PoolClient, ruleId: string): Promise<RuleRow | null> {
  const res = await db.query("SELECT * FROM rules WHERE id = $1", [ruleId]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    space_id: r.space_id,
    name: r.name,
    stream_id: r.stream_id,
    filter: r.filter ?? null,
    measure: r.measure,
    measure_field: r.measure_field,
    group_by: r.group_by,
    window_ms: Number(r.window_ms),
    comparison: r.comparison,
    threshold: Number(r.threshold),
    frequency: r.frequency,
    last_check_at: r.last_check_at ? new Date(r.last_check_at) : null,
    last_check_failed: r.last_check_failed,
  };
}

export async function listGroups(db: PoolClient, ruleId: string): Promise<GroupRow[]> {
  const res = await db.query("SELECT * FROM rule_groups WHERE rule_id = $1 ORDER BY \"group\"", [ruleId]);
  return res.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    rule_id: String(r.rule_id),
    group: String(r.group),
    state: r.state as GroupState,
    since: new Date(r.since as string),
    entered_at: new Date(r.entered_at as string),
    streak: Number(r.streak),
    snoozed_until: r.snoozed_until ? new Date(r.snoozed_until as string) : null,
    snooze_kind: (r.snooze_kind as string) ?? null,
    acknowledged_by: (r.acknowledged_by as string) ?? null,
    held_action: Boolean(r.held_action),
    history: (r.history as GroupRow["history"]) ?? [],
    change_log: (r.change_log as GroupRow["change_log"]) ?? [],
    last_action_at: r.last_action_at ? new Date(r.last_action_at as string) : null,
  }));
}

/** Measure a group's value at check time T (rule K). */
async function measureGroup(
  db: PoolClient,
  rule: RuleRow,
  group: string | null,
  sinceMs: number | null,
  now: number,
): Promise<number | null> {
  const args: unknown[] = [rule.stream_id, new Date(0), new Date(now)];
  let where = "generation_id IN (SELECT id FROM generations WHERE stream_id = $1)";
  if (sinceMs !== null) {
    args.push(new Date(sinceMs));
    where += ` AND ts > $${args.length}`;
  }
  // Fix parameter numbering for the range bounds.
  const params: unknown[] = [rule.stream_id];
  let sql = "SELECT fields, ts FROM events WHERE generation_id IN (SELECT id FROM generations WHERE stream_id = $1)";
  if (sinceMs !== null) {
    params.push(new Date(sinceMs));
    sql += ` AND ts > $${params.length}`;
  }
  params.push(new Date(now));
  sql += ` AND ts <= $${params.length}`;
  const res = await db.query<{ fields: Record<string, unknown>; ts: Date }>(sql, params);
  let total = 0;
  let count = 0;
  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  for (const row of res.rows) {
    const flat = flatten(row.fields);
    if (rule.filter) {
      if (!filterHolds(flat[rule.filter.field], rule.filter.op, rule.filter.value)) continue;
    }
    if (rule.group_by) {
      const g = flat[rule.group_by];
      const gname = g === undefined ? "none" : String(valuesOf(g)[0] ?? "none");
      if (group !== null && gname !== group) continue;
    }
    if (rule.measure === "count") {
      total += 1;
      continue;
    }
    const v = flat[rule.measure_field ?? ""];
    for (const num of valuesOf(v)) {
      if (typeof num !== "number") continue;
      count += 1;
      sum += num;
      if (num > max) max = num;
      if (num < min) min = num;
    }
  }
  switch (rule.measure) {
    case "count":
      return total;
    case "avg":
      return count === 0 ? null : sum / count;
    case "max":
      return count === 0 ? null : max;
    case "min":
      return count === 0 ? null : min;
    case "sum":
      return sum;
  }
}

function filterHolds(value: unknown, op: string, target: unknown): boolean {
  const vals = valuesOf(value);
  switch (op) {
    case "eq":
      return vals.some((v) => v === target);
    case "ne":
      return !vals.some((v) => v === target);
    case "exists":
      return vals.length > 0 && vals.every((v) => v !== null && v !== undefined);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const t = typeof target === "number" ? target : Number(target);
      if (isNaN(t)) return false;
      const nums = vals.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return false;
      if (op === "gt") return nums.some((v) => v > t);
      if (op === "gte") return nums.some((v) => v >= t);
      if (op === "lt") return nums.some((v) => v < t);
      return nums.some((v) => v <= t);
    }
  }
  return false;
}

export function breached(value: number | null, comparison: Comparison, threshold: number): boolean {
  if (value === null) return false;
  switch (comparison) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
  }
}

export interface MaintenanceWindow {
  id: string;
  space_id: string;
  name: string;
  time_zone: string;
  days: string;
  start: string;
  duration_ms: number;
  rule_id: string;
}

export async function listMaintenance(db: PoolClient, spaceId: string): Promise<MaintenanceWindow[]> {
  const res = await db.query("SELECT * FROM maintenance WHERE space_id = $1 ORDER BY id", [spaceId]);
  return res.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    space_id: String(r.space_id),
    name: String(r.name),
    time_zone: String(r.time_zone),
    days: String(r.days),
    start: String(r.start),
    duration_ms: Number(r.duration_ms),
    rule_id: String(r.rule_id),
  }));
}

/** Is a group inside a maintenance window at time T (rule L)? */
export function inMaintenanceNow(windows: MaintenanceWindow[], ruleId: string, now: number): boolean {
  for (const w of windows) {
    if (w.rule_id !== ruleId) continue;
    if (windowActiveAt(w, now)) return true;
  }
  return false;
}

/** Local wall start of a window on one of its days, resolved in its zone. */
export function windowActiveAt(w: MaintenanceWindow, now: number): boolean {
  const { localParts, zoneOffsetMs } = require("../shared/tz") as typeof import("../shared/tz");
  const days = w.days.split(",");
  const [h, m] = w.start.split(":").map(Number);
  // Try each candidate instant around now: walk the window's start times near now.
  for (let delta of [-86400000, -172800000, 0]) {
    const candidate = now + delta;
    const p = localParts(w.time_zone, candidate);
    const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    if (!days.includes(dow)) continue;
    const startWall = Date.UTC(p.year, p.month - 1, p.day, h, m, 0);
    // Resolve wall time in the zone: iterate candidate offsets.
    const offsets: number[] = [];
    for (let t = startWall - 26 * 3600000; t <= startWall + 26 * 3600000; t += 15 * 60000) {
      const off = zoneOffsetMs(w.time_zone, t);
      if (!offsets.includes(off)) offsets.push(off);
    }
    const starts: number[] = [];
    for (const off of offsets) {
      const ms = startWall - off;
      const q = localParts(w.time_zone, ms);
      if (q.year === p.year && q.month === p.month && q.day === p.day && q.hour === h && q.minute === m) {
        starts.push(ms);
      }
    }
    if (starts.length === 0) {
      // start inside a DST gap: begins at the same distance after the gap
      const sorted = offsets.sort((a, b) => a - b);
      const off = sorted[sorted.length - 1];
      const ms = startWall - off;
      const q = localParts(w.time_zone, ms);
      if (q.day === p.day && q.month === p.month && q.year === p.year) {
        starts.push(ms);
      }
      continue;
    }
    const start = starts[0];
    if (start <= now && now < start + w.duration_ms) return true;
  }
  return false;
}

/** The next start of a window after now, on the server clock. */
export function nextWindowStart(w: MaintenanceWindow, now: number): number {
  const { localParts, zoneOffsetMs } = require("../shared/tz") as typeof import("../shared/tz");
  const days = w.days.split(",");
  const [h, m] = w.start.split(":").map(Number);
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidate = now + dayOffset * 86400000 + 12 * 3600000;
    const p = localParts(w.time_zone, candidate);
    const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    if (!days.includes(dow)) continue;
    const startWall = Date.UTC(p.year, p.month - 1, p.day, h, m, 0);
    const offsets: number[] = [];
    for (let t = startWall - 26 * 3600000; t <= startWall + 26 * 3600000; t += 15 * 60000) {
      const off = zoneOffsetMs(w.time_zone, t);
      if (!offsets.includes(off)) offsets.push(off);
    }
    const starts: number[] = [];
    for (const off of offsets) {
      const ms = startWall - off;
      const q = localParts(w.time_zone, ms);
      if (q.year === p.year && q.month === p.month && q.day === p.day && q.hour === h && q.minute === m) {
        starts.push(ms);
      }
    }
    if (starts.length === 0) continue;
    const start = starts[0];
    if (start > now) return start;
  }
  return now;
}

export interface CheckOutcome {
  rule: string;
  checked_at: string;
  failed: boolean;
  groups: CheckResult[];
  seq: number;
  announcements: string[];
}

/** Run one check of a rule (rule K + rule L). */
export async function runCheck(
  db: PoolClient,
  ruleId: string,
  fail: boolean,
  username: string | null,
): Promise<Omit<CheckOutcome, "seq">> {
  const rule = await getRule(db, ruleId);
  if (!rule) throw errors.notFound();
  const now = nowMs();
  const groups = await listGroups(db, rule.id);
  const windows = await listMaintenance(db, rule.space_id);
  const results: CheckResult[] = [];
  const announcements: string[] = [];

  if (fail) {
    await db.query("UPDATE rules SET last_check_at = $1, last_check_failed = TRUE WHERE id = $2", [
      new Date(now),
      rule.id,
    ]);
    for (const g of groups) {
      results.push({
        group: g.group,
        state: g.state,
        value: 0,
        flapping: isFlapping(g),
        snoozed: isSnoozed(g, now),
        in_maintenance: inMaintenanceNow(windows, rule.id, now),
        action: "none",
        changed: false,
      });
    }
    return { rule: rule.id, checked_at: new Date(now).toISOString(), failed: true, groups: results, announcements };
  }

  // Discover groups from events.
  const discovered = await discoverGroups(db, rule, now);
  for (const name of discovered) {
    if (!groups.some((g) => g.group === name)) {
      await db.query(
        `INSERT INTO rule_groups (id, rule_id, "group", state, since, entered_at, streak, held_action, history, change_log)
         VALUES ($1,$2,$3,'inactive',$4,$4,0,FALSE,'[]','[]') ON CONFLICT DO NOTHING`,
        [nextId(), rule.id, name, new Date(now)],
      );
    }
  }
  const allGroups = await listGroups(db, rule.id);
  const pendingChecks = config().settings.pending_checks;

  for (const g of allGroups) {
    const sinceMs = g.entered_at.getTime();
    const value = await measureGroup(db, rule, g.group, sinceMs, now);
    const isBreached = breached(value, rule.comparison, rule.threshold);
    const prev = g.state;
    const t = TRANSITIONS[prev];
    let next: GroupState = prev;
    if (isBreached) {
      const streak = g.streak + 1;
      g.streak = streak;
      if (prev === "pending" || streak >= pendingChecks) {
        next = streak >= pendingChecks ? "active" : "pending";
      } else {
        next = t.breached;
      }
    } else {
      g.streak = 0;
      next = t.cleared;
      if (prev === "inactive") next = "inactive";
    }
    await db.query("UPDATE rule_groups SET streak = $1 WHERE id = $2", [g.streak, g.id]);
    const changed = next !== prev;
    const flappingAfter = changed ? isFlappingAfter(g) : isFlapping(g);
    const snoozed = isSnoozed(g, now) && g.state !== "recovered";
    const maintenance = inMaintenanceNow(windows, rule.id, now);
    let action: "fired" | "held" | "none" = "none";

    if (changed) {
      await recordTransition(db, g, next, now);
      announcements.push(`Group ${g.group} is now ${next}`);
    }
    g.state = next;

    const enteringActive = changed && next === "active";
    const enteringRecovered = changed && next === "recovered";
    const shouldFire =
      !flappingAfter && !snoozed && !maintenance && (enteringActive || (next === "active" && firesOnCheck(rule, g, now)));
    const maintenanceHeld = maintenance && next === "active";
    if (maintenanceHeld) {
      await db.query("UPDATE rule_groups SET held_action = TRUE WHERE id = $1", [g.id]);
      g.held_action = true;
    } else if (shouldFire) {
      await fireAction(db, rule, g, next, now, username);
      action = "fired";
      await db.query("UPDATE rule_groups SET last_action_at = $1 WHERE id = $2", [new Date(now), g.id]);
    }
    results.push({
      group: g.group,
      state: next,
      value: value ?? 0,
      flapping: flappingAfter,
      snoozed,
      in_maintenance: maintenance,
      action,
      changed,
    });
  }

  // Fire held actions when a window has ended (rule L fire rule).
  for (const g of allGroups) {
    if (!g.held_action) continue;
    const maintenance = inMaintenanceNow(windows, rule.id, now);
    if (maintenance) continue;
    if (g.state !== "active") {
      await db.query("UPDATE rule_groups SET held_action = FALSE WHERE id = $1", [g.id]);
      continue;
    }
    if (isSnoozed(g, now)) continue;
    if (isFlapping(g)) continue;
    await fireHeldAction(db, rule, g, now, windows);
  }

  await db.query("UPDATE rules SET last_check_at = $1, last_check_failed = FALSE WHERE id = $2", [
    new Date(now),
    rule.id,
  ]);
  return {
    rule: rule.id,
    checked_at: new Date(now).toISOString(),
    failed: false,
    groups: results,
    announcements,
  };
}

async function discoverGroups(db: PoolClient, rule: RuleRow, now: number): Promise<string[]> {
  const params: unknown[] = [rule.stream_id];
  let sql = "SELECT fields FROM events WHERE generation_id IN (SELECT id FROM generations WHERE stream_id = $1)";
  params.push(new Date(rule.window_ms !== 0 ? now - rule.window_ms : now));
  sql += ` AND ts > $${params.length}`;
  params.push(new Date(now));
  sql += ` AND ts <= $${params.length}`;
  const res = await db.query<{ fields: Record<string, unknown> }>(sql, params);
  const groups = new Set<string>();
  for (const row of res.rows) {
    const flat = flatten(row.fields);
    if (rule.filter && !filterHolds(flat[rule.filter.field], rule.filter.op, rule.filter.value)) continue;
    if (rule.group_by) {
      const g = flat[rule.group_by];
      groups.add(g === undefined ? "none" : String(valuesOf(g)[0] ?? "none"));
    } else {
      groups.add("all");
    }
  }
  return [...groups];
}

function firesOnCheck(rule: RuleRow, g: GroupRow, now: number): boolean {
  const freq = rule.frequency;
  if (freq.kind === "change") return false;
  if (freq.kind === "check") return g.state === "active";
  const last = g.last_action_at?.getTime() ?? null;
  return last === null || now - last >= freq.every_ms;
}

/**
 * Record a state change. `entered_at` (the B of rule K) only moves when the group
 * enters active or recovered, so no event counts toward two state changes.
 */
async function recordTransition(db: PoolClient, g: GroupRow, next: GroupState, now: number): Promise<void> {
  const at = new Date(now).toISOString();
  const history = [...g.history, { at, from: g.state, to: next }];
  const changeLog = [...g.change_log, { at, changed: true }].slice(-config().settings.flap_checks);
  const resetsB = next === "active" || next === "recovered";
  await db.query(
    `UPDATE rule_groups SET state = $1, since = $2, entered_at = $3, history = $4, change_log = $5 WHERE id = $6`,
    [next, new Date(now), resetsB ? new Date(now) : g.entered_at, JSON.stringify(history), JSON.stringify(changeLog), g.id],
  );
  g.history = history;
  g.change_log = changeLog;
}

function changeCount(g: GroupRow): number {
  const look = g.change_log.slice(-config().settings.flap_checks);
  return look.filter((e) => e.changed).length;
}

function isFlapping(g: GroupRow): boolean {
  return changeCount(g) >= config().settings.flap_changes;
}

function isFlappingAfter(g: GroupRow): boolean {
  return isFlapping(g);
}

export function isSnoozed(g: GroupRow, now: number): boolean {
  if (g.snooze_kind === "recovered") return g.state !== "recovered";
  if (g.snoozed_until === null) return false;
  return now < g.snoozed_until.getTime();
}

async function fireAction(
  db: PoolClient,
  rule: RuleRow,
  g: GroupRow,
  state: GroupState,
  now: number,
  username: string | null,
): Promise<void> {
  const text = `${g.group} is ${state} on rule ${rule.name}`;
  await db.query(
    'INSERT INTO inbox (space_id, rule_id, rule_name, "group", text, at) VALUES ($1,$2,$3,$4,$5,$6)',
    [rule.space_id, rule.id, rule.name, g.group, text, new Date(now)],
  );
  await db.query("UPDATE rule_groups SET held_action = FALSE WHERE id = $1", [g.id]);
}

async function fireHeldAction(
  db: PoolClient,
  rule: RuleRow,
  g: GroupRow,
  now: number,
  windows: MaintenanceWindow[],
): Promise<void> {
  const window = windows.find((w) => w.rule_id === rule.id);
  const text = `${g.group} is still active after maintenance window ${window?.name ?? ""} on rule ${rule.name}`;
  await db.query(
    'INSERT INTO inbox (space_id, rule_id, rule_name, "group", text, at) VALUES ($1,$2,$3,$4,$5,$6)',
    [rule.space_id, rule.id, rule.name, g.group, text, new Date(now)],
  );
  await db.query("UPDATE rule_groups SET held_action = FALSE, last_action_at = $1 WHERE id = $2", [
    new Date(now),
    g.id,
  ]);
  g.held_action = false;
}
