import { Tx } from '../db.js';

/** The local part in lower case, with everything but a-z0-9 removed. */
export function baseHandle(email: string): string {
  const local = email.slice(0, email.indexOf('@'));
  const stripped = local.toLowerCase().replace(/[^a-z0-9]/g, '');
  return stripped === '' ? 'person' : stripped;
}

export async function freeHandle(tx: Tx, email: string): Promise<string> {
  const base = baseHandle(email);
  const taken = await tx.one(`select 1 from users where handle = $1`, [base]);
  if (taken === null) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    const exists = await tx.one(`select 1 from users where handle = $1`, [candidate]);
    if (exists === null) return candidate;
  }
}
