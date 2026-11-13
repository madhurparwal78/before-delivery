import { COUNTDOWN_SECONDS, LOBBY_SIZE } from '../../shared/rounds.js';
import { query, transaction } from '../db.js';
import { fail } from '../errors.js';
import { createRound } from './matches.js';
import { MatchRunner } from './matchrunner.js';
import { pushLobby } from './lobbies.js';
import { pushParty } from './parties.js';
import { announcePresence } from './presence.js';

/**
 * Seats every queued party whole, in queue order, into the oldest filling lobby
 * with room. The lobby row lock makes this safe across server processes.
 */
async function seatParty(partyId: number): Promise<number | null> {
  return transaction(async (tx) => {
    const party = await tx.queryOne<{ id: number; state: string }>(
      `SELECT id, state FROM parties WHERE id = $1 FOR UPDATE`,
      [partyId],
    );
    if (party === null || party.state !== 'queued') return null;
    const members = await tx.query<{ user_id: number }>(
      'SELECT user_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, user_id',
      [partyId],
    );
    if (members.length === 0) return null;
    const candidates = await tx.query<{ id: number }>(
      `SELECT id FROM lobbies WHERE state = 'filling' ORDER BY created_at, id`,
    );
    let lobbyId: number | null = null;
    let taken: number[] = [];
    for (const candidate of candidates) {
      const locked = await tx.queryOne<{ id: number; state: string }>(
        `SELECT id, state FROM lobbies WHERE id = $1 FOR UPDATE`,
        [candidate.id],
      );
      if (locked === null || locked.state !== 'filling') continue;
      const seats = await tx.query<{ seat: number }>(
        'SELECT seat FROM lobby_seats WHERE lobby_id = $1',
        [candidate.id],
      );
      if (seats.length + members.length > LOBBY_SIZE) continue;
      lobbyId = candidate.id;
      taken = seats.map((row) => row.seat);
      break;
    }
    if (lobbyId === null) {
      const created = await tx.queryOne<{ id: number }>(
        `INSERT INTO lobbies DEFAULT VALUES RETURNING id`,
      );
      if (created === null) throw fail.internal();
      lobbyId = created.id;
    }
    const free: number[] = [];
    for (let seat = 1; seat <= LOBBY_SIZE; seat += 1) {
      if (!taken.includes(seat)) free.push(seat);
    }
    for (let index = 0; index < members.length; index += 1) {
      await tx.query(
        'INSERT INTO lobby_seats (lobby_id, seat, user_id, party_id) VALUES ($1, $2, $3, $4)',
        [lobbyId, free[index], members[index].user_id, partyId],
      );
    }
    await tx.query(`UPDATE parties SET state = 'in_lobby', lobby_id = $2 WHERE id = $1`, [
      partyId,
      lobbyId,
    ]);
    if (taken.length + members.length === LOBBY_SIZE) {
      await tx.query(
        `UPDATE lobbies SET state = 'countdown', countdown_ends_at = $2 WHERE id = $1`,
        [lobbyId, new Date(Date.now() + COUNTDOWN_SECONDS * 1000)],
      );
    }
    return lobbyId;
  });
}

export async function seatQueuedParties(): Promise<void> {
  const queued = await query<{ id: number }>(
    `SELECT id FROM parties WHERE state = 'queued' ORDER BY queued_at, id`,
  );
  for (const party of queued) {
    const lobbyId = await seatParty(party.id);
    if (lobbyId === null) continue;
    await pushParty(party.id);
    await pushLobby(lobbyId);
    await announcePresence(await memberIdsOf(party.id));
  }
}

async function memberIdsOf(partyId: number): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    'SELECT user_id FROM party_members WHERE party_id = $1',
    [partyId],
  );
  return rows.map((row) => row.user_id);
}

/** Starts the match for every lobby whose countdown has run out. */
export async function startDueMatches(): Promise<void> {
  const due = await query<{ id: number }>(
    `UPDATE lobbies SET state = 'running'
     WHERE state = 'countdown' AND countdown_ends_at <= $1 RETURNING id`,
    [new Date()],
  );
  for (const lobby of due) await startMatch(lobby.id);
}

async function startMatch(lobbyId: number): Promise<void> {
  const started = await transaction(async (tx) => {
    const seats = await tx.query<{ user_id: number }>(
      'SELECT user_id FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat',
      [lobbyId],
    );
    const starters = seats.map((row) => row.user_id).sort((a, b) => a - b);
    const match = await tx.queryOne<{ id: number }>(
      `INSERT INTO matches (lobby_id) VALUES ($1) RETURNING id`,
      [lobbyId],
    );
    if (match === null) throw fail.internal();
    for (const userId of starters) {
      await tx.query('INSERT INTO match_participants (match_id, user_id) VALUES ($1, $2)', [
        match.id,
        userId,
      ]);
    }
    await tx.query('UPDATE lobbies SET match_id = $2 WHERE id = $1', [lobbyId, match.id]);
    await tx.query(
      `UPDATE parties SET state = 'in_match', match_id = $2 WHERE lobby_id = $1`,
      [lobbyId, match.id],
    );
    const round = await createRound(tx, match.id, 1, starters);
    return { matchId: match.id, starters, round };
  });
  const partyIds = await query<{ id: number }>(
    'SELECT id FROM parties WHERE match_id = $1',
    [started.matchId],
  );
  for (const party of partyIds) await pushParty(party.id);
  await pushLobby(lobbyId);
  await announcePresence(started.starters);
  MatchRunner.start(started.matchId, started.starters, started.round);
}

export function startMatchmaker(): NodeJS.Timeout {
  return setInterval(() => {
    void seatQueuedParties().then(startDueMatches);
  }, 500);
}
