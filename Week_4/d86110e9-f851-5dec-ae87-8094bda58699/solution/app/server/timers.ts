import { findAutomation, versionContent } from './automations.js';
import { machineMs, workspaceNow, iso } from './clock.js';
import { config } from './config.js';
import { db } from './db.js';
import { fireTimer, settleWorkspace, startRun, trackWork } from './engine.js';
import { followingFiring, parseSchedule } from './schedule.js';

interface DueTimer {
  id: string;
  at: number;
}

interface DueSchedule {
  id: string;
  at: number;
}

async function fireSchedule(workspaceId: string, automationId: string, instant: number): Promise<void> {
  const claimed = await db.tx(async (client) => {
    const row = await findAutomation(client, workspaceId, automationId, true);
    if (row === null || row.schedule_next_at !== instant) return null;
    const live = await versionContent(client, automationId, row.live_version as number);
    const schedule = parseSchedule(String(live?.content.trigger.fields.schedule));
    if (schedule === null) {
      await client.query('UPDATE automations SET schedule_next_at = NULL WHERE id = $1', [automationId]);
      return null;
    }
    const claim = await client.query('INSERT INTO schedule_claims (automation_id, instant) VALUES ($1, $2) ON CONFLICT DO NOTHING', [automationId, instant]);
    await client.query('UPDATE automations SET schedule_next_at = $2 WHERE id = $1', [automationId, followingFiring(schedule, instant)]);
    return claim.rowCount === 1 ? row : null;
  });
  if (claimed !== null) await startRun({ workspaceId, automation: claimed, test: false, triggerOutput: { fired_at: iso(instant) }, at: instant });
}

/** Fires every timer and schedule of the workspace that is due, earliest first, and lets each run go as far as it can. */
export async function processDue(workspaceId: string): Promise<void> {
  await settleWorkspace(workspaceId);
  for (;;) {
    const now = await workspaceNow(workspaceId);
    const timers = await db.query<DueTimer>(
      'SELECT id, timer_at AS at FROM runs WHERE workspace_id = $1 AND owner_instance = $2 AND timer_at IS NOT NULL AND timer_at <= $3 ORDER BY timer_at LIMIT 1',
      [workspaceId, config.instanceId, now],
    );
    const schedules = await db.query<DueSchedule>(
      `SELECT id, schedule_next_at AS at FROM automations WHERE workspace_id = $1 AND schedule_owner = $2 AND live_version IS NOT NULL
         AND schedule_next_at IS NOT NULL AND schedule_next_at <= $3 ORDER BY schedule_next_at LIMIT 1`,
      [workspaceId, config.instanceId, now],
    );
    const timer = timers.rows[0];
    const schedule = schedules.rows[0];
    if (timer === undefined && schedule === undefined) break;
    if (timer !== undefined && (schedule === undefined || timer.at <= schedule.at)) await fireTimer(timer.id, timer.at);
    else if (schedule !== undefined) await trackWork(workspaceId, fireSchedule(workspaceId, schedule.id, schedule.at));
    await settleWorkspace(workspaceId);
  }
}

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = machineMs();
    const { rows } = await db.query<{ workspace_id: string }>(
      `SELECT r.workspace_id FROM runs r JOIN workspaces w ON w.id = r.workspace_id
         WHERE r.owner_instance = $1 AND r.timer_at IS NOT NULL AND r.timer_at <= $2 + w.clock_offset_ms
       UNION
       SELECT a.workspace_id FROM automations a JOIN workspaces w ON w.id = a.workspace_id
         WHERE a.schedule_owner = $1 AND a.schedule_next_at IS NOT NULL AND a.schedule_next_at <= $2 + w.clock_offset_ms`,
      [config.instanceId, now],
    );
    for (const row of rows) await processDue(row.workspace_id);
  } finally {
    ticking = false;
  }
}

export function startTicker(): NodeJS.Timeout {
  return setInterval(() => {
    tick().catch((error: unknown) => console.error('tick failed', error));
  }, config.scheduleTickSeconds * 1000);
}
