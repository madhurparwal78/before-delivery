// Acknowledging, snoozing, and the overlay changes a clock move causes.
import { now } from "../clock";
import { pool } from "../db";
import { deliverClock, emit, type Outgoing } from "../live";
import { groupView, inboxView, isSnoozed, loadGroups, loadWindows, maintenanceName, type GroupRow, type InboxRow, type RuleRow } from "./store";
import type { MaintenanceWindow } from "./maintenance";

export const SNOOZE_MS = { "1h": 3_600_000, "1d": 86_400_000 } as const;
export type SnoozeFor = keyof typeof SNOOZE_MS | "recovered";

async function groupMessage(rule: RuleRow, name: string, announcements: string[]): Promise<Outgoing> {
  const at = now();
  const [groups, windows] = await Promise.all([loadGroups(pool, rule.id), loadWindows(pool, rule.spaceId, rule.id)]);
  const view = groups.filter((g) => g.name === name).map((g) => groupView(g, windows, at));
  return { type: "alert", data: { rule: rule.id, groups: view, history: [], announcements } };
}

export async function snoozeGroup(rule: RuleRow, name: string, duration: SnoozeFor): Promise<number> {
  const until = duration === "recovered" ? null : now() + SNOOZE_MS[duration];
  await pool.query(
    "UPDATE rule_groups SET snoozed_until_ms = $3, snooze_until_recovered = $4 WHERE rule_id = $1 AND name = $2",
    [rule.id, name, until, duration === "recovered"],
  );
  return emit(rule.spaceId, [await groupMessage(rule, name, [])]);
}

/** Acknowledges the group and each of its unacknowledged inbox items; the first acknowledger is the one recorded. */
export async function acknowledgeGroup(rule: RuleRow, name: string, username: string): Promise<number> {
  const { rowCount } = await pool.query("UPDATE rule_groups SET acknowledged_by = $3 WHERE rule_id = $1 AND name = $2 AND acknowledged_by IS NULL", [rule.id, name, username]);
  const { rows } = await pool.query<InboxRow>(
    `UPDATE inbox_items SET acknowledged_by = $3 WHERE rule_id = $1 AND group_name = $2 AND acknowledged_by IS NULL
     RETURNING id, rule_id, group_name, text, at_ms, acknowledged_by`,
    [rule.id, name, username],
  );
  if (!rowCount && rows.length === 0) return (await pool.query<{ seq: number }>("SELECT seq FROM spaces WHERE id = $1", [rule.spaceId])).rows[0]?.seq ?? 0;
  return emit(rule.spaceId, [
    await groupMessage(rule, name, [`Acknowledged Group ${name}`]),
    ...rows.map((item): Outgoing => ({ type: "inbox", data: { item: inboxView(item) } })),
  ]);
}

export async function acknowledgeItem(spaceId: number, id: number, username: string): Promise<{ item: InboxRow; seq: number }> {
  const { rows } = await pool.query<InboxRow>(
    `UPDATE inbox_items SET acknowledged_by = COALESCE(acknowledged_by, $3) WHERE id = $1 AND space_id = $2
     RETURNING id, rule_id, group_name, text, at_ms, acknowledged_by`,
    [id, spaceId, username],
  );
  const item = rows[0] as InboxRow;
  const seq = await emit(spaceId, [{ type: "inbox", data: { item: inboxView(item), announcements: [`Acknowledged Group ${item.group_name}`] } }]);
  return { item, seq };
}

interface Overlay {
  spaceId: number;
  rule: number;
  group: GroupRow;
  snoozed: boolean;
  inMaintenance: boolean;
}

async function overlays(at: number): Promise<Map<string, Overlay>> {
  const { rows } = await pool.query<{ rule_id: number; space_id: number }>("SELECT id AS rule_id, space_id FROM rules");
  const { rows: windowRows } = await pool.query<Record<string, unknown>>("SELECT * FROM maintenance_windows");
  const byRule = new Map<number, MaintenanceWindow[]>();
  for (const row of windowRows) {
    const list = byRule.get(row.rule_id as number) ?? [];
    list.push({ id: row.id as number, name: row.name as string, timeZone: row.time_zone as string, days: row.days as string[], start: row.start as string, durationMs: row.duration_ms as number, ruleId: row.rule_id as number });
    byRule.set(row.rule_id as number, list);
  }
  const found = new Map<string, Overlay>();
  for (const { rule_id: rule, space_id: spaceId } of rows) {
    for (const group of await loadGroups(pool, rule)) {
      found.set(`${rule}:${group.name}`, { spaceId, rule, group, snoozed: isSnoozed(group, at), inMaintenance: maintenanceName(byRule.get(rule) ?? [], at) !== null });
    }
  }
  return found;
}

/** Moves the clock and sends a `clock` message to every space, and an `alert` for each group whose overlay changed. */
export async function moveClock(move: () => void): Promise<void> {
  const before = await overlays(now());
  move();
  const at = now();
  const after = await overlays(at);
  const { rows } = await pool.query<{ id: number; seq: number }>("UPDATE spaces SET seq = seq + 1 RETURNING id, seq");
  deliverClock(rows, at);
  for (const [key, overlay] of after) {
    const was = before.get(key);
    if (!was || was.snoozed !== overlay.snoozed || was.inMaintenance !== overlay.inMaintenance) {
      const windows = await loadWindows(pool, overlay.spaceId, overlay.rule);
      await emit(overlay.spaceId, [{ type: "alert", data: { rule: overlay.rule, groups: [groupView(overlay.group, windows, at)], history: [], announcements: [] } }]);
    }
  }
}
