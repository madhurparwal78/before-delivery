import { config } from './config.js';
import { queryOne } from './db.js';
import { accessRemoved, forbidden, notFound, sessionEnded, unauthenticated } from './http/errors.js';
import type { Ctx } from './http/router.js';
import { can, type Action, type Role } from '../shared/roles.js';

export const SESSION_COOKIE = 'tw_session';

export interface Actor {
  readonly sessionId: string;
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly yachtId: string | null;
}

interface SessionRow {
  readonly session_id: string;
  readonly member_id: string | null;
  readonly created_at: Date;
  readonly signed_out_at: Date | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: string | null;
  readonly workspace_id: string | null;
  readonly workspace_slug: string | null;
  readonly workspace_name: string | null;
  readonly yacht_id: string | null;
}

export async function loadActor(ctx: Ctx): Promise<Actor> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token === undefined) throw unauthenticated();
  const found = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, s.member_id, s.created_at, s.signed_out_at,
            m.name, m.email, m.role, m.yacht_id,
            w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name
       FROM sessions s
       LEFT JOIN members m ON m.id = s.member_id
       LEFT JOIN workspaces w ON w.id = m.workspace_id
      WHERE s.id = $1`,
    [token],
  );
  if (found === null) throw unauthenticated();
  if (found.member_id === null) throw accessRemoved();
  if (found.signed_out_at !== null) throw sessionEnded();
  const endsAt = found.created_at.getTime() + config.timers.sessionSeconds * 1000;
  if (ctx.now.getTime() >= endsAt) throw sessionEnded();
  return {
    sessionId: found.session_id,
    id: found.member_id,
    name: found.name as string,
    email: found.email as string,
    role: found.role as Role,
    workspaceId: found.workspace_id as string,
    workspaceSlug: found.workspace_slug as string,
    workspaceName: found.workspace_name as string,
    yachtId: found.yacht_id,
  };
}

export async function actorInWorkspace(ctx: Ctx): Promise<Actor> {
  const actor = await loadActor(ctx);
  if (ctx.params.ws !== actor.workspaceSlug) throw notFound();
  return actor;
}

export function requireAction(actor: Actor, action: Action): void {
  if (!can(actor.role, action)) throw forbidden();
}
