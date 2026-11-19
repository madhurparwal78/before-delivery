import { config } from '../server/config.js';
import { serverNow } from '../server/clock.js';
import type { Db } from '../server/db.js';
import { conflict } from '../server/errors.js';
import type { EventSink } from '../server/live.js';
import { applyChangeOnto } from './apply.js';
import { loadChangeView } from './changeview.js';
import { checkRows, latestReports } from './checks.js';
import { mergeChangeNow } from './merge.js';
import { getChangeById, type ChangeRow, type RepoRow } from './model.js';
import type { Actor } from './restack.js';
import { createRevision, getBranchRevision, getSnapshot, loadContents, type Snapshot } from './revisions.js';

export const QUEUE_ACTOR: Actor = { username: 'merge-queue', name: 'Merge queue' };

export type QueueEntryState = 'waiting' | 'checking' | 'merged' | 'removed';

export interface QueueEntryRow {
  id: number;
  repoId: number;
  changeId: number;
  changeNumber: number;
  changeTitle: string;
  position: number | null;
  state: QueueEntryState;
  revisionId: string | null;
  revisionCounter: number;
  revisionSetAt: Date;
  reason: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

const ENTRY_SELECT = `SELECT e.id, e.repo_id, e.change_id, c.number AS change_number, c.title AS change_title,
  e.position, e.state, e.revision_id, e.revision_counter, e.revision_set_at, e.reason, e.created_at, e.finished_at
  FROM rs_queue_entries e JOIN rs_changes c ON c.id = e.change_id`;

interface EntryQueryRow {
  id: string;
  repo_id: string;
  change_id: string;
  change_number: number;
  change_title: string;
  position: number | null;
  state: QueueEntryState;
  revision_id: string | null;
  revision_counter: number;
  revision_set_at: Date;
  reason: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function toEntry(row: EntryQueryRow): QueueEntryRow {
  return {
    id: Number(row.id),
    repoId: Number(row.repo_id),
    changeId: Number(row.change_id),
    changeNumber: row.change_number,
    changeTitle: row.change_title,
    position: row.position === null ? null : Number(row.position),
    state: row.state,
    revisionId: row.revision_id,
    revisionCounter: Number(row.revision_counter),
    revisionSetAt: row.revision_set_at,
    reason: row.reason,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export async function entryForChange(tx: Db, changeId: number): Promise<QueueEntryRow | null> {
  const rows = await tx.query<EntryQueryRow>(`${ENTRY_SELECT} WHERE e.change_id = $1 ORDER BY e.id DESC LIMIT 1`, [
    changeId,
  ]);
  return rows.length === 0 ? null : toEntry(rows[0]);
}

export async function getEntry(tx: Db, id: number): Promise<QueueEntryRow | null> {
  const rows = await tx.query<EntryQueryRow>(`${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  return rows.length === 0 ? null : toEntry(rows[0]);
}

export async function activeEntries(tx: Db, repoId: number): Promise<QueueEntryRow[]> {
  const rows = await tx.query<EntryQueryRow>(
    `${ENTRY_SELECT} WHERE e.repo_id = $1 AND e.state IN ('waiting', 'checking') ORDER BY e.position`,
    [repoId],
  );
  return rows.map(toEntry);
}

export async function historyEntries(tx: Db, repoId: number): Promise<QueueEntryRow[]> {
  const rows = await tx.query<EntryQueryRow>(
    `${ENTRY_SELECT} WHERE e.repo_id = $1 AND e.state IN ('merged', 'removed') ORDER BY e.finished_at DESC, e.id DESC`,
    [repoId],
  );
  return rows.map(toEntry);
}

export async function entriesForRevision(tx: Db, repoId: number, revisionId: string): Promise<QueueEntryRow[]> {
  const rows = await tx.query<EntryQueryRow>(
    `${ENTRY_SELECT} WHERE e.repo_id = $1 AND e.revision_id = $2 AND e.state IN ('waiting', 'checking')`,
    [repoId, revisionId],
  );
  return rows.map(toEntry);
}

export async function entryChecks(tx: Db, repo: RepoRow, entry: QueueEntryRow) {
  const reports = await latestReports(tx, repo.id, entry.revisionId!);
  return checkRows(repo.requiredChecks, reports, entry.revisionSetAt);
}

async function computeState(tx: Db, repo: RepoRow, entry: QueueEntryRow): Promise<QueueEntryState> {
  if (repo.requiredChecks.length === 0) return 'checking';
  const reports = await latestReports(tx, repo.id, entry.revisionId!);
  for (const report of reports.values()) {
    if (report.state !== 'queued') return 'checking';
  }
  return 'waiting';
}

/** A queue revision is the base head with every entry ahead applied in order, then this change. */
async function buildQueueRevision(
  tx: Db,
  repo: RepoRow,
  entry: QueueEntryRow,
  ahead: QueueEntryRow[],
  counter: number,
): Promise<{ ok: true; revision: string } | { ok: false; conflicts: string[] }> {
  const baseHead = (await getBranchRevision(tx, repo.id, repo.defaultBranch))!;
  let snapshot: Snapshot = await getSnapshot(tx, repo.id, baseHead);

  for (const other of [...ahead, entry]) {
    const change = (await getChangeById(tx, other.changeId))!;
    const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
    const baseSnapshot = await getSnapshot(tx, repo.id, change.baseRevision);
    const headSnapshot = await getSnapshot(tx, repo.id, headRevision);
    const result = applyChangeOnto(baseSnapshot, headSnapshot, snapshot);
    if (!result.ok) {
      if (other.id === entry.id) return { ok: false, conflicts: result.conflicts };
      continue;
    }
    snapshot = result.snapshot;
  }

  const change = (await getChangeById(tx, entry.changeId))!;
  const contents = await loadContents(snapshot);
  const revision = await createRevision(tx, repo.id, {
    parents: [baseHead],
    message: `Queue #${change.number} v${counter}`,
    authorUsername: QUEUE_ACTOR.username,
    authorName: QUEUE_ACTOR.name,
    contents,
  });
  return { ok: true, revision };
}

async function setEntryRevision(
  tx: Db,
  repo: RepoRow,
  entry: QueueEntryRow,
  counter: number,
  sink: EventSink,
): Promise<boolean> {
  const ahead = (await activeEntries(tx, repo.id)).filter(
    (other) => other.id !== entry.id && other.position !== null && entry.position !== null && other.position < entry.position,
  );
  const built = await buildQueueRevision(tx, repo, entry, ahead, counter);
  if (!built.ok) {
    await removeEntry(tx, repo, entry, `Removed: conflicts with ${built.conflicts.join(', ')}`, sink);
    return false;
  }
  await tx.query(
    'UPDATE rs_queue_entries SET revision_id = $2, revision_counter = $3, revision_set_at = $4 WHERE id = $1',
    [entry.id, built.revision, counter, serverNow()],
  );
  const refreshed = (await getEntry(tx, entry.id))!;
  const state = await computeState(tx, repo, refreshed);
  await tx.query('UPDATE rs_queue_entries SET state = $2 WHERE id = $1', [entry.id, state]);
  return true;
}

async function renumber(tx: Db, repo: RepoRow, sink: EventSink): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  let position = 1;
  for (const entry of entries) {
    if (entry.position !== position) {
      await tx.query('UPDATE rs_queue_entries SET position = $2 WHERE id = $1', [entry.id, position]);
      sink.add({
        kind: 'queue-position',
        text: `#${entry.changeNumber}: queue position ${position}`,
        change: entry.changeNumber,
      });
    }
    position += 1;
  }
}

/** Every entry from a position onwards gets a new queue revision with its checks reset. */
async function resetFrom(tx: Db, repo: RepoRow, fromPosition: number, sink: EventSink): Promise<void> {
  const entries = (await activeEntries(tx, repo.id)).filter((entry) => (entry.position ?? 0) >= fromPosition);
  for (const entry of entries) {
    const current = await getEntry(tx, entry.id);
    if (!current || (current.state !== 'waiting' && current.state !== 'checking')) continue;
    await setEntryRevision(tx, repo, current, current.revisionCounter + 1, sink);
  }
}

export async function removeEntry(
  tx: Db,
  repo: RepoRow,
  entry: QueueEntryRow,
  reason: string,
  sink: EventSink,
): Promise<void> {
  const position = entry.position ?? 1;
  await tx.query(
    "UPDATE rs_queue_entries SET state = 'removed', reason = $2, position = NULL, finished_at = $3 WHERE id = $1",
    [entry.id, reason, serverNow()],
  );
  await tx.query("UPDATE rs_changes SET state = 'removed', removal_reason = $2 WHERE id = $1", [entry.changeId, reason]);
  sink.add({ kind: 'queue-removed', text: `#${entry.changeNumber}: ${reason}`, change: entry.changeNumber });
  await renumber(tx, repo, sink);
  await resetFrom(tx, repo, position, sink);
  await scheduleNextStep(tx, repo, false);
}

export async function scheduleNextStep(tx: Db, repo: RepoRow, afterStep: boolean): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  const rows = await tx.query<{ queue_next_step_at: Date | null }>(
    'SELECT queue_next_step_at FROM rs_repos WHERE id = $1',
    [repo.id],
  );
  const current = rows[0].queue_next_step_at;
  if (entries.length === 0) {
    await tx.query('UPDATE rs_repos SET queue_next_step_at = NULL WHERE id = $1', [repo.id]);
    return;
  }
  if (afterStep || current === null) {
    const basis = afterStep && current !== null ? current.getTime() : serverNow().getTime();
    const next = new Date(basis + config.queueStepSeconds * 1000);
    await tx.query('UPDATE rs_repos SET queue_next_step_at = $2 WHERE id = $1', [repo.id, next]);
  }
}

export async function admitToQueue(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  sink: EventSink,
): Promise<QueueEntryRow> {
  if (change.state === 'merged') throw conflict('This change is already merged');
  if (change.state === 'queued') throw conflict('This change is already in the merge queue');
  if (!repo.queueOn) throw conflict('This repository does not use a merge queue');
  if (change.baseBranch !== repo.defaultBranch) throw conflict('Only changes based on main can join the merge queue');
  if (change.state === 'draft') throw conflict('A draft change cannot join the merge queue');
  const view = await loadChangeView(tx, repo, change, null);
  if (view.mergeRules.some((rule) => rule.rule !== 'met')) {
    throw conflict('This change has unmet merge rules and cannot join the merge queue');
  }

  const existing = await activeEntries(tx, repo.id);
  const position = existing.length + 1;
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO rs_queue_entries (repo_id, change_id, position, state, revision_set_at, created_at)
     VALUES ($1, $2, $3, 'waiting', $4, $4) RETURNING id`,
    [repo.id, change.id, position, serverNow()],
  );
  const entryId = Number(rows[0].id);
  await tx.query("UPDATE rs_changes SET state = 'queued', removal_reason = NULL WHERE id = $1", [change.id]);
  const entry = (await getEntry(tx, entryId))!;
  await setEntryRevision(tx, repo, entry, 1, sink);
  await scheduleNextStep(tx, repo, false);
  sink.add({ kind: 'queue-position', text: `#${change.number}: queue position ${position}`, change: change.number });
  return (await getEntry(tx, entryId))!;
}

export async function removeEntryForUpdatedChange(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  sink: EventSink,
): Promise<void> {
  const entry = await entryForChange(tx, change.id);
  if (!entry || (entry.state !== 'waiting' && entry.state !== 'checking')) return;
  await removeEntry(tx, repo, entry, 'Removed: the change was updated while queued', sink);
}

/** A report that lands on an entry's current queue revision decides its state or removes it. */
export async function entryReportArrived(tx: Db, repo: RepoRow, revisionId: string, sink: EventSink): Promise<void> {
  for (const entry of await entriesForRevision(tx, repo.id, revisionId)) {
    const rows = await entryChecks(tx, repo, entry);
    const failed = rows.find((row) => row.required && row.state === 'failure');
    if (failed) {
      await removeEntry(tx, repo, entry, `Removed: check ${failed.name} failed`, sink);
      continue;
    }
    const state = await computeState(tx, repo, entry);
    if (state !== entry.state) {
      await tx.query('UPDATE rs_queue_entries SET state = $2 WHERE id = $1', [entry.id, state]);
    }
  }
}

export async function entryTimedOut(
  tx: Db,
  repo: RepoRow,
  entry: QueueEntryRow,
  checkName: string,
  sink: EventSink,
): Promise<void> {
  await removeEntry(tx, repo, entry, `Removed: check ${checkName} timed out`, sink);
}

/** One queue step merges at most the head entry. */
export async function runQueueStep(tx: Db, repo: RepoRow, sink: EventSink): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  if (entries.length === 0) {
    await tx.query('UPDATE rs_repos SET queue_next_step_at = NULL WHERE id = $1', [repo.id]);
    return;
  }
  const head = entries[0];
  const rows = await entryChecks(tx, repo, head);
  const ready = head.state === 'checking' && rows.filter((row) => row.required).every((row) => row.state === 'success');
  if (ready) {
    const change = (await getChangeById(tx, head.changeId))!;
    await mergeChangeNow(tx, repo, change, QUEUE_ACTOR, sink);
    await tx.query(
      "UPDATE rs_queue_entries SET state = 'merged', position = NULL, finished_at = $2 WHERE id = $1",
      [head.id, serverNow()],
    );
    await renumber(tx, repo, sink);
  }
  await scheduleNextStep(tx, repo, true);
}

export async function resetAllEntries(tx: Db, repo: RepoRow, sink: EventSink): Promise<void> {
  await resetFrom(tx, repo, 1, sink);
}

export async function moveEntry(
  tx: Db,
  repo: RepoRow,
  entry: QueueEntryRow,
  position: number,
  sink: EventSink,
): Promise<void> {
  const entries = await activeEntries(tx, repo.id);
  const from = entry.position!;
  if (from === position) return;
  const ordered = entries.filter((item) => item.id !== entry.id);
  ordered.splice(position - 1, 0, entry);
  let index = 1;
  for (const item of ordered) {
    await tx.query('UPDATE rs_queue_entries SET position = $2 WHERE id = $1', [item.id, index]);
    if (item.position !== index) {
      sink.add({
        kind: 'queue-position',
        text: `#${item.changeNumber}: queue position ${index}`,
        change: item.changeNumber,
      });
    }
    index += 1;
  }
  await resetFrom(tx, repo, Math.min(from, position), sink);
}

export function queueEntryObject(entry: QueueEntryRow): Record<string, unknown> {
  return {
    id: entry.id,
    change: entry.changeNumber,
    state: entry.state,
    position: entry.position,
    revision: entry.revisionId,
    reason: entry.reason,
  };
}
