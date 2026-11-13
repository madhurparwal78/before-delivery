import { nowMs } from '../clock.js';
import { one, query } from '../db.js';
import { settings } from '../env.js';
import { generationsOf, loadRange, streamByName } from '../store.js';
import { partsInZone, wallToInstant } from './tz.js';
import { valuesOf, type EventFields } from './mapping.js';
import type { Filter, FilterOp } from './search.js';

export type GroupStateName = 'inactive' | 'pending' | 'active' | 'recovered';

export type Frequency = { kind: 'change' } | { kind: 'check' } | { kind: 'throttle'; every_ms: number };

export type Measure = 'count' | 'avg' | 'max' | 'min' | 'sum';

export type Comparison = '>' | '>=' | '<' | '<=';

export type RuleSpec = {
  stream: string;
  filter: { field: string; op: FilterOp; value?: unknown } | null;
  measure: Measure;
  measure_field: string | null;
  group_by: string | null;
  window_ms: number;
  comparison: Comparison;
  threshold: number;
  frequency: Frequency;
};

export type RuleRow = {
  id: string;
  spaceId: number;
  name: string;
  spec: RuleSpec;
  checks: number;
  lastCheck: { at: string; failed: boolean } | null;
};

export type GroupRow = {
  id: number;
  ruleId: string;
  group: string;
  state: GroupStateName;
  sinceMs: number;
  boundaryMs: number | null;
  pendingCount: number;
  flapping: boolean;
  snoozedUntilMs: number | null;
  snoozeRecovered: boolean;
  lastActionMs: number | null;
  heldWindow: string | null;
  changes: boolean[];
  acknowledgedBy: string | null;
};

export type MaintenanceRow = {
  id: string;
  spaceId: number;
  name: string;
  timeZone: string;
  days: string[];
  start: string;
  durationMs: number;
  ruleId: string;
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Rule K's transition table, the one place a group's next state is decided. */
export function transition(
  state: GroupStateName,
  breached: boolean,
  pendingCount: number,
): { state: GroupStateName; pendingCount: number } {
  const needed = Math.max(1, settings.pendingChecks);
  switch (state) {
    case 'inactive':
      if (!breached) return { state: 'inactive', pendingCount: 0 };
      return needed === 1 ? { state: 'active', pendingCount: 0 } : { state: 'pending', pendingCount: 1 };
    case 'pending':
      if (!breached) return { state: 'inactive', pendingCount: 0 };
      return pendingCount + 1 >= needed
        ? { state: 'active', pendingCount: 0 }
        : { state: 'pending', pendingCount: pendingCount + 1 };
    case 'active':
      return breached ? { state: 'active', pendingCount: 0 } : { state: 'recovered', pendingCount: 0 };
    case 'recovered':
      if (!breached) return { state: 'inactive', pendingCount: 0 };
      return needed === 1 ? { state: 'active', pendingCount: 0 } : { state: 'pending', pendingCount: 1 };
    default:
      return { state: 'inactive', pendingCount: 0 };
  }
}

export function breaches(value: number | null, comparison: Comparison, threshold: number): boolean {
  if (value === null) return false;
  switch (comparison) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    default:
      return false;
  }
}

export function isFlapping(changes: boolean[]): boolean {
  const recent = changes.slice(-settings.flapChecks);
  return recent.filter(Boolean).length >= settings.flapChanges;
}

/** A window's local start on one of its days, with gaps shifted and overlaps taking the first. */
function windowStartsAround(window: MaintenanceRow, atMs: number): number[] {
  const starts: number[] = [];
  const [hour, minute] = window.start.split(':').map((part) => Number(part));
  for (let dayOffset = -2; dayOffset <= 1; dayOffset += 1) {
    const probe = atMs + dayOffset * 86400000;
    const parts = partsInZone(window.timeZone, probe);
    if (!window.days.includes(parts.weekday)) continue;
    const resolved = wallToInstant(window.timeZone, {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour,
      minute,
      second: 0,
    });
    starts.push(resolved.ms);
  }
  return [...new Set(starts)].sort((left, right) => left - right);
}

export function windowCovers(window: MaintenanceRow, atMs: number): boolean {
  return windowStartsAround(window, atMs).some(
    (start) => start <= atMs && atMs < start + window.durationMs,
  );
}

export function nextWindowStart(window: MaintenanceRow, fromMs: number): number {
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const probe = fromMs + dayOffset * 86400000;
    const parts = partsInZone(window.timeZone, probe);
    if (!window.days.includes(parts.weekday)) continue;
    const [hour, minute] = window.start.split(':').map((part) => Number(part));
    const resolved = wallToInstant(window.timeZone, {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour,
      minute,
      second: 0,
    });
    if (resolved.ms >= fromMs) return resolved.ms;
  }
  return fromMs;
}

export function sortDays(days: string[]): string[] {
  return [...days].sort((left, right) => DAY_ORDER.indexOf(left) - DAY_ORDER.indexOf(right));
}

export function groupRowOf(row: Record<string, unknown>): GroupRow {
  return {
    id: Number(row.id),
    ruleId: String(row.rule_id),
    group: String(row.group_name),
    state: String(row.state) as GroupStateName,
    sinceMs: Number(row.since_ms),
    boundaryMs: row.boundary_ms === null ? null : Number(row.boundary_ms),
    pendingCount: Number(row.pending_count),
    flapping: Boolean(row.flapping),
    snoozedUntilMs: row.snoozed_until_ms === null ? null : Number(row.snoozed_until_ms),
    snoozeRecovered: Boolean(row.snooze_recovered),
    lastActionMs: row.last_action_ms === null ? null : Number(row.last_action_ms),
    heldWindow: row.held_window === null ? null : String(row.held_window),
    changes: (row.changes as boolean[]) ?? [],
    acknowledgedBy: row.acknowledged_by === null ? null : String(row.acknowledged_by),
  };
}

export function ruleRowOf(row: Record<string, unknown>): RuleRow {
  return {
    id: String(row.id),
    spaceId: Number(row.space_id),
    name: String(row.name),
    spec: row.spec as RuleSpec,
    checks: Number(row.checks),
    lastCheck: (row.last_check as { at: string; failed: boolean } | null) ?? null,
  };
}

export async function rulesOf(spaceId: number): Promise<RuleRow[]> {
  const rows = await query(`select * from rules where space_id = $1 order by name asc`, [spaceId]);
  return rows.map(ruleRowOf);
}

export async function groupsOf(ruleId: string): Promise<GroupRow[]> {
  const rows = await query(`select * from rule_groups where rule_id = $1 order by group_name asc`, [
    ruleId,
  ]);
  return rows.map(groupRowOf);
}

export async function maintenanceOf(spaceId: number): Promise<MaintenanceRow[]> {
  const rows = await query(`select * from maintenance where space_id = $1 order by name asc`, [spaceId]);
  return rows.map((row) => ({
    id: String(row.id),
    spaceId: Number(row.space_id),
    name: String(row.name),
    timeZone: String(row.time_zone),
    days: row.days as string[],
    start: String(row.start),
    durationMs: Number(row.duration_ms),
    ruleId: String(row.rule_id),
  }));
}

export function snoozedAt(group: GroupRow, atMs: number): boolean {
  if (group.snoozeRecovered) return true;
  return group.snoozedUntilMs !== null && group.snoozedUntilMs > atMs;
}

function measureValue(events: EventFields[], spec: RuleSpec): number | null {
  if (spec.measure === 'count') return events.length;
  const field = spec.measure_field;
  if (!field) return null;
  const numbers: number[] = [];
  for (const fields of events) {
    for (const value of valuesOf(fields[field])) {
      if (typeof value === 'number') numbers.push(value);
    }
  }
  if (numbers.length === 0) return null;
  switch (spec.measure) {
    case 'avg':
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case 'max':
      return Math.max(...numbers);
    case 'min':
      return Math.min(...numbers);
    case 'sum':
      return numbers.reduce((sum, value) => sum + value, 0);
    default:
      return null;
  }
}

function filterHolds(fields: EventFields, filter: Filter | null): boolean {
  if (!filter) return true;
  const values = valuesOf(fields[filter.field]);
  if (filter.op === 'exists') return values.length > 0;
  if (filter.op === 'eq') return values.some((value) => String(value) === String(filter.value));
  if (filter.op === 'ne') return !values.some((value) => String(value) === String(filter.value));
  const bound = Number(filter.value);
  return values.some((value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return false;
    switch (filter.op) {
      case 'gt':
        return numeric > bound;
      case 'gte':
        return numeric >= bound;
      case 'lt':
        return numeric < bound;
      case 'lte':
        return numeric <= bound;
      default:
        return false;
    }
  });
}

export type CheckedGroup = {
  group: string;
  state: GroupStateName;
  value: number | null;
  flapping: boolean;
  snoozed: boolean;
  in_maintenance: boolean;
  action: 'fired' | 'held' | 'none';
  changed: boolean;
};

export type CheckResult = {
  rule: string;
  checkedAtMs: number;
  failed: boolean;
  groups: CheckedGroup[];
  inboxItems: { id: string; text: string; group: string; atMs: number }[];
};

/** One rule check: the one place group state, flapping, overlays and actions are decided. */
export async function runRuleCheck(
  spaceId: number,
  rule: RuleRow,
  options: { fail?: boolean } = {},
): Promise<CheckResult> {
  const at = nowMs();
  const checkNumber = rule.checks + 1;
  if (options.fail) {
    await query(`update rules set last_check = $2 where id = $1`, [
      rule.id,
      JSON.stringify({ at: new Date(at).toISOString(), failed: true }),
    ]);
    const groups = await groupsOf(rule.id);
    const windows = (await maintenanceOf(spaceId)).filter((window) => window.ruleId === rule.id);
    return {
      rule: rule.id,
      checkedAtMs: at,
      failed: true,
      groups: groups.map((group) => ({
        group: group.group,
        state: group.state,
        value: null,
        flapping: group.flapping,
        snoozed: snoozedAt(group, at),
        in_maintenance: windows.some((window) => windowCovers(window, at)),
        action: 'none' as const,
        changed: false,
      })),
      inboxItems: [],
    };
  }

  const stream = await streamByName(spaceId, rule.spec.stream);
  const windows = (await maintenanceOf(spaceId)).filter((window) => window.ruleId === rule.id);
  const inMaintenanceWindow = windows.find((window) => windowCovers(window, at)) ?? null;
  const existing = await groupsOf(rule.id);
  const byGroup = new Map(existing.map((group) => [group.group, group]));

  type Candidate = { fields: EventFields; tsMs: number };
  const perGroup = new Map<string, Candidate[]>();
  if (stream) {
    const generations = await generationsOf(stream.id);
    const load = await loadRange(stream, at - rule.spec.window_ms + 1, at + 1, generations);
    for (const event of load.events) {
      if (!filterHolds(event.fields, rule.spec.filter)) continue;
      const groupName = rule.spec.group_by
        ? (valuesOf(event.fields[rule.spec.group_by])[0] ?? 'none')
        : 'all';
      const key = String(groupName);
      const list = perGroup.get(key) ?? [];
      list.push({ fields: event.fields, tsMs: event.tsMs });
      perGroup.set(key, list);
    }
  }

  const names = new Set<string>([...byGroup.keys(), ...perGroup.keys()]);
  const results: CheckedGroup[] = [];
  const inboxItems: CheckResult['inboxItems'] = [];

  for (const name of [...names].sort()) {
    const group =
      byGroup.get(name) ??
      groupRowOf(
        (await one(
          `insert into rule_groups (rule_id, group_name, state, since_ms) values ($1, $2, 'inactive', $3)
           on conflict (rule_id, group_name) do update set group_name = rule_groups.group_name
           returning *`,
          [rule.id, name, at],
        )) as Record<string, unknown>,
      );
    const boundary = group.boundaryMs ?? Number.NEGATIVE_INFINITY;
    const lowerBound = Math.max(at - rule.spec.window_ms, boundary);
    const events = (perGroup.get(name) ?? []).filter(
      (candidate) => candidate.tsMs > lowerBound && candidate.tsMs <= at,
    );
    const value = measureValue(
      events.map((candidate) => candidate.fields),
      rule.spec,
    );
    const breached = breaches(value, rule.spec.comparison, rule.spec.threshold);
    const next = transition(group.state, breached, group.pendingCount);
    const changed = next.state !== group.state;
    const changes = [...group.changes, changed].slice(-settings.flapChecks);
    const flapping = isFlapping(changes);
    let boundaryMs = group.boundaryMs;
    let snoozedUntil = group.snoozedUntilMs;
    let snoozeRecovered = group.snoozeRecovered;
    let heldWindow = group.heldWindow;
    let lastActionMs = group.lastActionMs;
    let acknowledgedBy = group.acknowledgedBy;
    if (changed && (next.state === 'active' || next.state === 'recovered')) boundaryMs = at;
    if (changed && next.state === 'recovered') {
      snoozedUntil = null;
      snoozeRecovered = false;
      heldWindow = null;
    }
    if (changed && next.state === 'active') acknowledgedBy = null;
    const snoozed = snoozedAt(
      { ...group, snoozedUntilMs: snoozedUntil, snoozeRecovered },
      at,
    );
    const inMaintenance = inMaintenanceWindow !== null;

    let action: 'fired' | 'held' | 'none' = 'none';
    let actionText: string | null = null;
    if (!inMaintenance && heldWindow !== null && next.state === 'active' && !snoozed && !flapping) {
      actionText = `${name} is still active after maintenance window ${heldWindow} on rule ${rule.name}`;
      heldWindow = null;
      action = 'fired';
      lastActionMs = at;
    } else {
      if (!inMaintenance) heldWindow = heldWindow !== null && next.state === 'active' ? heldWindow : null;
      const frequency = rule.spec.frequency;
      let due = false;
      if (frequency.kind === 'change') {
        due = changed && (next.state === 'active' || next.state === 'recovered');
      } else if (frequency.kind === 'check') {
        due = next.state === 'active';
      } else {
        due =
          next.state === 'active' &&
          (group.lastActionMs === null || at - group.lastActionMs >= frequency.every_ms);
      }
      if (due) {
        if (inMaintenance) {
          action = 'held';
          heldWindow = inMaintenanceWindow.name;
        } else if (snoozed || flapping) {
          action = 'held';
        } else {
          action = 'fired';
          actionText = `${name} is ${next.state} on rule ${rule.name}`;
          lastActionMs = at;
        }
      }
    }

    await query(
      `update rule_groups set state = $2, since_ms = $3, boundary_ms = $4, pending_count = $5,
         flapping = $6, snoozed_until_ms = $7, snooze_recovered = $8, last_action_ms = $9,
         held_window = $10, changes = $11, acknowledged_by = $12
       where rule_id = $1 and group_name = $13`,
      [
        rule.id,
        next.state,
        changed ? at : group.sinceMs,
        boundaryMs,
        next.pendingCount,
        flapping,
        snoozedUntil,
        snoozeRecovered,
        lastActionMs,
        heldWindow,
        JSON.stringify(changes),
        acknowledgedBy,
        name,
      ],
    );
    if (changed) {
      await query(
        `insert into rule_history (rule_id, group_name, check_no, at_ms, from_state, to_state)
         values ($1, $2, $3, $4, $5, $6)`,
        [rule.id, name, checkNumber, at, group.state, next.state],
      );
    }
    if (actionText !== null) {
      const inserted = await one<{ id: string }>(
        `insert into inbox (space_id, rule_id, rule_name, group_name, text, at_ms)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [spaceId, rule.id, rule.name, name, actionText, at],
      );
      inboxItems.push({ id: String(inserted?.id), text: actionText, group: name, atMs: at });
    }
    results.push({
      group: name,
      state: next.state,
      value,
      flapping,
      snoozed,
      in_maintenance: inMaintenance,
      action,
      changed,
    });
  }

  await query(`update rules set checks = $2, last_check = $3 where id = $1`, [
    rule.id,
    checkNumber,
    JSON.stringify({ at: new Date(at).toISOString(), failed: false }),
  ]);

  return { rule: rule.id, checkedAtMs: at, failed: false, groups: results, inboxItems };
}
