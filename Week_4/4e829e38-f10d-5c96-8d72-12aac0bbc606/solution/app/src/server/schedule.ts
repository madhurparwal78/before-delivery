/** Work that becomes due as the server clock moves: lapses, repeats, due-date rules and digests. */
import { config } from "./config.js";
import { dateOf, plus } from "./clock.js";
import { claim, pool, lockProject, transaction } from "./db.js";
import { publish } from "./events.js";
import { sendMail } from "./mail.js";
import { getTaskRow, loadProject } from "./tasks.js";
import { fireDue, newChain } from "./rules.js";
import { finishChain, spawnSuccessor } from "./workflow.js";

const DAY_MS = 86_400_000;

async function lapse(now: Date): Promise<void> {
  const cutoff = plus(now, -config.limits.holdTimeoutMs);
  await transaction(async (tx) => {
    const holds = await tx.query(
      `DELETE FROM holds h USING tasks t, projects p WHERE h.task_id = t.id AND p.id = t.project_id AND h.expires_at <= $1
         RETURNING h.task_id, p.team_id`, [now]);
    const gone = await tx.query(
      `DELETE FROM presence pr USING tasks t, projects p WHERE pr.task_id = t.id AND p.id = t.project_id
         AND pr.left_at IS NOT NULL AND pr.left_at <= $1 RETURNING pr.task_id, p.team_id`, [cutoff]);
    for (const row of holds.rows) await publish(tx, { t: "hold", team: row.team_id, task: row.task_id });
    for (const row of gone.rows) await publish(tx, { t: "presence", team: row.team_id, task: row.task_id });
  });
}

async function repeats(now: Date): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, project_id FROM tasks t WHERE NOT completed AND recurrence IS NOT NULL AND due_date < $1
       AND NOT EXISTS (SELECT 1 FROM claims WHERE key = 'successor:' || t.id) ORDER BY due_date, seq`,
    [dateOf(now)],
  );
  for (const row of rows) {
    await transaction(async (tx) => {
      await lockProject(tx, row.project_id);
      const task = await getTaskRow(tx, row.id);
      if (task.completed) return;
      const chain = await newChain(tx, await loadProject(tx, row.project_id), now);
      await spawnSuccessor(tx, chain, task, dateOf(now), true);
      await finishChain(tx, chain);
    });
  }
}

async function dueDates(prev: Date, now: Date): Promise<void> {
  const { rows } = await pool.query(
    `SELECT t.id, t.project_id FROM tasks t WHERE NOT t.completed AND t.due_date IS NOT NULL
       AND (t.due_date::timestamp AT TIME ZONE 'UTC') > $1 AND (t.due_date::timestamp AT TIME ZONE 'UTC') <= $2
       AND EXISTS (SELECT 1 FROM rules r WHERE r.project_id = t.project_id AND r.trigger->>'type' = 'due_date_arrives')
     ORDER BY t.due_date, t.seq`,
    [prev, now],
  );
  for (const row of rows) {
    await transaction(async (tx) => {
      await lockProject(tx, row.project_id);
      const chain = await newChain(tx, await loadProject(tx, row.project_id), now);
      await fireDue(tx, chain, await getTaskRow(tx, row.id));
      await finishChain(tx, chain);
    });
  }
}

function windowEnd(created: Date): number {
  const windowMs = config.limits.digestWindowMin * 60_000;
  const day = Math.floor(created.getTime() / DAY_MS) * DAY_MS;
  const index = Math.floor((created.getTime() - day) / windowMs);
  return Math.min(day + (index + 1) * windowMs, day + DAY_MS);
}

async function digests(prev: Date, now: Date): Promise<void> {
  const { rows } = await pool.query(
    `SELECT i.person_id, i.text, i.created_at, p.email FROM inbox i JOIN people p ON p.id = i.person_id
       WHERE NOT i.read AND NOT i.archived AND i.created_at >= $1 AND i.created_at < $2 ORDER BY i.created_at, i.seq`,
    [plus(prev, -DAY_MS), now],
  );
  const groups = new Map<string, { personId: string; email: string; end: number; texts: string[] }>();
  for (const row of rows) {
    const end = windowEnd(row.created_at);
    if (end <= prev.getTime() || end > now.getTime()) continue;
    const key = `${row.person_id}:${end}`;
    const group = groups.get(key) ?? { personId: row.person_id, email: row.email, end, texts: [] as string[] };
    group.texts.push(row.text);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const key = `digest:${group.personId}:${group.end}`;
    if (!(await claim(pool, key))) continue;
    try {
      await sendMail(group.email, `Everyweek: ${group.texts.length} unread in your inbox`, `${group.texts.join("\n")}\n`);
    } catch {
      await pool.query("DELETE FROM claims WHERE key = $1", [key]);
    }
  }
}

/** Runs everything that has become due between `prev` and `now`. `prev` is null on the first call. */
export async function runDueWork(prev: Date | null, now: Date, firstWindowStart: Date): Promise<void> {
  await lapse(now);
  await repeats(now);
  await dueDates(prev ?? firstWindowStart, now);
  if (prev) await digests(prev, now);
}
