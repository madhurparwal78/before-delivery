// Cycle rollover: when a cycle ends, its open tasks move to the current cycle as one change.

import { CYCLES, OPEN_STATUSES, isOpen, taskId } from "../shared/catalog.js";
import { bumped, underLock } from "./changes.js";
import { calendar } from "./cycles.js";
import { pool } from "./db.js";
import { cycleIndex } from "./domain.js";
import { ok } from "./tasks.js";

export const rollover = async (): Promise<void> => {
  const { windows, current } = calendar();
  const ended = CYCLES.slice(0, current).map((c) => c.key);
  if (!ended.length) return;
  const { rows } = await pool.query(
    "SELECT 1 FROM tasks WHERE cycle = ANY($1) AND status = ANY($2) LIMIT 1",
    [ended, OPEN_STATUSES],
  );
  if (!rows.length) return;
  await underLock(null, async (w) => {
    const target = windows[current].key;
    const moving = [...w.graph.rows.values()]
      .filter((r) => isOpen(r.status) && r.cycle !== null && cycleIndex(r.cycle) < current)
      .map((r) => r.number)
      .sort((a, b) => a - b);
    if (!moving.length) return ok(null);
    const now = new Date();
    const after = w.graph.with(bumped(w.graph, moving, now).map((r) => ({ ...r, cycle: target })));
    await w.commit({
      kind: "rollover",
      actor: null,
      after,
      saved: moving,
      activity: moving.map((n) => ({ task: n, kind: "rolled", actor: null, changes: { cycle: { from: w.graph.row(n).cycle, to: target } } })),
      undoable: false,
    });
    console.log(`rollover: ${moving.map(taskId).join(", ")} moved to ${target}`);
    return ok(null);
  });
};
