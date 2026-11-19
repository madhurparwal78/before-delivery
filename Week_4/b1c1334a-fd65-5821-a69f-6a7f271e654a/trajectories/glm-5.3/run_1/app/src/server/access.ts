/**
 * Access: one place decides a member's role, row scope and the rows they see.
 */
import { PoolClient } from 'pg';
import { DocState, View, OwnRowsView, AllRowsView } from './docstate.js';
import { ApiError } from '../shared/errors.js';

export type Role = 'owner' | 'editor' | 'viewer';

export interface Access {
  role: Role;
  rowScope: 'all' | 'own';
}

export interface Person {
  id: string;
  email: string;
  displayName: string;
}

export async function documentAccess(
  client: PoolClient,
  documentId: string,
  person: Person,
): Promise<{ access: Access; documentExists: boolean }> {
  const doc = await client.query<{ owner_person_id: string; id: string }>(
    'SELECT id, owner_person_id FROM documents WHERE id = $1',
    [documentId],
  );
  if (doc.rows.length === 0) return { access: { role: 'viewer', rowScope: 'all' }, documentExists: false };
  if (doc.rows[0]!.owner_person_id === person.id) {
    return { access: { role: 'owner', rowScope: 'all' }, documentExists: true };
  }
  const share = await client.query<{ role: string; row_scope: string }>(
    'SELECT role, row_scope FROM shares WHERE document_id = $1 AND email = $2',
    [documentId, person.email],
  );
  if (share.rows.length === 0) return { access: { role: 'viewer', rowScope: 'all' }, documentExists: false };
  return {
    access: {
      role: share.rows[0]!.role as Role,
      rowScope: share.rows[0]!.row_scope as 'all' | 'own',
    },
    documentExists: true,
  };
}

/** The view of one member over one document, in one request. */
export function viewFor(email: string, access: Access, state: DocState): View {
  void state;
  if (access.rowScope === 'own' && access.role !== 'owner') {
    return new OwnRowsView(email, access.role);
  }
  return new AllRowsView(access.role);
}

export const assertWritable = (access: Access): void => {
  if (access.role === 'viewer') throw new ApiError(403, 'forbidden', 'You may not take this action.');
};

export const assertOwner = (access: Access): void => {
  if (access.role !== 'owner') throw new ApiError(403, 'forbidden', 'You may not take this action.');
};

export const assertEditorFormula = (access: Access): void => {
  if (access.role === 'viewer') throw new ApiError(403, 'forbidden', 'You may not take this action.');
};

export async function loadPerson(client: PoolClient, personId: string): Promise<Person | null> {
  const r = await client.query<{ id: string; email: string; display_name: string }>(
    'SELECT id, email, display_name FROM persons WHERE id = $1',
    [personId],
  );
  if (r.rows.length === 0) return null;
  return { id: r.rows[0]!.id, email: r.rows[0]!.email, displayName: r.rows[0]!.display_name };
}
