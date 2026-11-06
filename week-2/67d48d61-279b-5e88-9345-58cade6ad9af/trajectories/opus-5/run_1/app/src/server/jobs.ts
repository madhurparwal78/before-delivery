import { isOpenStatus } from '../shared/domain.js';
import { readState, runChange } from './change.js';
import { currentCycleKey, cyclePosition } from './cycles.js';
import type { TaskRow } from './domain/graph.js';
import { ensureCollection, IntakeUnavailable, listPending } from './services/intake.js';
import { markIntake } from './services/monitor.js';

let collectionReady = false;

/** Pulls every pending request that has no Promptside task yet into triage. */
export async function pullRequests(): Promise<void> {
  try {
    if (!collectionReady) {
      await ensureCollection();
      collectionReady = true;
    }
    const pending = await listPending();
    markIntake(true);
    if (pending.length === 0) return;

    await runChange({
      kind: 'pull',
      actor: null,
      body: async (session) => {
        const ids = pending.map((record) => record.id);
        const taken = await session.client.query<{ request: string }>(
          'select request from tasks where request = any($1::text[])',
          [ids],
        );
        const have = new Set(taken.rows.map((row) => row.request));
        let next = 0;
        for (const number of session.graph.tasks.keys()) next = Math.max(next, number);
        for (const record of pending) {
          if (have.has(record.id)) continue;
          next += 1;
          const row: TaskRow = {
            number: next,
            title: record.title,
            details: record.details,
            department: record.department === '' ? null : record.department,
            label: null,
            status: 'triage',
            priority: 0,
            owner: null,
            cycle: null,
            parent: null,
            duplicate_of: null,
            request: record.id,
            version: 0,
            updated_at: session.now,
          };
          session.createTask(row);
        }
      },
    });
  } catch (error) {
    if (error instanceof IntakeUnavailable) {
      markIntake(false);
      collectionReady = false;
      return;
    }
    collectionReady = false;
  }
}

/** Moves the open tasks of an ended cycle to the cycle that is now current. */
export async function rollCycles(): Promise<void> {
  const due = await readState((graph, cycles) => {
    const current = currentCycleKey(cycles, new Date());
    const position = cyclePosition(cycles, current);
    return [...graph.tasks.values()]
      .filter(
        (row) =>
          row.cycle !== null &&
          isOpenStatus(row.status) &&
          cyclePosition(cycles, row.cycle) < position,
      )
      .map((row) => row.number);
  });
  if (due.length === 0) return;

  await runChange({
    kind: 'rollover',
    actor: null,
    body: (session) => {
      const current = currentCycleKey(session.cycles, session.now);
      const position = cyclePosition(session.cycles, current);
      for (const number of due) {
        const row = session.graph.tasks.get(number);
        if (!row || row.cycle === null || !isOpenStatus(row.status)) continue;
        if (cyclePosition(session.cycles, row.cycle) >= position) continue;
        session.setFields(number, { cycle: current }, 'rolled');
      }
    },
  });
}

export function startJobs(): void {
  void pullRequests();
  setInterval(() => void pullRequests(), 4000).unref();
  void rollCycles();
  setInterval(() => void rollCycles(), 2000).unref();
}
