import { PARTY_MAX } from '../../shared/rounds.js';
import type { Party, PartyPayload, PartyState } from '../../shared/types.js';
import { type Tx, query, queryOne, transaction } from '../db.js';
import { fail, invalidTransition, validationFailed } from '../errors.js';
import { hub } from '../ws/hub.js';
import { type UserRow, toUser } from './accounts.js';
import { releaseSeats } from './lobbies.js';

interface PartyRow {
  id: number;
  state: PartyState;
  leader_id: number;
  lobby_id: number | null;
  match_id: number | null;
  queued_at: Date | null;
}

interface MemberRow {
  user_id: number;
  handle: string;
  joined_at: Date;
}

const PARTY_COLUMNS = 'id, state, leader_id, lobby_id, match_id, queued_at';

export async function createSoloParty(tx: Tx, userId: number): Promise<number> {
  const party = await tx.queryOne<{ id: number }>(
    `INSERT INTO parties (leader_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  if (party === null) throw fail.internal();
  await tx.query('INSERT INTO party_members (party_id, user_id) VALUES ($1, $2)', [
    party.id,
    userId,
  ]);
  return party.id;
}

async function membersOf(tx: Tx, partyId: number): Promise<MemberRow[]> {
  return tx.query<MemberRow>(
    `SELECT m.user_id, u.handle, m.joined_at FROM party_members m
     JOIN users u ON u.id = m.user_id WHERE m.party_id = $1
     ORDER BY m.joined_at, m.user_id`,
    [partyId],
  );
}

async function lockPartyOf(tx: Tx, userId: number): Promise<PartyRow> {
  const row = await tx.queryOne<PartyRow>(
    `SELECT ${PARTY_COLUMNS} FROM parties
     WHERE id = (SELECT party_id FROM party_members WHERE user_id = $1) FOR UPDATE`,
    [userId],
  );
  if (row === null) throw fail.internal();
  return row;
}

async function lockParty(tx: Tx, partyId: number): Promise<PartyRow | null> {
  return tx.queryOne<PartyRow>(`SELECT ${PARTY_COLUMNS} FROM parties WHERE id = $1 FOR UPDATE`, [
    partyId,
  ]);
}

export async function partyIdOf(userId: number): Promise<number> {
  const row = await queryOne<{ party_id: number }>(
    'SELECT party_id FROM party_members WHERE user_id = $1',
    [userId],
  );
  if (row === null) throw fail.internal();
  return row.party_id;
}

export async function memberIds(partyId: number): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    'SELECT user_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, user_id',
    [partyId],
  );
  return rows.map((row) => row.user_id);
}

export async function loadParty(partyId: number): Promise<Party | null> {
  const row = await queryOne<PartyRow>(`SELECT ${PARTY_COLUMNS} FROM parties WHERE id = $1`, [
    partyId,
  ]);
  if (row === null) return null;
  const members = await query<MemberRow>(
    `SELECT m.user_id, u.handle, m.joined_at FROM party_members m
     JOIN users u ON u.id = m.user_id WHERE m.party_id = $1 ORDER BY m.joined_at, m.user_id`,
    [partyId],
  );
  return {
    id: row.id,
    state: row.state,
    leaderId: row.leader_id,
    members: members.map((member) => ({
      user: toUser({ id: member.user_id, handle: member.handle }),
      joinedAt: member.joined_at.toISOString(),
    })),
    lobbyId: row.lobby_id,
    matchId: row.match_id,
    queuedAt: row.queued_at?.toISOString() ?? null,
  };
}

export async function partyPayload(userId: number): Promise<PartyPayload> {
  const partyId = await partyIdOf(userId);
  const party = await loadParty(partyId);
  if (party === null) throw fail.internal();
  const incoming = await query<{
    id: number;
    party_id: number;
    from_id: number;
    handle: string;
    sent_at: Date;
  }>(
    `SELECT i.id, i.party_id, u.id AS from_id, u.handle, i.sent_at
     FROM party_invites i JOIN users u ON u.id = i.from_user_id
     WHERE i.to_user_id = $1 ORDER BY i.id`,
    [userId],
  );
  const outgoing = await query<{ id: number; to_id: number; handle: string; sent_at: Date }>(
    `SELECT i.id, u.id AS to_id, u.handle, i.sent_at
     FROM party_invites i JOIN users u ON u.id = i.to_user_id
     WHERE i.from_user_id = $1 ORDER BY i.id`,
    [userId],
  );
  return {
    party,
    invites: {
      incoming: incoming.map((row) => ({
        id: row.id,
        from: toUser({ id: row.from_id, handle: row.handle }),
        partyId: row.party_id,
        sentAt: row.sent_at.toISOString(),
      })),
      outgoing: outgoing.map((row) => ({
        id: row.id,
        to: toUser({ id: row.to_id, handle: row.handle }),
        sentAt: row.sent_at.toISOString(),
      })),
    },
  };
}

export async function pushParty(partyId: number): Promise<void> {
  const party = await loadParty(partyId);
  if (party === null) return;
  hub.broadcast(
    party.members.map((member) => member.user.id),
    { type: 'party', party },
  );
}

export async function pushPartyOf(userId: number): Promise<void> {
  await pushParty(await partyIdOf(userId));
}

/**
 * Takes a member out of a party: leadership passes to the member who joined
 * earliest, and an empty party is gone.
 */
async function detachMember(tx: Tx, party: PartyRow, userId: number): Promise<void> {
  await tx.query('DELETE FROM party_members WHERE party_id = $1 AND user_id = $2', [
    party.id,
    userId,
  ]);
  await tx.query('DELETE FROM party_invites WHERE from_user_id = $1', [userId]);
  const remaining = await membersOf(tx, party.id);
  if (remaining.length === 0) {
    await tx.query('DELETE FROM parties WHERE id = $1', [party.id]);
    return;
  }
  if (party.leader_id === userId) {
    const heir = remaining[0];
    await tx.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [party.id, heir.user_id]);
  }
}

export interface InviteOutcome {
  created: boolean;
  inviteId: number;
  sentAt: string;
  targetId: number;
  handle: string;
}

export async function invite(me: UserRow, targetId: number): Promise<InviteOutcome> {
  const target = await queryOne<{ id: number; handle: string }>(
    'SELECT id, handle FROM users WHERE id = $1',
    [targetId],
  );
  if (target === null) throw fail.userNotFound();
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    if (party.leader_id !== me.id) throw fail.notLeader();
    if (party.state !== 'idle') throw fail.partyBusy();
    const members = await membersOf(tx, party.id);
    if (members.some((member) => member.user_id === target.id)) throw fail.alreadyInParty();
    const friendship = await tx.queryOne<{ ok: boolean }>(
      `SELECT true AS ok FROM friendships WHERE low_user_id = $1 AND high_user_id = $2`,
      [Math.min(me.id, target.id), Math.max(me.id, target.id)],
    );
    const block = await tx.queryOne<{ ok: boolean }>(
      `SELECT true AS ok FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [me.id, target.id],
    );
    if (friendship === null || block !== null) throw fail.notFriendsForbidden();
    if (members.length >= PARTY_MAX) throw fail.partyFull();
    const existing = await tx.queryOne<{ id: number; sent_at: Date }>(
      `SELECT id, sent_at FROM party_invites WHERE party_id = $1 AND to_user_id = $2`,
      [party.id, target.id],
    );
    if (existing !== null) {
      return {
        created: false,
        inviteId: existing.id,
        sentAt: existing.sent_at.toISOString(),
        targetId: target.id,
        handle: target.handle,
      };
    }
    const created = await tx.queryOne<{ id: number; sent_at: Date }>(
      `INSERT INTO party_invites (party_id, from_user_id, to_user_id) VALUES ($1, $2, $3)
       RETURNING id, sent_at`,
      [party.id, me.id, target.id],
    );
    if (created === null) throw fail.internal();
    return {
      created: true,
      inviteId: created.id,
      sentAt: created.sent_at.toISOString(),
      targetId: target.id,
      handle: target.handle,
    };
  });
}

export interface JoinOutcome {
  partyId: number;
  previousPartyId: number;
  inviterId: number;
  affectedUserIds: number[];
}

export async function acceptInvite(me: UserRow, inviteId: number): Promise<JoinOutcome> {
  return transaction(async (tx) => {
    const invite = await tx.queryOne<{ party_id: number; from_user_id: number }>(
      `SELECT party_id, from_user_id FROM party_invites WHERE id = $1 AND to_user_id = $2`,
      [inviteId, me.id],
    );
    if (invite === null) throw fail.inviteNotFound();
    const myPartyId = await partyIdOf(me.id);
    await tx.query('SELECT id FROM parties WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [
      [myPartyId, invite.party_id],
    ]);
    const mine = await lockParty(tx, myPartyId);
    const target = await lockParty(tx, invite.party_id);
    if (mine === null || target === null) throw fail.inviteNotFound();
    if (target.id === mine.id) throw fail.alreadyInParty();
    if (target.state !== 'idle' || mine.state !== 'idle') throw fail.partyBusy();
    const targetMembers = await membersOf(tx, target.id);
    if (targetMembers.length >= PARTY_MAX) throw fail.partyFull();
    const leaving = await membersOf(tx, mine.id);
    await tx.query('DELETE FROM party_invites WHERE id = $1', [inviteId]);
    await detachMember(tx, mine, me.id);
    await tx.query('INSERT INTO party_members (party_id, user_id) VALUES ($1, $2)', [
      target.id,
      me.id,
    ]);
    return {
      partyId: target.id,
      previousPartyId: mine.id,
      inviterId: invite.from_user_id,
      affectedUserIds: [
        ...targetMembers.map((member) => member.user_id),
        ...leaving.map((member) => member.user_id),
      ],
    };
  });
}

export async function declineInvite(me: UserRow, inviteId: number): Promise<number> {
  const row = await queryOne<{ from_user_id: number }>(
    `DELETE FROM party_invites WHERE id = $1 AND to_user_id = $2 RETURNING from_user_id`,
    [inviteId, me.id],
  );
  if (row === null) throw fail.inviteNotFound();
  return row.from_user_id;
}

export interface LeaveOutcome {
  previousPartyId: number;
  newPartyId: number;
  remainingUserIds: number[];
  lobbyId: number | null;
  searchCancelled: boolean;
  newLeaderId: number | null;
}

export async function leaveParty(me: UserRow): Promise<LeaveOutcome> {
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    const members = await membersOf(tx, party.id);
    if (members.length === 1) throw fail.alreadySolo();
    if (party.state === 'in_match') throw fail.partyBusy();
    if (party.lobby_id !== null) await releaseSeats(tx, party.lobby_id, [me.id]);
    const searchCancelled = party.state === 'queued';
    if (searchCancelled) {
      await tx.query(
        `UPDATE parties SET state = 'idle', queued_at = NULL, lobby_id = NULL WHERE id = $1`,
        [party.id],
      );
    }
    await detachMember(tx, party, me.id);
    const after = await lockParty(tx, party.id);
    const newPartyId = await createSoloParty(tx, me.id);
    return {
      previousPartyId: party.id,
      newPartyId,
      remainingUserIds: members
        .filter((member) => member.user_id !== me.id)
        .map((member) => member.user_id),
      lobbyId: party.lobby_id,
      searchCancelled,
      newLeaderId:
        after !== null && after.leader_id !== party.leader_id ? after.leader_id : null,
    };
  });
}

export async function handOverLeadership(me: UserRow, targetId: number): Promise<number> {
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    if (party.leader_id !== me.id) throw fail.notLeader();
    const members = await membersOf(tx, party.id);
    if (!members.some((member) => member.user_id === targetId)) {
      throw validationFailed({ userId: 'Choose a member of your party.' });
    }
    await tx.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [party.id, targetId]);
    await tx.query('DELETE FROM party_invites WHERE from_user_id = $1', [me.id]);
    return party.id;
  });
}

export async function queueParty(me: UserRow): Promise<number> {
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    if (party.leader_id !== me.id) throw fail.notLeader();
    if (party.state !== 'idle') throw invalidTransition(party.state);
    await tx.query(`UPDATE parties SET state = 'queued', queued_at = now() WHERE id = $1`, [
      party.id,
    ]);
    return party.id;
  });
}

export async function cancelQueue(me: UserRow): Promise<number> {
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    if (party.leader_id !== me.id) throw fail.notLeader();
    if (party.state !== 'queued') throw invalidTransition(party.state);
    await tx.query(`UPDATE parties SET state = 'idle', queued_at = NULL WHERE id = $1`, [party.id]);
    return party.id;
  });
}

export async function leaveLobby(me: UserRow): Promise<{ partyId: number; lobbyId: number }> {
  return transaction(async (tx) => {
    const party = await lockPartyOf(tx, me.id);
    if (party.leader_id !== me.id) throw fail.notLeader();
    if (party.state !== 'in_lobby' || party.lobby_id === null) throw invalidTransition(party.state);
    const members = await membersOf(tx, party.id);
    await releaseSeats(
      tx,
      party.lobby_id,
      members.map((member) => member.user_id),
    );
    await tx.query(
      `UPDATE parties SET state = 'idle', lobby_id = NULL, queued_at = NULL WHERE id = $1`,
      [party.id],
    );
    return { partyId: party.id, lobbyId: party.lobby_id };
  });
}
