import type { SessionSnapshot } from '../../shared/wire';
import { authenticate, learnerIdOf, openSession, type OpenedSession } from '../access';
import { param, reply, type Ctx, type Reply } from '../http';
import { buildSnapshot, type Viewer } from '../live/snapshot';

export async function sessionOf(ctx: Ctx): Promise<OpenedSession> {
  return openSession(await authenticate(ctx.req), param(ctx.params, 'id'));
}

function viewerOf(opened: OpenedSession): Viewer {
  return { role: opened.role, learnerId: learnerIdOf(opened.caller) };
}

export async function snapshotOf(opened: OpenedSession): Promise<SessionSnapshot> {
  return buildSnapshot(opened.session.id, viewerOf(opened));
}

export async function snapshotReply(opened: OpenedSession, status = 200): Promise<Reply> {
  return reply(status, await snapshotOf(opened));
}
