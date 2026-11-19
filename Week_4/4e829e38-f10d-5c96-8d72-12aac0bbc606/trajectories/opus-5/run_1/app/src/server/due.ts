import { claim, query } from './db.js';
import { config } from './config.js';
import { toDateString } from './clock.js';
import { publish } from './events.js';
import { createSuccessor, tasksDueForSuccessor } from './recurrence.js';
import { runChain } from './rules.js';
import { sendMailQuietly } from './mail.js';

async function runRecurring(now: Date): Promise<void> {
  const open = await tasksDueForSuccessor(now);
  for (const task of open) {
    await createSuccessor(task, now, 'clock');
  }
}

async function runDueDateRules(now: Date): Promise<void> {
  const today = toDateString(now);
  const rows = await query<{ id: string; project_id: string; due_date: string }>(
    `SELECT t.id, t.project_id, t.due_date FROM tasks t
     WHERE t.completed = false AND t.due_date IS NOT NULL AND t.due_date <= $1
       AND EXISTS (SELECT 1 FROM rules r WHERE r.project_id = t.project_id
                    AND r.trigger->>'type' = 'due_date_arrives')
     ORDER BY t.created_at`,
    [today],
  );
  for (const row of rows) {
    const due = String(row.due_date).slice(0, 10);
    await runChain(
      row.project_id,
      [{ taskId: row.id, kind: 'due_date_arrives', key: `due:${row.id}:${due}` }],
      now,
    );
  }
}

async function lapseHoldsAndPresence(now: Date): Promise<void> {
  const holds = await query<{ task_id: string; field: string }>(
    `DELETE FROM holds WHERE expires_at <= $1 RETURNING task_id, field`,
    [now.toISOString()],
  );
  for (const hold of holds) {
    await publish({
      type: 'hold_changed',
      teamId: await teamOfTask(hold.task_id),
      taskId: hold.task_id,
      field: hold.field,
      holder: null,
    });
  }
  const gone = await query<{ task_id: string }>(
    `DELETE FROM presence WHERE expires_at <= $1 RETURNING task_id`,
    [now.toISOString()],
  );
  const seen = new Set<string>();
  for (const row of gone) {
    if (seen.has(row.task_id)) continue;
    seen.add(row.task_id);
    await publish({
      type: 'presence_changed',
      teamId: await teamOfTask(row.task_id),
      taskId: row.task_id,
      viewing: await viewersOf(row.task_id),
    });
  }
}

export async function teamOfTask(taskId: string): Promise<string | null> {
  const rows = await query<{ team_id: string }>(
    `SELECT p.team_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
    [taskId],
  );
  return rows.length > 0 ? rows[0].team_id : null;
}

export async function viewersOf(taskId: string): Promise<{ id: string; name: string }[]> {
  return query<{ id: string; name: string }>(
    `SELECT p.id, p.name FROM presence pr JOIN people p ON p.id = pr.person_id
     WHERE pr.task_id = $1 ORDER BY p.name`,
    [taskId],
  );
}

function windowLengthMs(): number {
  return config.digestWindowMin * 60000;
}

/** Window ends after `previous` and at or before `next`, aligned to UTC midnight. */
export function digestWindowEnds(previous: Date, next: Date): Date[] {
  const length = windowLengthMs();
  const ends: Date[] = [];
  let first = Math.ceil((previous.getTime() + 1) / length) * length;
  while (first <= next.getTime()) {
    ends.push(new Date(first));
    first += length;
  }
  return ends;
}

async function sendDigests(previous: Date | null, next: Date): Promise<void> {
  if (previous === null) return;
  for (const end of digestWindowEnds(previous, next)) {
    const start = new Date(end.getTime() - windowLengthMs());
    const people = await query<{ person_id: string; email: string }>(
      `SELECT DISTINCT i.person_id, p.email FROM inbox_items i JOIN people p ON p.id = i.person_id
       WHERE i.read = false AND i.archived = false
         AND i.created_at >= $1 AND i.created_at < $2`,
      [start.toISOString(), end.toISOString()],
    );
    for (const person of people) {
      if (!(await claim(`digest:${person.person_id}:${end.toISOString()}`))) continue;
      const items = await query<{ text: string }>(
        `SELECT text FROM inbox_items
         WHERE person_id = $1 AND read = false AND archived = false
           AND created_at >= $2 AND created_at < $3
         ORDER BY created_at`,
        [person.person_id, start.toISOString(), end.toISOString()],
      );
      await sendMailQuietly({
        to: person.email,
        subject: `Everyweek: ${items.length} unread in your inbox`,
        body: items.map((i) => i.text).join('\r\n'),
      });
    }
  }
}

let running = false;

/** Runs the work that has become due, exactly once across instances. */
export async function runDueWork(previous: Date | null, now: Date): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runRecurring(now);
    await runDueDateRules(now);
    await lapseHoldsAndPresence(now);
    await sendDigests(previous, now);
  } finally {
    running = false;
  }
}
