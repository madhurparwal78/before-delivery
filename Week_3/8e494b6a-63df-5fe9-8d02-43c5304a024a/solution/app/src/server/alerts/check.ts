// A rule check (Business rules K and L): measure each group, move its state, decide its action.
import { config } from "../config";
import { now } from "../clock";
import { formatIso } from "../../shared/time";
import { locked, pool } from "../db";
import { emit, type Outgoing } from "../live";
import { findStream } from "../access";
import { loadStreamContext, loadUniverse } from "../search/context";
import { eventValues, matchesFilter } from "../search/filters";
import type { StoredEvent } from "../search/events";
import {
  groupView, inboxView, isFlapping, isSnoozed, lastCheckView, loadGroups, loadRule, loadWindows, maintenanceName,
  type GroupRow, type GroupState, type HistoryEntry, type InboxRow, type RuleRow,
} from "./store";

/** The one place a group's state moves: the published transition table. */
function nextState(state: GroupState, breached: boolean, streak: number): { state: GroupState; streak: number } {
  const enter = (): { state: GroupState; streak: number } =>
    config.settings.pendingChecks <= 1 ? { state: "active", streak: 0 } : { state: "pending", streak: 1 };
  switch (state) {
    case "inactive":
    case "recovered":
      return breached ? enter() : { state: "inactive", streak: 0 };
    case "pending":
      if (!breached) return { state: "inactive", streak: 0 };
      return streak + 1 >= config.settings.pendingChecks ? { state: "active", streak: 0 } : { state: "pending", streak: streak + 1 };
    case "active":
      return breached ? { state: "active", streak } : { state: "recovered", streak: 0 };
  }
}

function measure(rule: RuleRow, events: StoredEvent[]): number | null {
  if (rule.measure === "count") return events.length;
  const numbers = events.flatMap((event) => eventValues(event, rule.measureField ?? "").filter((v): v is number => typeof v === "number"));
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, v) => sum + v, 0);
  switch (rule.measure) {
    case "sum": return total;
    case "avg": return total / numbers.length;
    case "max": return Math.max(...numbers);
    default: return Math.min(...numbers);
  }
}

function breaches(rule: RuleRow, value: number | null): boolean {
  if (value === null) return false;
  switch (rule.comparison) {
    case ">": return value > rule.threshold;
    case ">=": return value >= rule.threshold;
    case "<": return value < rule.threshold;
    default: return value <= rule.threshold;
  }
}

const groupNameOf = (rule: RuleRow, event: StoredEvent): string => {
  if (rule.groupBy === null) return "all";
  const first = eventValues(event, rule.groupBy)[0];
  return first === undefined ? "none" : String(first);
};

type Action = "fired" | "held" | "none";

interface GroupOutcome {
  row: GroupRow;
  value: number | null;
  action: Action;
}

interface CheckResult {
  rule: number;
  checked_at: string;
  failed: boolean;
  groups: Array<{ group: string; state: GroupState; value: number | null; flapping: boolean; snoozed: boolean; in_maintenance: boolean; action: Action }>;
  seq: number;
}

export async function runCheck(ruleId: number, fail: boolean): Promise<CheckResult> {
  const at = now();
  const { rows: owner } = await pool.query<{ space_id: number }>("SELECT space_id FROM rules WHERE id = $1", [ruleId]);
  const spaceId = (owner[0] as { space_id: number }).space_id;
  const done = await locked("rule", ruleId, async (client) => {
    const rule = (await loadRule(client, spaceId, ruleId)) as RuleRow;
    const windows = await loadWindows(client, spaceId, ruleId);
    const existing = await loadGroups(client, ruleId);
    const history: HistoryEntry[] = [];
    const inbox: InboxRow[] = [];
    const announcements: string[] = [];
    let outcomes: GroupOutcome[] = existing.map((row) => ({ row, value: null, action: "none" }));

    if (!fail) {
      const stream = await findStream(spaceId, rule.stream);
      const universe = stream ? await loadUniverse(await loadStreamContext(stream, spaceId), at - rule.windowMs + 1, at + 1) : null;
      const events = (universe?.events ?? []).filter((event) => !rule.filter || matchesFilter(event, rule.filter));
      const byGroup = new Map<string, StoredEvent[]>();
      for (const event of events) {
        const name = groupNameOf(rule, event);
        byGroup.set(name, [...(byGroup.get(name) ?? []), event]);
      }
      const known = new Map(existing.map((row) => [row.name, row]));
      for (const name of byGroup.keys()) {
        if (!known.has(name)) {
          known.set(name, { name, state: "inactive", sinceMs: null, streak: 0, changeFlags: [], snoozedUntilMs: null, snoozeUntilRecovered: false, acknowledgedBy: null, lastActionMs: null, heldWindow: null });
        }
      }
      outcomes = [];
      for (const row of [...known.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const since = row.sinceMs;
        const counted = (byGroup.get(row.name) ?? []).filter((event) => since === null || event.ts > since);
        const value = measure(rule, counted);
        const moved = nextState(row.state, breaches(rule, value), row.streak);
        const changed = moved.state !== row.state;
        const next: GroupRow = { ...row, state: moved.state, streak: moved.streak, changeFlags: [...row.changeFlags, changed].slice(-config.settings.flapChecks) };
        if (changed) {
          history.push({ at: formatIso(at), group: row.name, from: row.state, to: moved.state });
          announcements.push(`Group ${row.name} is now ${moved.state}`);
          if (moved.state === "active" || moved.state === "recovered") next.sinceMs = at;
          if (moved.state === "recovered") {
            next.snoozedUntilMs = null;
            next.snoozeUntilRecovered = false;
          }
        }
        const windowName = maintenanceName(windows, at);
        const flapping = isFlapping(next.changeFlags);
        const snoozed = isSnoozed(next, at);
        let action: Action = "none";
        let text: string | null = null;
        if (next.heldWindow !== null && windowName === null) {
          if (next.state === "active" && !snoozed && !flapping) {
            text = `${row.name} is still active after maintenance window ${next.heldWindow} on rule ${rule.name}`;
            action = "fired";
          }
          next.heldWindow = null;
        }
        if (action === "none") {
          const frequency = rule.frequency;
          const wants =
            frequency.kind === "change" ? changed && (moved.state === "active" || moved.state === "recovered")
            : frequency.kind === "check" ? moved.state === "active"
            : moved.state === "active" && (next.lastActionMs === null || at - next.lastActionMs >= frequency.every_ms);
          if (wants) {
            if (flapping || snoozed) action = "held";
            else if (windowName !== null) {
              action = "held";
              next.heldWindow = windowName;
            } else {
              action = "fired";
              text = `${row.name} is ${moved.state} on rule ${rule.name}`;
            }
          }
        }
        if (action === "fired" && text !== null) {
          next.lastActionMs = at;
          next.acknowledgedBy = null;
          const { rows } = await client.query<InboxRow>(
            "INSERT INTO inbox_items (space_id, rule_id, group_name, text, at_ms) VALUES ($1, $2, $3, $4, $5) RETURNING id, rule_id, group_name, text, at_ms, acknowledged_by",
            [spaceId, ruleId, row.name, text, at],
          );
          inbox.push(rows[0] as InboxRow);
        }
        await client.query(
          `INSERT INTO rule_groups (rule_id, name, state, since_ms, streak, change_flags, snoozed_until_ms, snooze_until_recovered, acknowledged_by, last_action_ms, held_window)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (rule_id, name) DO UPDATE SET state = $3, since_ms = $4, streak = $5, change_flags = $6, snoozed_until_ms = $7,
             snooze_until_recovered = $8, acknowledged_by = $9, last_action_ms = $10, held_window = $11`,
          [ruleId, next.name, next.state, next.sinceMs, next.streak, JSON.stringify(next.changeFlags), next.snoozedUntilMs, next.snoozeUntilRecovered, next.acknowledgedBy, next.lastActionMs, next.heldWindow],
        );
        outcomes.push({ row: next, value, action });
      }
      for (const entry of history) {
        await client.query(
          "INSERT INTO rule_history (rule_id, at_ms, group_name, from_state, to_state) VALUES ($1, $2, $3, $4, $5)",
          [ruleId, at, entry.group, entry.from, entry.to],
        );
      }
    }
    await client.query("UPDATE rules SET last_check_ms = $2, last_check_failed = $3 WHERE id = $1", [ruleId, at, fail]);
    return { rule: { ...rule, lastCheckMs: at, lastCheckFailed: fail }, windows, outcomes, history, inbox, announcements };
  });

  const views = done.outcomes.map((outcome) => groupView(outcome.row, done.windows, at));
  const messages: Outgoing[] = [
    { type: "alert", data: { rule: ruleId, last_check: lastCheckView(done.rule), groups: views, history: done.history, announcements: done.announcements } },
    ...done.inbox.map((item): Outgoing => ({ type: "inbox", data: { item: inboxView(item) } })),
  ];
  const seq = await emit(spaceId, messages);
  return {
    rule: ruleId,
    checked_at: formatIso(at),
    failed: fail,
    groups: done.outcomes.map((outcome, k) => {
      const view = views[k] as (typeof views)[number];
      return { group: view.group, state: view.state, value: outcome.value, flapping: view.flapping, snoozed: view.snoozed, in_maintenance: view.in_maintenance, action: outcome.action };
    }),
    seq,
  };
}

export async function runAllChecks(): Promise<void> {
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM rules");
  for (const { id } of rows) await runCheck(id, false);
}
