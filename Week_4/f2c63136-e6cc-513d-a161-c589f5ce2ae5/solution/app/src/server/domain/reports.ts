import type { Row, Tx } from '../db.ts';
import { config } from '../config.ts';
import { at, now, wholeSecond } from '../clock.ts';
import { transaction } from '../db.ts';
import { flushLive } from '../live.ts';
import { CHECK_WORD, type CheckState } from '../../shared/types.ts';
import { checkState, isFinal, latestReports } from './checks.ts';
import { Events } from './events.ts';
import { removeEntry, runStep } from './queue.ts';
import { Contents, loadRevision } from './revisions.ts';
import { stackNumbers, unmergedChanges } from './stack.ts';
import { byteOrder } from './validate.ts';

/** Whether a report on this revision may still arrive: required names time out on unmerged heads and current queue revisions. */
async function timesOut(tx: Pick<Tx, 'q'>, repoId: number, revision: string): Promise<boolean> {
  const head = await tx.q(`SELECT 1 FROM changes WHERE repo_id = $1 AND head_revision = $2 AND state <> 'merged' LIMIT 1`, [repoId, revision]);
  if (head.length) return true;
  return (await tx.q(`SELECT 1 FROM queue_entries WHERE repo_id = $1 AND revision = $2 AND status = 'active' LIMIT 1`, [repoId, revision])).length > 0;
}

export async function isTimedOut(tx: Pick<Tx, 'q'>, repo: Row, revision: string, name: string): Promise<boolean> {
  const created = (await loadRevision(tx, repo.id, revision))!.created_at as Date;
  const report = (await latestReports(tx, repo.id, revision)).get(name);
  const required = (repo.required_checks as string[]).includes(name);
  return checkState(report, required, created, await timesOut(tx, repo.id, revision)) === 'timed_out';
}

/** Records a report and tells what it means for the changes whose head it is and the queue entry it judges. */
export async function recordReport(tx: Tx, repo: Row, revision: string, name: string, state: CheckState, summary: string, contents: Contents): Promise<void> {
  await tx.q('INSERT INTO check_reports (repo_id, revision, name, state, summary, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    repo.id,
    revision,
    name,
    state,
    summary,
    wholeSecond(now()),
  ]);
  const events = new Events();
  const all = await unmergedChanges(tx, repo.id);
  for (const change of all.filter((row) => row.head_revision === revision)) {
    await tx.q('UPDATE changes SET checks_settled = false WHERE id = $1', [change.id]);
    events.say(`#${change.number}: check ${name} ${CHECK_WORD[state]}`);
    events.touch(stackNumbers(all, change));
  }
  const entry = (await tx.q<Row>(`SELECT * FROM queue_entries WHERE repo_id = $1 AND revision = $2 AND status = 'active'`, [repo.id, revision]))[0];
  if (entry) {
    const change = (await tx.q<Row>('SELECT number FROM changes WHERE id = $1', [entry.change_id]))[0];
    await tx.q('UPDATE queue_entries SET checks_settled = false WHERE id = $1', [entry.id]);
    events.say(`#${change.number}: check ${name} ${CHECK_WORD[state]}`, 'queue');
    events.touch([change.number]);
    events.queue = true;
    if (state === 'failure' && (repo.required_checks as string[]).includes(name)) {
      await removeEntry(tx, repo, entry, `Removed: check ${name} failed`, contents, events);
    }
  }
  events.emit(tx, repo.id);
}

async function expireNames(tx: Tx, repo: Row, revision: string): Promise<string[]> {
  const reports = await latestReports(tx, repo.id, revision);
  const open = (repo.required_checks as string[]).filter((name) => !isFinal(reports.get(name)?.state ?? 'queued')).sort(byteOrder);
  for (const name of open) {
    await tx.q('INSERT INTO check_reports (repo_id, revision, name, state, summary, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      repo.id,
      revision,
      name,
      'timed_out',
      '',
      wholeSecond(now()),
    ]);
  }
  return open;
}

type Due = { kind: 'head' | 'entry' | 'step'; id: number; due: Date };

async function nextDue(target: Date): Promise<Due | null> {
  const seconds = config.checkTimeoutSeconds;
  const timeouts = await transaction(async (tx) => {
    const heads = await tx.q<Row>(
      `SELECT c.id, r.created_at + ($2 * interval '1 second') AS due FROM changes c
         JOIN repos rp ON rp.id = c.repo_id JOIN revisions r ON r.repo_id = c.repo_id AND r.id = c.head_revision
        WHERE c.state <> 'merged' AND NOT c.checks_settled AND jsonb_array_length(rp.required_checks) > 0
          AND r.created_at + ($2 * interval '1 second') <= $1 ORDER BY due LIMIT 1`,
      [target, seconds],
    );
    const entries = await tx.q<Row>(
      `SELECT e.id, r.created_at + ($2 * interval '1 second') AS due FROM queue_entries e
         JOIN repos rp ON rp.id = e.repo_id JOIN revisions r ON r.repo_id = e.repo_id AND r.id = e.revision
        WHERE e.status = 'active' AND NOT e.checks_settled AND jsonb_array_length(rp.required_checks) > 0
          AND r.created_at + ($2 * interval '1 second') <= $1 ORDER BY due LIMIT 1`,
      [target, seconds],
    );
    const steps = await tx.q<Row>('SELECT id, queue_next_step AS due FROM repos WHERE queue_next_step IS NOT NULL AND queue_next_step <= $1 ORDER BY queue_next_step LIMIT 1', [target]);
    return { head: heads[0], entry: entries[0], step: steps[0] };
  });
  const candidates: Due[] = [];
  if (timeouts.head) candidates.push({ kind: 'head', id: timeouts.head.id, due: timeouts.head.due });
  if (timeouts.entry) candidates.push({ kind: 'entry', id: timeouts.entry.id, due: timeouts.entry.due });
  // A timeout fires before a step due at the same instant.
  const rank = { head: 0, entry: 0, step: 1 };
  if (timeouts.step) candidates.push({ kind: 'step', id: timeouts.step.id, due: timeouts.step.due });
  candidates.sort((a, b) => a.due.getTime() - b.due.getTime() || rank[a.kind] - rank[b.kind]);
  return candidates[0] ?? null;
}

async function fire(item: Due): Promise<void> {
  await at(item.due, () =>
    transaction(async (tx) => {
      const events = new Events();
      const contents = new Contents();
      if (item.kind === 'head') {
        const change = (await tx.q<Row>('SELECT * FROM changes WHERE id = $1', [item.id]))[0];
        const repo = (await tx.q<Row>('SELECT r.*, o.slug AS org_slug FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1', [change.repo_id]))[0];
        await tx.lockRepo(repo.id);
        const expired = await expireNames(tx, repo, change.head_revision);
        await tx.q('UPDATE changes SET checks_settled = true WHERE id = $1', [change.id]);
        const all = await unmergedChanges(tx, repo.id);
        for (const name of expired) events.say(`#${change.number}: check ${name} ${CHECK_WORD.timed_out}`);
        if (expired.length) events.touch(stackNumbers(all, change));
        events.emit(tx, repo.id);
        return;
      }
      if (item.kind === 'entry') {
        const entry = (await tx.q<Row>('SELECT * FROM queue_entries WHERE id = $1', [item.id]))[0];
        const repo = (await tx.q<Row>('SELECT r.*, o.slug AS org_slug FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1', [entry.repo_id]))[0];
        await tx.lockRepo(repo.id);
        const fresh = (await tx.q<Row>('SELECT * FROM queue_entries WHERE id = $1', [item.id]))[0];
        if (fresh.status !== 'active') return;
        const expired = await expireNames(tx, repo, fresh.revision);
        await tx.q('UPDATE queue_entries SET checks_settled = true WHERE id = $1', [fresh.id]);
        if (expired.length) await removeEntry(tx, repo, fresh, `Removed: check ${expired[0]} timed out`, contents, events);
        events.emit(tx, repo.id);
        return;
      }
      const repo = (await tx.q<Row>('SELECT r.*, o.slug AS org_slug FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1', [item.id]))[0];
      await tx.lockRepo(repo.id);
      await runStep(tx, repo, item.due, contents, events);
      events.emit(tx, repo.id);
    }),
  );
}

let running: Promise<void> | null = null;

/** Fires every timer due at or before `target`, in time order, and sends the resulting live updates. */
export function processDue(target: Date): Promise<void> {
  const run = async (): Promise<void> => {
    for (let item = await nextDue(target); item; item = await nextDue(target)) await fire(item);
    flushLive();
  };
  running = (running ?? Promise.resolve()).then(run, run);
  return running;
}

