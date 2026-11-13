import type { Db } from '../db.js';
import { errors } from '../errors.js';

export type Versioned = { revision: number; saved_by: string };

/** The one revision check: a change must carry the record's current revision. */
export async function requireRevision(
  db: Db,
  baseRevision: number,
  record: Versioned,
  thing: string,
): Promise<void> {
  if (baseRevision === record.revision) return;
  const { rows } = await db.query<{ id: string; name: string }>(
    'select id, name from members where id = $1',
    [record.saved_by],
  );
  const savedBy = rows[0] as { id: string; name: string };
  throw errors.staleRevision(thing, record.revision, savedBy);
}
