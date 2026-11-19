import type { PoolClient } from 'pg';
import { one, pool, type Queryable } from './db';
import { forbidden, notFound, OWNER_ONLY, REVIEWER_ARTWORK, REVIEWER_DRAW, REVIEWER_EXPORT } from './errors';
import { loadSpriteRow, type SpriteRow } from './model';
import type { Role } from '../shared/rules';

export type Right = 'draw' | 'artwork' | 'export' | 'owner' | 'comment';

const REFUSALS: Record<Right, string | null> = {
  draw: REVIEWER_DRAW,
  artwork: REVIEWER_ARTWORK,
  export: REVIEWER_EXPORT,
  owner: OWNER_ONLY,
  comment: null,
};

/** Whether a role holds a right; the single place that decides it. */
export function holds(role: Role, right: Right): boolean {
  if (role === 'owner') return true;
  if (right === 'owner') return false;
  if (role === 'reviewer') return right === 'comment';
  return true;
}

export function require(role: Role, right: Right): void {
  if (!holds(role, right)) throw forbidden(role === 'reviewer' ? (REFUSALS[right] ?? OWNER_ONLY) : OWNER_ONLY);
}

export const asId = (value: string | undefined): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) throw notFound();
  return id;
};

/** The person's role in a project, or a 404 when they cannot open it. */
export async function roleIn(q: Queryable, userId: number, projectId: number): Promise<Role> {
  const row = await one<{ role: Role }>(q, 'SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  if (!row) throw notFound();
  return row.role;
}

export interface SpriteAccess {
  sprite: SpriteRow;
  role: Role;
}

export async function spriteAccess(userId: number, spriteId: number, q: Queryable | PoolClient = pool, lock = false): Promise<SpriteAccess> {
  const sprite = await loadSpriteRow(q, spriteId, lock);
  if (!sprite) throw notFound();
  return { sprite, role: await roleIn(q, userId, sprite.project_id) };
}
