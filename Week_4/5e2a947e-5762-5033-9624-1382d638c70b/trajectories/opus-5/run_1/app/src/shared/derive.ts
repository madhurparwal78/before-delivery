import { derivedColour, derivedShape, derivedTextColour } from './style.js';
import {
  allTopicsDepthFirst,
  permittedChildren,
  permittedDescendantCount,
  type MapView,
} from './tree.js';
import type { DerivedTopic, MapDoc, ThemeName } from './types.js';

export interface DeriveInput extends MapView {
  theme: ThemeName;
  /** The server's current UTC date as `YYYY-MM-DD`. */
  today: string;
}

type Rollup = number | 'dash' | null;

export class DerivedMap {
  private readonly input: DeriveInput;
  private readonly rollups = new Map<string, Rollup>();
  private readonly taskDescendants = new Map<string, boolean>();
  private readonly dues = new Map<string, string | null>();

  constructor(input: DeriveInput) {
    this.input = input;
  }

  private doc(): MapDoc {
    return this.input.doc;
  }

  hasTaskDescendants(id: string): boolean {
    const cached = this.taskDescendants.get(id);
    if (cached !== undefined) return cached;
    let found = false;
    for (const child of permittedChildren(this.input, id)) {
      if (this.doc().topics[child]?.task || this.hasTaskDescendants(child)) {
        found = true;
        break;
      }
    }
    this.taskDescendants.set(id, found);
    return found;
  }

  rollup(id: string): Rollup {
    const cached = this.rollups.get(id);
    if (cached !== undefined) return cached;
    this.rollups.set(id, null);
    if (!this.hasTaskDescendants(id)) return null;
    let sumWeight = 0;
    let sumWeighted = 0;
    let included = 0;
    for (const childId of permittedChildren(this.input, id)) {
      const child = this.doc().topics[childId];
      if (!child) continue;
      if (child.task && child.task.state === 'cancelled') continue;
      const childRollup = this.rollup(childId);
      let weight: number;
      let percent: number;
      if (childRollup !== null && childRollup !== 'dash') {
        weight = child.task ? child.task.weight : 1;
        percent = childRollup;
      } else if (child.task) {
        weight = child.task.weight;
        percent = child.task.percent;
      } else {
        continue;
      }
      included += 1;
      sumWeight += weight;
      sumWeighted += weight * percent;
    }
    const value: Rollup = included === 0 || sumWeight === 0 ? 'dash' : Math.round(sumWeighted / sumWeight);
    this.rollups.set(id, value);
    return value;
  }

  shownPercent(id: string): number | 'dash' | null {
    const rolled = this.rollup(id);
    if (rolled !== null) return rolled;
    const own = this.doc().topics[id]?.task;
    return own ? own.percent : null;
  }

  /** The earliest due date over the topic and its descendants with open, unfinished tasks. */
  earliestDue(id: string): string | null {
    const cached = this.dues.get(id);
    if (cached !== undefined) return cached;
    this.dues.set(id, null);
    const t = this.doc().topics[id];
    let earliest: string | null = null;
    const consider = (value: string | null): void => {
      if (value !== null && (earliest === null || value < earliest)) earliest = value;
    };
    if (t?.task && t.task.state === 'open' && t.task.percent < 100) consider(t.task.due);
    for (const child of permittedChildren(this.input, id)) consider(this.earliestDue(child));
    this.dues.set(id, earliest);
    return earliest;
  }

  private blockers(): Map<string, string[]> {
    const order = allTopicsDepthFirst(this.doc()).filter((id) => !this.input.hidden.has(id));
    const rank = new Map(order.map((id, index) => [id, index] as const));
    const result = new Map<string, string[]>();
    for (const link of this.doc().links) {
      if (link.type !== 'depends') continue;
      if (this.input.hidden.has(link.from) || this.input.hidden.has(link.to)) continue;
      const target = this.doc().topics[link.to];
      if (!target) continue;
      const shown = this.shownPercent(link.to);
      if (shown === null) continue;
      if (target.task && target.task.state === 'cancelled') continue;
      if (shown === 100) continue;
      const list = result.get(link.from) ?? [];
      list.push(link.to);
      result.set(link.from, list);
    }
    for (const list of result.values()) {
      list.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    }
    return result;
  }

  all(): Map<string, DerivedTopic> {
    const blocked = this.blockers();
    const out = new Map<string, DerivedTopic>();
    const blockedInBranch = new Map<string, number>();
    const countBlocked = (id: string): number => {
      const cached = blockedInBranch.get(id);
      if (cached !== undefined) return cached;
      let count = 0;
      for (const child of permittedChildren(this.input, id)) {
        count += (blocked.has(child) ? 1 : 0) + countBlocked(child);
      }
      blockedInBranch.set(id, count);
      return count;
    };
    for (const id of allTopicsDepthFirst(this.doc())) {
      if (this.input.hidden.has(id)) continue;
      const colour = derivedColour(this.doc(), id);
      const shape = derivedShape(this.doc(), id, this.input.theme);
      const due = this.earliestDue(id);
      out.set(id, {
        colour,
        shape,
        text: derivedTextColour(colour, shape),
        percent: this.shownPercent(id),
        earliest_due: due,
        overdue: due !== null && due < this.input.today,
        blocked_by: blocked.get(id) ?? [],
        blocked_count: countBlocked(id),
        subtopics: permittedDescendantCount(this.input, id),
      });
    }
    return out;
  }
}

export function deriveAll(input: DeriveInput): Map<string, DerivedTopic> {
  return new DerivedMap(input).all();
}

/** True when adding a `depends` link from one topic to another would close a loop. */
export function wouldLoop(doc: MapDoc, from: string, to: string): boolean {
  if (from === to) return true;
  const edges = new Map<string, string[]>();
  for (const link of doc.links) {
    if (link.type !== 'depends') continue;
    const list = edges.get(link.from) ?? [];
    list.push(link.to);
    edges.set(link.from, list);
  }
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (next === from) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(edges.get(next) ?? []));
  }
  return false;
}
