import { serverNow } from './clock.js';
import { config } from './config.js';
import { db, withTx } from './db.js';
import { EventSink, publish } from './live.js';
import { CHECK_STATE_WORDS, latestReports, timeoutDeadline } from '../domain/checks.js';
import { activeEntries, entryTimedOut, getEntry, runQueueStep } from '../domain/queue.js';
import { getRepoById, listAllRepos } from '../domain/model.js';
import { byteOrder } from '../domain/revisions.js';

interface DueTimer {
  at: Date;
  kind: 'timeout' | 'step';
  repoId: number;
  changeNumber?: number;
  entryId?: number;
  revisionId?: string;
  names?: string[];
}

async function firedNames(repoId: number, revisionId: string): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>(
    'SELECT name FROM rs_check_timeouts WHERE repo_id = $1 AND revision_id = $2',
    [repoId, revisionId],
  );
  return new Set(rows.map((row) => row.name));
}

async function pendingRequired(repoId: number, revisionId: string, requiredChecks: string[]): Promise<string[]> {
  const reports = await latestReports(db, repoId, revisionId);
  const fired = await firedNames(repoId, revisionId);
  return requiredChecks
    .filter((name) => {
      const report = reports.get(name);
      if (report && (report.state === 'success' || report.state === 'failure')) return false;
      return !fired.has(name);
    })
    .sort(byteOrder);
}

async function collectDue(now: Date): Promise<DueTimer[]> {
  const timers: DueTimer[] = [];
  for (const repo of await listAllRepos(db)) {
    if (repo.requiredChecks.length > 0) {
      const due = await db.query<{ number: number; revision_id: string; created_at: Date }>(
        `SELECT c.number, b.revision_id, r.created_at
         FROM rs_changes c
         JOIN rs_branches b ON b.repo_id = c.repo_id AND b.name = c.head_branch
         JOIN rs_revisions r ON r.repo_id = c.repo_id AND r.id = b.revision_id
         WHERE c.repo_id = $1 AND c.state <> 'merged' AND r.created_at <= $2`,
        [repo.id, new Date(now.getTime() - config.checkTimeoutSeconds * 1000)],
      );
      for (const row of due) {
        const deadline = timeoutDeadline(row.created_at);
        const names = await pendingRequired(repo.id, row.revision_id, repo.requiredChecks);
        if (names.length > 0) {
          timers.push({
            at: deadline,
            kind: 'timeout',
            repoId: repo.id,
            changeNumber: row.number,
            revisionId: row.revision_id,
            names,
          });
        }
      }
      for (const entry of await activeEntries(db, repo.id)) {
        if (entry.revisionId === null) continue;
        const deadline = timeoutDeadline(entry.revisionSetAt);
        if (deadline.getTime() > now.getTime()) continue;
        const names = await pendingRequired(repo.id, entry.revisionId, repo.requiredChecks);
        if (names.length > 0) {
          timers.push({
            at: deadline,
            kind: 'timeout',
            repoId: repo.id,
            entryId: entry.id,
            revisionId: entry.revisionId,
            names,
          });
        }
      }
    }
    const rows = await db.query<{ queue_next_step_at: Date | null }>(
      'SELECT queue_next_step_at FROM rs_repos WHERE id = $1',
      [repo.id],
    );
    const stepAt = rows[0]?.queue_next_step_at ?? null;
    if (stepAt !== null && stepAt.getTime() <= now.getTime()) {
      timers.push({ at: stepAt, kind: 'step', repoId: repo.id });
    }
  }
  return timers.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'timeout' ? -1 : 1));
}

async function fireTimeout(timer: DueTimer): Promise<void> {
  const sink = new EventSink();
  await withTx(async (tx) => {
    const repo = (await getRepoById(tx, timer.repoId))!;
    for (const name of timer.names!) {
      await tx.query(
        `INSERT INTO rs_check_timeouts (repo_id, revision_id, name, timed_out_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (repo_id, revision_id, name) DO NOTHING`,
        [repo.id, timer.revisionId, name, timer.at],
      );
    }
    if (timer.entryId !== undefined) {
      const entry = await getEntry(tx, timer.entryId);
      if (entry && (entry.state === 'waiting' || entry.state === 'checking')) {
        await entryTimedOut(tx, repo, entry, timer.names![0], sink);
      }
      return;
    }
    for (const name of timer.names!) {
      sink.add({
        kind: 'check',
        text: `#${timer.changeNumber}: check ${name} ${CHECK_STATE_WORDS.timed_out}`,
        change: timer.changeNumber,
      });
    }
  });
  publish(timer.repoId, sink.list());
}

async function fireStep(timer: DueTimer): Promise<void> {
  const sink = new EventSink();
  await withTx(async (tx) => {
    const repo = (await getRepoById(tx, timer.repoId))!;
    await runQueueStep(tx, repo, sink);
  });
  publish(timer.repoId, sink.list());
}

async function runDueTimers(): Promise<void> {
  for (let round = 0; round < 1000; round += 1) {
    const due = await collectDue(serverNow());
    if (due.length === 0) return;
    const timer = due[0];
    if (timer.kind === 'timeout') await fireTimeout(timer);
    else await fireStep(timer);
  }
}

let chain: Promise<void> = Promise.resolve();

/** Fires every timer due at or before the server clock, in time order, one run at a time. */
export function processDueTimers(): Promise<void> {
  chain = chain.then(runDueTimers, runDueTimers);
  return chain;
}

export function startScheduler(): void {
  setInterval(() => {
    void processDueTimers();
  }, 1000).unref();
}
