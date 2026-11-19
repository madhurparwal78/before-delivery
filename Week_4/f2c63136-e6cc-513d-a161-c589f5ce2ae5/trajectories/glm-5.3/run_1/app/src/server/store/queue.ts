import type { Tx, ChangeRow } from './revisions.js';
import { getChange, getBranch, getRepoById, revisionFileTexts, changeHeadRevision, insertRevision } from './revisions.js';
import { contentKey } from '../storage.js';
import { byteOrder, byteLength } from '../../shared/bytes.js';
import { fileLevelApply } from '../../shared/rules.js';
import { computeRevisionId } from './revisions.js';
import { removeQueueEntry, renumberQueue, rebuildQueueRevision } from './push.js';
import type { ServiceDeps } from './domain.js';

interface QueueRow {
  id: number; repo_id: number; change_number: number; state: string;
  position: number; revision: string; reason: string | null; vcount: number;
  created_at_ms: number; ended_at_ms: number | null;
}

export async function getQueueEntries(tx: Tx, repoId: number): Promise<QueueRow[]> {
  const r = await tx.query(
    "SELECT * FROM queue_entries WHERE repo_id = $1 AND state IN ('waiting','checking') ORDER BY position, id",
    [repoId],
  );
  return r.rows;
}

export async function getQueueHistory(tx: Tx, repoId: number): Promise<QueueRow[]> {
  const r = await tx.query(
    "SELECT * FROM queue_entries WHERE repo_id = $1 AND state IN ('merged','removed') ORDER BY ended_at_ms DESC, id DESC",
    [repoId],
  );
  return r.rows;
}

/** Admits a change to the queue; returns the new entry or a refusal. */
export async function admitToQueue(
  deps: ServiceDeps, tx: Tx, repoId: number, change: ChangeRow,
): Promise<QueueRow> {
  const now = deps.clock.nowMs();
  const entries = await getQueueEntries(tx, repoId);
  const position = entries.length + 1;
  // Queue revision: base head with every entry ahead applied, then this change.
  const revision = await queueRevisionFiles(deps, tx, repoId, change, position);
  const vcount = (change.queue_revision_count ?? 0) + 1;
  const message = `Queue #${change.number} v${vcount}`;
  const revId = computeRevisionId([revision.baseHead], message, revision.files);
  const keyMap = new Map<string, { key: string; size: number }>();
  for (const [path, content] of revision.files) {
    keyMap.set(path, { key: contentKey(content), size: byteLength(content) });
  }
  await insertRevision(tx, repoId, revId, message, { username: 'merge-queue', name: 'Merge queue' }, [revision.baseHead, null], keyMap, now);
  await tx.query("UPDATE changes SET queue_revision_count = $1 WHERE repo_id = $2 AND number = $3", [vcount, repoId, change.number]);
  const insert = await tx.query(
    `INSERT INTO queue_entries (repo_id, change_number, state, position, revision, reason, vcount, created_at_ms)
     VALUES ($1,$2,'waiting',$3,$4,NULL,1,$5) RETURNING *`,
    [repoId, change.number, position, revId, now],
  );
  await tx.query("UPDATE changes SET state = 'queued' WHERE repo_id = $1 AND number = $2", [repoId, change.number]);
  // The first step of an empty queue is due QUEUE_STEP_SECONDS after entry.
  if (position === 1) {
    await tx.query(
      `INSERT INTO queue_state (repo_id, next_step_at_ms) VALUES ($1,$2)
       ON CONFLICT (repo_id) DO UPDATE SET next_step_at_ms = LEAST(queue_state.next_step_at_ms, EXCLUDED.next_step_at_ms)`,
      [repoId, now + deps.cfg.queueStepSeconds * 1000],
    );
  }
  return insert.rows[0];
}

/** The full snapshot files of a queue revision, with deleted paths absent. */
async function queueRevisionFiles(
  deps: ServiceDeps, tx: Tx, repoId: number, change: ChangeRow, position: number,
): Promise<{ baseHead: string; files: Map<string, string>; conflict: boolean; conflictPaths: string[] }> {
  const base = await getBranch(tx, repoId, 'main');
  const baseHead = base!.revision_id;
  const baseFiles = await revisionFileTexts(tx, deps.storage, repoId, baseHead);
  const snapshot: Map<string, string | null> = new Map(baseFiles);
  const entries = await getQueueEntries(tx, repoId);
  for (const e of entries) {
    if (e.position >= position) break;
    const ahead = await getChange(tx, repoId, e.change_number);
    if (!ahead) continue;
    const applied = await applyChangeFiles(deps, tx, ahead, snapshot);
    if (!applied.ok) {
      return { baseHead, files: new Map(), conflict: true, conflictPaths: applied.conflicts };
    }
    for (const [p, c] of applied.result) {
      if (c === null) snapshot.delete(p);
      else snapshot.set(p, c);
    }
  }
  const appliedSelf = await applyChangeFiles(deps, tx, change, snapshot);
  if (!appliedSelf.ok) {
    return { baseHead, files: new Map(), conflict: true, conflictPaths: appliedSelf.conflicts };
  }
  for (const [p, c] of appliedSelf.result) {
    if (c === null) snapshot.delete(p);
    else snapshot.set(p, c);
  }
  const files = new Map<string, string>();
  for (const [p, c] of snapshot) if (c !== null) files.set(p, c);
  return { baseHead, files, conflict: false, conflictPaths: [] };
}

async function applyChangeFiles(
  deps: ServiceDeps, tx: Tx, change: ChangeRow, snapshot: Map<string, string | null>,
): Promise<{ ok: boolean; result: Map<string, string | null>; conflicts: string[] }> {
  const baseTexts = await revisionFileTexts(tx, deps.storage, change.repo_id, change.base_revision);
  const headRev = await changeHeadRevision(tx, change);
  const headTexts = await revisionFileTexts(tx, deps.storage, change.repo_id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(baseTexts), new Map(headTexts));
  return fileLevelApply(diff, new Map(baseTexts), snapshot);
}

/** Merges the head entry at a queue step when its checks have passed. */
export async function queueStep(deps: ServiceDeps, tx: Tx, repoId: number): Promise<void> {
  const entries = await getQueueEntries(tx, repoId);
  if (entries.length === 0) {
    // Nothing to step: the queue stops here and the next entry schedules it.
    await tx.query('DELETE FROM queue_state WHERE repo_id = $1', [repoId]);
    return;
  }
  const head = entries[0];
  const change = await getChange(tx, repoId, head.change_number);
  if (!change) return;
  const repoRow = await getRepoById(tx, repoId);
  if (!repoRow) return;
  // Is the head checking with every required check passed?
  const reports = await tx.query(
    'SELECT DISTINCT ON (name) name, state FROM checks WHERE repo_id = $1 AND revision = $2 ORDER BY name, created_at_ms DESC, id DESC',
    [repoId, head.revision],
  );
  const byName = new Map<string, string>();
  for (const r of reports.rows) byName.set(r.name, r.state);
  let checking = false;
  for (const r of reports.rows) if (r.state !== 'queued') checking = true;
  const requiredPassed = repoRow.required_checks.every((name: string) => byName.get(name) === 'success');
  const now = deps.clock.nowMs();
  if (checking && requiredPassed) {
    await mergeChangeIntoBase(deps, tx, repoRow, change, head.revision, 'merge-queue');
    await tx.query("UPDATE queue_entries SET state = 'merged', ended_at_ms = $1 WHERE id = $2", [now, head.id]);
    await tx.query("UPDATE changes SET state = 'merged' WHERE repo_id = $1 AND number = $2", [repoId, change.number]);
    await renumberQueue(deps, tx, repoId);
    const { retargetAfterMerge } = await import('./push.js');
    await retargetAfterMerge(deps, tx, repoId, change, { username: 'merge-queue', name: 'Merge queue' });
  }
  // Schedule the next step while entries remain, anchored to the previous step
  // so a clock jump forward still steps one entry at a time.
  const remaining = await getQueueEntries(tx, repoId);
  if (remaining.length > 0) {
    const state = await tx.query('SELECT next_step_at_ms FROM queue_state WHERE repo_id = $1', [repoId]);
    const previous = state.rows.length > 0 ? Number(state.rows[0].next_step_at_ms) : now;
    const next = Math.max(previous, now) + deps.cfg.queueStepSeconds * 1000;
    await tx.query(
      'INSERT INTO queue_state (repo_id, next_step_at_ms) VALUES ($1,$2) ON CONFLICT (repo_id) DO UPDATE SET next_step_at_ms = $2',
      [repoId, next],
    );
  } else {
    await tx.query('DELETE FROM queue_state WHERE repo_id = $1', [repoId]);
  }
}

/** Merges a change (or a queue entry) into the base branch atomically. */
export async function mergeChangeIntoBase(
  deps: ServiceDeps, tx: Tx, repoRow: { id: number; name: string; org: string }, change: ChangeRow,
  queueRevision: string | null, authorUsername: string,
): Promise<string> {
  const { storage, clock } = deps;
  const now = clock.nowMs();
  const baseBranch = await getBranch(tx, change.repo_id, change.base_branch);
  const baseHead = baseBranch!.revision_id;
  const headRev = await changeHeadRevision(tx, change);
  const baseTexts = await revisionFileTexts(tx, storage, change.repo_id, change.base_revision);
  const headTexts = await revisionFileTexts(tx, storage, change.repo_id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(baseTexts), new Map(headTexts));
  const targetTexts = await revisionFileTexts(tx, storage, change.repo_id, baseHead);
  const apply = fileLevelApply(diff, new Map(baseTexts), new Map(targetTexts));
  if (!apply.ok) throw new Error('conflict');
  const message = `Merge #${change.number}: ${change.title}`;
  const author = authorUsername === 'merge-queue'
    ? { username: 'merge-queue', name: 'Merge queue' }
    : await authorFor(tx, authorUsername);
  const files = new Map<string, string>();
  for (const [p, c] of apply.result) if (c !== null) files.set(p, c);
  const id = computeRevisionId([baseHead, headRev], message, files);
  const keyMap = new Map<string, { key: string; size: number }>();
  for (const [p, c] of files) keyMap.set(p, { key: contentKey(c), size: byteLength(c) });
  await insertRevision(tx, change.repo_id, id, message, author, [baseHead, headRev], keyMap, now);
  await tx.query('UPDATE branches SET revision_id = $1 WHERE repo_id = $2 AND name = $3', [id, change.repo_id, change.base_branch]);
  await tx.query("UPDATE changes SET state = 'merged', merged_revision = $1 WHERE repo_id = $2 AND number = $3", [id, change.repo_id, change.number]);
  // Merge mail, recorded in the same step.
  const changes = await import('./changes.js');
  const authorUser = await changes.getUserById(tx, change.author_id);
  if (authorUser) {
    await deps.mailer.record({
      to: authorUser.email,
      subject: `[${repoRow.org}/${repoRow.name}] #${change.number} merged: ${change.title}`,
      body: `${change.title} was merged into ${change.base_branch}.\n\n${deps.cfg.appPublicUrl}/${repoRow.org}/${repoRow.name}/changes/${change.number}`,
      headers: { 'X-Change-Id': `${repoRow.org}/${repoRow.name}#${change.number}` },
    });
  }
  return id;
}

async function authorFor(tx: Tx, username: string): Promise<{ username: string; name: string }> {
  const changes = await import('./changes.js');
  const u = await changes.getUserByUsername(tx, username);
  return u ? { username: u.username, name: u.name } : { username, name: username };
}
