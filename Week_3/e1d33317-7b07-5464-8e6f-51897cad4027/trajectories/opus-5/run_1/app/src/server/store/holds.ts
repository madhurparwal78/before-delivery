import type { Hold, Role } from '../../shared/types.js';
import { query, transact } from '../db/pool.js';
import { errors } from '../errors.js';
import { broadcast } from '../services/valkey.js';
import type { CollaboratorRow } from './collaborators.js';

interface HoldRow {
  staff_id: string;
  collaborator_id: string;
  connection_id: string;
  since: Date;
  name: string;
  role: Role;
}

export async function listHolds(scoreId: string): Promise<Hold[]> {
  const rows = await query<HoldRow>(
    `select h.staff_id, h.collaborator_id, h.connection_id, h.since, c.name, c.role
     from holds h join collaborators c on c.id = h.collaborator_id
     where h.score_id = $1 order by h.since asc`,
    [scoreId],
  );
  return rows.map((row) => ({
    staffId: row.staff_id,
    holder: { id: row.collaborator_id, name: row.name, role: row.role },
    since: row.since.toISOString(),
  }));
}

async function publishHolds(scoreId: string): Promise<Hold[]> {
  const holds = await listHolds(scoreId);
  await broadcast.publish(scoreId, { type: 'holds', holds });
  return holds;
}

/** A hold request is all or nothing: one caller gets every staff it asked for. */
export async function acquireHolds(
  scoreId: string,
  caller: CollaboratorRow,
  staffIds: string[],
  connectionId: string,
  staffNames: Map<string, string>,
): Promise<Hold[]> {
  await transact(async (client) => {
    await client.query('select id from scores where id = $1 for update', [scoreId]);
    const existing = await client.query<HoldRow>(
      `select h.staff_id, h.collaborator_id, h.connection_id, c.name, c.role
       from holds h join collaborators c on c.id = h.collaborator_id
       where h.score_id = $1 and h.staff_id = any($2::text[])`,
      [scoreId, staffIds],
    );
    const blocking = existing.rows.filter(
      (row) => row.collaborator_id !== caller.id || row.connection_id !== connectionId,
    );
    if (blocking.length > 0) {
      const holder = blocking[0]!;
      throw errors.staffHeld(
        { id: holder.collaborator_id, name: holder.name, role: holder.role },
        blocking.map((row) => staffNames.get(row.staff_id) ?? row.staff_id),
        blocking.map((row) => row.staff_id),
      );
    }
    for (const staffId of staffIds) {
      await client.query(
        `insert into holds (score_id, staff_id, collaborator_id, connection_id)
         values ($1, $2, $3, $4)
         on conflict (score_id, staff_id) do update set connection_id = excluded.connection_id`,
        [scoreId, staffId, caller.id, connectionId],
      );
    }
  });
  return publishHolds(scoreId);
}

export async function releaseHolds(
  scoreId: string,
  collaboratorId: string,
  staffIds: string[],
): Promise<void> {
  await query(
    `delete from holds where score_id = $1 and collaborator_id = $2 and staff_id = any($3::text[])`,
    [scoreId, collaboratorId, staffIds],
  );
  await publishHolds(scoreId);
}

export async function releaseConnectionHolds(
  scoreId: string,
  connectionId: string,
): Promise<void> {
  const removed = await query<{ staff_id: string }>(
    'delete from holds where score_id = $1 and connection_id = $2 returning staff_id',
    [scoreId, connectionId],
  );
  if (removed.length > 0) await publishHolds(scoreId);
}

export async function releaseCollaboratorHolds(
  scoreId: string,
  collaboratorId: string,
): Promise<void> {
  const removed = await query<{ staff_id: string }>(
    'delete from holds where score_id = $1 and collaborator_id = $2 returning staff_id',
    [scoreId, collaboratorId],
  );
  if (removed.length > 0) await publishHolds(scoreId);
}

/** Staff settings and part layout need the caller to hold every staff involved. */
export async function requireHolds(
  scoreId: string,
  caller: CollaboratorRow,
  staffIds: string[],
  staffNames: Map<string, string>,
): Promise<void> {
  const holds = await listHolds(scoreId);
  const byStaff = new Map(holds.map((hold) => [hold.staffId, hold]));
  const heldByOthers = staffIds.filter(
    (staffId) => byStaff.has(staffId) && byStaff.get(staffId)!.holder.id !== caller.id,
  );
  if (heldByOthers.length > 0) {
    const holder = byStaff.get(heldByOthers[0]!)!.holder;
    throw errors.staffHeld(
      holder,
      heldByOthers.map((staffId) => staffNames.get(staffId) ?? staffId),
      heldByOthers,
    );
  }
  const unheld = staffIds.filter((staffId) => !byStaff.has(staffId));
  if (unheld.length > 0) throw errors.holdRequired();
}
