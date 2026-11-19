import { randomBytes, randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../db.js';
import { errors } from '../errors.js';
import { onlineAmong } from '../presence.js';
import { postSystemMessage } from '../chat.js';
import { publish } from '../realtime/bus.js';
import { appendEvent } from '../realtime/streams.js';
import {
  PARTY_MAX_MEMBERS,
  READY_CHECK_SECONDS,
  STORIES,
} from '../../shared/constants.js';
import type { Party, PartyMember, PartyStatus, ReadyCheckState } from '../../shared/types.js';
import { readProgress } from './progress.js';
import { createSession, droppedMembersOf } from '../sessions/engine.js';

export function partyChannel(partyId: string): string {
  return `party-${partyId}`;
}

export function partyStream(partyId: string): string {
  return `party:${partyId}`;
}

interface PartyRow {
  id: string;
  status: PartyStatus;
  leader_id: string;
  story_id: string;
  session_id: string | null;
  ready_deadline_at: string | null;
  ready_started_members: string[] | null;
}

interface MemberRow {
  account_id: string;
  display_name: string;
  joined_at: Date;
  ready_response: 'ready' | 'not_ready' | null;
}

/** Allowed party state moves, in one place. */
const TRANSITIONS: Record<PartyStatus, PartyStatus[]> = {
  forming: ['ready_check'],
  ready_check: ['in_session', 'forming'],
  in_session: ['member_dropped', 'chapter_complete'],
  member_dropped: ['in_session', 'forming', 'chapter_complete'],
  chapter_complete: ['forming'],
};

function assertTransition(from: PartyStatus, to: PartyStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw errors.conflict('wrong_state', { key: 'fb.generic' });
  }
}

export async function touchParty(partyId: string): Promise<void> {
  await publish({ kind: 'party', party_id: partyId });
}

function remainingSeconds(deadlineAt: number): number {
  return Math.max(0, Math.ceil((deadlineAt * 1000 - Date.now()) / 1000));
}

async function partyRow(partyId: string): Promise<PartyRow | null> {
  const rows = await query<PartyRow>('SELECT * FROM parties WHERE id = $1', [partyId]);
  return rows[0] ?? null;
}

async function memberRows(partyId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT m.account_id, a.display_name, m.joined_at, m.ready_response
     FROM party_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.party_id = $1 ORDER BY m.joined_at, m.account_id`,
    [partyId],
  );
}

export async function loadParty(partyId: string): Promise<Party | null> {
  const row = await partyRow(partyId);
  if (row === null) return null;
  const members = await memberRows(partyId);
  const online = await onlineAmong(members.map((member) => member.account_id));
  const dropped = row.session_id === null ? new Map<string, number>() : droppedMembersOf(row.session_id);

  const partyMembers: PartyMember[] = members.map((member) => {
    const grace = dropped.get(member.account_id);
    const connection =
      grace !== undefined ? 'dropped' : online.has(member.account_id) ? 'connected' : 'offline';
    return {
      account_id: member.account_id,
      display_name: member.display_name,
      joined_at: member.joined_at.toISOString(),
      connection,
      grace_remaining_seconds: grace ?? null,
    };
  });

  let readyCheck: ReadyCheckState | null = null;
  if (row.status === 'ready_check' && row.ready_deadline_at !== null) {
    const deadlineAt = Number(row.ready_deadline_at);
    const responses: Record<string, 'ready' | 'not_ready' | 'pending'> = {};
    for (const member of members) responses[member.account_id] = member.ready_response ?? 'pending';
    readyCheck = {
      deadline_at: deadlineAt,
      remaining_seconds: remainingSeconds(deadlineAt),
      responses,
    };
  }

  return {
    id: row.id,
    status: row.status,
    leader_id: row.leader_id,
    story_id: row.story_id,
    members: partyMembers,
    ready_check: readyCheck,
    session_id: row.session_id,
    progress: await readProgress({ kind: 'party', partyId }, row.story_id),
  };
}

export async function partyIdOf(accountId: string): Promise<string | null> {
  const rows = await query<{ party_id: string }>(
    'SELECT party_id FROM party_members WHERE account_id = $1',
    [accountId],
  );
  return rows[0]?.party_id ?? null;
}

export async function requireMembership(partyId: string, accountId: string): Promise<PartyRow> {
  const row = await partyRow(partyId);
  if (row === null) throw errors.notFound();
  const rows = await query<{ account_id: string }>(
    'SELECT account_id FROM party_members WHERE party_id = $1 AND account_id = $2',
    [partyId, accountId],
  );
  if (rows.length === 0) throw errors.notFound();
  return row;
}

export async function requireLeader(partyId: string, accountId: string): Promise<PartyRow> {
  const row = await requireMembership(partyId, accountId);
  if (row.leader_id !== accountId) throw errors.notLeader();
  return row;
}

function isCoopStory(storyId: unknown): boolean {
  return STORIES.some((story) => story.id === storyId && story.mode === 'coop');
}

export async function createParty(
  accountId: string,
  displayName: string,
  storyId: unknown,
): Promise<Party> {
  if (!isCoopStory(storyId)) throw errors.invalidField('story_id', { key: 'fb.generic' });
  if ((await partyIdOf(accountId)) !== null) {
    throw errors.conflict('already_in_party', { key: 'fb.alreadyInParty' });
  }
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO parties (id, status, leader_id, story_id) VALUES ($1, 'forming', $2, $3)`,
      [id, accountId, storyId as string],
    );
    await client.query('INSERT INTO party_members (account_id, party_id) VALUES ($1, $2)', [
      accountId,
      id,
    ]);
  });
  await postSystemMessage(partyChannel(id), 'joined', { name: displayName });
  await postSystemMessage(partyChannel(id), 'leader', { name: displayName });
  await touchParty(id);
  const party = await loadParty(id);
  if (party === null) throw errors.internal();
  return party;
}

export async function setPartyStory(partyId: string, storyId: unknown): Promise<Party> {
  if (!isCoopStory(storyId)) throw errors.invalidField('story_id', { key: 'fb.generic' });
  const row = await partyRow(partyId);
  if (row === null) throw errors.notFound();
  if (row.status !== 'forming') throw errors.conflict('wrong_state', { key: 'fb.generic' });
  await pool.query('UPDATE parties SET story_id = $2 WHERE id = $1', [partyId, storyId as string]);
  await touchParty(partyId);
  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

export async function memberCount(partyId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    'SELECT count(*) AS count FROM party_members WHERE party_id = $1',
    [partyId],
  );
  return Number(rows[0].count);
}

export async function createInvite(
  partyId: string,
  toAccountId: string,
): Promise<{ id: string; token: string; to: string }> {
  if ((await memberCount(partyId)) >= PARTY_MAX_MEMBERS) {
    throw errors.conflict('party_full', { key: 'fb.partyFull' });
  }
  const id = randomUUID();
  const token = randomBytes(18).toString('base64url');
  await pool.query(
    `INSERT INTO party_invites (id, party_id, to_id, token, state) VALUES ($1, $2, $3, $4, 'open')`,
    [id, partyId, toAccountId, token],
  );
  await appendEvent(`me:${toAccountId}`, { kind: 'invite', party_id: partyId, token });
  return { id, token, to: toAccountId };
}

interface InviteRow {
  id: string;
  party_id: string;
  to_id: string;
  state: string;
}

export async function inviteByToken(token: string): Promise<InviteRow | null> {
  const rows = await query<InviteRow>('SELECT * FROM party_invites WHERE token = $1', [token]);
  return rows[0] ?? null;
}

/** Accepting checks the seat count and adds the member as one indivisible step. */
export async function acceptInvite(
  token: string,
  accountId: string,
  displayName: string,
): Promise<Party> {
  const invite = await inviteByToken(token);
  if (invite === null) throw errors.notFound();
  if (invite.to_id !== accountId) throw errors.notFound();
  if (invite.state !== 'open') throw errors.gone('invite_closed', { key: 'fb.inviteClosed' });

  const partyId = invite.party_id;
  await transaction(async (client) => {
    const locked = await client.query<PartyRow>('SELECT * FROM parties WHERE id = $1 FOR UPDATE', [
      partyId,
    ]);
    const row = locked.rows[0];
    if (row === undefined) throw errors.notFound();
    if (row.status !== 'forming') throw errors.conflict('wrong_state', { key: 'fb.generic' });

    const existing = await client.query<{ party_id: string }>(
      'SELECT party_id FROM party_members WHERE account_id = $1',
      [accountId],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].party_id === partyId) return;
      throw errors.conflict('already_in_party', { key: 'fb.alreadyInParty' });
    }

    const counted = await client.query<{ count: string }>(
      'SELECT count(*) AS count FROM party_members WHERE party_id = $1',
      [partyId],
    );
    if (Number(counted.rows[0].count) >= PARTY_MAX_MEMBERS) {
      throw errors.conflict('party_full', { key: 'fb.partyFull' });
    }

    await client.query('INSERT INTO party_members (account_id, party_id) VALUES ($1, $2)', [
      accountId,
      partyId,
    ]);
    await client.query(`UPDATE party_invites SET state = 'used' WHERE id = $1`, [invite.id]);
  });

  await postSystemMessage(partyChannel(partyId), 'joined', { name: displayName });
  await appendEvent(partyStream(partyId), { kind: 'member_joined', account_id: accountId });
  await touchParty(partyId);
  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

export async function declineInvite(token: string, accountId: string): Promise<void> {
  const invite = await inviteByToken(token);
  if (invite === null || invite.to_id !== accountId) throw errors.notFound();
  if (invite.state !== 'open') throw errors.gone('invite_closed', { key: 'fb.inviteClosed' });
  await pool.query(`UPDATE party_invites SET state = 'declined' WHERE id = $1`, [invite.id]);
}

async function closePartyInvites(partyId: string): Promise<void> {
  await pool.query(`UPDATE party_invites SET state = 'closed' WHERE party_id = $1 AND state = 'open'`, [
    partyId,
  ]);
}

async function succeedLeader(partyId: string, leavingId: string): Promise<string | null> {
  const members = await memberRows(partyId);
  const next = members.find((member) => member.account_id !== leavingId);
  if (next === undefined) return null;
  await pool.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [partyId, next.account_id]);
  return next.display_name;
}

async function endReadyCheck(partyId: string, cause: 'left' | 'not_ready' | 'deadline'): Promise<void> {
  const row = await partyRow(partyId);
  if (row === null || row.status !== 'ready_check') return;
  const started = row.ready_started_members ?? [];
  const members = await memberRows(partyId);
  const readyNow = new Set(
    members.filter((member) => member.ready_response === 'ready').map((member) => member.account_id),
  );
  const notReady = started.filter((accountId) => !readyNow.has(accountId)).length;
  await pool.query(
    `UPDATE parties SET status = 'forming', ready_deadline_at = NULL, ready_started_members = NULL
     WHERE id = $1`,
    [partyId],
  );
  await pool.query('UPDATE party_members SET ready_response = NULL WHERE party_id = $1', [partyId]);
  await postSystemMessage(partyChannel(partyId), 'ready_failed', { n: Math.max(1, notReady) });
  await appendEvent(partyStream(partyId), { kind: 'ready_check_failed', cause });
  await touchParty(partyId);
}

export async function leaveParty(
  partyId: string,
  accountId: string,
  displayName: string,
): Promise<void> {
  const row = await partyRow(partyId);
  if (row === null) return;
  const wasLeader = row.leader_id === accountId;
  const inReadyCheck = row.status === 'ready_check';

  await pool.query('DELETE FROM party_members WHERE party_id = $1 AND account_id = $2', [
    partyId,
    accountId,
  ]);
  await postSystemMessage(partyChannel(partyId), 'left', { name: displayName });

  const remaining = await memberCount(partyId);
  if (remaining === 0) {
    await closePartyInvites(partyId);
    await pool.query('DELETE FROM parties WHERE id = $1', [partyId]);
    await touchParty(partyId);
    return;
  }

  if (inReadyCheck) await endReadyCheck(partyId, 'left');
  if (wasLeader) {
    const newLeader = await succeedLeader(partyId, accountId);
    if (newLeader !== null) {
      await postSystemMessage(partyChannel(partyId), 'leader', { name: newLeader });
    }
  }
  await appendEvent(partyStream(partyId), { kind: 'member_left', account_id: accountId });
  await touchParty(partyId);
}

/** Called when a dropped member's grace ends while another member is connected. */
export async function removeMemberFromParty(
  partyId: string,
  accountId: string,
  reason: 'removed',
): Promise<void> {
  const row = await partyRow(partyId);
  if (row === null) return;
  const members = await memberRows(partyId);
  const member = members.find((entry) => entry.account_id === accountId);
  if (member === undefined) return;

  await pool.query('DELETE FROM party_members WHERE party_id = $1 AND account_id = $2', [
    partyId,
    accountId,
  ]);
  await postSystemMessage(partyChannel(partyId), reason, { name: member.display_name });
  if (row.leader_id === accountId) {
    const newLeader = await succeedLeader(partyId, accountId);
    if (newLeader !== null) {
      await postSystemMessage(partyChannel(partyId), 'leader', { name: newLeader });
    }
  }
  await appendEvent(partyStream(partyId), { kind: 'member_removed', account_id: accountId });
  await touchParty(partyId);
}

export async function handoffLeader(partyId: string, accountId: string): Promise<Party> {
  const members = await memberRows(partyId);
  const member = members.find((entry) => entry.account_id === accountId);
  if (member === undefined) throw errors.notFound();
  await pool.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [partyId, accountId]);
  await postSystemMessage(partyChannel(partyId), 'leader', { name: member.display_name });
  await appendEvent(partyStream(partyId), { kind: 'leader_changed', account_id: accountId });
  await touchParty(partyId);
  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

export async function startReadyCheck(partyId: string): Promise<Party> {
  const row = await partyRow(partyId);
  if (row === null) throw errors.notFound();
  if (row.status === 'ready_check') {
    const running = await loadParty(partyId);
    if (running === null) throw errors.internal();
    return running;
  }
  assertTransition(row.status, 'ready_check');
  const members = await memberRows(partyId);
  if (members.length < 2) {
    throw errors.conflict('not_enough_members', { key: 'fb.notEnoughMembers' });
  }
  const deadlineAt = Math.ceil(Date.now() / 1000) + READY_CHECK_SECONDS;
  await pool.query(
    `UPDATE parties SET status = 'ready_check', ready_deadline_at = $2, ready_started_members = $3
     WHERE id = $1`,
    [partyId, deadlineAt, JSON.stringify(members.map((member) => member.account_id))],
  );
  await pool.query('UPDATE party_members SET ready_response = NULL WHERE party_id = $1', [partyId]);
  await postSystemMessage(partyChannel(partyId), 'ready_started');
  await appendEvent(partyStream(partyId), { kind: 'ready_check_started', deadline_at: deadlineAt });
  await touchParty(partyId);
  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

async function startPartySession(partyId: string): Promise<void> {
  const row = await partyRow(partyId);
  if (row === null) return;
  const members = await memberRows(partyId);
  const progress = await readProgress({ kind: 'party', partyId }, row.story_id);
  const created = await createSession({
    storyId: row.story_id,
    chapter: progress.unlocked_chapter,
    mode: 'coop',
    members: members.map((member) => ({
      account_id: member.account_id,
      display_name: member.display_name,
    })),
    partyId,
    ownerAccountId: null,
  });
  await pool.query(
    `UPDATE parties SET status = 'in_session', session_id = $2, ready_deadline_at = NULL,
            ready_started_members = NULL WHERE id = $1`,
    [partyId, created.session_id],
  );
  await pool.query('UPDATE party_members SET ready_response = NULL WHERE party_id = $1', [partyId]);
  await closePartyInvites(partyId);
  await postSystemMessage(partyChannel(partyId), 'ready_passed', { story_id: row.story_id });
  await appendEvent(partyStream(partyId), {
    kind: 'session_started',
    session_id: created.session_id,
  });
  await touchParty(partyId);
}

export async function respondReadyCheck(
  partyId: string,
  accountId: string,
  ready: boolean,
): Promise<Party> {
  const row = await partyRow(partyId);
  if (row === null) throw errors.notFound();
  if (row.status !== 'ready_check') {
    throw errors.conflict('no_ready_check', { key: 'fb.generic' });
  }
  const members = await memberRows(partyId);
  const member = members.find((entry) => entry.account_id === accountId);
  if (member === undefined) throw errors.notFound();
  if (member.ready_response !== null) {
    throw errors.conflict('already_answered', { key: 'fb.generic' });
  }
  await pool.query(
    'UPDATE party_members SET ready_response = $3 WHERE party_id = $1 AND account_id = $2',
    [partyId, accountId, ready ? 'ready' : 'not_ready'],
  );
  await touchParty(partyId);

  if (!ready) {
    await endReadyCheck(partyId, 'not_ready');
  } else {
    const after = await memberRows(partyId);
    if (after.every((entry) => entry.ready_response === 'ready')) {
      await startPartySession(partyId);
    }
  }

  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

export async function returnToLobby(partyId: string): Promise<Party> {
  const row = await partyRow(partyId);
  if (row === null) throw errors.notFound();
  assertTransition(row.status, 'forming');
  await pool.query(`UPDATE parties SET status = 'forming', session_id = NULL WHERE id = $1`, [
    partyId,
  ]);
  await touchParty(partyId);
  const party = await loadParty(partyId);
  if (party === null) throw errors.internal();
  return party;
}

/** The server's own clock ends every ready check. */
export function startReadyCheckTimer(): void {
  setInterval(() => {
    void (async () => {
      const rows = await query<{ id: string }>(
        `SELECT id FROM parties WHERE status = 'ready_check' AND ready_deadline_at IS NOT NULL
           AND ready_deadline_at * 1000 <= $1`,
        [Date.now()],
      );
      for (const row of rows) await endReadyCheck(row.id, 'deadline');
      const live = await query<{ id: string }>(
        `SELECT id FROM parties WHERE status IN ('ready_check', 'member_dropped')`,
      );
      for (const row of live) await touchParty(row.id);
    })();
  }, 500);
}
