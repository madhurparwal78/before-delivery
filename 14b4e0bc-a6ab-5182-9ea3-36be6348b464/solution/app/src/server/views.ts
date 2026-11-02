import { assetCounts, assetTerms, type Snapshot } from "./catalog.ts";
import { effectiveTags, tagSources } from "./tags.ts";
import { sortTags, type Role, type Tag } from "./text.ts";

export const MASKED = "[masked]";

/** Masking by role, decided here only (DP-23): the raw value never leaves the server for a masked role. */
export function masks(role: Role, effective: readonly Tag[]): boolean {
  if (role === "Admin" || role === "Steward") return false;
  if (role === "Analyst") return effective.includes("PII");
  return effective.length > 0;
}

export function assetSummary(snapshot: Snapshot, assetId: string) {
  const asset = snapshot.assets.get(assetId)!;
  const counts = assetCounts(snapshot, assetId);
  return {
    id: asset.id,
    kind: asset.kind,
    description: asset.description,
    owner: asset.owner,
    state: snapshot.certs.get(assetId)!.state,
    terms: assetTerms(snapshot, assetId),
    tagged_column_count: counts.tagged,
    pii_column_count: counts.pii,
    confidential_column_count: counts.confidential,
    deprecated_upstream: snapshot.deprecatedUpstream.get(assetId) ?? null,
  };
}

function columnBody(snapshot: Snapshot, columnId: string, samples: string[], role: Role) {
  const column = snapshot.columns.get(columnId)!;
  const effective = effectiveTags(snapshot.derived, columnId);
  const masked = samples.length > 0 && masks(role, effective);
  return {
    id: column.id,
    name: column.name,
    data_type: column.dataType,
    direct_tags: sortTags(snapshot.facts.direct.get(columnId) ?? []),
    effective_tags: effective,
    suppressed_tags: sortTags(snapshot.facts.suppressed.get(columnId) ?? []),
    tag_sources: tagSources(snapshot.derived, columnId),
    samples: masked ? samples.map(() => MASKED) : samples,
    masked,
  };
}

export function columnRead(snapshot: Snapshot, columnId: string, samples: string[], role: Role) {
  const assetId = snapshot.columns.get(columnId)!.assetId;
  return { ...columnBody(snapshot, columnId, samples, role), asset: { id: assetId, state: snapshot.certs.get(assetId)!.state } };
}

export function assetDetail(snapshot: Snapshot, assetId: string, samples: Map<string, string[]>, role: Role) {
  const cert = snapshot.certs.get(assetId)!;
  const evidence = cert.evidence && {
    filename: cert.evidence.filename,
    content_type: cert.evidence.content_type,
    size_bytes: cert.evidence.size_bytes,
    sha256: cert.evidence.sha256,
    uploaded_at: cert.evidence.uploaded_at,
    uploaded_by: cert.evidence.uploaded_by,
  };
  return {
    ...assetSummary(snapshot, assetId),
    verified_at: cert.verifiedAt,
    evidence,
    deprecation: cert.deprecation,
    columns: (snapshot.assetColumns.get(assetId) ?? []).map((id) => columnBody(snapshot, id, samples.get(id) ?? [], role)),
  };
}

export function graphColumn(snapshot: Snapshot, columnId: string) {
  return {
    id: columnId,
    asset: snapshot.columns.get(columnId)!.assetId,
    direct_tags: sortTags(snapshot.facts.direct.get(columnId) ?? []),
    effective_tags: effectiveTags(snapshot.derived, columnId),
    suppressed_tags: sortTags(snapshot.facts.suppressed.get(columnId) ?? []),
    tag_sources: tagSources(snapshot.derived, columnId),
  };
}
