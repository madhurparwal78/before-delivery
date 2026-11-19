/**
 * Background work: SLA thresholds, escalation timers, vote windows, automatic
 * closure, workflow waits, digests, export jobs and storage recovery. Every due
 * job is run in time order, whether real time passes or the clock is advanced.
 */

import { now, nowMs } from '../clock';
import { settings } from '../config';
import { query, readState, transaction, writeState } from '../db';
import { eventTexts } from '../domain/inbox';
import { ackDue } from '../domain/oncall';
import { localDate, wallOf } from '../domain/zone';
import { loadSteps, settleStep } from './changes';
import { Engine } from './engine';
import { publish } from './live';
import { deliver, operators, unreadCount } from './notify';
import { reopenDeadline, transitionRecord } from './recordops';
import { pushSlas, reviewSlas } from './slaservice';
import { loadAllSlaInstances, type RecordRow } from './store';
import { csvOf, exportRows } from './lists';
import {
  getObject,
  objectKeys,
  probeDue,
  probeStorage,
  putObject,
  storageAvailable,
  StorageFailure,
} from './storage';
import { targetOf } from '../api/oncallapi';
import { advanceRun, dueRuns } from './workflow';

let running = false;

/** One pass of every due job, in time order. */
export async function runDueWork(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const engine = await Engine.load('live');
    await reviewRunningSlas(engine);
    await closeResolvedIncidents(engine);
    await climbPages(engine);
    await closeVoteWindows(engine);
    await advanceWaitingRuns(engine);
    await sendDigests(engine);
    await runExportJobs(engine);
    await recoverStorage();
  } finally {
    running = false;
  }
}

async function reviewRunningSlas(engine: Engine): Promise<void> {
  const rows = await loadAllSlaInstances();
  const numbers = [...new Set(rows.map((row) => row.recordNumber))];
  for (const number of numbers) {
    const record = engine.records.get(number);
    if (!record) continue;
    const slas = await transaction((client) => reviewSlas(client, engine, record));
    pushSlas(number, slas);
  }
}

/** A resolved incident closes at the first instant after its reopen deadline. */
async function closeResolvedIncidents(engine: Engine): Promise<void> {
  for (const record of [...engine.records.values()]) {
    if (record.table !== 'incident' || record.state !== 'resolved') continue;
    const deadline = reopenDeadline(engine, record);
    if (deadline === null || nowMs() <= deadline) continue;
    await transitionRecord(engine, operatorCaller(engine), record.number, 'closed').catch(() => undefined);
  }
}

function operatorCaller(engine: Engine): Parameters<typeof transitionRecord>[1] {
  return {
    username: 'oona',
    roles: ['operator'],
    department: 'IT provider',
    timeZone: engine.businessZone,
    displayName: 'Switchyard',
    actor: 'oona',
    impersonating: false,
    system: true,
    workspace: 'live',
  };
}

interface PageRecord {
  id: string;
  number: string;
  policy: string;
  status: string;
  level: number;
  levels: { level: number; username: string; notifiedAt: number; ackDueAt: number }[];
}

/** An unacknowledged page climbs when the clock passes each level's timer. */
async function climbPages(engine: Engine): Promise<void> {
  const rows = await query<PageRecord>(`SELECT * FROM page WHERE status = 'paging'`);
  for (const row of rows) {
    const policy = engine.escalationPolicies.get(row.policy);
    if (!policy) continue;
    let levels = [...(row.levels ?? [])];
    let level = row.level;
    for (;;) {
      const current = levels[levels.length - 1];
      if (!current || nowMs() < current.ackDueAt) break;
      if (level >= policy.levels.length) {
        await transaction(async (client) => {
          await client.query(`UPDATE page SET status = 'exhausted' WHERE id = $1`, [row.id]);
          const delivered = await deliver(
            client,
            engine.inboxRules,
            engine.people,
            'page_exhausted',
            operators(engine.people),
            eventTexts.page_exhausted(row.number),
            row.number,
          );
          for (const username of delivered) {
            publish({
              topic: 'inbox',
              event: 'unread',
              data: { username, unread: await unreadCount(client, username) },
            });
          }
        });
        publish({ topic: 'pages', event: 'exhausted', data: { id: row.id, record: row.number } });
        break;
      }
      // The next level is notified at exactly the moment the timer ran out.
      const nextLevel = level + 1;
      const spec = policy.levels[nextLevel - 1];
      const at = current.ackDueAt;
      const username = targetOf(engine, policy, nextLevel, at);
      if (username === null) break;
      levels = [
        ...levels,
        {
          level: nextLevel,
          username,
          notifiedAt: at,
          ackDueAt: ackDue(spec, at, settings().ONCALL_ACK_MINUTES),
        },
      ];
      level = nextLevel;
      await transaction(async (client) => {
        await client.query(`UPDATE page SET level = $2, levels = $3::jsonb WHERE id = $1`, [
          row.id,
          level,
          JSON.stringify(levels),
        ]);
        const delivered = await deliver(
          client,
          engine.inboxRules,
          engine.people,
          'page',
          [username],
          eventTexts.page(row.number),
          row.number,
        );
        for (const who of delivered) {
          publish({
            topic: 'inbox',
            event: 'unread',
            data: { username: who, unread: await unreadCount(client, who) },
          });
        }
      });
      publish({
        topic: 'pages',
        event: 'escalated',
        data: { id: row.id, record: row.number, level, username },
      });
    }
  }
}

/** A step undecided at its window close is rejected without reaching quorum. */
async function closeVoteWindows(engine: Engine): Promise<void> {
  const rows = await query<{ number: string; step: number; closes_at: Date | null }>(
    `SELECT number, step, closes_at FROM approval_step WHERE status = 'open' AND closes_at IS NOT NULL`,
  );
  for (const row of rows) {
    if (row.closes_at === null || nowMs() < row.closes_at.getTime()) continue;
    const record = engine.records.get(row.number);
    if (!record) continue;
    const steps = await loadSteps(row.number);
    const step = steps.find((s) => s.step === row.step);
    if (!step) continue;
    await transaction((client) => settleStep(client, engine, record, step, row.closes_at!.getTime(), true));
  }
}

async function advanceWaitingRuns(engine: Engine): Promise<void> {
  for (const run of await dueRuns(nowMs())) {
    await advanceRun(engine, run);
  }
}

/** A daily digest arrives at 08:00 in the person's own zone. */
async function sendDigests(engine: Engine): Promise<void> {
  for (const person of engine.people.values()) {
    if (person.digest !== 'daily') continue;
    const today = localDate(person.timeZone, nowMs());
    const wall = wallOf(nowMs(), person.timeZone);
    if (wall.hour < 8) continue;
    const marker = `${person.username}:${today}`;
    const sent = (await readState<string[]>('digest_sent')) ?? [];
    if (sent.includes(marker)) continue;
    const pending = await query<{ n: string }>(
      `SELECT count(*) AS n FROM inbox_item WHERE username = $1 AND pending_digest AND NOT read`,
      [person.username],
    );
    const count = Number(pending[0]?.n ?? 0);
    if (count > 0) {
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO inbox_item (username, event, text, at, read, pending_digest)
           VALUES ($1, 'digest', $2, $3, FALSE, FALSE)`,
          [person.username, eventTexts.digest(count), now()],
        );
        await client.query(
          `UPDATE inbox_item SET read = TRUE WHERE username = $1 AND pending_digest`,
          [person.username],
        );
        publish({
          topic: 'inbox',
          event: 'unread',
          data: { username: person.username, unread: await unreadCount(client, person.username) },
        });
      });
    }
    await writeState('digest_sent', [...sent.filter((s) => !s.startsWith(`${person.username}:`)), marker]);
  }
}

/** An export job runs in batches, then stores, then completes. */
async function runExportJobs(engine: Engine): Promise<void> {
  const rows = await query<{
    id: string;
    owner: string;
    table_name: string;
    filter_text: string;
    columns: string[];
    status: string;
    rows_total: number;
    rows_done: number;
  }>(`SELECT * FROM export_job WHERE status IN ('queued', 'running') ORDER BY created_at`);
  for (const row of rows) {
    const owner = engine.person(row.owner);
    if (!owner) continue;
    const caller = {
      username: owner.username,
      roles: owner.roles,
      department: owner.department,
      timeZone: owner.timeZone,
      displayName: owner.displayName,
      actor: owner.username,
      impersonating: false,
      workspace: 'live' as const,
    };
    const built = exportRows(
      engine,
      caller,
      row.table_name as never,
      row.filter_text,
      row.columns ?? [],
    );
    const batch = settings().EXPORT_BATCH_ROWS;
    let done = row.rows_done;
    await query(`UPDATE export_job SET status = 'running', rows_total = $2 WHERE id = $1`, [
      row.id,
      built.rows.length,
    ]);
    while (done < built.rows.length) {
      done = Math.min(done + batch, built.rows.length);
      await query(`UPDATE export_job SET rows_done = $2 WHERE id = $1`, [row.id, done]);
      publish({
        topic: `export:${row.id}`,
        event: 'progress',
        data: { id: row.id, rows_done: done, rows_total: built.rows.length },
      });
    }
    const key = objectKeys.exportFile(row.id);
    try {
      await putObject(key, Buffer.from(csvOf(built.header, built.rows), 'utf8'), 'text/csv');
    } catch (e) {
      if (!(e instanceof StorageFailure)) throw e;
      // The job becomes complete only after storage accepts the object.
      await query(`UPDATE export_job SET status = 'failed', error = 'storage_unavailable' WHERE id = $1`, [
        row.id,
      ]);
      publish({ topic: `export:${row.id}`, event: 'failed', data: { id: row.id, error: 'storage_unavailable' } });
      continue;
    }
    await query(`UPDATE export_job SET status = 'complete', object_key = $2 WHERE id = $1`, [row.id, key]);
    await transaction(async (client) => {
      const delivered = await deliver(
        client,
        engine.inboxRules,
        engine.people,
        'export_finished',
        [row.owner],
        eventTexts.export_finished(row.id),
        null,
      );
      for (const username of delivered) {
        publish({
          topic: 'inbox',
          event: 'unread',
          data: { username, unread: await unreadCount(client, username) },
        });
      }
    });
    publish({
      topic: `export:${row.id}`,
      event: 'complete',
      data: { id: row.id, rows: built.rows.length },
    });
  }
}

/** When storage returns, queued uploads finish and failed exports retry. */
async function recoverStorage(): Promise<void> {
  const wasAvailable = storageAvailable();
  if (probeDue(nowMs())) await probeStorage();
  if (!storageAvailable()) {
    if (wasAvailable) publish({ topic: 'storage', event: 'unavailable', data: { storage: 'unavailable' } });
    return;
  }
  if (!wasAvailable) publish({ topic: 'storage', event: 'available', data: { storage: 'available' } });

  const queued = await query<{ id: string; object_key: string; content_type: string; queued_bytes: Buffer }>(
    `SELECT id, object_key, content_type, queued_bytes FROM attachment
     WHERE status = 'queued' AND queued_bytes IS NOT NULL ORDER BY created_at`,
  );
  for (const row of queued) {
    try {
      await putObject(row.object_key, row.queued_bytes, row.content_type);
      await query(`UPDATE attachment SET status = 'stored', queued_bytes = NULL WHERE id = $1`, [row.id]);
      publish({ topic: 'storage', event: 'stored', data: { id: row.id } });
    } catch {
      return;
    }
  }
  await query(
    `UPDATE export_job SET status = 'queued', rows_done = 0, error = NULL
     WHERE status = 'failed' AND error = 'storage_unavailable'`,
  );
}

let timer: NodeJS.Timeout | null = null;

export function startBackground(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueWork().catch(() => undefined);
  }, 1000);
}

export function stopBackground(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { getObject, reviewSlas };
export type { RecordRow };
