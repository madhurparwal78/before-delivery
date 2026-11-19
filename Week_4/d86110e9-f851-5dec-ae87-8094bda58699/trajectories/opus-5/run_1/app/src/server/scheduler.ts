import { config, instancePort } from './config';
import { one, query } from './db';
import { createRun } from './engine/runs';
import { resumeRun } from './engine/runs';
import { firstFiring, nextFiring, parseSchedule } from './schedule';
import { workspaceNow } from './time';
import type { AutomationContent } from '../shared/types';

/** Publishing anchors a schedule, and the publishing instance owns it. */
export async function anchorSchedule(
  automationId: string,
  version: number,
  content: AutomationContent,
  publishedAt: Date,
): Promise<void> {
  const schedule = content.trigger.kind === 'schedule' ? parseSchedule(content.trigger.fields.schedule) : null;
  if (schedule === null) {
    await query('delete from schedule_claims where automation_id = $1', [automationId]);
    return;
  }
  const text = String(content.trigger.fields.schedule);
  const nextAt = firstFiring(schedule, publishedAt);
  await query(
    `insert into schedule_claims (automation_id, version, schedule, next_at, owner_port)
       values ($1, $2, $3, $4, $5)
       on conflict (automation_id) do update set version = $2, schedule = $3, next_at = $4, owner_port = $5`,
    [automationId, version, text, nextAt, instancePort],
  );
}

interface DueTimer {
  id: string;
  run_id: string;
  due_at: Date;
}

interface DueSchedule {
  automation_id: string;
  workspace_id: string;
  schedule: string;
  next_at: Date;
}

async function dueTimer(workspaceId: string, now: Date): Promise<DueTimer | null> {
  return one<DueTimer>(
    `select t.id, t.run_id, t.due_at from timers t join runs r on r.id = t.run_id
       where t.owner_port = $1 and t.fired = false and t.due_at <= $2 and r.workspace_id = $3
       order by t.due_at, t.id limit 1`,
    [instancePort, now, workspaceId],
  );
}

async function dueSchedule(workspaceId: string, now: Date): Promise<DueSchedule | null> {
  return one<DueSchedule>(
    `select s.automation_id, a.workspace_id, s.schedule, s.next_at from schedule_claims s
       join automations a on a.id = s.automation_id
       where s.owner_port = $1 and s.next_at <= $2 and a.workspace_id = $3
       order by s.next_at, s.automation_id limit 1`,
    [instancePort, now, workspaceId],
  );
}

async function fireTimer(timer: DueTimer): Promise<void> {
  const claimed = await one<{ id: string }>(
    'update timers set fired = true where id = $1 and fired = false returning id',
    [timer.id],
  );
  if (claimed === null) return;
  await resumeRun(timer.run_id);
}

async function fireSchedule(due: DueSchedule): Promise<void> {
  const schedule = parseSchedule(due.schedule);
  if (schedule === null) {
    await query('delete from schedule_claims where automation_id = $1', [due.automation_id]);
    return;
  }
  const following = nextFiring(schedule, due.next_at);
  const claimed = await one<{ automation_id: string }>(
    'update schedule_claims set next_at = $3 where automation_id = $1 and next_at = $2 returning automation_id',
    [due.automation_id, due.next_at, following],
  );
  if (claimed === null) return;
  const live = await one<{ version: number; content: AutomationContent }>(
    `select v.version, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version
       where a.id = $1`,
    [due.automation_id],
  );
  if (live === null) return;
  await createRun({
    workspaceId: due.workspace_id,
    automationId: due.automation_id,
    version: live.version,
    content: live.content,
    triggerOutput: { fired_at: due.next_at.toISOString() },
    test: false,
  });
}

let firing: Promise<void> = Promise.resolve();

function serialise(work: () => Promise<void>): Promise<void> {
  const next = firing.catch(() => undefined).then(work);
  firing = next.catch(() => undefined);
  return next;
}

/**
 * Fires every timer and schedule this instance owns that is due on the workspace clock,
 * in time order, and resumes each run as far as it can go without waiting again.
 */
export function fireDue(workspaceId: string): Promise<void> {
  return serialise(async () => {
    for (;;) {
      const now = await workspaceNow(workspaceId);
      const timer = await dueTimer(workspaceId, now);
      const schedule = await dueSchedule(workspaceId, now);
      if (timer === null && schedule === null) return;
      if (timer !== null && (schedule === null || timer.due_at.getTime() <= schedule.next_at.getTime())) {
        await fireTimer(timer);
      } else if (schedule !== null) {
        await fireSchedule(schedule);
      }
    }
  });
}

async function workspacesWithWork(): Promise<string[]> {
  const rows = await query<{ workspace_id: string }>(
    `select distinct r.workspace_id from timers t join runs r on r.id = t.run_id
       where t.owner_port = $1 and t.fired = false
     union
     select distinct a.workspace_id from schedule_claims s join automations a on a.id = s.automation_id
       where s.owner_port = $1`,
    [instancePort],
  );
  return rows.map((row) => row.workspace_id);
}

export function startTicking(): void {
  setInterval(() => {
    void (async () => {
      for (const workspaceId of await workspacesWithWork()) await fireDue(workspaceId);
    })();
  }, config.scheduleTickSeconds * 1000).unref();
}

/** Waiting runs and retrying steps resume at their recorded due times after a restart. */
export async function resumeOwnedRuns(): Promise<void> {
  const rows = await query<{ id: string }>(
    `select id from runs where owner_port = $1 and status in ('queued','running') order by seq`,
    [instancePort],
  );
  for (const row of rows) await resumeRun(row.id);
}
