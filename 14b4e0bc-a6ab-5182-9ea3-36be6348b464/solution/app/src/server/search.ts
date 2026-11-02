import type { Snapshot } from "./catalog.ts";
import { FieldErrors } from "./errors.ts";
import { codePoints, byName, isTag, type Tag } from "./text.ts";
import { assetSummary } from "./views.ts";

const STATES = ["draft", "verified", "deprecated"] as const;

interface SearchState {
  q: string;
  tag: Tag | null;
  owner: string | null;
  state: string | null;
  term: string | null;
}

export function parseSearch(params: URLSearchParams): SearchState {
  const errors = new FieldErrors();
  const q = (params.get("q") ?? "").trim();
  if (codePoints(q) > 200) errors.add("q", "Search text must be 200 characters or fewer.");
  const tag = params.get("tag");
  if (tag !== null && tag !== "" && !isTag(tag)) errors.add("tag", "Tag must be PII or Confidential.");
  const state = params.get("state");
  if (state !== null && state !== "" && !(STATES as readonly string[]).includes(state)) {
    errors.add("state", "State must be draft, verified or deprecated.");
  }
  errors.throwIfAny();
  return {
    q,
    tag: tag ? (tag as Tag) : null,
    owner: params.get("owner") || null,
    state: state || null,
    term: params.get("term") || null,
  };
}

interface Facts {
  id: string;
  text: string[];
  tags: Set<Tag>;
  owner: string;
  state: string;
  terms: string[];
}

function assetFacts(snapshot: Snapshot, id: string): Facts {
  const asset = snapshot.assets.get(id)!;
  const columns = snapshot.assetColumns.get(id) ?? [];
  const tags = new Set<Tag>();
  for (const c of columns) for (const t of snapshot.derived.get(c)?.keys() ?? []) tags.add(t);
  const terms = snapshot.links.get(id) ?? [];
  return {
    id,
    text: [id, asset.description, ...columns.map((c) => snapshot.columns.get(c)!.name), ...terms.map((t) => snapshot.terms.get(t)!.name)]
      .map((s) => s.toLowerCase()),
    tags,
    owner: asset.owner.id,
    state: snapshot.certs.get(id)!.state,
    terms,
  };
}

type Group = "q" | "tag" | "owner" | "state" | "term";

/** Every character of q matches only itself; filters AND-combine (DP-15). */
function matches(f: Facts, s: SearchState, skip: Group | null): boolean {
  if (s.q && !f.text.some((t) => t.includes(s.q.toLowerCase()))) return false;
  if (skip !== "tag" && s.tag && !f.tags.has(s.tag)) return false;
  if (skip !== "owner" && s.owner && f.owner !== s.owner) return false;
  if (skip !== "state" && s.state && f.state !== s.state) return false;
  if (skip !== "term" && s.term && !f.terms.includes(s.term)) return false;
  return true;
}

export function runSearch(snapshot: Snapshot, s: SearchState, userNames: Map<string, string>) {
  const all = [...snapshot.assets.keys()].sort().map((id) => assetFacts(snapshot, id));
  const results = all.filter((f) => matches(f, s, null));
  /** A facet group's counts apply every other selection but not its own (DP-16). */
  const pool = (group: Group) => all.filter((f) => matches(f, s, group));
  const tagPool = pool("tag");
  const statePool = pool("state");
  const ownerCounts = new Map<string, number>();
  for (const f of pool("owner")) ownerCounts.set(f.owner, (ownerCounts.get(f.owner) ?? 0) + 1);
  if (s.owner && !ownerCounts.has(s.owner) && userNames.has(s.owner)) ownerCounts.set(s.owner, 0);
  const termCounts = new Map<string, number>();
  for (const f of pool("term")) for (const t of f.terms) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
  if (s.term && !termCounts.has(s.term) && snapshot.terms.has(s.term)) termCounts.set(s.term, 0);
  const named = (counts: Map<string, number>, label: (id: string) => string) =>
    [...counts]
      .map(([value, count]) => ({ id: value, name: label(value), count }))
      .sort(byName)
      .map(({ id, name, count }) => ({ value: id, label: name, count }));
  return {
    results: results.slice(0, 100).map((f) => assetSummary(snapshot, f.id)),
    total: results.length,
    facets: {
      tag: (["PII", "Confidential"] as const).map((t) => ({ value: t, label: t, count: tagPool.filter((f) => f.tags.has(t)).length })),
      owner: named(ownerCounts, (id) => userNames.get(id)!),
      state: STATES.map((v) => ({ value: v, label: v, count: statePool.filter((f) => f.state === v).length })),
      term: named(termCounts, (id) => snapshot.terms.get(id)!.name),
    },
  };
}
