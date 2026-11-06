import { isOpenStatus, type Status } from '../../shared/domain.js';
import { listOf, task, type Graph } from './graph.js';

export interface ChildStatusChange {
  from: Status | null;
  to: Status;
}

export interface RollUpEffect {
  parent: number;
  status: 'done' | 'in_progress';
  kind: 'auto_closed' | 'auto_reopened';
  /** The sub-tasks this change closed, used for the cascade level of a closed parent. */
  closedChildren: number[];
}

/**
 * The one place the sub-task roll-up is decided. `changes` holds every sub-task whose
 * status this change set, including newly created sub-tasks (`from` null).
 */
export function rollUpEffects(
  graph: Graph,
  changes: Map<number, ChildStatusChange>,
): RollUpEffect[] {
  const parents = new Map<number, number[]>();
  for (const child of changes.keys()) {
    const parent = task(graph, child).parent;
    if (parent === null) continue;
    const siblings = parents.get(parent);
    if (siblings) siblings.push(child);
    else parents.set(parent, [child]);
  }

  const effects: RollUpEffect[] = [];
  for (const [parent, changedChildren] of parents) {
    const parentRow = task(graph, parent);
    const closedChildren = changedChildren.filter((child) => {
      const change = changes.get(child) as ChildStatusChange;
      return change.to === 'done' || change.to === 'cancelled';
    });
    const openedChildren = changedChildren.filter((child) => {
      const change = changes.get(child) as ChildStatusChange;
      return isOpenStatus(change.to);
    });

    if (isOpenStatus(parentRow.status) && closedChildren.length > 0) {
      let done = 0;
      let openOrLeft = 0;
      for (const child of listOf(graph.children, parent)) {
        const status = task(graph, child).status;
        if (status === 'cancelled') continue;
        if (status === 'done') done += 1;
        else openOrLeft += 1;
      }
      if (openOrLeft === 0 && done > 0) {
        effects.push({
          parent,
          status: 'done',
          kind: 'auto_closed',
          closedChildren: closedChildren.filter(
            (child) => task(graph, child).status === 'done' || task(graph, child).status === 'cancelled',
          ),
        });
        continue;
      }
    }

    if (parentRow.status === 'done' && openedChildren.length > 0) {
      effects.push({
        parent,
        status: 'in_progress',
        kind: 'auto_reopened',
        closedChildren: [],
      });
    }
  }
  return effects;
}
