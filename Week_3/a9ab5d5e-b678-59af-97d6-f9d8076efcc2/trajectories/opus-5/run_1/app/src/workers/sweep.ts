import { PoolClient } from 'pg';
import { appendLog, inHousehold, rows } from '../db';
import { Household, loadHousehold, refreshStatement } from '../db/repo';
import { ParentRole, otherRole } from '../domain/plan';
import {
  lapsedNotice,
  queueNotices,
  reminderNotice,
  supersedeQueuedReminders,
} from '../services/notices';

interface DueRow {
  id: string;
  householdId: string;
  createdBy: ParentRole;
}

async function dueRows(table: 'swaps' | 'costs', kind: 'lapse' | 'reminder' | 'settle'): Promise<DueRow[]> {
  const creator = table === 'swaps' ? 'created_by' : 'paid_by';
  const where =
    kind === 'lapse'
      ? "state = 'sent' AND answer_by <= now()"
      : kind === 'reminder'
        ? "state = 'sent' AND reminded = false AND reminder_at IS NOT NULL AND reminder_at <= now() AND answer_by > now()"
        : "state = 'accepted' AND settle_at IS NOT NULL AND settle_at <= now()";
  const found = await rows(
    `SELECT id::text AS id, household_id::text AS household_id, ${creator} AS creator FROM ${table}
     WHERE ${where} ORDER BY ${table}.id LIMIT 20`,
  );
  return found.map((row) => ({
    id: row.id as string,
    householdId: row.household_id as string,
    createdBy: row.creator as ParentRole,
  }));
}

async function withHousehold(
  householdId: string,
  run: (client: PoolClient, household: Household) => Promise<void>,
): Promise<void> {
  const household = await loadHousehold(householdId);
  if (!household) return;
  await inHousehold(householdId, async (client) => run(client, household));
}

/** Lapsing, reminders and settling act exactly once per request on its stored moments. */
export async function runSweepOnce(): Promise<void> {
  for (const table of ['swaps', 'costs'] as const) {
    for (const due of await dueRows(table, 'lapse')) {
      await withHousehold(due.householdId, async (client, household) => {
        const current = await client.query(
          `SELECT state FROM ${table} WHERE id = $1 AND state = 'sent' AND answer_by <= now() FOR UPDATE`,
          [due.id],
        );
        if (current.rows.length === 0) return;
        await client.query(`UPDATE ${table} SET state = 'lapsed', rev = rev + 1 WHERE id = $1`, [due.id]);
        await supersedeQueuedReminders(client, household.id, table, due.id);
        await appendLog(client, household.id, 'system', `${table === 'swaps' ? 'swap' : 'cost'}.lapsed`, due.id);
        await queueNotices(client, household, [lapsedNotice(household, 'planning'), lapsedNotice(household, 'other')]);
        if (table === 'costs') await refreshStatement(client, household);
      });
    }
    for (const due of await dueRows(table, 'reminder')) {
      await withHousehold(due.householdId, async (client, household) => {
        const current = await client.query(
          `SELECT state FROM ${table} WHERE id = $1 AND state = 'sent' AND reminded = false FOR UPDATE`,
          [due.id],
        );
        if (current.rows.length === 0) return;
        await client.query(`UPDATE ${table} SET reminded = true WHERE id = $1`, [due.id]);
        await appendLog(client, household.id, 'system', `${table === 'swaps' ? 'swap' : 'cost'}.reminded`, due.id);
        await queueNotices(client, household, [
          reminderNotice(household, otherRole(due.createdBy), table, due.id),
        ]);
      });
    }
  }
  for (const due of await dueRows('swaps', 'settle')) {
    await withHousehold(due.householdId, async (client, household) => {
      const current = await client.query(
        "SELECT state FROM swaps WHERE id = $1 AND state = 'accepted' AND settle_at <= now() FOR UPDATE",
        [due.id],
      );
      if (current.rows.length === 0) return;
      await client.query("UPDATE swaps SET state = 'settled', rev = rev + 1 WHERE id = $1", [due.id]);
      await appendLog(client, household.id, 'system', 'swap.settled', due.id);
    });
  }
}
