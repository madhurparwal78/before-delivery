import { byString, sortTags, type Tag } from "./text.ts";

export const TRANSFORMS = ["copy", "rename", "cast", "filter", "join", "concat", "hash", "aggregate"] as const;
export type Transform = (typeof TRANSFORMS)[number];
const PASS_THROUGH = new Set<string>(["copy", "rename", "cast", "filter", "join", "concat"]);

export function isPassThrough(transform: string): boolean {
  return PASS_THROUGH.has(transform);
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  transform: Transform;
}

/** The committed facts every derived tag value is computed from. */
export interface TagFacts {
  columns: Iterable<string>;
  edges: readonly Edge[];
  direct: Map<string, Set<Tag>>;
  suppressed: Map<string, Set<Tag>>;
}

/** column id -> effective tag -> sorted source column ids. Keys of the inner map are the effective tags. */
export type Derived = Map<string, Map<Tag, string[]>>;

export interface Adjacency {
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
}

export function adjacency(edges: readonly Edge[]): Adjacency {
  const out = new Map<string, Edge[]>();
  const inn = new Map<string, Edge[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  return { out, in: inn };
}

function suppresses(facts: TagFacts, column: string, tag: Tag): boolean {
  return facts.suppressed.get(column)?.has(tag) ?? false;
}

/**
 * Reach (DP-30): a tag held by u reaches v along pass-through edges on a path where no column after u
 * suppresses that tag. Effective tags are direct tags plus every tag reaching the column; tag sources
 * are the direct holders that are the column or reach it.
 */
export function recompute(facts: TagFacts, adj: Adjacency = adjacency(facts.edges)): Derived {
  const sources = new Map<string, Map<Tag, Set<string>>>();
  const add = (column: string, tag: Tag, source: string) => {
    let byTag = sources.get(column);
    if (!byTag) sources.set(column, (byTag = new Map()));
    let set = byTag.get(tag);
    if (!set) byTag.set(tag, (set = new Set()));
    set.add(source);
  };
  for (const [holder, tags] of facts.direct) {
    for (const tag of tags) {
      add(holder, tag, holder);
      for (const reached of reachFrom(facts, adj, holder, tag)) add(reached, tag, holder);
    }
  }
  const derived: Derived = new Map();
  for (const [column, byTag] of sources) {
    const out = new Map<Tag, string[]>();
    for (const tag of sortTags(byTag.keys())) out.set(tag, [...byTag.get(tag)!].sort(byString));
    derived.set(column, out);
  }
  return derived;
}

/** Columns a tag held by `start` reaches downstream (start excluded). */
export function reachFrom(facts: TagFacts, adj: Adjacency, start: string, tag: Tag): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  const reached = new Set<string>();
  while (stack.length) {
    const x = stack.pop()!;
    for (const e of adj.out.get(x) ?? []) {
      if (!isPassThrough(e.transform) || seen.has(e.to) || suppresses(facts, e.to, tag)) continue;
      seen.add(e.to);
      reached.add(e.to);
      stack.push(e.to);
    }
  }
  return reached;
}

/** Columns from which a tag they hold would reach `focus` (focus excluded). */
export function reachInto(facts: TagFacts, adj: Adjacency, focus: string, tag: Tag): Set<string> {
  const reached = new Set<string>();
  if (suppresses(facts, focus, tag)) return reached;
  const seen = new Set<string>([focus]);
  const stack = [focus];
  while (stack.length) {
    const v = stack.pop()!;
    for (const e of adj.in.get(v) ?? []) {
      if (!isPassThrough(e.transform) || seen.has(e.from)) continue;
      seen.add(e.from);
      reached.add(e.from);
      if (!suppresses(facts, e.from, tag)) stack.push(e.from);
    }
  }
  return reached;
}

export function effectiveTags(derived: Derived, column: string): Tag[] {
  return [...(derived.get(column)?.keys() ?? [])];
}

export function tagSources(derived: Derived, column: string): Record<string, string[]> {
  return Object.fromEntries(derived.get(column) ?? []);
}

/** A suppression is active while the tag would otherwise reach the column. */
export function activeSuppressions(facts: TagFacts, derived: Derived, adj: Adjacency, column: string): Tag[] {
  const tags = facts.suppressed.get(column);
  if (!tags) return [];
  return sortTags(
    [...tags].filter((tag) =>
      (adj.in.get(column) ?? []).some((e) => isPassThrough(e.transform) && derived.get(e.from)?.has(tag)),
    ),
  );
}

function sameSources(a: Map<Tag, string[]> | undefined, b: Map<Tag, string[]> | undefined): boolean {
  const x = a ?? new Map<Tag, string[]>();
  const y = b ?? new Map<Tag, string[]>();
  if (x.size !== y.size) return false;
  for (const [tag, list] of x) {
    const other = y.get(tag);
    if (!other || other.length !== list.length || other.some((s, i) => s !== list[i])) return false;
  }
  return true;
}

function sameTags(a: Set<Tag> | undefined, b: Set<Tag> | undefined): boolean {
  const x = a ?? new Set<Tag>();
  const y = b ?? new Set<Tag>();
  return x.size === y.size && [...x].every((t) => y.has(t));
}

/** Sorted ids of every column whose effective tags, suppressed tags or tag sources changed. */
export function changedColumns(
  before: Derived,
  after: Derived,
  suppressedBefore: Map<string, Set<Tag>>,
  suppressedAfter: Map<string, Set<Tag>>,
): string[] {
  const ids = new Set<string>([...before.keys(), ...after.keys(), ...suppressedBefore.keys(), ...suppressedAfter.keys()]);
  return [...ids]
    .filter((id) => !sameSources(before.get(id), after.get(id)) || !sameTags(suppressedBefore.get(id), suppressedAfter.get(id)))
    .sort(byString);
}

/**
 * Remaining reach after withdrawing `tag` from `withdrawn`: columns other than it that held the tag
 * with the withdrawn column among its sources before, and still hold the tag after.
 */
export function stillReaching(before: Derived, after: Derived, withdrawn: string, tag: Tag): number {
  let count = 0;
  for (const [column, byTag] of before) {
    if (column === withdrawn) continue;
    if (byTag.get(tag)?.includes(withdrawn) && after.get(column)?.has(tag)) count++;
  }
  return count;
}

