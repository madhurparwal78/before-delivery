import type * as pg from 'pg';
import { randomId } from './util';
import { OPERATOR_POCKETBASE_ID } from './operatorIdentity';

export interface ManagerRow {
  id: string;
  pocketbase_id: string;
  team_name: string;
  role: 'manager' | 'operator';
}

export async function createSession(client: pg.PoolClient, managerId: string): Promise<string> {
  const id = `s_${randomId(24)}`;
  await client.query('INSERT INTO sessions (id, manager_id) VALUES ($1, $2)', [id, managerId]);
  return id;
}

export async function findSession(client: pg.PoolClient, sessionId: string): Promise<ManagerRow | null> {
  const result = await client.query<{ id: string; pocketbase_id: string; team_name: string }>(
    `SELECT m.id, m.pocketbase_id, m.team_name
       FROM sessions s JOIN managers m ON m.id = s.manager_id
      WHERE s.id = $1`,
    [sessionId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const role = row.pocketbase_id === OPERATOR_POCKETBASE_ID() ? 'operator' : 'manager';
  return { id: row.id, pocketbase_id: row.pocketbase_id, team_name: row.team_name, role };
}

export async function deleteSession(client: pg.PoolClient, sessionId: string): Promise<void> {
  await client.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
