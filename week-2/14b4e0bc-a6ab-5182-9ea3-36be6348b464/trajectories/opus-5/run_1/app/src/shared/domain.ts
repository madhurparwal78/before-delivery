export type Tag = 'Confidential' | 'PII';
export type Role = 'Admin' | 'Steward' | 'Analyst' | 'Viewer';
export type AssetKind = 'table' | 'view' | 'dashboard';
export type CertificationState = 'draft' | 'verified' | 'deprecated';
export type Transform = 'copy' | 'rename' | 'cast' | 'filter' | 'join' | 'concat' | 'hash' | 'aggregate';
export type EdgeKind = 'flow' | 'seal' | 'cycle';
export type LineageDirection = 'downstream' | 'upstream';

export const TAGS: readonly Tag[] = ['Confidential', 'PII'];
export const ROLES: readonly Role[] = ['Admin', 'Steward', 'Analyst', 'Viewer'];
export const ASSET_KINDS: readonly AssetKind[] = ['table', 'view', 'dashboard'];
export const CERTIFICATION_STATES: readonly CertificationState[] = ['draft', 'verified', 'deprecated'];
export const TRANSFORMS: readonly Transform[] = [
  'copy',
  'rename',
  'cast',
  'filter',
  'join',
  'concat',
  'hash',
  'aggregate',
];
export const PASS_THROUGH_TRANSFORMS: readonly Transform[] = ['copy', 'rename', 'cast', 'filter', 'join', 'concat'];

export const MASK_PLACEHOLDER = '[masked]';
export const MAX_HOPS = 12;
export const MAX_COLUMNS = 500;
export const BUSINESS_TIME_ZONE = 'America/Chicago';

export function isTag(value: unknown): value is Tag {
  return value === 'PII' || value === 'Confidential';
}

export function isPassThrough(transform: Transform): boolean {
  return transform !== 'hash' && transform !== 'aggregate';
}

/** Tag lists are sorted alphabetically everywhere: Confidential before PII. */
export function sortTags(tags: Iterable<Tag>): Tag[] {
  return [...new Set(tags)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function sortIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareIds);
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Name order compares case-folded names, with ties broken by id. */
export function compareByName<T extends { id: string; name: string }>(a: T, b: T): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return compareIds(a.id, b.id);
}

export function codePointLength(value: string): number {
  return [...value].length;
}
