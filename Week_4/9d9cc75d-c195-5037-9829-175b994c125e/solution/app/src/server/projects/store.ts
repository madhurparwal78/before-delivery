import type { Role } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import { newId } from '../db/ids.ts';

/** A new project; `members` pairs user ids with their roles. Returns its id. */
export async function createProject(
  tx: Queryable,
  name: string,
  members: readonly (readonly [string, Role])[],
  explorersSchedule: boolean,
): Promise<string> {
  const id = newId();
  await tx.exec(`INSERT INTO projects (id, name, explorers_schedule) VALUES ($1, $2, $3)`, [id, name, explorersSchedule]);
  for (const [userId, role] of members) await setMember(tx, id, userId, role);
  return id;
}

export function setMember(q: Queryable, projectId: string, userId: string, role: Role): Promise<number> {
  return q.exec(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [projectId, userId, role],
  );
}
