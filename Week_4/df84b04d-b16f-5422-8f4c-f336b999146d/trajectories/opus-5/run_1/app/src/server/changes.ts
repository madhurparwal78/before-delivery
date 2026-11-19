import type { PoolClient } from 'pg';
import type { Bullet } from '../shared/types.js';
import { withOutlineLock } from './db.js';
import { loadTree, type Tree } from './tree.js';
import { publishChange } from './live.js';
import type { Scope } from './scope.js';
import type { HistoryStep } from './history.js';
import { pushStep } from './history.js';

/**
 * A committed change: the message tabs receive, plus the placements each bullet can be
 * reached through, which is how fan-out decides whether a branch should see it.
 */
export interface ChangeRecord {
  type: 'change';
  seq: number;
  bullets: Bullet[];
  removed: string[];
  reach: Record<string, string[]>;
}

export interface MutationOutcome<T> {
  result: T;
  /** Placements whose data changed and should be re-sent. */
  affected: string[];
  /** Placements that left the outline. */
  removed?: string[];
  step?: HistoryStep;
}

async function nextSeq(client: PoolClient, ownerId: string): Promise<number> {
  const inserted = await client.query(
    `insert into outline_sequence (owner_id, seq) values ($1, 1)
       on conflict (owner_id) do update set seq = outline_sequence.seq + 1
     returning seq`,
    [ownerId]
  );
  return Number((inserted.rows[0] as { seq: string }).seq);
}

function addBullets(
  tree: Tree,
  ids: readonly string[],
  bullets: Bullet[],
  reach: Record<string, string[]>
): void {
  for (const id of new Set(ids)) {
    const row = tree.row(id);
    if (row === undefined) continue;
    bullets.push(tree.serialize({ row, displayParentId: row.parentId, depth: tree.depthOf(id) }));
    reach[id] = [...tree.reach(id)];
  }
}

/**
 * Runs one write against the outline, gives it the next sequence number, records it
 * and hands it to live fan-out.
 */
export async function commit<T>(
  scope: Scope,
  work: (client: PoolClient, tree: Tree) => Promise<MutationOutcome<T>>
): Promise<{ result: T; seq: number }> {
  const { result, seq, record } = await withOutlineLock(scope.ownerId, async (client) => {
    const before = await loadTree(scope.ownerId, client);
    const outcome = await work(client, before);
    const after = await loadTree(scope.ownerId, client);
    const seqValue = await nextSeq(client, scope.ownerId);
    const removedIds = outcome.removed ?? [];
    const bullets: Bullet[] = [];
    const reach: Record<string, string[]> = {};
    addBullets(after, outcome.affected, bullets, reach);
    for (const id of removedIds) reach[id] = [...before.reach(id)];
    const changeRecord: ChangeRecord = {
      type: 'change',
      seq: seqValue,
      bullets,
      removed: removedIds,
      reach
    };
    await client.query(`insert into changes (owner_id, seq, payload) values ($1, $2, $3)`, [
      scope.ownerId,
      seqValue,
      JSON.stringify(changeRecord)
    ]);
    if (outcome.step !== undefined) {
      await pushStep(client, scope, outcome.step);
    }
    return { result: outcome.result, seq: seqValue, record: changeRecord };
  });
  await publishChange(scope.ownerId, record);
  return { result, seq };
}

/** Records a change made outside a person's own editing, such as the purge sweep. */
export async function commitSystemChange(
  ownerId: string,
  removedIds: readonly string[]
): Promise<void> {
  if (removedIds.length === 0) return;
  const record = await withOutlineLock(ownerId, async (client) => {
    const seq = await nextSeq(client, ownerId);
    const changeRecord: ChangeRecord = {
      type: 'change',
      seq,
      bullets: [],
      removed: [...removedIds],
      reach: {}
    };
    await client.query(`insert into changes (owner_id, seq, payload) values ($1, $2, $3)`, [
      ownerId,
      seq,
      JSON.stringify(changeRecord)
    ]);
    return changeRecord;
  });
  await publishChange(ownerId, record);
}
