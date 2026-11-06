import { isOpenStatus, taskId } from '../../shared/domain.js';
import type { CascadeEntry, ReblockedEntry } from '../../shared/types.js';
import { listOf, task, type Graph } from './graph.js';

/**
 * The one place the cascade order is decided. `levels` holds every task this change took
 * from an open status to a closed one, with level 0 for the tasks the request closed and
 * one more than its closed sub-tasks for a parent closed by roll-up.
 */
export function computeCascade(
  graph: Graph,
  blockedBefore: Map<number, boolean>,
  blockedAfter: Map<number, boolean>,
  levels: Map<number, number>,
): CascadeEntry[] {
  const freed: { number: number; depth: number; freedBy: number }[] = [];
  for (const [number, wasBlocked] of blockedBefore) {
    if (!wasBlocked || blockedAfter.get(number) === true) continue;
    const row = graph.tasks.get(number);
    if (!row || !isOpenStatus(row.status)) continue;
    const freedBy = freeingBlocker(graph, number, levels);
    if (freedBy === null) continue;
    freed.push({ number, depth: (levels.get(freedBy) as number) + 1, freedBy });
  }
  freed.sort((a, b) => a.depth - b.depth || a.number - b.number);
  return freed.map((entry, index) => ({
    id: taskId(entry.number),
    depth: entry.depth,
    order: index + 1,
    freed_by: taskId(entry.freedBy),
  }));
}

/** Of the blockers that closed in this change, the highest level, then the higher number. */
function freeingBlocker(graph: Graph, number: number, levels: Map<number, number>): number | null {
  let best: number | null = null;
  for (const blocker of listOf(graph.blockedBy, number)) {
    const level = levels.get(blocker);
    if (level === undefined) continue;
    if (best === null) {
      best = blocker;
      continue;
    }
    const bestLevel = levels.get(best) as number;
    if (level > bestLevel || (level === bestLevel && blocker > best)) best = blocker;
  }
  return best;
}

export function computeReblocked(
  blockedBefore: Map<number, boolean>,
  blockedAfter: Map<number, boolean>,
): ReblockedEntry[] {
  const numbers: number[] = [];
  for (const [number, isNowBlocked] of blockedAfter) {
    if (isNowBlocked && blockedBefore.get(number) !== true) numbers.push(number);
  }
  numbers.sort((a, b) => a - b);
  return numbers.map((number, index) => ({ id: taskId(number), order: index + 1 }));
}

/**
 * Removing a link can free only the task that link blocked, and the removed link's
 * blocker is the freeing task.
 */
export function linkRemovalCascade(
  graph: Graph,
  blocker: number,
  blocked: number,
  blockedBefore: Map<number, boolean>,
  blockedAfter: Map<number, boolean>,
): CascadeEntry[] {
  if (blockedBefore.get(blocked) !== true || blockedAfter.get(blocked) === true) return [];
  if (!isOpenStatus(task(graph, blocked).status)) return [];
  return [{ id: taskId(blocked), depth: 1, order: 1, freed_by: taskId(blocker) }];
}
