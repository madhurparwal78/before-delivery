import type { Queryable } from '../db.ts';
import type {
  AssetKind,
  CertificationState,
  Role,
  Tag,
  Transform,
} from '../../shared/domain.ts';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface EvidenceRecord {
  id: string;
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface DeprecationRecord {
  reason: string;
  at: string;
  by: string;
}

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  description: string;
  ownerId: string;
  state: CertificationState;
  verifiedAt: string | null;
  evidence: EvidenceRecord | null;
  deprecation: DeprecationRecord | null;
  termIds: string[];
}

export interface ColumnRecord {
  id: string;
  assetId: string;
  name: string;
  dataType: string;
  ordinal: number;
  samples: string[];
  directTags: Tag[];
  suppressedTags: Tag[];
}

export interface EdgeRecord {
  id: string;
  from: string;
  to: string;
  transform: Transform;
}

export interface TermRecord {
  id: string;
  name: string;
  definition: string;
  revision: number;
}

/** An immutable view of the catalog at one audit seq. */
export class Snapshot {
  readonly seq: number;
  readonly users = new Map<string, UserRecord>();
  readonly assets = new Map<string, AssetRecord>();
  readonly columns = new Map<string, ColumnRecord>();
  readonly terms = new Map<string, TermRecord>();
  readonly edges = new Map<string, EdgeRecord>();
  private readonly outEdges = new Map<string, EdgeRecord[]>();
  private readonly inEdges = new Map<string, EdgeRecord[]>();
  private readonly columnsByAsset = new Map<string, ColumnRecord[]>();
  private readonly memos = new Map<string, unknown>();

  constructor(seq: number) {
    this.seq = seq;
  }

  /** Lazily computed state derived from this snapshot, reused across one request. */
  memo<T>(key: string, build: (snapshot: Snapshot) => T): T {
    if (!this.memos.has(key)) this.memos.set(key, build(this));
    return this.memos.get(key) as T;
  }

  indexGraph(): void {
    this.outEdges.clear();
    this.inEdges.clear();
    for (const edge of this.edges.values()) {
      const out = this.outEdges.get(edge.from);
      if (out) out.push(edge);
      else this.outEdges.set(edge.from, [edge]);
      const into = this.inEdges.get(edge.to);
      if (into) into.push(edge);
      else this.inEdges.set(edge.to, [edge]);
    }
    this.columnsByAsset.clear();
    for (const column of this.columns.values()) {
      const list = this.columnsByAsset.get(column.assetId);
      if (list) list.push(column);
      else this.columnsByAsset.set(column.assetId, [column]);
    }
    for (const list of this.columnsByAsset.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    this.memos.clear();
  }

  out(columnId: string): readonly EdgeRecord[] {
    return this.outEdges.get(columnId) ?? [];
  }

  in(columnId: string): readonly EdgeRecord[] {
    return this.inEdges.get(columnId) ?? [];
  }

  assetColumns(assetId: string): readonly ColumnRecord[] {
    return this.columnsByAsset.get(assetId) ?? [];
  }

  liveEdge(from: string, to: string): EdgeRecord | null {
    for (const edge of this.out(from)) if (edge.to === to) return edge;
    return null;
  }
}

interface SnapshotRows {
  users: { id: string; name: string; email: string; role: Role }[];
  assets: { id: string; kind: AssetKind; description: string; owner_id: string }[];
  columns: {
    id: string;
    asset_id: string;
    name: string;
    data_type: string;
    ordinal: number;
    samples: string[];
  }[];
  edges: { id: string; from_column: string; to_column: string; transform: Transform }[];
  tags: { column_id: string; tag: Tag }[];
  suppressions: { column_id: string; tag: Tag }[];
  certification: {
    asset_id: string;
    state: CertificationState;
    verified_at: string | null;
    deprecation: DeprecationRecord | null;
    evidence_id: string | null;
    filename: string | null;
    content_type: string | null;
    size_bytes: string | null;
    sha256: string | null;
    uploaded_at: string | null;
    uploaded_by: string | null;
    storage_key: string | null;
  }[];
  terms: { id: string; name: string; definition: string; revision: number }[];
  assetTerms: { asset_id: string; term_id: string }[];
}

export async function latestSeq(client: Queryable): Promise<number> {
  const result = await client.query<{ seq: string | null }>('SELECT max(seq) AS seq FROM audit_log');
  return Number(result.rows[0]?.seq ?? 0);
}

/** Loads the catalog exactly as it stood right after audit row `seq` committed. */
export async function loadSnapshot(client: Queryable, seq: number): Promise<Snapshot> {
  const rows: SnapshotRows = {
    users: (
      await client.query<SnapshotRows['users'][number]>('SELECT id, name, email, role FROM users')
    ).rows,
    assets: (
      await client.query<SnapshotRows['assets'][number]>(
        'SELECT id, kind, description, owner_id FROM assets WHERE created_seq <= $1',
        [seq],
      )
    ).rows,
    columns: (
      await client.query<SnapshotRows['columns'][number]>(
        `SELECT c.id, c.asset_id, c.name, c.data_type, c.ordinal, c.samples
           FROM asset_columns c JOIN assets a ON a.id = c.asset_id
          WHERE c.created_seq <= $1 AND a.created_seq <= $1`,
        [seq],
      )
    ).rows,
    edges: (
      await client.query<SnapshotRows['edges'][number]>(
        `SELECT id, from_column, to_column, transform FROM lineage_edges
          WHERE added_seq <= $1 AND (removed_seq IS NULL OR removed_seq > $1)`,
        [seq],
      )
    ).rows,
    tags: (
      await client.query<SnapshotRows['tags'][number]>(
        `SELECT column_id, tag FROM column_tags
          WHERE added_seq <= $1 AND (removed_seq IS NULL OR removed_seq > $1)`,
        [seq],
      )
    ).rows,
    suppressions: (
      await client.query<SnapshotRows['suppressions'][number]>(
        `SELECT column_id, tag FROM suppressions
          WHERE created_seq <= $1 AND (lifted_seq IS NULL OR lifted_seq > $1)`,
        [seq],
      )
    ).rows,
    certification: (
      await client.query<SnapshotRows['certification'][number]>(
        `SELECT c.asset_id, c.state, c.verified_at, c.deprecation, c.evidence_id,
                e.filename, e.content_type, e.size_bytes, e.sha256, e.uploaded_at, e.uploaded_by, e.storage_key
           FROM asset_certification c
           LEFT JOIN evidence_records e ON e.id = c.evidence_id
          WHERE c.from_seq <= $1
            AND c.from_seq = (
              SELECT max(from_seq) FROM asset_certification i
               WHERE i.asset_id = c.asset_id AND i.from_seq <= $1)`,
        [seq],
      )
    ).rows,
    terms: (
      await client.query<SnapshotRows['terms'][number]>(
        `SELECT r.term_id AS id, r.name, r.definition, r.revision
           FROM term_revisions r JOIN terms t ON t.id = r.term_id
          WHERE r.from_seq <= $1 AND t.created_seq <= $1
            AND r.revision = (
              SELECT max(revision) FROM term_revisions i
               WHERE i.term_id = r.term_id AND i.from_seq <= $1)`,
        [seq],
      )
    ).rows,
    assetTerms: (
      await client.query<SnapshotRows['assetTerms'][number]>(
        `SELECT asset_id, term_id FROM asset_terms
          WHERE linked_seq <= $1 AND (unlinked_seq IS NULL OR unlinked_seq > $1)`,
        [seq],
      )
    ).rows,
  };

  const snapshot = new Snapshot(seq);
  for (const user of rows.users) {
    snapshot.users.set(user.id, { id: user.id, name: user.name, email: user.email, role: user.role });
  }
  for (const term of rows.terms) {
    snapshot.terms.set(term.id, {
      id: term.id,
      name: term.name,
      definition: term.definition,
      revision: term.revision,
    });
  }
  const certByAsset = new Map<string, SnapshotRows['certification'][number]>();
  for (const row of rows.certification) certByAsset.set(row.asset_id, row);
  const termsByAsset = new Map<string, string[]>();
  for (const link of rows.assetTerms) {
    if (!snapshot.terms.has(link.term_id)) continue;
    const list = termsByAsset.get(link.asset_id);
    if (list) list.push(link.term_id);
    else termsByAsset.set(link.asset_id, [link.term_id]);
  }
  for (const asset of rows.assets) {
    const cert = certByAsset.get(asset.id);
    snapshot.assets.set(asset.id, {
      id: asset.id,
      kind: asset.kind,
      description: asset.description,
      ownerId: asset.owner_id,
      state: cert?.state ?? 'draft',
      verifiedAt: cert?.verified_at ?? null,
      evidence:
        cert?.evidence_id && cert.filename !== null
          ? {
              id: cert.evidence_id,
              storageKey: cert.storage_key as string,
              filename: cert.filename,
              contentType: cert.content_type as string,
              sizeBytes: Number(cert.size_bytes),
              sha256: cert.sha256 as string,
              uploadedAt: cert.uploaded_at as string,
              uploadedBy: cert.uploaded_by as string,
            }
          : null,
      deprecation: cert?.deprecation ?? null,
      termIds: termsByAsset.get(asset.id) ?? [],
    });
  }
  for (const column of rows.columns) {
    snapshot.columns.set(column.id, {
      id: column.id,
      assetId: column.asset_id,
      name: column.name,
      dataType: column.data_type,
      ordinal: column.ordinal,
      samples: column.samples,
      directTags: [],
      suppressedTags: [],
    });
  }
  for (const tag of rows.tags) {
    snapshot.columns.get(tag.column_id)?.directTags.push(tag.tag);
  }
  for (const suppression of rows.suppressions) {
    snapshot.columns.get(suppression.column_id)?.suppressedTags.push(suppression.tag);
  }
  for (const column of snapshot.columns.values()) {
    column.directTags.sort();
    column.suppressedTags.sort();
  }
  for (const edge of rows.edges) {
    if (!snapshot.columns.has(edge.from_column) || !snapshot.columns.has(edge.to_column)) continue;
    snapshot.edges.set(edge.id, {
      id: edge.id,
      from: edge.from_column,
      to: edge.to_column,
      transform: edge.transform,
    });
  }
  snapshot.indexGraph();
  return snapshot;
}

/**
 * Loads the catalog as the running transaction sees it, including rows this transaction has
 * written at a seq it has not yet appended.
 */
export async function loadCurrentSnapshot(client: Queryable): Promise<Snapshot> {
  return loadSnapshot(client, Number.MAX_SAFE_INTEGER);
}
