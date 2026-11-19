import type { Row, Tx } from '../db.ts';
import { config } from '../config.ts';
import { iso, now, wholeSecond } from '../clock.ts';
import { workspaceTime } from '../format.ts';
import { invalid } from '../errors.ts';
import { applyChange } from './combined.ts';
import { checkRows, latestReports, unmetChecks } from './checks.ts';
import { Events } from './events.ts';
import { Contents, createRevision, loadRevision, loadSnap, type Author, type Snap } from './revisions.ts';
import { mergeChange } from './stack.ts';
import type { QueueEntryView, QueueView } from '../../shared/types.ts';

const QUEUE_AUTHOR: Author = { username: 'merge-queue', name: 'Merge queue' };

async function activeEntries(tx: { q: Tx['q'] }, repoId: number): Promise<Row[]> {
  return tx.q<Row>(`SELECT * FROM queue_entries WHERE repo_id = $1 AND status = 'active' ORDER BY position`, [repoId]);
}

async function mainHead(tx: Tx, repo: Row): Promise<string> {
  return (await tx.q<Row>(`SELECT revision FROM branches WHERE repo_id = $1 AND name = 'main'`, [repo.id]))[0].revision;
}

async function changeOf(tx: Tx, id: number): Promise<Row> {
  return (await tx.q<Row>('SELECT * FROM changes WHERE id = $1', [id]))[0];
}

/** The queue revision of a change: the base head with every entry ahead applied, then this change. */
async function queueRevision(tx: Tx, repo: Row, change: Row, ahead: Snap, parent: string, contents: Contents): Promise<{ revision: string; snap: Snap } | { conflicts: string[] }> {
  const applied = applyChange(await loadSnap(tx, repo.id, change.base_revision), await loadSnap(tx, repo.id, change.head_revision), ahead);
  if (!applied.ok) return { conflicts: applied.conflicts };
  const k = change.queue_revisions + 1;
  await tx.q('UPDATE changes SET queue_revisions = $1 WHERE id = $2', [k, change.id]);
  const revision = await createRevision(tx, repo.id, { parents: [parent], message: `Queue #${change.number} v${k}`, snap: applied.snap, author: QUEUE_AUTHOR }, contents);
  return { revision, snap: applied.snap };
}

const conflictReason = (paths: string[]): string => `Removed: conflicts with ${paths.join(', ')}`;

async function markRemoved(tx: Tx, entry: Row, reason: string, events: Events): Promise<void> {
  await tx.q(`UPDATE queue_entries SET status = 'removed', position = NULL, reason = $1, finished_at = $2 WHERE id = $3`, [reason, wholeSecond(now()), entry.id]);
  const change = await changeOf(tx, entry.change_id);
  await tx.q(`UPDATE changes SET state = 'removed', removal_reason = $1 WHERE id = $2`, [reason, entry.change_id]);
  events.say(`#${change.number}: ${reason}`, 'both');
  events.touch([change.number]);
  events.queue = true;
}

/**
 * Gives every entry of `entries` from index `from` on a new queue revision (checks start over) and
 * renumbers positions; an entry whose change no longer applies is removed instead.
 */
async function rebuildFrom(tx: Tx, repo: Row, entries: Row[], from: number, contents: Contents, events: Events): Promise<void> {
  const parent = await mainHead(tx, repo);
  let running = from > 0 ? await loadSnap(tx, repo.id, entries[from - 1].revision) : await loadSnap(tx, repo.id, parent);
  let position = from;
  for (const entry of entries.slice(from)) {
    const change = await changeOf(tx, entry.change_id);
    const made = await queueRevision(tx, repo, change, running, parent, contents);
    if ('conflicts' in made) {
      await markRemoved(tx, entry, conflictReason(made.conflicts), events);
      continue;
    }
    position += 1;
    running = made.snap;
    await tx.q('UPDATE queue_entries SET revision = $1, position = $2, checks_settled = false WHERE id = $3', [made.revision, position, entry.id]);
    if (entry.position !== position) {
      events.say(`#${change.number}: queue position ${position}`, 'both');
      events.touch([change.number]);
    }
  }
  events.queue = true;
}

async function settleNextStep(tx: Tx, repo: Row, due: Date | null): Promise<void> {
  const remaining = (await activeEntries(tx, repo.id)).length;
  await tx.q('UPDATE repos SET queue_next_step = $1 WHERE id = $2', [remaining ? due : null, repo.id]);
}

export async function removeEntry(tx: Tx, repo: Row, entry: Row, reason: string, contents: Contents, events: Events): Promise<void> {
  await markRemoved(tx, entry, reason, events);
  await rebuildFrom(tx, repo, await activeEntries(tx, repo.id), entry.position - 1, contents, events);
  const current = (await tx.q<Row>('SELECT queue_next_step FROM repos WHERE id = $1', [repo.id]))[0].queue_next_step;
  await settleNextStep(tx, repo, current);
}

export async function enqueue(tx: Tx, repo: Row, change: Row, contents: Contents, events: Events): Promise<Row> {
  const entries = await activeEntries(tx, repo.id);
  const parent = await mainHead(tx, repo);
  const ahead = await loadSnap(tx, repo.id, entries.length ? entries[entries.length - 1].revision : parent);
  const made = await queueRevision(tx, repo, change, ahead, parent, contents);
  const created = wholeSecond(now());
  events.touch([change.number]);
  events.queue = true;
  if ('conflicts' in made) {
    const reason = conflictReason(made.conflicts);
    const row = await tx.q<Row>(
      `INSERT INTO queue_entries (repo_id, change_id, status, revision, reason, created_at, finished_at)
       VALUES ($1, $2, 'removed', $3, $4, $5, $5) RETURNING *`,
      [repo.id, change.id, change.head_revision, reason, created],
    );
    await tx.q(`UPDATE changes SET state = 'removed', removal_reason = $1 WHERE id = $2`, [reason, change.id]);
    events.say(`#${change.number}: ${reason}`, 'both');
    return row[0];
  }
  const row = await tx.q<Row>(
    `INSERT INTO queue_entries (repo_id, change_id, status, position, revision, created_at) VALUES ($1, $2, 'active', $3, $4, $5) RETURNING *`,
    [repo.id, change.id, entries.length + 1, made.revision, created],
  );
  await tx.q(`UPDATE changes SET state = 'queued', removal_reason = NULL WHERE id = $1`, [change.id]);
  if (!entries.length) await tx.q('UPDATE repos SET queue_next_step = $1 WHERE id = $2', [new Date(now().getTime() + config.queueStepSeconds * 1000), repo.id]);
  events.say(`#${change.number}: queue position ${entries.length + 1}`, 'both');
  return row[0];
}

export async function moveEntry(tx: Tx, repo: Row, entry: Row, position: number, contents: Contents, events: Events): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  if (!Number.isInteger(position) || position < 1 || position > entries.length) throw invalid({ position: `Position must be between 1 and ${entries.length}` });
  if (position === entry.position) return;
  const order = entries.filter((candidate) => candidate.id !== entry.id);
  order.splice(position - 1, 0, entry);
  await rebuildFrom(tx, repo, order, Math.min(position, entry.position) - 1, contents, events);
}

interface EntryState {
  state: 'waiting' | 'checking';
  checks: ReturnType<typeof checkRows>;
  ready: boolean;
}

export async function entryState(tx: Pick<Tx, 'q'>, repo: Row, entry: Row): Promise<EntryState> {
  const reports = await latestReports(tx, repo.id, entry.revision);
  const created = (await loadRevision(tx, repo.id, entry.revision))!.created_at as Date;
  const checks = checkRows(reports, repo.required_checks, created, true);
  const started = !repo.required_checks.length || [...reports.values()].some((report) => report.state !== 'queued');
  return { state: started ? 'checking' : 'waiting', checks, ready: started && unmetChecks(checks, repo.required_checks).length === 0 };
}

/** One queue step: merges the head entry when it is checking with every required check passed. */
export async function runStep(tx: Tx, repo: Row, due: Date, contents: Contents, events: Events): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  if (entries.length) {
    const head = entries[0];
    if ((await entryState(tx, repo, head)).ready) {
      const change = await changeOf(tx, head.change_id);
      await mergeChange(tx, repo, change, QUEUE_AUTHOR, contents, events);
      await tx.q(`UPDATE queue_entries SET status = 'merged', position = NULL, finished_at = $1 WHERE id = $2`, [wholeSecond(now()), head.id]);
      for (const entry of entries.slice(1)) {
        const behind = await changeOf(tx, entry.change_id);
        await tx.q('UPDATE queue_entries SET position = $1 WHERE id = $2', [entry.position - 1, entry.id]);
        events.say(`#${behind.number}: queue position ${entry.position - 1}`, 'both');
        events.touch([behind.number]);
      }
      events.queue = true;
    }
  }
  await settleNextStep(tx, repo, new Date(due.getTime() + config.queueStepSeconds * 1000));
}

async function entryObject(tx: Pick<Tx, 'q'>, repo: Row, entry: Row): Promise<QueueEntryView> {
  const change = (await tx.q<Row>('SELECT number, title FROM changes WHERE id = $1', [entry.change_id]))[0];
  const live = entry.status === 'active' ? await entryState(tx, repo, entry) : null;
  const finished = entry.finished_at as Date | null;
  return {
    id: entry.id,
    change: change.number,
    title: change.title,
    state: live ? live.state : entry.status,
    position: entry.position,
    revision: entry.revision,
    reason: entry.reason,
    checks: live ? live.checks : [],
    finished_at: finished ? { iso: iso(finished), shown: workspaceTime(finished) } : null,
  };
}

export async function queueView(tx: Pick<Tx, 'q'>, repo: Row, org: Row, canReorder: boolean): Promise<QueueView> {
  const rows = await tx.q<Row>('SELECT * FROM queue_entries WHERE repo_id = $1 ORDER BY id', [repo.id]);
  const entries = await Promise.all(rows.filter((row) => row.status === 'active').sort((a, b) => a.position - b.position).map((row) => entryObject(tx, repo, row)));
  const history = await Promise.all(rows.filter((row) => row.status !== 'active').reverse().map((row) => entryObject(tx, repo, row)));
  return { repo: { id: repo.id, org: org.slug, name: repo.name }, can_reorder: canReorder, entries, history };
}

/** A push to main outside the queue gives every entry a new queue revision. */
export async function mainMoved(tx: Tx, repo: Row, contents: Contents, events: Events): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  if (entries.length) await rebuildFrom(tx, repo, entries, 0, contents, events);
}
