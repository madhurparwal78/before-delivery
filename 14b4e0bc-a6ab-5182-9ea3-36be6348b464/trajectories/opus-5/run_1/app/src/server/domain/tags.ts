import {
  type Role,
  type Tag,
  MASK_PLACEHOLDER,
  TAGS,
  isPassThrough,
  sortIds,
  sortTags,
} from '../../shared/domain.ts';
import type { ColumnRecord, Snapshot } from './snapshot.ts';

export type TagSources = Partial<Record<Tag, string[]>>;
export type Direction = 'downstream' | 'upstream';

export interface Walk {
  /** Columns the tag reaches from the starting columns. */
  reached: Set<string>;
  /** Columns where the tag would arrive but a suppression stops it. */
  sealed: Set<string>;
}

/**
 * A tag held by column u reaches column v when a path of pass-through edges leads from u to v
 * and no column on that path after u, v included, suppresses that tag.
 */
export function walkReach(
  snapshot: Snapshot,
  starts: readonly string[],
  tag: Tag,
  direction: Direction,
): Walk {
  const startSet = new Set(starts);
  const reached = new Set<string>();
  const sealed = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const edges = direction === 'downstream' ? snapshot.out(current) : snapshot.in(current);
    for (const edge of edges) {
      if (!isPassThrough(edge.transform)) continue;
      const nextId = direction === 'downstream' ? edge.to : edge.from;
      const next = snapshot.columns.get(nextId);
      if (!next) continue;
      if (next.suppressedTags.includes(tag)) {
        sealed.add(nextId);
        continue;
      }
      if (reached.has(nextId) || startSet.has(nextId)) continue;
      reached.add(nextId);
      queue.push(nextId);
    }
  }
  return { reached, sealed };
}

export function reachFrom(snapshot: Snapshot, start: string, tag: Tag, direction: Direction): Set<string> {
  return walkReach(snapshot, [start], tag, direction).reached;
}

function holdersOf(snapshot: Snapshot, tag: Tag): string[] {
  const holders: string[] = [];
  for (const column of snapshot.columns.values()) {
    if (column.directTags.includes(tag)) holders.push(column.id);
  }
  return holders;
}

interface DerivedTagState {
  /** For each column, each effective tag and the direct-tag columns that reach it. */
  sources: Map<string, Map<Tag, Set<string>>>;
  /** For each tag, the columns whose suppression of it is active. */
  activeSuppressions: Map<Tag, Set<string>>;
}

function buildTagState(snapshot: Snapshot): DerivedTagState {
  const sources = new Map<string, Map<Tag, Set<string>>>();
  const activeSuppressions = new Map<Tag, Set<string>>();
  const record = (columnId: string, tag: Tag, sourceId: string): void => {
    let byTag = sources.get(columnId);
    if (!byTag) {
      byTag = new Map();
      sources.set(columnId, byTag);
    }
    let holders = byTag.get(tag);
    if (!holders) {
      holders = new Set();
      byTag.set(tag, holders);
    }
    holders.add(sourceId);
  };

  for (const tag of TAGS) {
    const holders = holdersOf(snapshot, tag);
    for (const holder of holders) {
      record(holder, tag, holder);
      for (const reachedId of reachFrom(snapshot, holder, tag, 'downstream')) {
        record(reachedId, tag, holder);
      }
    }
    activeSuppressions.set(tag, walkReach(snapshot, holders, tag, 'downstream').sealed);
  }
  return { sources, activeSuppressions };
}

function tagState(snapshot: Snapshot): DerivedTagState {
  return snapshot.memo('tagState', buildTagState);
}

export function effectiveTags(snapshot: Snapshot, columnId: string): Tag[] {
  const byTag = tagState(snapshot).sources.get(columnId);
  return byTag ? sortTags(byTag.keys()) : [];
}

export function tagSourcesOf(snapshot: Snapshot, columnId: string): TagSources {
  const byTag = tagState(snapshot).sources.get(columnId);
  const result: TagSources = {};
  if (!byTag) return result;
  for (const tag of sortTags(byTag.keys())) {
    result[tag] = sortIds(byTag.get(tag) as Set<string>);
  }
  return result;
}

export function hasEffectiveTag(snapshot: Snapshot, columnId: string, tag: Tag): boolean {
  return tagState(snapshot).sources.get(columnId)?.has(tag) ?? false;
}

/** A suppression is active while the tag would otherwise reach the column. */
export function suppressionActive(snapshot: Snapshot, columnId: string, tag: Tag): boolean {
  return tagState(snapshot).activeSuppressions.get(tag)?.has(columnId) ?? false;
}

export interface AssetTagCounts {
  tagged_column_count: number;
  pii_column_count: number;
  confidential_column_count: number;
}

export function assetTagCounts(snapshot: Snapshot, assetId: string): AssetTagCounts {
  let tagged = 0;
  let pii = 0;
  let confidential = 0;
  for (const column of snapshot.assetColumns(assetId)) {
    const tags = effectiveTags(snapshot, column.id);
    if (tags.length > 0) tagged += 1;
    if (tags.includes('PII')) pii += 1;
    if (tags.includes('Confidential')) confidential += 1;
  }
  return {
    tagged_column_count: tagged,
    pii_column_count: pii,
    confidential_column_count: confidential,
  };
}

/** An asset carries a tag when at least one of its columns has it as an effective tag. */
export function assetCarriesTag(snapshot: Snapshot, assetId: string, tag: Tag): boolean {
  for (const column of snapshot.assetColumns(assetId)) {
    if (hasEffectiveTag(snapshot, column.id, tag)) return true;
  }
  return false;
}

export function samplesHidden(tags: readonly Tag[], role: Role): boolean {
  if (role === 'Admin' || role === 'Steward') return false;
  if (tags.includes('PII')) return true;
  return role === 'Viewer' && tags.includes('Confidential');
}

export interface MaskedSamples {
  samples: string[];
  masked: boolean;
}

/** Masking is decided on the server, per request, from effective tags and the caller's role. */
export function maskSamples(snapshot: Snapshot, column: ColumnRecord, role: Role): MaskedSamples {
  if (!samplesHidden(effectiveTags(snapshot, column.id), role) || column.samples.length === 0) {
    return { samples: [...column.samples], masked: false };
  }
  return { samples: column.samples.map(() => MASK_PLACEHOLDER), masked: true };
}

/** Every column whose effective tags, suppressed tags or tag sources changed between two states. */
export function changedColumns(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const id of new Set<string>([...before.columns.keys(), ...after.columns.keys()])) {
    const beforeColumn = before.columns.get(id);
    const afterColumn = after.columns.get(id);
    if (!beforeColumn || !afterColumn) {
      changed.push(id);
      continue;
    }
    if (
      beforeColumn.suppressedTags.join(' ') !== afterColumn.suppressedTags.join(' ') ||
      JSON.stringify(tagSourcesOf(before, id)) !== JSON.stringify(tagSourcesOf(after, id))
    ) {
      changed.push(id);
    }
  }
  return sortIds(changed);
}

/**
 * The number of columns, other than the withdrawn column, that held the tag with the withdrawn
 * column among their sources just before the withdrawal and still hold it just after.
 */
export function stillReaching(before: Snapshot, after: Snapshot, columnId: string, tag: Tag): number {
  let count = 0;
  for (const id of before.columns.keys()) {
    if (id === columnId) continue;
    const sources = tagSourcesOf(before, id)[tag];
    if (!sources || !sources.includes(columnId)) continue;
    if (hasEffectiveTag(after, id, tag)) count += 1;
  }
  return count;
}
