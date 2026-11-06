import { query } from './db.js';
import { defaultMode, modeForRole } from './permissions.js';
import type { Mode, Role } from '../shared/types.js';

export async function storedMode(documentId: string, personId: string): Promise<Mode | null> {
  const result = await query<{ mode: Mode }>('select mode from document_modes where document_id = $1 and person_id = $2', [
    documentId,
    personId,
  ]);
  return result.rows[0]?.mode ?? null;
}

export async function setStoredMode(documentId: string, personId: string, mode: Mode): Promise<void> {
  await query(
    `insert into document_modes (document_id, person_id, mode) values ($1, $2, $3)
     on conflict (document_id, person_id) do update set mode = $3`,
    [documentId, personId, mode],
  );
}

/** The mode a person gets now: their stored one when their role still allows it. */
export async function modeFor(documentId: string, personId: string, role: Role): Promise<Mode> {
  const stored = await storedMode(documentId, personId);
  return stored === null ? defaultMode(role) : modeForRole(role, stored);
}
