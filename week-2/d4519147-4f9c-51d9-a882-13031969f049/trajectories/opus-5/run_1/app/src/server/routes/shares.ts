import { withTransaction } from '../db';
import { deliverQueuedMessages } from '../services/queue';
import { errors } from '../http/errors';
import type { AuthedCtx, Params, Reply, Route } from '../http/router';
import { requireAccess, requireRole, isUuid } from '../domain/access';
import {
  changeShareRole,
  createInvitation,
  inviteRateState,
  isValidEmail,
  listShares,
  loadShareForUpdate,
  normalizeEmail,
  removeShare,
  type InviteContext,
} from '../domain/shares';

function readRole(json: unknown): 'editor' | 'viewer' {
  const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  if (body.role === 'editor' || body.role === 'viewer') return body.role;
  throw errors.validation({ role: 'invalid' });
}

async function contextFor(ctx: AuthedCtx, params: Params): Promise<InviteContext> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'owner');
  return {
    diagramId: access.diagramId,
    diagramTitle: access.title,
    inviterName: access.ownerName,
    actorEmail: ctx.session.user.email,
  };
}

async function list(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const context = await contextFor(ctx, params);
  return { status: 200, body: { shares: await listShares(context.diagramId) } };
}

async function invite(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const context = await contextFor(ctx, params);
  const rate = await inviteRateState(context.diagramId);
  if (rate.limited) {
    throw errors.rateLimited('invite_rate_limited', 'Too many invitations sent.', rate.retryAfterSeconds);
  }
  const body = typeof ctx.json === 'object' && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {};
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const role = readRole(ctx.json);
  if (!isValidEmail(rawEmail)) throw errors.validation({ email: 'invalid' });
  const email = normalizeEmail(rawEmail);
  if (email === ctx.session.user.email.toLowerCase()) {
    throw errors.conflict('already_member', 'This person already has access.');
  }
  const share = await withTransaction((client) => createInvitation(client, context, email, role));
  void deliverQueuedMessages().catch(() => undefined);
  return { status: 201, body: { share } };
}

async function changeRole(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const context = await contextFor(ctx, params);
  const shareId = params.shareId ?? '';
  if (!isUuid(shareId)) throw errors.notFound();
  const role = readRole(ctx.json);
  const share = await withTransaction(async (client) => {
    const row = await loadShareForUpdate(client, context.diagramId, shareId);
    if (!row) throw errors.notFound();
    return changeShareRole(client, context, row, role);
  });
  void deliverQueuedMessages().catch(() => undefined);
  return { status: 200, body: { share } };
}

async function remove(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const context = await contextFor(ctx, params);
  const shareId = params.shareId ?? '';
  if (!isUuid(shareId)) throw errors.notFound();
  await withTransaction(async (client) => {
    const row = await loadShareForUpdate(client, context.diagramId, shareId);
    if (!row) throw errors.notFound();
    await removeShare(client, context, row);
  });
  void deliverQueuedMessages().catch(() => undefined);
  return { status: 204 };
}

export const shareRoutes: Route[] = [
  { method: 'GET', pattern: '/api/diagrams/:id/shares', auth: true, handler: list },
  { method: 'POST', pattern: '/api/diagrams/:id/shares', auth: true, body: 'json', handler: invite },
  { method: 'PATCH', pattern: '/api/diagrams/:id/shares/:shareId', auth: true, body: 'json', handler: changeRole },
  { method: 'DELETE', pattern: '/api/diagrams/:id/shares/:shareId', auth: true, handler: remove },
];
