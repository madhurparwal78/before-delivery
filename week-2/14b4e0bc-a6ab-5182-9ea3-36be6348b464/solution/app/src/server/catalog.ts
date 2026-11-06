import type { Tx } from "./db.ts";
import { inForce, loadFacts, loadStoredDerived, type GraphFacts } from "./graph.ts";
import { adjacency, recompute, type Adjacency, type Derived } from "./tags.ts";
import { byName, byString } from "./text.ts";

export type AssetState = "draft" | "verified" | "deprecated";

export interface AssetRow {
  id: string;
  kind: string;
  description: string;
  owner: { id: string; name: string };
}

export interface ColumnRow {
  id: string;
  assetId: string;
  name: string;
  dataType: string;
}

export interface Certification {
  state: AssetState;
  verifiedAt: string | null;
  evidence: {
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    uploaded_at: string;
    uploaded_by: { id: string; name: string };
    objectKey: string;
  } | null;
  deprecation: { reason: string; at: string; by: { id: string; name: string } } | null;
}

export interface TermRow {
  id: string;
  name: string;
  definition: string;
  revision: number;
}

/**
 * The whole catalog as it stood at seq k (or live when k is null). Every read, live or point in
 * time, is answered from one of these, so each derived value has one rule (DP-86).
 */
export interface Snapshot {
  k: number | null;
  assets: Map<string, AssetRow>;
  columns: Map<string, ColumnRow>;
  assetColumns: Map<string, string[]>;
  facts: GraphFacts;
  adj: Adjacency;
  derived: Derived;
  certs: Map<string, Certification>;
  terms: Map<string, TermRow>;
  links: Map<string, string[]>;
  deprecatedUpstream: Map<string, string | null>;
}

export async function loadSnapshot(tx: Tx, k: number | null): Promise<Snapshot> {
  const registered = k === null ? "true" : `a.registered_seq <= ${k}`;
  const assetRows = await tx.query(`select a.id, a.kind, a.description, u.id as owner_id, u.name as owner_name
              from assets a join users u on u.id = a.owner_id where ${registered} order by a.id`);
  const columnRows = await tx.query(`select c.id, c.asset_id, c.name, c.data_type from columns c join assets a on a.id = c.asset_id
              where ${registered} order by c.asset_id, c.ord`);
  const facts = await loadFacts(tx, k);
  const certRows = await tx.query(`select c.asset_id, c.state, c.verified_at,
                e.filename, e.content_type, e.size_bytes, e.sha256, e.uploaded_at, e.object_key,
                eu.id as uploader_id, eu.name as uploader_name,
                d.reason, d.at as deprecated_at, du.id as deprecator_id, du.name as deprecator_name
              from certifications c
              left join evidence e on e.id = c.evidence_id left join users eu on eu.id = e.uploaded_by
              left join deprecation_events d on d.id = c.deprecation_id left join users du on du.id = d.by_id
              where ${inForce(k, "c")}`);
  const termRows = await tx.query(`select term_id as id, name, definition, revision from term_revisions where ${inForce(k)}`);
  const linkRows = await tx.query(`select asset_id, term_id from term_links where ${inForce(k)}`);
  const assets = new Map<string, AssetRow>();
  for (const r of assetRows.rows) {
    assets.set(r.id, { id: r.id, kind: r.kind, description: r.description, owner: { id: r.owner_id, name: r.owner_name } });
  }
  const columns = new Map<string, ColumnRow>();
  const assetColumns = new Map<string, string[]>();
  for (const r of columnRows.rows) {
    columns.set(r.id, { id: r.id, assetId: r.asset_id, name: r.name, dataType: r.data_type });
    (assetColumns.get(r.asset_id) ?? assetColumns.set(r.asset_id, []).get(r.asset_id)!).push(r.id);
  }
  const certs = new Map<string, Certification>();
  for (const r of certRows.rows) {
    if (!assets.has(r.asset_id)) continue;
    certs.set(r.asset_id, {
      state: r.state,
      verifiedAt: r.verified_at,
      evidence: r.filename === null ? null : {
        filename: r.filename, content_type: r.content_type, size_bytes: r.size_bytes, sha256: r.sha256,
        uploaded_at: r.uploaded_at, uploaded_by: { id: r.uploader_id, name: r.uploader_name }, objectKey: r.object_key,
      },
      deprecation: r.reason === null ? null : {
        reason: r.reason, at: r.deprecated_at, by: { id: r.deprecator_id, name: r.deprecator_name },
      },
    });
  }
  const terms = new Map<string, TermRow>();
  for (const r of termRows.rows) terms.set(r.id, r);
  const links = new Map<string, string[]>();
  for (const r of linkRows.rows) {
    if (!assets.has(r.asset_id)) continue;
    (links.get(r.asset_id) ?? links.set(r.asset_id, []).get(r.asset_id)!).push(r.term_id);
  }
  const adj = adjacency(facts.edges);
  const derived = k === null ? await loadStoredDerived(tx) : recompute(facts, adj);
  const snapshot: Snapshot = {
    k, assets, columns, assetColumns, facts, adj, derived, certs, terms, links, deprecatedUpstream: new Map(),
  };
  snapshot.deprecatedUpstream = nearestDeprecatedUpstream(snapshot);
  return snapshot;
}

export function assetOf(snapshot: Snapshot, columnId: string): string {
  return snapshot.columns.get(columnId)!.assetId;
}

/** Asset-level downstream relation: B is downstream of A when a column edge runs from A to B. */
export function assetDownstream(snapshot: Snapshot): Map<string, Set<string>> {
  const down = new Map<string, Set<string>>();
  for (const e of snapshot.facts.edges) {
    const a = assetOf(snapshot, e.from);
    const b = assetOf(snapshot, e.to);
    if (a === b) continue;
    (down.get(a) ?? down.set(a, new Set()).get(a)!).add(b);
  }
  return down;
}

/** Transitive downstream assets of `start` with their asset-level hop; never `start` itself. */
export function downstreamAssets(down: Map<string, Set<string>>, start: string): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  while (frontier.length) {
    const next: string[] = [];
    for (const a of frontier) {
      for (const b of down.get(a) ?? []) {
        if (dist.has(b)) continue;
        dist.set(b, dist.get(a)! + 1);
        next.push(b);
      }
    }
    frontier = next;
  }
  dist.delete(start);
  return dist;
}

/** Nearest deprecated upstream: fewest asset-level hops, ties to the lower asset id (DP-59). */
function nearestDeprecatedUpstream(snapshot: Snapshot): Map<string, string | null> {
  const down = assetDownstream(snapshot);
  const best = new Map<string, { hops: number; id: string }>();
  const deprecated = [...snapshot.certs].filter(([, c]) => c.state === "deprecated").map(([id]) => id).sort(byString);
  for (const d of deprecated) {
    for (const [asset, hops] of downstreamAssets(down, d)) {
      const current = best.get(asset);
      if (!current || hops < current.hops || (hops === current.hops && d < current.id)) best.set(asset, { hops, id: d });
    }
  }
  return new Map([...snapshot.assets.keys()].map((id) => [id, best.get(id)?.id ?? null]));
}

export function assetTerms(snapshot: Snapshot, assetId: string): { id: string; name: string }[] {
  return (snapshot.links.get(assetId) ?? [])
    .map((id) => ({ id, name: snapshot.terms.get(id)!.name }))
    .sort(byName);
}

interface Counts {
  tagged: number;
  pii: number;
  confidential: number;
}

/** Derived counts per asset, from effective tags (DP-33). */
export function assetCounts(snapshot: Snapshot, assetId: string): Counts {
  const counts: Counts = { tagged: 0, pii: 0, confidential: 0 };
  for (const id of snapshot.assetColumns.get(assetId) ?? []) {
    const tags = snapshot.derived.get(id);
    if (!tags?.size) continue;
    counts.tagged++;
    if (tags.has("PII")) counts.pii++;
    if (tags.has("Confidential")) counts.confidential++;
  }
  return counts;
}

export async function loadSamples(tx: Tx, columnIds: string[]): Promise<Map<string, string[]>> {
  const { rows } = await tx.query("select id, samples from columns where id = any($1)", [columnIds]);
  return new Map(rows.map((r: { id: string; samples: string[] }) => [r.id, r.samples]));
}
