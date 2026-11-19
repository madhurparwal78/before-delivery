import type { Db, Row, Tx } from '../db.ts';
import { combinedDiff, diffHash, applyChange } from './combined.ts';
import { Events } from './events.ts';
import { queueMail } from '../mail.ts';
import { config } from '../config.ts';
import { Contents, createRevision, loadSnap, type Author, type Snap } from './revisions.ts';
import { remapThreads } from './threads.ts';
import { conflict } from '../errors.ts';

export async function unmergedChanges(tx: Db, repoId: number): Promise<Row[]> {
  return tx.q<Row>(`SELECT * FROM changes WHERE repo_id = $1 AND state <> 'merged' ORDER BY number`, [repoId]);
}

const lowerOf = (all: Row[], change: Row): Row | undefined => all.find((other) => other.id !== change.id && other.head === change.base);
const childrenOf = (all: Row[], change: Row): Row[] => all.filter((other) => other.id !== change.id && other.base === change.head);

/** The stack of a change, bottom to top. */
export function stackOf(all: Row[], change: Row): Row[] {
  const below: Row[] = [];
  for (let lower = lowerOf(all, change); lower && !below.includes(lower); lower = lowerOf(all, lower)) below.unshift(lower);
  const above: Row[] = [];
  for (let next = childrenOf(all, change)[0]; next && !above.includes(next); next = childrenOf(all, next)[0]) above.push(next);
  return [...below, change, ...above];
}

/** Every change above a change in stack order, parents before children. */
function descendants(all: Row[], change: Row): Row[] {
  const order: Row[] = [];
  for (let queue = childrenOf(all, change); queue.length; ) {
    const next = queue.shift()!;
    if (order.includes(next)) continue;
    order.push(next);
    queue.push(...childrenOf(all, next));
  }
  return order;
}

export const stackNumbers = (all: Row[], change: Row): number[] => stackOf(all, change).map((row) => row.number);

interface Heads {
  base: Snap;
  head: Snap;
}

/**
 * What a new head revision does to the change, once: approvals given on another combined diff are
 * dismissed, viewed marks of paths whose head content changed are dropped, threads follow the lines.
 */
async function onNewHead(tx: Tx, change: Row, before: Heads, after: Heads, contents: Contents): Promise<{ kept: boolean; dismissed: number }> {
  const next = combinedDiff(after.base, after.head);
  const nextHash = diffHash(next);
  const kept = diffHash(combinedDiff(before.base, before.head)) === nextHash;
  const dismissed = await tx.q(
    `UPDATE reviews SET state = 'dismissed' WHERE change_id = $1 AND state = 'approved' AND diff_hash <> $2 RETURNING id`,
    [change.id, nextHash],
  );
  const marks = await tx.q<Row>('SELECT DISTINCT path FROM viewed WHERE change_id = $1', [change.id]);
  const changedPaths = marks.map((mark) => mark.path).filter((path) => before.head.get(path)?.sha !== after.head.get(path)?.sha);
  if (changedPaths.length) await tx.q('DELETE FROM viewed WHERE change_id = $1 AND path = ANY($2)', [change.id, changedPaths]);
  await remapThreads(tx, change, before, after, contents);
  return { kept, dismissed: dismissed.length };
}

const word = (kept: boolean): string => (kept ? 'kept' : 'dismissed');

async function refresh(tx: Tx, change: Row): Promise<Row> {
  return (await tx.q<Row>('SELECT * FROM changes WHERE id = $1', [change.id]))[0];
}

async function storeResult(tx: Tx, change: Row, result: string, dismissed: number, notice: string | null, kind: string | null): Promise<void> {
  await tx.q('UPDATE changes SET restack_result = $1, restack_dismissed = $2, restack_notice = $3, restack_notice_kind = $4 WHERE id = $5', [
    result,
    dismissed,
    notice,
    kind,
    change.id,
  ]);
}

/** The stored count is the number shown in the result word: dismissed approvals, or conflicting files. */
/** Restacks one change onto a newer revision with the file-level rule; false when it conflicts. */
async function restackChange(
  tx: Tx,
  repo: Row,
  change: Row,
  onto: { revision: string; lowerNumber: number },
  author: Author,
  contents: Contents,
  events: Events,
  baseNotice: string | null,
): Promise<boolean> {
  const before: Heads = { base: await loadSnap(tx, repo.id, change.base_revision), head: await loadSnap(tx, repo.id, change.head_revision) };
  const applied = applyChange(before.base, before.head, await loadSnap(tx, repo.id, onto.revision));
  events.touch([change.number]);
  if (!applied.ok) {
    await storeResult(tx, change, 'conflicting', applied.conflicts.length, `Restack stopped: ${applied.conflicts.join(', ')} changed in #${onto.lowerNumber}`, 'restack-stopped');
    events.say(`#${change.number}: restack conflict in ${applied.conflicts.length} files`);
    events.restack.push({ number: change.number, result: 'conflicting', dismissed_count: applied.conflicts.length });
    return false;
  }
  const head = await createRevision(tx, repo.id, { parents: [change.head_revision], message: `Restack onto #${onto.lowerNumber}`, snap: applied.snap, author }, contents);
  await tx.q('UPDATE branches SET revision = $1 WHERE repo_id = $2 AND name = $3', [head, repo.id, change.head]);
  await tx.q('UPDATE changes SET head_revision = $1, base_revision = $2, checks_settled = false WHERE id = $3', [head, onto.revision, change.id]);
  const moved = await onNewHead(tx, change, before, { base: await loadSnap(tx, repo.id, onto.revision), head: applied.snap }, contents);
  await storeResult(tx, change, moved.kept ? 'kept' : 'dismissed', moved.dismissed, baseNotice, baseNotice ? 'base-changed' : null);
  events.say(`#${change.number}: restacked onto #${onto.lowerNumber}, approvals ${word(moved.kept)}`);
  events.restack.push({ number: change.number, result: moved.kept ? 'kept' : 'dismissed', dismissed_count: moved.dismissed });
  return true;
}

/** Restacks every change above `root` in stack order; a conflict stops everything above it. */
async function restackAbove(
  tx: Tx,
  repo: Row,
  root: Row,
  stoppedAt: Row | null,
  author: Author,
  contents: Contents,
  events: Events,
): Promise<void> {
  const all = await unmergedChanges(tx, repo.id);
  const stopped = new Map<number, number>();
  if (stoppedAt) stopped.set(stoppedAt.id, stoppedAt.number);
  for (const above of descendants(all, root)) {
    const lower = lowerOf(all, above)!;
    const blocker = stopped.get(lower.id);
    events.touch([above.number]);
    if (blocker !== undefined) {
      stopped.set(above.id, blocker);
      await storeResult(tx, above, 'not_restacked', 0, `Not restacked: #${blocker} has a restack conflict`, 'not-restacked');
      events.say(`#${above.number}: not restacked`);
      events.restack.push({ number: above.number, result: 'not_restacked', dismissed_count: 0 });
      continue;
    }
    const current = await refresh(tx, lower);
    const ok = await restackChange(tx, repo, above, { revision: current.head_revision, lowerNumber: lower.number }, author, contents, events, null);
    if (!ok) stopped.set(above.id, above.number);
  }
}

/**
 * A branch moved from `previous` to `next`. When it is a change's head the change gets its new head
 * revision (dismissals, threads, viewed marks), an out-of-date stacked change retries its restack,
 * and every change above is restacked.
 */
export async function headAdvanced(
  tx: Tx,
  repo: Row,
  change: Row,
  previous: string,
  author: Author,
  contents: Contents,
  events: Events,
  leaveQueue: (entry: Row, reason: string) => Promise<void>,
): Promise<void> {
  const next = (await tx.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, change.head]))[0].revision as string;
  const base = await loadSnap(tx, repo.id, change.base_revision);
  const moved = await onNewHead(tx, change, { base, head: await loadSnap(tx, repo.id, previous) }, { base, head: await loadSnap(tx, repo.id, next) }, contents);
  await tx.q('UPDATE changes SET head_revision = $1, checks_settled = false WHERE id = $2', [next, change.id]);
  events.say(`#${change.number}: new revision ${next} from ${author.name}, approvals ${word(moved.kept)}`);
  events.touch([change.number]);
  if (change.state === 'queued') {
    const entry = (await tx.q<Row>(`SELECT * FROM queue_entries WHERE change_id = $1 AND status = 'active'`, [change.id]))[0];
    await leaveQueue(entry, 'Removed: the change was updated while queued');
  } else if (change.state === 'removed') {
    await tx.q(`UPDATE changes SET state = 'open', removal_reason = NULL WHERE id = $1`, [change.id]);
  }
  const all = await unmergedChanges(tx, repo.id);
  const current = await refresh(tx, change);
  const lower = lowerOf(all, current);
  let stoppedAt: Row | null = null;
  if (lower && current.base_revision !== lower.head_revision) {
    const ok = await restackChange(tx, repo, current, { revision: lower.head_revision, lowerNumber: lower.number }, author, contents, events, null);
    if (!ok) stoppedAt = current;
  }
  const hasAbove = childrenOf(all, current).length > 0;
  if (hasAbove) await restackAbove(tx, repo, current, stoppedAt, author, contents, events);
  events.touch(stackNumbers(all, current));
}

/** Merges the change into its base branch in one step and retargets the change above it. */
export async function mergeChange(tx: Tx, repo: Row, change: Row, author: Author, contents: Contents, events: Events): Promise<string> {
  const target = (await tx.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, change.base]))[0].revision as string;
  const applied = applyChange(await loadSnap(tx, repo.id, change.base_revision), await loadSnap(tx, repo.id, change.head_revision), await loadSnap(tx, repo.id, target));
  if (!applied.ok) throw conflict('This change has unmet merge rules and cannot be merged');
  const merge = await createRevision(tx, repo.id, { parents: [target, change.head_revision], message: `Merge #${change.number}: ${change.title}`, snap: applied.snap, author }, contents);
  await tx.q('UPDATE branches SET revision = $1 WHERE repo_id = $2 AND name = $3', [merge, repo.id, change.base]);
  await tx.q(`UPDATE changes SET state = 'merged', merge_revision = $1 WHERE id = $2`, [merge, change.id]);
  await tx.q('UPDATE review_requests SET pending = false WHERE change_id = $1', [change.id]);
  const owner = (await tx.q<Row>('SELECT email FROM users WHERE id = $1', [change.author_id]))[0];
  await queueMail(tx, {
    to: owner.email,
    subject: `[${repo.org_slug}/${repo.name}] #${change.number} merged: ${change.title}`,
    body: `Change #${change.number} "${change.title}" was merged into ${change.base}.\n\n${config.publicUrl}/${repo.org_slug}/${repo.name}/changes/${change.number}\n`,
    changeId: `${repo.org_slug}/${repo.name}#${change.number}`,
  });
  events.say(`#${change.number} merged`, 'both');
  events.touch([change.number]);
  const all = await unmergedChanges(tx, repo.id);
  events.touch(all.filter((other) => other.base === change.base).map((other) => other.number));
  const next = childrenOf(all, change)[0];
  if (next) {
    await tx.q('UPDATE changes SET base = $1 WHERE id = $2', [change.base, next.id]);
    const retargeted = await refresh(tx, next);
    const notice = `Base changed to ${change.base} after #${change.number} merged`;
    const ok = await restackChange(tx, repo, retargeted, { revision: merge, lowerNumber: change.number }, author, contents, events, notice);
    await restackAbove(tx, repo, retargeted, ok ? null : retargeted, author, contents, events);
    events.touch(stackNumbers(all, retargeted));
  }
  return merge;
}
