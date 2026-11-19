import type { ApiTopic, Boundary, LayoutMode, Link, MapDoc, Role, TaskFields, ThemeName } from './model.ts';
import { can } from './rules.ts';
import { depthFirst, lockOf, newTopics, withoutRestricted } from './tree.ts';

const SNAPSHOT_FORMAT = 'sprigmap-version-1';

/** A topic as a version snapshot stores it: the topic shape without the values computed from other tables. */
type SnapshotTopic = Omit<ApiTopic, 'derived' | 'comment_count' | 'vote_count' | 'voted'>;

/** The full state of a map at one version, as stored in the object store. */
export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  map_id: string;
  version: number;
  revision: number;
  layout: LayoutMode;
  theme: ThemeName;
  topics: SnapshotTopic[];
  links: Link[];
  boundaries: Boundary[];
  slides: string[];
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  moved: string[];
  edited: string[];
  summary: string;
}

export function snapshotOf(doc: MapDoc, at: { mapId: string; version: number; revision: number }): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    map_id: at.mapId,
    version: at.version,
    revision: at.revision,
    layout: doc.layout,
    theme: doc.theme,
    topics: depthFirst(doc.topics).map((topic) => ({ ...topic, lock_inherited: lockOf(doc.topics, topic.id)?.inherited ?? false })),
    links: doc.links,
    boundaries: doc.boundaries,
    slides: doc.slides,
  };
}

/** The map document a snapshot describes. */
export function docOfSnapshot(snapshot: Snapshot): MapDoc {
  const topics = newTopics();
  for (const { lock_inherited: _inherited, ...topic } of snapshot.topics) topics[topic.id] = topic;
  return {
    topics,
    links: snapshot.links,
    boundaries: snapshot.boundaries,
    slides: snapshot.slides,
    layout: snapshot.layout,
    theme: snapshot.theme,
    custom_colours: [],
    next_n: snapshot.topics.reduce((next, topic) => Math.max(next, topic.n + 1), 0),
  };
}

/** The snapshot as one role may see it: restricted branches and everything that points into them are left out. */
export function visibleSnapshot(snapshot: Snapshot, role: Role): Snapshot {
  if (can(role, 'see_restricted')) return snapshot;
  const doc = withoutRestricted(docOfSnapshot(snapshot));
  return {
    ...snapshot,
    topics: snapshot.topics.filter((topic) => doc.topics[topic.id]),
    links: doc.links,
    boundaries: doc.boundaries,
    slides: snapshot.slides.filter((id) => doc.topics[id]),
  };
}

interface Pair {
  was: SnapshotTopic;
  now: SnapshotTopic;
}

const byRank = (a: SnapshotTopic, b: SnapshotTopic): number => a.rank - b.rank;

/** Topics that kept their parent but changed their rank among the siblings both versions share. */
function reordered(pairs: readonly Pair[]): Set<string> {
  const families = new Map<string, Pair[]>();
  for (const pair of pairs) {
    if (pair.now.parent_id === null || pair.was.parent_id !== pair.now.parent_id) continue;
    families.set(pair.now.parent_id, [...(families.get(pair.now.parent_id) ?? []), pair]);
  }
  const out = new Set<string>();
  for (const family of families.values()) {
    const before = family.map((p) => p.was).sort(byRank);
    family
      .map((p) => p.now)
      .sort(byRank)
      .forEach((topic, at) => {
        if (before[at]?.id !== topic.id) out.add(topic.id);
      });
  }
  return out;
}

const sameTask = (a: TaskFields | null, b: TaskFields | null): boolean =>
  a === null || b === null
    ? a === b
    : a.percent === b.percent && a.weight === b.weight && a.state === b.state && a.priority === b.priority && a.due === b.due && a.assignee === b.assignee;

const edited = ({ was, now }: Pair): boolean =>
  was.title !== now.title ||
  was.note !== now.note ||
  was.colour !== now.colour ||
  was.shape !== now.shape ||
  was.icon !== now.icon ||
  !sameTask(was.task, now.task);

/** Compare an earlier snapshot with a later one by topic id. */
export function diffSnapshots(earlier: Snapshot, later: Snapshot): VersionDiff {
  const was = new Map(earlier.topics.map((topic) => [topic.id, topic]));
  const now = new Map(later.topics.map((topic) => [topic.id, topic]));
  const pairs = later.topics.flatMap((topic) => {
    const before = was.get(topic.id);
    return before ? [{ was: before, now: topic }] : [];
  });
  const shifted = reordered(pairs);
  const added = later.topics.filter((topic) => !was.has(topic.id)).map((topic) => topic.id).sort();
  const removed = earlier.topics.filter((topic) => !now.has(topic.id)).map((topic) => topic.id).sort();
  const moved = pairs
    .filter((p) => p.was.parent_id !== p.now.parent_id || p.was.x !== p.now.x || p.was.y !== p.now.y || shifted.has(p.now.id))
    .map((p) => p.now.id)
    .sort();
  const changed = pairs.filter(edited).map((p) => p.now.id).sort();
  return {
    added,
    removed,
    moved,
    edited: changed,
    summary: `Added ${added.length}, removed ${removed.length}, moved ${moved.length}, edited ${changed.length}`,
  };
}
