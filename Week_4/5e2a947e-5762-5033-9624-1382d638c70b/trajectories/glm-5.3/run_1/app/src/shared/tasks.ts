import type { TopicNode, CrossLink } from './types.js';

/**
 * Task rollups, earliest due dates, overdue state and dependency
 * blocking: the single implementation of the published formulas.
 */

export interface RollupResult {
  percent: number | 'dash' | null;
  earliestDue: string | null;
}

interface RNode {
  t: TopicNode;
  children: RNode[];
  rollup: number | 'dash' | null;
  earliest: string | null;
}

export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/**
 * Compute rollups for a whole tree. Returns per-topic percent
 * (own rollup when it has one, else own task percent) and earliest due.
 */
export function computeRollups(topics: TopicNode[]): {
  percent: Map<string, number | 'dash' | null>;
  earliestDue: Map<string, string | null>;
} {
  const byParent = new Map<string | null, RNode[]>();
  const byId = new Map<string, RNode>();
  for (const t of topics) {
    const n: RNode = { t, children: [], rollup: null, earliest: null };
    byId.set(t.id, n);
    const arr = byParent.get(t.parent_id) ?? [];
    arr.push(n);
    byParent.set(t.parent_id, arr);
  }
  for (const n of byId.values()) n.children = (byParent.get(n.t.id) ?? []).sort((a, b) => a.t.rank - b.t.rank);

  const hasTaskDescendants = (n: RNode): boolean => {
    for (const c of n.children) {
      if (c.t.task !== null) return true;
      if (hasTaskDescendants(c)) return true;
    }
    return false;
  };

  const percentMap = new Map<string, number | 'dash' | null>();
  const dueMap = new Map<string, string | null>();

  const walk = (n: RNode): void => {
    for (const c of n.children) walk(c);
    // earliest due among open, under-100% descendants (zero-weight counts)
    let earliest: string | null = null;
    const collectDue = (node: RNode) => {
      for (const c of node.children) {
        const task = c.t.task;
        if (task && task.state === 'open' && task.percent < 100) {
          if (task.due && (earliest === null || task.due < earliest)) earliest = task.due;
        }
        collectDue(c);
      }
    };
    collectDue(n);

    const showsRollup = hasTaskDescendants(n);
    if (showsRollup) {
      let num = 0;
      let den = 0;
      for (const c of n.children) {
        const task = c.t.task;
        if (task && task.state === 'cancelled') continue;
        const childHas = hasTaskDescendants(c);
        if (!task && !childHas) continue;
        const w = task ? task.weight : 1;
        let p: number | 'dash' | null;
        if (childHas) p = c.rollup;
        else p = task ? task.percent : null;
        if (p === null || p === 'dash') continue;
        num += w * p;
        den += w;
      }
      n.rollup = den === 0 ? 'dash' : roundHalfUp(num / den);
      n.earliest = earliest;
    } else if (n.t.task) {
      n.rollup = n.t.task.percent;
      n.earliest = n.t.task.state === 'open' && n.t.task.percent < 100 ? n.t.task.due : null;
      if (n.earliest === null) n.earliest = null;
    } else {
      n.rollup = null;
      n.earliest = earliest;
    }
    percentMap.set(n.t.id, n.rollup);
    dueMap.set(n.t.id, n.earliest);
  };

  const roots = byParent.get(null) ?? [];
  for (const r of roots) walk(r);
  return { percent: percentMap, earliestDue: dueMap };
}

/** Blocked topics: A depends on B blocks A until B is 100% or cancelled. */
export function computeBlocked(
  topics: TopicNode[],
  links: CrossLink[],
): { blockedBy: Map<string, string[]>; blockedCount: Map<string, number> } {
  const byId = new Map<string, TopicNode>();
  for (const t of topics) byId.set(t.id, t);
  const { percent } = computeRollups(topics);
  const blockedBy = new Map<string, string[]>();
  for (const t of topics) blockedBy.set(t.id, []);
  for (const l of links) {
    if (l.type !== 'depends') continue;
    const target = byId.get(l.to);
    if (!target) continue;
    const p = percent.get(l.to);
    const blocks = target.task !== null || p !== null
      ? !(target.task?.state === 'cancelled' || p === 100)
      : false;
    if (blocks) {
      const arr = blockedBy.get(l.from) ?? [];
      arr.push(l.to);
      blockedBy.set(l.from, arr);
    }
  }
  // first blocker by depth-first order of the whole tree
  const order: string[] = [];
  const byParent = new Map<string | null, TopicNode[]>();
  for (const t of topics) {
    const arr = byParent.get(t.parent_id) ?? [];
    arr.push(t);
    byParent.set(t.parent_id, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
  const dfs = (id: string | null) => {
    const kids = byParent.get(id) ?? [];
    for (const k of kids) { order.push(k.id); dfs(k.id); }
  };
  dfs(null);
  const blockedCount = new Map<string, number>();
  for (const t of topics) blockedCount.set(t.id, 0);
  for (const id of order) {
    const blockers = (blockedBy.get(id) ?? []).filter((b) => byId.has(b));
    blockedBy.set(id, blockers.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  }
  // Ancestor counts need children first, so walk depth-first order backwards.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    let count = (blockedBy.get(id) ?? []).length;
    for (const c of byParent.get(id) ?? []) count += blockedCount.get(c.id) ?? 0;
    blockedCount.set(id, count);
  }
  return { blockedBy, blockedCount };
}

/** Would a depends link from A to B close a loop? */
export function wouldLoop(from: string, to: string, ancestorsOf: (id: string) => string[]): boolean {
  if (from === to) return true;
  const anc = ancestorsOf(to);
  return anc.includes(from);
}
