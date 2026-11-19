import type { Tx } from './revisions.js';
import {
  getBranch, getChange, insertRevision, revisionFileTexts, changeCombinedDiff,
  changeHeadRevision, computeRevisionId, revisionFileRows, type ChangeRow,
} from './revisions.js';
import { contentKey } from '../storage.js';
import { byteOrder, byteLength } from '../../shared/bytes.js';
import { fileLevelApply, type CombinedFile } from '../../shared/rules.js';
import { lineMovement, splitLines } from '../../shared/lines.js';
import { diffSignature, Sentences, type ServiceDeps } from './domain.js';

export interface PushFile { path: string; content: string | null }

export interface PushOutcome {
  revision: string;
  restackEvents: RestackOutcome[];
}

export interface RestackOutcome {
  changeNumber: number;
  result: 'kept' | 'dismissed' | 'conflicting' | 'not_restacked';
  dismissedCount: number;
  notice: string | null;
  noticeType: 'base-changed' | 'restack-stopped' | 'not-restacked' | null;
  newRevision: string | null;
}

/**
 * One push: applies files onto the branch's snapshot, writes objects, makes
 * the revision, then runs the push's side effects (dismissal, thread mapping,
 * viewed resets) and the restack cascade up the stack.
 *
 * Must be called inside a transaction that has already verified the expected
 * head and the storage health.
 */
export async function performPush(
  deps: ServiceDeps,
  tx: Tx,
  repoId: number,
  branch: string,
  parentRevision: string,
  message: string,
  files: PushFile[],
  author: { username: string; name: string },
  opts: { isRestackRetry?: boolean } = {},
): Promise<PushOutcome> {
  const { storage } = deps;
  const now = deps.clock.nowMs();
  const branchTexts = await revisionFileTexts(tx, storage, repoId, parentRevision);
  const newFiles = new Map(branchTexts);
  for (const f of files) {
    if (f.content === null) newFiles.delete(f.path);
    else newFiles.set(f.path, f.content);
  }
  // Store every distinct new content first: the push is accepted only after
  // storage confirmed every object the revision names.
  for (const path of byteOrder(files.map((f) => f.path))) {
    const content = files.find((f) => f.path === path)!.content;
    if (content === null) continue;
    const key = contentKey(content);
    const exists = await tx.query('SELECT 1 FROM objects WHERE key = $1', [key]);
    if (exists.rowCount === 0) {
      await storage.put(key, content);
      await tx.query('INSERT INTO objects (key, size) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, byteLength(content)]);
    }
  }
  const id = computeRevisionId([parentRevision], message, newFiles);
  const keyMap = new Map<string, { key: string; size: number }>();
  for (const [path, content] of newFiles) keyMap.set(path, { key: contentKey(content), size: byteLength(content) });
  await insertRevision(tx, repoId, id, message, author, [parentRevision, null], keyMap, now);
  await tx.query('UPDATE branches SET revision_id = $1 WHERE repo_id = $2 AND name = $3', [id, repoId, branch]);

  const outcome: PushOutcome = { revision: id, restackEvents: [] };
  // Side effects on open changes whose head branch is this branch.
  const changedSet = new Set(files.map((f) => f.path));
  const openChanges = await tx.query(
    'SELECT * FROM changes WHERE repo_id = $1 AND head_branch = $2 AND state IN ($3,$4,$5)',
    [repoId, branch, 'draft', 'open', 'removed'],
  );
  for (const row of openChanges.rows as ChangeRow[]) {
    await applyNewHeadSideEffects(deps, tx, row, parentRevision, id, changedSet, author, null);
  }
  // The queue removes an updated change.
  const queued = await tx.query(
    "SELECT id FROM queue_entries WHERE repo_id = $1 AND change_number IN (SELECT number FROM changes WHERE repo_id = $1 AND head_branch = $2 AND state = 'queued')",
    [repoId, branch],
  );
  for (const q of queued.rows) {
    await removeQueueEntry(deps, tx, repoId, q.id, 'Removed: the change was updated while queued');
  }
  // Restack cascade up the stack.
  const events = await restackAbove(deps, tx, repoId, branch, author);
  outcome.restackEvents = events;
  return outcome;
}

/**
 * Dismissal, thread mapping and viewed resets after a change's new head.
 * identityKept is null when the caller wants the diff-identity test here.
 */
export async function applyNewHeadSideEffects(
  deps: ServiceDeps,
  tx: Tx,
  change: ChangeRow,
  previousHead: string,
  newHead: string,
  changedPaths: Set<string>,
  author: { username: string; name: string },
  lowerChange: number | null,
): Promise<{ kept: boolean; dismissedCount: number }> {
  const { storage } = deps;
  // Diff identity decides dismissal, in exactly one place.
  const beforeDiff = await diffAtHead(tx, storage, change, previousHead);
  const afterDiff = await diffAtHead(tx, storage, change, newHead);
  const kept = diffSignature(beforeDiff) === diffSignature(afterDiff);
  let dismissedCount = 0;
  if (!kept) {
    const r = await tx.query(
      "UPDATE reviews SET state = 'dismissed', reason = 'Dismissed: the change was updated after this approval' WHERE repo_id = $1 AND change_number = $2 AND state = 'approved'",
      [change.repo_id, change.number],
    );
    dismissedCount = r.rowCount ?? 0;
  }
  // Threads map through the line diff of their side.
  const threads = await tx.query(
    'SELECT * FROM threads WHERE repo_id = $1 AND change_number = $2 AND outdated = false',
    [change.repo_id, change.number],
  );
  const headBranchRow = await getBranch(tx, change.repo_id, change.head_branch);
  for (const t of threads.rows) {
    const row = t as { id: number; path: string; side: string; line: number };
    // Text of the thread's side before and after, on the change's head branch.
    const oldText = await sideText(tx, storage, change, previousHead, row.path, row.side);
    const newText = await sideText(tx, storage, change, newHead, row.path, row.side);
    if (oldText === null || newText === null) {
      await tx.query('UPDATE threads SET outdated = true WHERE id = $1', [row.id]);
      continue;
    }
    const stillInDiff = afterDiff.some((f) => f.path === row.path);
    if (!stillInDiff) {
      await tx.query('UPDATE threads SET outdated = true WHERE id = $1', [row.id]);
      continue;
    }
    const movement = lineMovement(oldText, newText);
    const mapped = movement.get(row.line);
    if (mapped === undefined) {
      await tx.query('UPDATE threads SET outdated = true WHERE id = $1', [row.id]);
    } else {
      await tx.query('UPDATE threads SET line = $1, revision = $2 WHERE id = $3', [mapped, newHead, row.id]);
    }
  }
  // Viewed marks reset when the file's head content changed.
  for (const path of changedPaths) {
    const before = await sideText(tx, storage, change, previousHead, path, 'new');
    const after = await sideText(tx, storage, change, newHead, path, 'new');
    if (before !== after) {
      await tx.query('DELETE FROM viewed_marks WHERE repo_id = $1 AND change_number = $2 AND path = $3', [change.repo_id, change.number, path]);
    }
  }
  // Suggestions: a suggested range is refused when its lines changed; the
  // suggestion state stays open (checked at apply time).
  return { kept, dismissedCount };
}

async function sideText(
  tx: Tx, storage: { get(key: string): Promise<string> }, change: ChangeRow, revision: string, path: string, side: string,
): Promise<string | null> {
  const rows = await tx.query(
    'SELECT key FROM revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3',
    [change.repo_id, revision, path],
  );
  if (rows.rowCount === 0) return null;
  return storage.get(rows.rows[0].key);
}

/** The combined diff with a specific head revision. */
export async function diffAtHead(
  tx: Tx, storage: { get(key: string): Promise<string> }, change: ChangeRow, headRevision: string,
): Promise<CombinedFile[]> {
  const base = await revisionFileTexts(tx, storage, change.repo_id, change.base_revision);
  const head = await revisionFileTexts(tx, storage, change.repo_id, headRevision);
  const { combinedDiff } = await import('../../shared/rules.js');
  return combinedDiff(new Map(base), new Map(head));
}

/**
 * The restack cascade: every change above the updated branch, in stack order,
 * is restacked onto the new head of the change directly below it with the
 * file-level apply rule. A conflict stops the stack.
 */
export async function restackAbove(
  deps: ServiceDeps,
  tx: Tx,
  repoId: number,
  updatedBranch: string,
  author: { username: string; name: string },
): Promise<RestackOutcome[]> {
  const events: RestackOutcome[] = [];
  // Walk the chain: the change whose base branch is the updated branch, then
  // each change above it, bottom to top.
  let currentBranch = updatedBranch;
  let stopped = false;
  let stopper = 0;
  for (let depth = 0; depth < 64 && !stopped; depth++) {
    const above = await tx.query(
      "SELECT * FROM changes WHERE repo_id = $1 AND base_branch = $2 AND state IN ('draft','open','removed') ORDER BY number",
      [repoId, currentBranch],
    );
    if (above.rows.length === 0) break;
    const change = above.rows[0] as ChangeRow;
    if (stopped) break;
    const result = await restackOne(deps, tx, change, currentBranch, author, stopper);
    events.push(result);
    if (result.result === 'conflicting') {
      stopped = true;
      stopper = change.number;
    } else {
      currentBranch = change.head_branch;
    }
  }
  // Mark every change above a conflict as not restacked.
  if (stopped) {
    let branch = updatedBranch;
    let marking = true;
    for (let i = 0; i < 64 && marking; i++) {
      const above = await tx.query(
        "SELECT * FROM changes WHERE repo_id = $1 AND base_branch = $2 AND state IN ('draft','open','removed') ORDER BY number",
        [repoId, branch],
      );
      if (above.rows.length === 0) break;
      const change = above.rows[0] as ChangeRow;
      const already = events.find((e) => e.changeNumber === change.number);
      if (already && already.result !== 'conflicting') {
        already.result = 'not_restacked';
        already.notice = `Not restacked: #${stopper} has a restack conflict`;
        already.noticeType = 'not-restacked';
        await tx.query(
          'UPDATE changes SET restack_result = $1, restack_notice = $2, restack_notice_type = $3 WHERE repo_id = $4 AND number = $5',
          ['not_restacked', already.notice, 'not-restacked', repoId, change.number],
        );
      }
      branch = change.head_branch;
      if (already && already.result === 'conflicting') marking = false;
    }
  }
  return events;
}

/** Restacks one change onto the current head of the change below it. */
async function restackOne(
  deps: ServiceDeps,
  tx: Tx,
  change: ChangeRow,
  lowerBranch: string,
  author: { username: string; name: string },
  stopper: number,
): Promise<RestackOutcome> {
  const { storage } = deps;
  const lowerBranchRow = await getBranch(tx, change.repo_id, lowerBranch);
  if (!lowerBranchRow) {
    return { changeNumber: change.number, result: 'not_restacked', dismissedCount: 0, notice: `Not restacked: #${stopper} has a restack conflict`, noticeType: 'not-restacked', newRevision: null };
  }
  const lowerHead = lowerBranchRow.revision_id;
  const baseTexts = await revisionFileTexts(tx, storage, change.repo_id, change.base_revision);
  const headRev = await changeHeadRevision(tx, change);
  const headTexts = await revisionFileTexts(tx, storage, change.repo_id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(baseTexts), new Map(headTexts));
  const targetTexts = await revisionFileTexts(tx, storage, change.repo_id, lowerHead);
  const apply = fileLevelApply(diff, new Map(baseTexts), new Map(targetTexts));
  if (!apply.ok) {
    const notice = `Restack stopped: ${apply.conflicts.join(', ')} changed in #${await branchChangeNumber(tx, change.repo_id, lowerBranch)}`;
    await tx.query(
      'UPDATE changes SET restack_result = $1, restack_dismissed = 0, restack_notice = $2, restack_notice_type = $3 WHERE repo_id = $4 AND number = $5',
      ['conflicting', notice, 'restack-stopped', change.repo_id, change.number],
    );
    return { changeNumber: change.number, result: 'conflicting', dismissedCount: 0, notice, noticeType: 'restack-stopped', newRevision: null };
  }
  // A successful restack: new head revision "Restack onto #<lower>".
  const lowerNumber = await branchChangeNumber(tx, change.repo_id, lowerBranch);
  const message = `Restack onto #${lowerNumber}`;
  const previousHead = headRev;
  const keptFiles = new Map<string, string>();
  for (const [path, content] of apply.result) if (content !== null) keptFiles.set(path, content);
  const newId = computeRevisionId([previousHead], message, keptFiles);
  const keyMap = new Map<string, { key: string; size: number }>();
  for (const [path, content] of apply.result) {
    if (content === null) continue;
    keyMap.set(path, { key: contentKey(content), size: byteLength(content) });
  }
  const now = deps.clock.nowMs();
  await insertRevision(tx, change.repo_id, newId, message, author, [previousHead, null], keyMap, now);
  await tx.query('UPDATE branches SET revision_id = $1 WHERE repo_id = $2 AND name = $3', [newId, change.repo_id, change.head_branch]);
  const beforeDiff = diff;
  await tx.query('UPDATE changes SET base_revision = $1 WHERE repo_id = $2 AND number = $3', [lowerHead, change.repo_id, change.number]);
  const afterDiff = await diffAtHead(tx, storage, change, newId);
  const kept = diffSignature(beforeDiff) === diffSignature(afterDiff);
  // Dismissal and thread mapping for the change's new head.
  const changedPaths = new Set<string>([
    ...beforeDiff.filter((f) => f.headText !== (afterDiff.find((g) => g.path === f.path)?.headText ?? null)).map((f) => f.path),
  ]);
  const sideEffects = await applyNewHeadSideEffects(deps, tx, change, previousHead, newId, changedPaths, author, change.number);
  const dismissedCount = kept ? 0 : sideEffects.dismissedCount;
  // A successful restack keeps the base-change notice: it belongs to this
  // same event (the notice is cleared only by a later conflicting restack).
  await tx.query(
    'UPDATE changes SET restack_result = $1, restack_dismissed = $2 WHERE repo_id = $3 AND number = $4',
    [kept ? 'kept' : 'dismissed', dismissedCount, change.repo_id, change.number],
  );
  return {
    changeNumber: change.number,
    result: kept ? 'kept' : 'dismissed',
    dismissedCount,
    notice: null,
    noticeType: null,
    newRevision: newId,
  };
}

async function branchChangeNumber(tx: Tx, repoId: number, branch: string): Promise<number> {
  const r = await tx.query(
    "SELECT number FROM changes WHERE repo_id = $1 AND head_branch = $2 AND state IN ('draft','open','removed') ORDER BY number LIMIT 1",
    [repoId, branch],
  );
  return r.rows[0]?.number ?? 0;
}

/**
 * Retargets the change above a merged change onto the merged change's base
 * branch with the base-change notice, then restacks the chain above (DP-30).
 */
export async function retargetAfterMerge(
  deps: ServiceDeps,
  tx: Tx,
  repoId: number,
  change: ChangeRow,
  author: { username: string; name: string },
): Promise<void> {
  const above = await tx.query(
    "SELECT * FROM changes WHERE repo_id = $1 AND base_branch = $2 AND state IN ('draft','open','removed') ORDER BY number",
    [repoId, change.head_branch],
  );
  if (above.rows.length === 0) return;
  const next = above.rows[0] as ChangeRow;
  await tx.query(
    'UPDATE changes SET base_branch = $1, restack_notice = $2, restack_notice_type = $3 WHERE repo_id = $4 AND number = $5',
    [change.base_branch, `Base changed to ${change.base_branch} after #${change.number} merged`, 'base-changed', repoId, next.number],
  );
  await restackAbove(deps, tx, repoId, change.base_branch, author);
}

/** Removes a queue entry with its reason and resets the entries behind it. */
export async function removeQueueEntry(
  deps: ServiceDeps,
  tx: Tx,
  repoId: number,
  entryId: number,
  reason: string,
): Promise<void> {
  const entry = await tx.query('SELECT * FROM queue_entries WHERE repo_id = $1 AND id = $2', [repoId, entryId]);
  if (entry.rowCount === 0) return;
  const row = entry.rows[0] as { id: number; change_number: number; position: number; state: string };
  const now = deps.clock.nowMs();
  await tx.query("UPDATE queue_entries SET state = 'removed', reason = $1, ended_at_ms = $2 WHERE id = $3", [reason, now, entryId]);
  await tx.query("UPDATE changes SET state = 'removed', removal_reason = $1 WHERE repo_id = $2 AND number = $3", [reason, repoId, row.change_number]);
  await renumberQueue(deps, tx, repoId);
  await resetChecksBehind(deps, tx, repoId);
}

/** Renumbers positions from 1 after any change to the queue. */
export async function renumberQueue(deps: ServiceDeps, tx: Tx, repoId: number): Promise<void> {
  const rows = await tx.query(
    "SELECT id FROM queue_entries WHERE repo_id = $1 AND state IN ('waiting','checking') ORDER BY position, id",
    [repoId],
  );
  let p = 1;
  for (const r of rows.rows) {
    await tx.query('UPDATE queue_entries SET position = $1 WHERE id = $2', [p, r.id]);
    p++;
  }
}

/** New queue revisions with checks reset for every waiting/checking entry. */
export async function resetChecksBehind(deps: ServiceDeps, tx: Tx, repoId: number, fromPosition = 1): Promise<void> {
  const rows = await tx.query(
    "SELECT id, change_number FROM queue_entries WHERE repo_id = $1 AND state IN ('waiting','checking') AND position >= $2 ORDER BY position",
    [repoId, fromPosition],
  );
  for (const r of rows.rows as Array<{ id: number; change_number: number }>) {
    await rebuildQueueRevision(deps, tx, repoId, r.id);
  }
}

/** Recomputes one entry's queue revision from the entries ahead of it. */
export async function rebuildQueueRevision(deps: ServiceDeps, tx: Tx, repoId: number, entryId: number): Promise<void> {
  const entry = await tx.query('SELECT * FROM queue_entries WHERE id = $1', [entryId]);
  if (entry.rowCount === 0) return;
  const row = entry.rows[0] as { id: number; change_number: number; position: number; vcount: number };
  const change = await getChange(tx, repoId, row.change_number);
  if (!change) return;
  const base = await getBranch(tx, repoId, 'main');
  if (!base) return;
  // base head with every entry ahead applied in order, then this entry.
  const files = await revisionFileTexts(tx, deps.storage, repoId, base.revision_id);
  const ahead = await tx.query(
    "SELECT change_number FROM queue_entries WHERE repo_id = $1 AND state IN ('waiting','checking') AND position < $2 ORDER BY position",
    [repoId, row.position],
  );
  const current: Map<string, string> = new Map(files);
  let rev = base.revision_id;
  let ok = true;
  for (const a of ahead.rows as Array<{ change_number: number }>) {
    const aheadChange = await getChange(tx, repoId, a.change_number);
    if (!aheadChange) continue;
    const applied = await applyChangeOnto(deps, tx, aheadChange, current);
    if (!applied.ok) { ok = false; break; }
    copyEntries(current, applied.files);
    rev = applied.revision ?? rev;
  }
  if (!ok) return;
  const appliedSelf = await applyChangeOnto(deps, tx, change, current);
  if (!appliedSelf.ok) return;
  const newV = row.vcount + 1;
  const message = `Queue #${change.number} v${newV}`;
  const newId = computeRevisionId([base.revision_id], message, appliedSelf.files);
  const keyMap = new Map<string, { key: string; size: number }>();
  for (const [path, content] of appliedSelf.files) {
    if (content === null) continue;
    keyMap.set(path, { key: contentKey(content), size: byteLength(content) });
  }
  await insertRevision(tx, repoId, newId, message, { username: 'merge-queue', name: 'Merge queue' }, [base.revision_id, null], keyMap, deps.clock.nowMs());
  await tx.query('UPDATE queue_entries SET revision = $1, vcount = $2 WHERE id = $3', [newId, newV, entryId]);
}

function copyEntries(into: Map<string, string>, from: Map<string, string | null>): void {
  for (const [path, content] of from) {
    if (content === null) into.delete(path);
    else into.set(path, content);
  }
}

/** Applies a change's combined diff onto a snapshot with the file-level rule. */
export async function applyChangeOnto(
  deps: ServiceDeps, tx: Tx, change: ChangeRow, snapshot: Map<string, string>,
): Promise<{ ok: boolean; files: Map<string, string>; revision: string | null }> {
  const baseTexts = await revisionFileTexts(tx, deps.storage, change.repo_id, change.base_revision);
  const headRev = await changeHeadRevision(tx, change);
  const headTexts = await revisionFileTexts(tx, deps.storage, change.repo_id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(baseTexts), new Map(headTexts));
  const apply = fileLevelApply(diff, new Map(baseTexts), snapshot);
  const files = new Map<string, string>();
  for (const [path, content] of apply.result) {
    if (content !== null) files.set(path, content);
  }
  return { ok: apply.ok, files, revision: null };
}
