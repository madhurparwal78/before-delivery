// The timer and schedule loop. Each instance fires only the timers and
// schedules it owns (owner_port = its own port), in due-time order.

import { db } from "./db.js";
import { timersRepo, automationsAll, versionsRepo } from "./repo.js";
import { fireTimer, startRun, PORT } from "./engine.js";
import { parseSchedule, nextAfter } from "./schedule.js";
import { realNowMs } from "./clock.js";

// Fires every due timer owned by this instance, oldest first. When offset
// is given (a clock call) it uses that offset directly.
export async function runDueTimers(offsetOverride: number | null): Promise<void> {
  const offset = offsetOverride ?? 0;
  const now = new Date(realNowMs() + offset * 1000);
  const due = await timersRepo.dueForPort(db, PORT, now);
  for (const t of due) {
    await fireTimer(t.id);
  }
}

// Fires every schedule owned by this instance whose time has come, once per
// instant, and re-anchors the next firing.
export async function runDueSchedules(offsetOverride: number | null): Promise<void> {
  const offset = offsetOverride ?? 0;
  const nowMs = realNowMs() + offset * 1000;
  const autos = await automationsAll.listAll(db);
  for (const a of autos) {
    if (a.live_version === null || a.trigger_kind !== "schedule") continue;
    const r = await db.query("SELECT next_fire_at FROM automations WHERE id=$1", [a.id]);
    const nf = r.rows[0]?.next_fire_at as Date | null;
    if (!nf) continue;
    const nextMs = new Date(nf).getTime();
    if (nextMs > nowMs) continue;
    const v = await versionsRepo.get(db, a.id, a.live_version);
    if (!v) continue;
    const spec = parseSchedule(String(v.content.trigger.fields.schedule ?? ""));
    if (!spec) continue;
    // fire every missed instant in order, once each; the schedule is owned
    // by the instance that published the live version (owner_port = PORT is
    // checked when the runs are claimed, and this loop only runs locally)
    for (let cur = nextMs; cur <= nowMs; cur = nextAfter(spec, cur)) {
      const firedAt = new Date(cur);
      await startRun({ wsId: a.workspace_id, aid: a.id, version: a.live_version, test: false, triggerOutput: { fired_at: firedAt.toISOString() } });
    }
    await db.query("UPDATE automations SET next_fire_at=$1 WHERE id=$2", [new Date(nextAfter(spec, nowMs)), a.id]);
  }
}
