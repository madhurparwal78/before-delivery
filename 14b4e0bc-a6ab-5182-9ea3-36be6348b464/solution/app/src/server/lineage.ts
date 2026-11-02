import { assetOf, type Snapshot } from "./catalog.ts";
import { activeSuppressions, effectiveTags, isPassThrough, reachFrom, reachInto, tagSources, type Edge } from "./tags.ts";
import { byString, sortTags, type Tag } from "./text.ts";

const MAX_HOPS = 12;
const MAX_COLUMNS = 500;

type Direction = "downstream" | "upstream";

/**
 * Lineage traversal (DP-39, DP-40): breadth-first from the focus, each column once at its shortest
 * hop, hop members added in column id order, bounded at 12 hops and 500 reached columns.
 */
export function traverse(snapshot: Snapshot, focus: string, direction: Direction) {
  const forward = direction === "downstream";
  const walk = (c: string): Edge[] => (forward ? snapshot.adj.out.get(c) : snapshot.adj.in.get(c)) ?? [];
  const far = (e: Edge) => (forward ? e.to : e.from);
  const hop = new Map<string, number>([[focus, 0]]);
  const reached: string[] = [];
  let truncated = false;
  let frontier = [focus];
  for (let h = 0; frontier.length; h++) {
    const candidates = new Set<string>();
    for (const c of frontier) for (const e of walk(c)) if (!hop.has(far(e))) candidates.add(far(e));
    if (!candidates.size) break;
    if (h === MAX_HOPS) {
      truncated = true;
      break;
    }
    const next: string[] = [];
    for (const v of [...candidates].sort(byString)) {
      if (reached.length >= MAX_COLUMNS) {
        truncated = true;
        break;
      }
      hop.set(v, h + 1);
      reached.push(v);
      next.push(v);
    }
    if (truncated) break;
    frontier = next;
  }

  const reachableFrom = new Map<string, Set<string>>();
  const leadsBack = (from: string, to: string): boolean => {
    let seen = reachableFrom.get(from);
    if (!seen) {
      seen = new Set([from]);
      const stack = [from];
      while (stack.length) for (const e of walk(stack.pop()!)) if (!seen.has(far(e))) (seen.add(far(e)), stack.push(far(e)));
      reachableFrom.set(from, seen);
    }
    return seen.has(to);
  };

  const edges: { from: string; to: string; transform: string; kind: "flow" | "seal" | "cycle" }[] = [];
  for (const u of hop.keys()) {
    for (const e of walk(u)) {
      const v = far(e);
      if (!hop.has(v)) continue;
      const cycle = (v === focus || hop.get(v)! <= hop.get(u)!) && leadsBack(v, u);
      const kind = cycle ? "cycle" : isPassThrough(e.transform) ? "flow" : "seal";
      edges.push({ from: e.from, to: e.to, transform: e.transform, kind });
    }
  }
  edges.sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to));
  const cycles = edges.filter((e) => e.kind === "cycle").map(({ from, to }) => ({ from, to }));

  const focusTags = effectiveTags(snapshot.derived, focus);
  const carriedSets = new Map<Tag, Set<string>>();
  for (const tag of forward ? focusTags : (["Confidential", "PII"] as Tag[])) {
    carriedSets.set(tag, forward ? reachFrom(snapshot.facts, snapshot.adj, focus, tag) : reachInto(snapshot.facts, snapshot.adj, focus, tag));
  }
  const entries = reached.map((column) => {
    const effective = effectiveTags(snapshot.derived, column);
    const carried = forward
      ? focusTags.filter((t) => carriedSets.get(t)!.has(column))
      : effective.filter((t) => carriedSets.get(t)!.has(column));
    const sealed = forward
      ? sortTags(focusTags.filter((t) =>
          snapshot.facts.suppressed.get(column)?.has(t) &&
          (snapshot.adj.in.get(column) ?? []).some((e) => isPassThrough(e.transform) && (e.from === focus || carriedSets.get(t)!.has(e.from))),
        ))
      : activeSuppressions(snapshot.facts, snapshot.derived, snapshot.adj, column);
    const sources = tagSources(snapshot.derived, column);
    return {
      column,
      asset: assetOf(snapshot, column),
      hop: hop.get(column)!,
      carried_tags: carried,
      sealed_tags: sealed,
      tag_sources: Object.fromEntries(carried.map((t) => [t, sources[t]])),
    };
  });

  const assetIds = [...new Set([assetOf(snapshot, focus), ...entries.map((e) => e.asset)])].sort(byString);
  const hops = entries.length ? Math.max(...entries.map((e) => e.hop)) : 0;
  const summary =
    `Trace complete. Columns reached: ${entries.length}. Hops: ${hops}. Cycles: ${cycles.length}.` +
    (truncated ? " Truncated at the 12-hop or 500-column limit." : "");
  return {
    focus,
    direction,
    focus_tags: focusTags,
    focus_tag_sources: tagSources(snapshot.derived, focus),
    reached: entries,
    edges,
    cycles,
    assets: Object.fromEntries(
      assetIds.map((id) => [id, { state: snapshot.certs.get(id)!.state, deprecated_upstream: snapshot.deprecatedUpstream.get(id) ?? null }]),
    ),
    totals: { columns: entries.length, hops, cycles: cycles.length },
    truncated,
    limits: { max_hops: MAX_HOPS, max_columns: MAX_COLUMNS },
    summary,
  };
}
