import { isWriter, type Role, type Visibility } from '../shared/types.ts';
import { forbidden } from './errors.ts';
import { only, type Db, type Row } from './db.ts';

export type MembershipState = Role | 'removed' | 'none';

/** Effective board access: the one place that turns membership state and board visibility into a role. */
export function boardRole(visibility: Visibility, state: MembershipState): Role | null {
  if (state === 'removed') return null;
  if (state === 'none') return visibility === 'workspace' ? 'observer' : null;
  return state;
}

export function requireWrite(role: Role): void {
  if (!isWriter(role)) throw forbidden();
}

export function requireAdmin(role: Role): void {
  if (role !== 'admin') throw forbidden();
}

interface BoardRow {
  id: string;
  workspaceId: string;
  name: string;
  visibility: Visibility;
  parentName: string;
  timeZone: string;
}

export interface BoardAccess {
  board: BoardRow;
  role: Role;
}

/** The board and the person's effective role on it, or null when the board does not exist for them. */
export async function boardAccess(db: Db, userId: string, boardId: string): Promise<BoardAccess | null> {
  const { rows } = await db.query<Row>(
    `SELECT b.id, b.workspace_id, b.name, b.visibility, w.parent_name, w.time_zone, COALESCE(bm.role, 'none') AS state
       FROM boards b
       JOIN workspaces w ON w.id = b.workspace_id
       JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $1
       LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
      WHERE b.id = $2`,
    [userId, boardId],
  );
  const row = rows[0];
  if (!row) return null;
  const visibility = row['visibility'] as Visibility;
  const role = boardRole(visibility, row['state'] as MembershipState);
  if (!role) return null;
  return {
    role,
    board: {
      id: row['id'] as string,
      workspaceId: row['workspace_id'] as string,
      name: row['name'] as string,
      visibility,
      parentName: row['parent_name'] as string,
      timeZone: row['time_zone'] as string,
    },
  };
}

/** The last-admin guard: how many admins other than this person hold the role in the workspace or on the board. */
export async function otherAdmins(db: Db, scope: { workspaceId: string } | { boardId: string }, userId: string): Promise<number> {
  const [table, column, id] = 'workspaceId' in scope ? ['workspace_members', 'workspace_id', scope.workspaceId] : ['board_members', 'board_id', scope.boardId];
  const { rows } = await db.query<Row>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1 AND role = 'admin' AND user_id <> $2`, [id, userId]);
  return only(rows)['n'] as number;
}
