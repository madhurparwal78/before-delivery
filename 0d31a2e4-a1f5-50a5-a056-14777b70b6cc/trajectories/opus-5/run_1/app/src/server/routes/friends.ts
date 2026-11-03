import { fail } from '../errors.js';
import { type Router, requireId, requireUser } from '../http/router.js';
import { findByHandle, toUser } from '../services/accounts.js';
import {
  acceptRequest,
  blockUser,
  declineRequest,
  friendsPayload,
  friendshipWith,
  removeFriend,
  sendRequest,
  unblockUser,
  withdrawRequest,
} from '../services/friends.js';
import { hub } from '../ws/hub.js';
import { pushParty, pushPartyOf } from '../services/parties.js';
import { announcePresence, presenceOf } from '../services/presence.js';
import { profileCounts, profileMatches } from '../services/matches.js';

function hintFriends(userIds: readonly number[]): void {
  hub.broadcast(userIds, { type: 'friends' });
}

export function registerFriendRoutes(router: Router): void {
  router.add('GET', '/api/users/:handle', async (ctx) => {
    const me = requireUser(ctx);
    const target = await findByHandle(ctx.params.handle);
    if (target === null) throw fail.userNotFound();
    const friendship = await friendshipWith(me.id, target.id);
    const counts = await profileCounts(target.id);
    return {
      status: 200,
      body: {
        user: toUser(target),
        friendship,
        presence: friendship === 'friends' ? await presenceOf(target.id) : null,
        played: counts.played,
        wins: counts.wins,
        matches: await profileMatches(target.id),
      },
    };
  });

  router.add(
    'GET',
    '/api/friends',
    async (ctx) => ({ status: 200, body: await friendsPayload(requireUser(ctx).id) }),
    { gated: true },
  );

  router.add(
    'POST',
    '/api/friends/requests',
    async (ctx) => {
      const me = requireUser(ctx);
      const handle = typeof ctx.body.handle === 'string' ? ctx.body.handle : '';
      const outcome = await sendRequest(me, handle);
      if (outcome.kind === 'merged') {
        hintFriends([me.id, outcome.friendship.user.id]);
        await announcePresence([me.id, outcome.friendship.user.id]);
        return { status: 200, body: { friendship: outcome.friendship } };
      }
      hintFriends([me.id, outcome.request.to.id]);
      return {
        status: outcome.kind === 'created' ? 201 : 200,
        body: { request: outcome.request },
      };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/friends/requests/:id/accept',
    async (ctx) => {
      const me = requireUser(ctx);
      const outcome = await acceptRequest(me, requireId(ctx, 'id'));
      hintFriends([me.id, outcome.otherId]);
      await announcePresence([me.id, outcome.otherId]);
      return { status: 200, body: { friendship: outcome.friendship } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/friends/requests/:id/decline',
    async (ctx) => {
      const me = requireUser(ctx);
      const otherId = await declineRequest(me, requireId(ctx, 'id'));
      hintFriends([me.id, otherId]);
      return { status: 204 };
    },
    { gated: true },
  );

  router.add(
    'DELETE',
    '/api/friends/requests/:id',
    async (ctx) => {
      const me = requireUser(ctx);
      const otherId = await withdrawRequest(me, requireId(ctx, 'id'));
      hintFriends([me.id, otherId]);
      return { status: 204 };
    },
    { gated: true },
  );

  router.add(
    'DELETE',
    '/api/friends/:userId',
    async (ctx) => {
      const me = requireUser(ctx);
      const otherId = requireId(ctx, 'userId');
      await removeFriend(me, otherId);
      hintFriends([me.id, otherId]);
      return { status: 204 };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/blocks',
    async (ctx) => {
      const me = requireUser(ctx);
      const targetId = Number(ctx.body.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) throw fail.userNotFound();
      const outcome = await blockUser(me, targetId);
      if (outcome.created) {
        hintFriends([me.id, targetId]);
        for (const partyId of outcome.cancelledInvitePartyIds) await pushParty(partyId);
        await pushPartyOf(targetId);
        await pushPartyOf(me.id);
      }
      return {
        status: outcome.created ? 201 : 200,
        body: { blocked: outcome.blocked },
      };
    },
    { gated: true },
  );

  router.add(
    'DELETE',
    '/api/blocks/:userId',
    async (ctx) => {
      const me = requireUser(ctx);
      const targetId = requireId(ctx, 'userId');
      await unblockUser(me, targetId);
      hintFriends([me.id, targetId]);
      return { status: 204 };
    },
    { gated: true },
  );
}
