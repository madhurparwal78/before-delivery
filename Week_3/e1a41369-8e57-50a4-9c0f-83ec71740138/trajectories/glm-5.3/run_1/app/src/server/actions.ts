import { applyExperience, faintPenalty } from '../shared/rules.js';
import { q, taskFromRow, tenths, fromTenths, type TaskRow, type UserRow } from './db.js';
import { weekdayOf } from './time.js';
import type { Task } from '../shared/types.js';
import type { PoolClient } from 'pg';

/**
 * The single place a player's level, experience, health and gold move
 * together, with faint checks and notices. Level-up first, then faint.
 */
export async function applyGains(
  client: PoolClient,
  user: UserRow,
  opts: {
    experience?: number;
    healthTenthsDelta?: number;
    ledger?: { kind: string; amountCents: number; taskId?: string | null };
  }
): Promise<{ user: UserRow; leveled: boolean; fainted: boolean }> {
  let level = user.level;
  let experience = user.experience;
  let goldCents = user.gold_cents;
  let healthTenths = tenths(user.health);
  let leveled = false;
  let fainted = false;

  if ((opts.experience ?? 0) !== 0) {
    const res = applyExperience(level, experience, opts.experience!);
    level = res.level;
    experience = res.experience;
    if (res.levelsGained > 0) {
      leveled = true;
      healthTenths = 500;
      for (let i = 0; i < res.levelsGained; i++) {
        await client.query(
          `INSERT INTO notices (user_id, kind, level, gold_lost_cents) VALUES ($1,'level_up',$2,NULL)`,
          [user.id, res.level - (res.levelsGained - 1 - i)]
        );
      }
    }
  }

  if ((opts.healthTenthsDelta ?? 0) !== 0) {
    healthTenths = Math.max(0, Math.min(500, healthTenths + opts.healthTenthsDelta!));
    if (healthTenths <= 0) {
      const p = faintPenalty(level, goldCents);
      level = p.level;
      experience = 0;
      goldCents -= p.goldLostCents;
      healthTenths = 500;
      fainted = true;
      await client.query(
        `INSERT INTO notices (user_id, kind, level, gold_lost_cents) VALUES ($1,'faint',$2,$3)`,
        [user.id, level, p.goldLostCents]
      );
      if (p.goldLostCents > 0) {
        await client.query(
          `INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1,'faint',$2,NULL)`,
          [user.id, -p.goldLostCents]
        );
      }
    }
  }

  if (opts.ledger && opts.ledger.amountCents !== 0) {
    goldCents += opts.ledger.amountCents;
    await client.query(
      `INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1,$2,$3,$4)`,
      [user.id, opts.ledger.kind, opts.ledger.amountCents, opts.ledger.taskId ?? null]
    );
  }

  const updated = await client.query<UserRow>(
    `UPDATE users SET level=$2, experience=$3, health=$4, gold_cents=$5 WHERE id=$1 RETURNING *`,
    [user.id, level, experience, fromTenths(healthTenths).toFixed(1), goldCents]
  );
  return { user: updated.rows[0], leveled, fainted };
}

/** Load a task row for an action, verifying ownership. */
export async function loadTask(client: PoolClient, userId: string, taskId: string): Promise<TaskRow | null> {
  const t = await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1 AND owner_id=$2`, [taskId, userId]);
  return t.rows[0] ?? null;
}

/** Serialize one task, computing dueToday from the owner's open local date. */
export async function serializeTask(task: TaskRow, owner: UserRow): Promise<Task> {
  const checklist =
    task.type === 'todo'
      ? (
          await q<{ id: string; text: string; checked: boolean }>(
            `SELECT id, text, checked FROM checklist_items WHERE task_id=$1 ORDER BY position`,
            [task.id]
          )
        ).rows.map((x) => ({ id: x.id, text: x.text, checked: x.checked }))
      : null;
  const dueToday =
    task.type === 'daily'
      ? (task.weekdays ?? []).includes(weekdayOf(owner.open_date.toISOString().slice(0, 10), owner.time_zone))
      : null;
  return taskFromRow(task, checklist, dueToday);
}
