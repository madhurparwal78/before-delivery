import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Collaborator, Role } from '../../shared/types.js';
import { one, query } from '../db/pool.js';
import { errors } from '../errors.js';

export interface CollaboratorRow {
  id: string;
  score_id: string;
  name: string;
  role: Role;
  status: 'invited' | 'active' | 'removed';
  staff_ids: string[];
  all_staves: boolean;
  seat_token: string | null;
  invite_token: string | null;
  acked_lamport: number;
}

export interface Caller extends CollaboratorRow {
  staffIdsForEdit: string[];
}

export function collaboratorOf(row: CollaboratorRow, allStaffIds: string[]): Collaborator {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    staffIds: row.all_staves ? allStaffIds : row.staff_ids,
  };
}

export async function callerForSeatToken(token: string): Promise<CollaboratorRow | undefined> {
  return one<CollaboratorRow>(
    `select * from collaborators where seat_token = $1 and status = 'active'`,
    [token],
  );
}

export async function listCollaborators(scoreId: string): Promise<CollaboratorRow[]> {
  return query<CollaboratorRow>(
    'select * from collaborators where score_id = $1 order by role asc, name asc',
    [scoreId],
  );
}

export async function findCollaborator(
  scoreId: string,
  collaboratorId: string,
): Promise<CollaboratorRow> {
  const row = await one<CollaboratorRow>(
    'select * from collaborators where score_id = $1 and id = $2',
    [scoreId, collaboratorId],
  );
  if (!row) throw errors.notFound();
  return row;
}

/** Which staves a collaborator may edit: every staff, or only the ones assigned to them. */
export function canEditStaff(caller: CollaboratorRow, staffId: string): boolean {
  return caller.all_staves || caller.staff_ids.includes(staffId);
}

export function editableStaffIds(caller: CollaboratorRow, allStaffIds: string[]): string[] {
  return caller.all_staves ? allStaffIds : caller.staff_ids;
}

export async function createInvite(
  client: PoolClient,
  scoreId: string,
  name: string,
  role: 'copyist' | 'player',
  staffIds: string[],
): Promise<{ row: CollaboratorRow; inviteToken: string }> {
  const id = `c-${randomUUID().slice(0, 8)}`;
  const inviteToken = `inv-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const inserted = await client.query<CollaboratorRow>(
    `insert into collaborators (id, score_id, name, role, status, staff_ids, all_staves, invite_token, acked_lamport)
     values ($1, $2, $3, $4, 'invited', $5::jsonb, $6, $7, 0) returning *`,
    [id, scoreId, name, role, JSON.stringify(staffIds), role === 'copyist', inviteToken],
  );
  return { row: inserted.rows[0]!, inviteToken };
}
