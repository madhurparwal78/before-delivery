import { type CertificationState, type Role, type Tag, compareByName, compareIds } from '../../shared/domain.ts';
import { nearestDeprecatedUpstream } from './deprecation.ts';
import type { AssetRecord, ColumnRecord, Snapshot, TermRecord } from './snapshot.ts';
import { type TagSources, assetTagCounts, effectiveTags, maskSamples, tagSourcesOf } from './tags.ts';

export interface UserRef {
  id: string;
  name: string;
}

export interface TermRef {
  id: string;
  name: string;
}

export interface AssetSummary {
  id: string;
  kind: string;
  description: string;
  owner: UserRef;
  state: CertificationState;
  terms: TermRef[];
  tagged_column_count: number;
  pii_column_count: number;
  confidential_column_count: number;
  deprecated_upstream: string | null;
}

export interface ColumnBody {
  id: string;
  name: string;
  data_type: string;
  direct_tags: Tag[];
  effective_tags: Tag[];
  suppressed_tags: Tag[];
  tag_sources: TagSources;
  samples: string[];
  masked: boolean;
}

export interface AssetDetail extends AssetSummary {
  verified_at: string | null;
  evidence: {
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    uploaded_at: string;
    uploaded_by: UserRef;
  } | null;
  deprecation: { reason: string; at: string; by: UserRef } | null;
  columns: ColumnBody[];
}

export interface GraphColumn {
  id: string;
  asset: string;
  direct_tags: Tag[];
  effective_tags: Tag[];
  suppressed_tags: Tag[];
  tag_sources: TagSources;
}

export interface TermBody {
  id: string;
  name: string;
  definition: string;
  revision: number;
  assets: { id: string }[];
}

export function userRef(snapshot: Snapshot, userId: string): UserRef {
  const user = snapshot.users.get(userId);
  return { id: userId, name: user?.name ?? userId };
}

export function termRefs(snapshot: Snapshot, asset: AssetRecord): TermRef[] {
  const terms = asset.termIds
    .map((termId) => snapshot.terms.get(termId))
    .filter((term): term is TermRecord => term !== undefined)
    .sort(compareByName);
  return terms.map((term) => ({ id: term.id, name: term.name }));
}

export function assetSummary(snapshot: Snapshot, asset: AssetRecord): AssetSummary {
  return {
    id: asset.id,
    kind: asset.kind,
    description: asset.description,
    owner: userRef(snapshot, asset.ownerId),
    state: asset.state,
    terms: termRefs(snapshot, asset),
    ...assetTagCounts(snapshot, asset.id),
    deprecated_upstream: nearestDeprecatedUpstream(snapshot, asset.id),
  };
}

export function columnBody(snapshot: Snapshot, column: ColumnRecord, role: Role): ColumnBody {
  const { samples, masked } = maskSamples(snapshot, column, role);
  return {
    id: column.id,
    name: column.name,
    data_type: column.dataType,
    direct_tags: [...column.directTags],
    effective_tags: effectiveTags(snapshot, column.id),
    suppressed_tags: [...column.suppressedTags],
    tag_sources: tagSourcesOf(snapshot, column.id),
    samples,
    masked,
  };
}

export function assetDetail(snapshot: Snapshot, asset: AssetRecord, role: Role): AssetDetail {
  return {
    ...assetSummary(snapshot, asset),
    verified_at: asset.verifiedAt,
    evidence: asset.evidence
      ? {
          filename: asset.evidence.filename,
          content_type: asset.evidence.contentType,
          size_bytes: asset.evidence.sizeBytes,
          sha256: asset.evidence.sha256,
          uploaded_at: asset.evidence.uploadedAt,
          uploaded_by: userRef(snapshot, asset.evidence.uploadedBy),
        }
      : null,
    deprecation: asset.deprecation
      ? {
          reason: asset.deprecation.reason,
          at: asset.deprecation.at,
          by: userRef(snapshot, asset.deprecation.by),
        }
      : null,
    columns: snapshot.assetColumns(asset.id).map((column) => columnBody(snapshot, column, role)),
  };
}

export function graphColumn(snapshot: Snapshot, column: ColumnRecord): GraphColumn {
  return {
    id: column.id,
    asset: column.assetId,
    direct_tags: [...column.directTags],
    effective_tags: effectiveTags(snapshot, column.id),
    suppressed_tags: [...column.suppressedTags],
    tag_sources: tagSourcesOf(snapshot, column.id),
  };
}

export function termBody(snapshot: Snapshot, term: TermRecord): TermBody {
  const assets = [...snapshot.assets.values()]
    .filter((asset) => asset.termIds.includes(term.id))
    .map((asset) => ({ id: asset.id }))
    .sort((a, b) => compareIds(a.id, b.id));
  return {
    id: term.id,
    name: term.name,
    definition: term.definition,
    revision: term.revision,
    assets,
  };
}

/** Glossary order is the name order of terms. */
export function glossaryOrder(snapshot: Snapshot): TermRecord[] {
  return [...snapshot.terms.values()].sort(compareByName);
}
