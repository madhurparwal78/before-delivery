import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { pool, transaction } from '../db.js';
import { accept, block, blockedMembers, connect, ignore, remove, unblock, withdraw } from '../domain/connections.js';
import { follow, unfollow } from '../domain/follows.js';
import { networkFor } from '../domain/network.js';
import { config } from '../config.js';
import { conflict, validation } from '../errors.js';

interface MemberBody {
  member_id?: unknown;
  member_ids?: unknown;
  target_id?: unknown;
}

function memberIdOf(body: MemberBody | null): string {
  if (typeof body?.member_id !== 'string') throw validation({ member_id: 'Choose a member.' });
  return body.member_id;
}

function memberIdsOf(body: MemberBody | null): string[] {
  const ids = body?.member_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > config.maxWithdrawBatch || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw validation({ member_ids: 'Choose 1 to 50 invitations.' });
  }
  return ids as string[];
}

export async function networkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/network', async (request) => networkFor(pool, memberOf(request).id));

  app.post<{ Body: MemberBody | null }>('/api/connections', async (request, reply) => {
    const viewerId = memberOf(request).id;
    const memberId = memberIdOf(request.body);
    const result = await transaction((tx) => connect(tx, viewerId, memberId));
    return reply.status(result.status).send({ state: result.state });
  });

  app.post<{ Params: { member_id: string } }>('/api/connections/:member_id/withdraw', async (request) => {
    const viewerId = memberOf(request).id;
    const [withdrawn] = await transaction((tx) => withdraw(tx, viewerId, [request.params.member_id], () => conflict('no_pending_request')));
    return { state: withdrawn.state, retry_at: withdrawn.retry_at };
  });

  app.post<{ Body: MemberBody | null }>('/api/invitations/withdraw', async (request) => {
    const viewerId = memberOf(request).id;
    const memberIds = memberIdsOf(request.body);
    const withdrawn = await transaction((tx) => withdraw(tx, viewerId, memberIds, (memberId) => conflict('not_pending', { member_id: memberId })));
    return { withdrawn: withdrawn.map((entry) => entry.member_id), retry_at: withdrawn[0].retry_at };
  });

  app.post<{ Params: { member_id: string } }>('/api/connections/:member_id/accept', async (request) => {
    const viewerId = memberOf(request).id;
    return { state: await transaction((tx) => accept(tx, viewerId, request.params.member_id)) };
  });

  app.post<{ Params: { member_id: string } }>('/api/connections/:member_id/ignore', async (request) => {
    const viewerId = memberOf(request).id;
    return { state: await transaction((tx) => ignore(tx, viewerId, request.params.member_id)) };
  });

  app.delete<{ Params: { member_id: string } }>('/api/connections/:member_id', async (request) => {
    const viewerId = memberOf(request).id;
    return { state: await transaction((tx) => remove(tx, viewerId, request.params.member_id)) };
  });

  app.get('/api/blocks', async (request) => ({ blocked: await blockedMembers(pool, memberOf(request).id) }));

  app.post<{ Body: MemberBody | null }>('/api/blocks', async (request, reply) => {
    const viewerId = memberOf(request).id;
    const memberId = memberIdOf(request.body);
    const created = await transaction((tx) => block(tx, viewerId, memberId));
    return reply.status(created ? 201 : 200).send({ blocked: true });
  });

  app.delete<{ Params: { member_id: string } }>('/api/blocks/:member_id', async (request) => {
    const viewerId = memberOf(request).id;
    await transaction((tx) => unblock(tx, viewerId, request.params.member_id));
    return { blocked: false };
  });

  app.post<{ Body: MemberBody | null }>('/api/follows', async (request, reply) => {
    const viewerId = memberOf(request).id;
    const created = await transaction((tx) => follow(tx, viewerId, request.body?.target_id));
    return reply.status(created ? 201 : 200).send({ following: true });
  });

  app.delete<{ Params: { target_id: string } }>('/api/follows/:target_id', async (request) => {
    await unfollow(pool, memberOf(request).id, request.params.target_id);
    return { following: false };
  });
}
