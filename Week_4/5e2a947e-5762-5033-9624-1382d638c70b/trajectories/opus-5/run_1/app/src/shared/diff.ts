import { copy } from './copy.js';
import type { StoredTopic, VersionSnapshot } from './types.js';

export interface VersionDiff {
  added: string[];
  removed: string[];
  moved: string[];
  edited: string[];
  summary: string;
}

function byId(snapshot: VersionSnapshot): Map<string, StoredTopic> {
  return new Map(snapshot.topics.map((t) => [t.id, t] as const));
}

function sameTask(a: StoredTopic, b: StoredTopic): boolean {
  return JSON.stringify(a.task) === JSON.stringify(b.task);
}

/** Rank among the siblings that exist in both versions under the same parent. */
function rankAmongShared(
  topics: Map<string, StoredTopic>,
  other: Map<string, StoredTopic>,
  id: string,
): number {
  const t = topics.get(id);
  if (!t) return -1;
  const siblings =
    t.parent_id === null
      ? [...topics.values()].filter((each) => each.parent_id === null).map((each) => each.id)
      : (topics.get(t.parent_id)?.children ?? []);
  return siblings.filter((each) => other.has(each)).indexOf(id);
}

export function diffSnapshots(earlier: VersionSnapshot, later: VersionSnapshot): VersionDiff {
  const before = byId(earlier);
  const after = byId(later);
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const edited: string[] = [];

  for (const id of after.keys()) if (!before.has(id)) added.push(id);
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);

  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    const parentChanged = was.parent_id !== now.parent_id;
    const rankChanged =
      !parentChanged &&
      rankAmongShared(before, after, id) !== rankAmongShared(after, before, id);
    const centreChanged = was.floating && now.floating && (was.x !== now.x || was.y !== now.y);
    if (parentChanged || rankChanged || centreChanged) moved.push(id);
    if (
      was.title !== now.title ||
      was.note !== now.note ||
      !sameTask(was, now) ||
      was.colour !== now.colour ||
      was.shape !== now.shape ||
      was.icon !== now.icon
    ) {
      edited.push(id);
    }
  }

  return {
    added,
    removed,
    moved,
    edited,
    summary: copy.diffSummary(added.length, removed.length, moved.length, edited.length),
  };
}
