import { query, transaction, type Client } from '../db.js';
import { config } from '../config.js';
import { Router, type Ctx } from '../http/core.js';
import { VALIDATION_MESSAGES, fail, failValidation } from '../http/errors.js';
import {
  isMember,
  liveQuestId,
  loadInvites,
  loadParty,
  memberCount,
  memberIds,
  partyJson,
  pendingInviteCount,
} from '../services/party.js';
import { loadUser, loadUserByUsername, partyIdOf, type UserRow } from '../services/player.js';
import { publishInvites, publishParty, publishPlayer } from '../services/notify.js';
import { addParticipants } from '../services/quest.js';

async function currentUser(ctx: Ctx): Promise<UserRow> {
  const session = ctx.requireUser();
  const user = await loadUser({ query }, session.id);
  if (!user) throw fail('unauthenticated');
  return user;
}

/** A party the Player is not in answers exactly like one that does not exist. */
export async function requireMembership(client: Client, partyId: string, userId: string): Promise<void> {
  const party = await loadParty(client, partyId);
  if (!party) throw fail('not_found');
  if (!(await isMember(client, partyId, userId))) throw fail('not_found');
}

export async function requireLeader(client: Client, partyId: string, userId: string): Promise<void> {
  await requireMembership(client, partyId, userId);
  const party = await loadParty(client, partyId);
  if (!party || party.leader_id !== userId) throw fail('leader_only');
}

export function registerPartyRoutes(router: Router): void {
  router.add('POST', '/api/parties', async (ctx) => {
    const user = await currentUser(ctx);
    if (await partyIdOf({ query }, user.id)) throw fail('already_in_party');
    const body = ctx.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 40) throw failValidation({ name: VALIDATION_MESSAGES.name });

    const party = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        'insert into parties (name, leader_id) values ($1, $2) returning id',
        [name, user.id],
      );
      const partyId = created.rows[0]?.id as string;
      await client.query('insert into party_members (party_id, user_id) values ($1, $2)', [partyId, user.id]);
      return partyJson(client, partyId);
    });
    await publishParty({ query }, (party as { id: string }).id);
    await publishPlayer({ query }, user.id);
    ctx.send(201, party);
  });

  router.add('GET', '/api/party', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = await partyIdOf({ query }, user.id);
    ctx.send(200, { party: partyId ? await partyJson({ query }, partyId) : null });
  });

  router.add('GET', '/api/parties/:id', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireMembership({ query }, partyId, user.id);
    ctx.send(200, await partyJson({ query }, partyId));
  });

  router.add('POST', '/api/parties/:id/invites', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireLeader({ query }, partyId, user.id);

    const members = await memberCount({ query }, partyId);
    const pending = await pendingInviteCount({ query }, partyId);
    if (members + pending + 1 > config.partyMaxMembers) throw fail('party_full');

    const body = ctx.json();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const target = await loadUserByUsername({ query }, username);
    if (!target) throw failValidation({ username: VALIDATION_MESSAGES.inviteTarget });
    if (await partyIdOf({ query }, target.id)) throw fail('already_in_party');
    const existing = await query('select 1 from party_invites where party_id = $1 and user_id = $2', [
      partyId,
      target.id,
    ]);
    if (existing.rowCount === 1) throw fail('already_invited');

    const invite = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        'insert into party_invites (party_id, user_id) values ($1, $2) returning id',
        [partyId, target.id],
      );
      return created.rows[0]?.id as string;
    });
    const party = await partyJson({ query }, partyId);
    await publishParty({ query }, partyId);
    await publishInvites({ query }, target.id);
    ctx.send(201, { id: invite, party, username: target.username });
  });

  router.add('GET', '/api/invites', async (ctx) => {
    const user = await currentUser(ctx);
    ctx.send(200, { invites: await loadInvites({ query }, user.id) });
  });

  router.add('POST', '/api/invites/:id/accept', async (ctx) => {
    const user = await currentUser(ctx);
    const inviteId = ctx.param('id');
    const found = await query<{ party_id: string }>(
      'select party_id from party_invites where id = $1 and user_id = $2',
      [inviteId, user.id],
    );
    const invite = found.rows[0];
    if (!invite) throw fail('not_found');
    if (await partyIdOf({ query }, user.id)) throw fail('already_in_party');
    if ((await memberCount({ query }, invite.party_id)) + 1 > config.partyMaxMembers) throw fail('party_full');

    const party = await transaction(async (client) => {
      await client.query('insert into party_members (party_id, user_id) values ($1, $2)', [
        invite.party_id,
        user.id,
      ]);
      await client.query('delete from party_invites where user_id = $1', [user.id]);
      const quest = await liveQuestId(client, invite.party_id);
      if (quest) await addParticipants(client, quest, [user.id]);
      return partyJson(client, invite.party_id);
    });
    await publishParty({ query }, invite.party_id);
    await publishInvites({ query }, user.id);
    await publishPlayer({ query }, user.id);
    ctx.send(200, party);
  });

  router.add('POST', '/api/invites/:id/decline', async (ctx) => {
    const user = await currentUser(ctx);
    const removed = await query<{ party_id: string }>(
      'delete from party_invites where id = $1 and user_id = $2 returning party_id',
      [ctx.param('id'), user.id],
    );
    const invite = removed.rows[0];
    if (!invite) throw fail('not_found');
    await publishInvites({ query }, user.id);
    await publishParty({ query }, invite.party_id);
    ctx.sendEmpty(204);
  });

  router.add('POST', '/api/parties/:id/leave', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireMembership({ query }, partyId, user.id);
    await transaction(async (client) => {
      await client.query('delete from party_members where party_id = $1 and user_id = $2', [partyId, user.id]);
      const rest = await memberIds(client, partyId);
      if (rest.length === 0) {
        await client.query('delete from parties where id = $1', [partyId]);
        return;
      }
      const party = await loadParty(client, partyId);
      if (party && party.leader_id === user.id) {
        await client.query('update parties set leader_id = $2 where id = $1', [partyId, rest[0] as string]);
      }
    });
    await publishParty({ query }, partyId, [user.id]);
    await publishPlayer({ query }, user.id);
    ctx.sendEmpty(204);
  });

  router.add('GET', '/api/parties/:id/chat', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireMembership({ query }, partyId, user.id);
    const found = await query<{ id: string; username: string; text: string; created_at: Date }>(
      `select m.id, u.username, m.text, m.created_at from chat_messages m join users u on u.id = m.user_id
       where m.party_id = $1 order by m.seq desc limit 100`,
      [partyId],
    );
    const messages = found.rows
      .map((row) => ({
        id: row.id,
        username: row.username,
        text: row.text,
        createdAt: row.created_at.toISOString(),
      }))
      .reverse();
    ctx.send(200, { messages });
  });
}
