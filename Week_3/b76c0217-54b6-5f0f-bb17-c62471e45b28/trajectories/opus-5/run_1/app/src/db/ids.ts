import { randomBytes } from 'node:crypto';

const PREFIXES = {
  team: 'tm',
  user: 'usr',
  session: 'ses',
  site: 'site',
  version: 'ver',
  tab: 'tab',
  group: 'grp',
  page: 'pg',
  snapshot: 'snap',
  attempt: 'pub',
  previewLink: 'pl',
  invite: 'inv',
  import: 'imp',
  asset: 'img',
  reader: 'rdr',
} as const;

export type IdKind = keyof typeof PREFIXES;

export const newId = (kind: IdKind): string => `${PREFIXES[kind]}_${randomBytes(6).toString('hex')}`;

export const newToken = (): string => randomBytes(24).toString('base64url');
