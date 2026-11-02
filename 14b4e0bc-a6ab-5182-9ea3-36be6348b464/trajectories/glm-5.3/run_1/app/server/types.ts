import type { AssetKind, CertState, Tag, Transform } from '../shared/domain';
import { cpLen } from '../shared/domain';

export interface AssetRow {
  id: string;
  kind: AssetKind;
  description: string;
  owner_id: string;
  state: CertState;
  verified_at: string | null;
  deprecated_upstream: string | null;
}

export interface ColumnRow {
  id: string;
  asset: string;
  name: string;
  data_type: string;
  samples: string[];
  position: number;
}

export interface SampleRow {
  column_id: string;
  value: string;
  position: number;
}

export interface EdgeRow {
  id: string;
  from_col: string;
  to_col: string;
  transform: Transform;
}

export interface TagRow {
  column_id: string;
  tag: Tag;
}

export interface SuppressionRow {
  column_id: string;
  tag: Tag;
  justification: string;
  at: string;
  by: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface TermRow {
  id: string;
  name: string;
  definition: string;
  revision: number;
}

export interface EvidenceRow {
  asset: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  uploaded_at: string;
  uploaded_by: string;
  evidence_id: string;
}

export interface DeprecationRow {
  asset: string;
  reason: string;
  at: string;
  by: string;
  event_id: string;
}

export interface NoticeRow {
  id: string;
  event_id: string;
  asset: string;
  owner_id: string;
  state: 'queued' | 'claimed' | 'sent' | 'cancelled';
  claim_expires_at: number | null;
  attempts: number;
  message_id: string;
}

/** The whole catalog as of one point in time, built from one query pass. */
export interface CatalogSnapshot {
  assets: AssetRow[];
  columns: ColumnRow[];
  samples: Map<string, string[]>;
  edges: EdgeRow[];
  directTags: Map<string, Tag[]>;
  suppressions: SuppressionRow[];
  assetStates: Map<string, CertState>;
  deprecatedUpstream: Map<string, string | null>;
  terms: TermRow[];
  assetTerms: Map<string, string[]>;
  owners: UserRow[];
  evidence: Map<string, EvidenceRow>;
  deprecations: Map<string, DeprecationRow>;
  verifiedAt: Map<string, string | null>;
}

export interface CatalogQueryFilters {
  asOfSeq: number | null;
  columnIds?: string[];
}

export function isColumnNameValid(name: string): boolean {
  if (cpLen(name) < 1 || cpLen(name) > 60) return false;
  const cps = [...name];
  const first = cps[0]!;
  if (!isLetterCp(first)) return false;
  for (const cp of cps) {
    if (isLetterCp(cp) || isCombiningMark(cp) || isDecimalDigit(cp) || cp === '_') continue;
    return false;
  }
  return true;
}

function isUpperOrTitle(cp: string): boolean {
  return /\p{Lu}/u.test(cp) || /\p{Lt}/u.test(cp);
}

function isLetterCp(cp: string): boolean {
  if (isUpperOrTitle(cp)) return false;
  return /\p{L}/u.test(cp);
}

function isCombiningMark(cp: string): boolean {
  return /\p{M}/u.test(cp);
}

function isDecimalDigit(cp: string): boolean {
  return /\p{Nd}/u.test(cp);
}

export function isAssetIdValid(id: string): boolean {
  if (id.length === 0 || id.length > 120) return false;
  const parts = id.split('.');
  if (parts.length !== 2) return false;
  for (const part of parts) {
    if (part.length === 0) return false;
    const first = part[0]!;
    if (!/[a-z]/.test(first)) return false;
    if (!/^[a-z0-9_]+$/.test(part)) return false;
  }
  return true;
}

export function isValidEmailShape(email: string): boolean {
  const m = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.exec(email);
  return m !== null && cpLen(email) <= 254;
}
