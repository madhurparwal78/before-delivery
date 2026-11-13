import { randomBytes } from 'node:crypto';

type IdPrefix = 'tm' | 'usr' | 'site' | 'ver' | 'tab' | 'grp' | 'pg' | 'lnk' | 'inv' | 'imp' | 'img' | 'snap' | 'rdr';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** A token with 256 bits of entropy, safe in a URL. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
