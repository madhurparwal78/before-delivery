import type { Database } from './db';
import type { DbRow } from './querier';
import type { Role, Tag, Transform } from '../shared/domain';
import type { TEdge } from '../shared/lineage';
import { replayPointInTime } from './replay';


export interface Actor {
  id: string;
  name: string;
  role: Role;
}

interface AssetDb extends DbRow {
  id: string;
  kind: string;
  description: string;
  owner_id: string;
  state: string;
  verified_at: string | null;
}
interface ColumnDb extends DbRow {
  id: string;
  asset: string;
  name: string;
  data_type: string;
  position: number;
}
interface SampleDb extends DbRow {
  column_id: string;
  position: number;
  value: string;
}
interface EdgeDb extends DbRow {
  id: string;
  from_col: string;
  to_col: string;
  transform: string;
}
interface UserDb extends DbRow {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface TermDb extends DbRow {
  id: string;
  name: string;
  definition: string;
  revision: number;
}

export interface CatalogData {
  assets: Map<string, AssetDb>;
  columns: Map<string, ColumnDb>;
  samples: Map<string, string[]>;
  edges: TEdge[];
  directTags: Map<string, Set<Tag>>;
  suppressions: Map<string, Map<Tag, { justification: string; at: string; by: string }>>;
  users: Map<string, UserDb>;
  terms: Map<string, TermDb>;
  assetTerms: Map<string, Set<string>>;
  evidence: Map<string, EvidenceDb>;
  deprecations: Map<string, DeprecationDb>;
  assetSeq: Map<string, number>;
  columnSeq: Map<string, number>;
}

interface EvidenceDb extends DbRow {
  evidence_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by: string;
}
interface DeprecationDb extends DbRow {
  event_id: string;
  reason: string;
  at: string;
  by: string;
}

/**
 * Loads the whole catalog from one query pass — used by every read and write,
 * live and point-in-time, so all derived state is computed by one rule set.
 */
export async function loadCatalog(db: Database, asOfSeq: number | null): Promise<CatalogData> {
  const assets = new Map<string, AssetDb>();
  const columns = new Map<string, ColumnDb>();
  const edges: TEdge[] = [];
  const samples = new Map<string, string[]>();
  const directTags = new Map<string, Set<Tag>>();
  const suppressions = new Map<string, Map<Tag, { justification: string; at: string; by: string }>>();
  const users = new Map<string, UserDb>();
  const terms = new Map<string, TermDb>();
  const assetTerms = new Map<string, Set<string>>();
  const evidence = new Map<string, EvidenceDb>();
  const deprecations = new Map<string, DeprecationDb>();
  const assetSeq = new Map<string, number>();
  const columnSeq = new Map<string, number>();

  const userRows = await db.query<UserDb>(`SELECT id, name, email, role FROM users`);
  for (const u of userRows) users.set(u.id, u);

  // Point-in-time reads answer exactly what the read returned right after audit
  // row k committed (DP-86). The write log is replayed in seq order: rows with
  // seq <= k are applied, later rows are not.
  if (asOfSeq === null) {
    const assetRows = await db.query<AssetDb>(`SELECT id, kind, description, owner_id, state, verified_at FROM assets`);
    for (const a of assetRows) assets.set(a.id, a);
    const colRows = await db.query<ColumnDb>(`SELECT id, asset, name, data_type, position FROM columns_ ORDER BY asset, position`);
    for (const c of colRows) columns.set(c.id, c);
    const sampleRows = await db.query<SampleDb>(`SELECT column_id, position, value FROM column_samples ORDER BY column_id, position`);
    for (const s of sampleRows) {
      const list = samples.get(s.column_id) ?? [];
      list.push(s.value);
      samples.set(s.column_id, list);
    }
    const edgeRows = await db.query<EdgeDb>(`SELECT id, from_col, to_col, transform FROM edges`);
    for (const e of edgeRows) edges.push({ id: e.id, from: e.from_col, to: e.to_col, transform: e.transform as Transform });
    const tagRows = await db.query<{ column_id: string; tag: Tag }>(`SELECT column_id, tag FROM direct_tags`);
    for (const t of tagRows) {
      const set = directTags.get(t.column_id) ?? new Set<Tag>();
      set.add(t.tag);
      directTags.set(t.column_id, set);
    }
    const supRows = await db.query<{ column_id: string; tag: Tag; justification: string; at: string; by: string }>(
      `SELECT column_id, tag, justification, at, by FROM suppressions`
    );
    for (const s of supRows) {
      const per = suppressions.get(s.column_id) ?? new Map<Tag, { justification: string; at: string; by: string }>();
      per.set(s.tag, { justification: s.justification, at: s.at, by: s.by });
      suppressions.set(s.column_id, per);
    }
    const termRows = await db.query<TermDb>(`SELECT id, name, definition, revision FROM terms`);
    for (const t of termRows) terms.set(t.id, t);
    const linkRows = await db.query<{ asset: string; term_id: string }>(`SELECT asset, term_id FROM asset_terms`);
    for (const l of linkRows) {
      const set = assetTerms.get(l.asset) ?? new Set<string>();
      set.add(l.term_id);
      assetTerms.set(l.asset, set);
    }
    const evRows = await db.query<EvidenceDb & { asset: string }>(
      `SELECT asset, evidence_id, filename, content_type, size_bytes, sha256, uploaded_at, uploaded_by FROM evidence`
    );
    for (const e of evRows) evidence.set(e.asset, { ...e, size_bytes: Number(e.size_bytes) });
    const depRows = await db.query<DeprecationDb & { asset: string }>(
      `SELECT asset, id AS event_id, reason, at, by FROM deprecation_events`
    );
    for (const d of depRows) deprecations.set(d.asset, d);
    for (const a of assets.values()) assetSeq.set(a.id, 0);
    for (const c of columns.values()) columnSeq.set(c.id, 0);
  } else {
    await replayPointInTime(db, asOfSeq, {
      assets,
      columns,
      samples,
      edges,
      directTags,
      suppressions,
      terms,
      assetTerms,
      evidence,
      deprecations,
    });
  }

  return {
    assets,
    columns,
    samples,
    edges,
    directTags,
    suppressions,
    users,
    terms,
    assetTerms,
    evidence,
    deprecations,
    assetSeq,
    columnSeq,
  };
}

/** The mutable state a point-in-time replay fills from the fixed seed plus audit rows. */
export interface PointInTimeTarget {
  assets: Map<string, AssetDb>;
  columns: Map<string, ColumnDb>;
  samples: Map<string, string[]>;
  edges: TEdge[];
  directTags: Map<string, Set<Tag>>;
  suppressions: Map<string, Map<Tag, { justification: string; at: string; by: string }>>;
  terms: Map<string, TermDb>;
  assetTerms: Map<string, Set<string>>;
  evidence: Map<string, EvidenceDb>;
  deprecations: Map<string, DeprecationDb>;
}
