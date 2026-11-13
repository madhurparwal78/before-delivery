import type { Role, User } from '../shared/types.js';
import { queryOne } from './db.js';
import { forbidden, notFound, unauthenticated } from './errors.js';
import type { Ctx } from './http.js';

export interface UserRow {
  id: string;
  email: string;
  email_lower: string;
  display_name: string;
  verified: boolean;
}

export interface NotebookRow {
  id: string;
  owner_id: string;
  title: string;
  imported: boolean;
  execution_counter: number;
  checkpoint_sequence: number;
  modified_at: Date;
}

export interface NotebookAccess {
  notebook: NotebookRow;
  role: Role;
  user: UserRow;
}

export function publicUser(user: UserRow): User {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    verified: user.verified,
  };
}

export async function sessionUser(ctx: Ctx): Promise<UserRow | null> {
  const sessionId = ctx.cookies.bp_session;
  if (!sessionId) return null;
  return queryOne<UserRow>(
    `select u.id, u.email, u.email_lower, u.display_name, u.verified
       from sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [sessionId],
  );
}

/** Step 1 of the error precedence: a missing or ended session. */
export async function requireUser(ctx: Ctx): Promise<UserRow> {
  const user = await sessionUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

export async function roleFor(notebook: NotebookRow, user: UserRow): Promise<Role | null> {
  if (notebook.owner_id === user.id) return 'owner';
  const share = await queryOne<{ role: Role }>(
    `select role from shares
      where notebook_id = $1 and status = 'active' and (user_id = $2 or email_lower = $3)`,
    [notebook.id, user.id, user.email_lower],
  );
  return share ? share.role : null;
}

/**
 * Step 2 of the error precedence: an unknown notebook, or one this person may
 * not open, is a 404 and never a 403.
 */
export async function requireNotebook(ctx: Ctx, notebookId: string): Promise<NotebookAccess> {
  const user = await requireUser(ctx);
  const notebook = await queryOne<NotebookRow>(
    `select id, owner_id, title, imported, execution_counter, checkpoint_sequence, modified_at
       from notebooks where id = $1`,
    [notebookId],
  );
  if (!notebook) throw notFound();
  const role = await roleFor(notebook, user);
  if (!role) throw notFound();
  return { notebook, role, user };
}

/** Step 3: a viewer may read, but not write or run. */
export function requireWriter(access: NotebookAccess): void {
  if (access.role === 'viewer') throw forbidden();
}

export function requireOwner(access: NotebookAccess): void {
  if (access.role !== 'owner') throw forbidden();
}
