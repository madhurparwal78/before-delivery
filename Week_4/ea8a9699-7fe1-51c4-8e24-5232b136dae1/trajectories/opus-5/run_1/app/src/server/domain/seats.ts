import type { PoolClient } from 'pg';
import { lock, transact } from '../db.js';
import { errors } from '../errors.js';
import { currentPlan } from './plan.js';
import type { WorkspaceRow } from '../auth.js';

export interface SeatOutcome {
  created: boolean;
  seatsUsed: number;
  seatCap: number;
}

async function countSeats(client: PoolClient, workspaceId: string): Promise<number> {
  const result = await client.query<{ used: number }>('select count(*)::int as used from seats where workspace_id = $1', [
    workspaceId,
  ]);
  return result.rows[0].used;
}

/**
 * The one place that enforces the seat cap. Assignments race safely across instances: exactly as
 * many succeed as there are seats left.
 */
export async function assignSeat(workspace: WorkspaceRow, memberId: string): Promise<SeatOutcome> {
  const { seatCap } = await currentPlan(workspace);
  return transact(async (client) => {
    await lock(client, 'seats', workspace.id);
    const already = await client.query('select 1 from seats where workspace_id = $1 and account_id = $2', [
      workspace.id,
      memberId,
    ]);
    if (already.rowCount !== null && already.rowCount > 0) {
      return { created: false, seatsUsed: await countSeats(client, workspace.id), seatCap };
    }
    const used = await countSeats(client, workspace.id);
    if (used >= seatCap) {
      throw errors.noSeatsLeft();
    }
    await client.query('insert into seats (workspace_id, account_id) values ($1, $2)', [workspace.id, memberId]);
    return { created: true, seatsUsed: used + 1, seatCap };
  });
}

export async function freeSeat(workspace: WorkspaceRow, memberId: string): Promise<SeatOutcome> {
  const { seatCap } = await currentPlan(workspace);
  return transact(async (client) => {
    await lock(client, 'seats', workspace.id);
    await client.query('delete from seats where workspace_id = $1 and account_id = $2', [workspace.id, memberId]);
    return { created: false, seatsUsed: await countSeats(client, workspace.id), seatCap };
  });
}
