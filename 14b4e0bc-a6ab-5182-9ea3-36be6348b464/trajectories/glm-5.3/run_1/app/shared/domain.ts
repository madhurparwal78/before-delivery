export const TAGS = ['PII', 'Confidential'] as const;
export type Tag = (typeof TAGS)[number];
export const CERT_STATES = ['draft', 'verified', 'deprecated'] as const;
export type CertState = (typeof CERT_STATES)[number];
export const TRANSFORMS = ['copy', 'rename', 'cast', 'filter', 'join', 'concat', 'hash', 'aggregate'] as const;
export type Transform = (typeof TRANSFORMS)[number];
export const ROLES = ['Admin', 'Steward', 'Analyst', 'Viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ASSET_KINDS = ['table', 'view', 'dashboard'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export function isTag(v: unknown): v is Tag {
  return typeof v === 'string' && (TAGS as readonly string[]).includes(v);
}
export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}
export function isCertState(v: unknown): v is CertState {
  return typeof v === 'string' && (CERT_STATES as readonly string[]).includes(v);
}
export function isTransform(v: unknown): v is Transform {
  return typeof v === 'string' && (TRANSFORMS as readonly string[]).includes(v);
}
export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v);
}

export function tagSorted(tags: Iterable<Tag>): Tag[] {
  return [...tags].sort();
}

export const BUSINESS_TZ = 'America/Chicago';

/** Every character limit in this brief counts Unicode code points. */
export function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

export function foldAscii(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x41 && c <= 0x5a) out += String.fromCodePoint(c + 32);
    else out += ch;
  }
  return out;
}

export function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}



/** Pass-through transforms propagate tags; hash and aggregate pass nothing on. */
export const PASS_THROUGH: Readonly<Record<Transform, boolean>> = {
  copy: true,
  rename: true,
  cast: true,
  filter: true,
  join: true,
  concat: true,
  hash: false,
  aggregate: false,
};

/** Lineage traversal bounds (DP-40): stops at 12 hops or 500 reached columns. */
export const MAX_HOPS = 12;
export const MAX_COLUMNS = 500;

/** The published placeholder the server substitutes for a masked sample (DP-23). */
export const MASKED = '[masked]';
