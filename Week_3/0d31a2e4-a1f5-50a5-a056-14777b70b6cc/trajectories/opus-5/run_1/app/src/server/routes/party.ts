import { fail } from '../errors.js';
import { type Router, requireId, requireUser } from '../http/router.js';
import { lobbyPayload, pushLobby } from '../services/lobbies.js';
import {
  acceptInvite,
  declineInvite,
  handOverLeadership,
  invite,
  leaveLobby,
  leaveParty,
  loadParty,
  partyPayload,
  pushParty,
  pushPartyOf,
  queueParty,
  cancelQueue,
} from '../services/parties.js';
import { announcePresence } from '../services/presence.js';
import { toUser } from '../services/accounts.js';

export function registerPartyRoutes(router: Router): void {
  router.add(
    'GET',
    '/api/party',
    async (ctx) => ({ status: 200, body: await partyPayload(requireUser(ctx).id) }),
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/invites',
    async (ctx) => {
      const me = requireUser(ctx);
      const targetId = Number(ctx.body.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) throw fail.userNotFound();
      const outcome = await invite(me, targetId);
      await pushPartyOf(me.id);
      await pushPartyOf(outcome.targetId);
      return {
        status: outcome.created ? 201 : 200,
        body: {
          invite: {
            id: outcome.inviteId,
            to: toUser({ id: outcome.targetId, handle: outcome.handle }),
            sentAt: outcome.sentAt,
          },
        },
      };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/invites/:id/accept',
    async (ctx) => {
      const me = requireUser(ctx);
      const outcome = await acceptInvite(me, requireId(ctx, 'id'));
      const party = await loadParty(outcome.partyId);
      if (party === null) throw fail.internal();
      await pushParty(outcome.partyId);
      await pushParty(outcome.previousPartyId);
      for (const userId of outcome.affectedUserIds) await pushPartyOf(userId);
      await announcePresence([...outcome.affectedUserIds, me.id]);
      return { status: 200, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/invites/:id/decline',
    async (ctx) => {
      const me = requireUser(ctx);
      const inviterId = await declineInvite(me, requireId(ctx, 'id'));
      await pushPartyOf(me.id);
      await pushPartyOf(inviterId);
      return { status: 204 };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/leave',
    async (ctx) => {
      const me = requireUser(ctx);
      const outcome = await leaveParty(me);
      const party = await loadParty(outcome.newPartyId);
      if (party === null) throw fail.internal();
      await pushParty(outcome.previousPartyId);
      await pushParty(outcome.newPartyId);
      if (outcome.lobbyId !== null) await pushLobby(outcome.lobbyId);
      await announcePresence([me.id, ...outcome.remainingUserIds]);
      return { status: 200, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/leader',
    async (ctx) => {
      const me = requireUser(ctx);
      const targetId = Number(ctx.body.userId);
      const partyId = await handOverLeadership(me, targetId);
      const party = await loadParty(partyId);
      if (party === null) throw fail.internal();
      await pushParty(partyId);
      return { status: 200, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/queue',
    async (ctx) => {
      const me = requireUser(ctx);
      const partyId = await queueParty(me);
      const party = await loadParty(partyId);
      if (party === null) throw fail.internal();
      await pushParty(partyId);
      await announcePresence(party.members.map((member) => member.user.id));
      return { status: 202, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/party/queue/cancel',
    async (ctx) => {
      const me = requireUser(ctx);
      const partyId = await cancelQueue(me);
      const party = await loadParty(partyId);
      if (party === null) throw fail.internal();
      await pushParty(partyId);
      await announcePresence(party.members.map((member) => member.user.id));
      return { status: 200, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'POST',
    '/api/lobby/leave',
    async (ctx) => {
      const me = requireUser(ctx);
      const outcome = await leaveLobby(me);
      const party = await loadParty(outcome.partyId);
      if (party === null) throw fail.internal();
      await pushParty(outcome.partyId);
      await pushLobby(outcome.lobbyId);
      await announcePresence(party.members.map((member) => member.user.id));
      return { status: 200, body: { party } };
    },
    { gated: true },
  );

  router.add(
    'GET',
    '/api/lobbies/:id',
    async (ctx) => {
      const lobby = await lobbyPayload(requireId(ctx, 'id'));
      if (lobby === null) throw fail.lobbyNotFound();
      return { status: 200, body: { lobby } };
    },
    { gated: true },
  );
}
