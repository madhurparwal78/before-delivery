import { randomInt } from 'node:crypto';
import { TIERS, prizeSplit } from '../shared/domain';
import { playerById } from './auth';
import { config } from './config';
import { query, transaction, type Db } from './db';
import { ApiError, assertUuid, notFound, tierLocked } from './errors';
import { route, type Json } from './http';
import { ESCROW, HOUSE, balance, lockPlayer, wallet, writePair } from './ledger';
import { notifyPlayer, publish, watchedTopics } from './realtime';
import { ensureOpenBracket } from './seed';
import { NOT_ENOUGH_COINS, inLiveMatch, openRoom, seatFor, setTournamentMatchEnd, type Room } from './tables';

const SEATS = 8;
const BRACKET_SIZE_MESSAGE = 'Bracket is full';

type BracketStatus = 'open' | 'full' | 'ready_check' | 'round_of_8' | 'semi_finals' | 'final' | 'paid' | 'refunded';

interface TournamentRow {
  id: string;
  tier: number;
  status: BracketStatus;
  window_ends_at: Date | null;
  ready_ends_at: Date | null;
}

interface EntrantRow {
  player_id: string;
  display_name: string;
  slot: number | null;
  ready: boolean;
  eliminated_in: string | null;
}

function secondsUntil(moment: Date | null): number | null {
  return moment === null ? null : Math.max(0, Math.ceil((moment.getTime() - Date.now()) / 1000));
}

async function bracketBody(client: Db, row: TournamentRow): Promise<Json> {
  const tier = TIERS[row.tier - 1];
  const entrants = await entrantsOf(client, row.id);
  return {
    id: row.id,
    tier: row.tier,
    tierName: tier.name,
    status: row.status,
    entry: tier.entry,
    entrantCount: entrants.length,
    entrants: entrants.map((entrant) => ({ slot: entrant.slot, playerId: entrant.player_id, displayName: entrant.display_name, ready: entrant.ready })),
    prizes: prizeSplit(tier.entry),
    windowSecondsLeft: row.status === 'open' ? secondsUntil(row.window_ends_at) : null,
    readySecondsLeft: row.status === 'ready_check' ? secondsUntil(row.ready_ends_at) : null,
  };
}

async function entrantsOf(client: Db, id: string): Promise<EntrantRow[]> {
  const { rows } = await client.query<EntrantRow>(
    `SELECT e.player_id, p.display_name, e.slot, e.ready, e.eliminated_in FROM tournament_entrants e
     JOIN players p ON p.id = e.player_id WHERE e.tournament_id = $1 ORDER BY e.slot NULLS LAST, e.seq`,
    [id],
  );
  return rows;
}

async function lockBracket(client: Db, id: string): Promise<TournamentRow> {
  assertUuid(id);
  const { rows } = await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [id]);
  if (rows.length === 0) throw notFound();
  return rows[0];
}

async function publishBracket(id: string): Promise<void> {
  const body = await transaction(async (client) => {
    const { rows } = await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1', [id]);
    return bracketBody(client, rows[0]);
  });
  publish(`tournament:${id}`, { body });
  publish('tournaments', {});
}

async function drawSlots(client: Db, id: string): Promise<void> {
  const entrants = await entrantsOf(client, id);
  const slots = Array.from({ length: SEATS }, (_, index) => index + 1);
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [slots[index], slots[other]] = [slots[other], slots[index]];
  }
  for (const [index, entrant] of entrants.entries()) {
    await client.query('UPDATE tournament_entrants SET slot = $3 WHERE tournament_id = $1 AND player_id = $2', [id, entrant.player_id, slots[index]]);
  }
}

async function refundBracket(client: Db, row: TournamentRow): Promise<string[]> {
  const entry = TIERS[row.tier - 1].entry;
  const entrants = await entrantsOf(client, row.id);
  for (const { player_id: playerId } of entrants) {
    await lockPlayer(client, playerId);
    await writePair(client, { from: ESCROW, to: wallet(playerId), amount: entry, currency: 'coins', kind: 'tournament_refund', refId: row.id });
  }
  await client.query(`UPDATE tournaments SET status = 'refunded' WHERE id = $1`, [row.id]);
  await ensureOpenBracket(client, row.tier);
  return entrants.map((entrant) => entrant.player_id);
}

async function openRoundTables(client: Db, row: TournamentRow, status: BracketStatus): Promise<string[]> {
  await client.query('UPDATE tournaments SET status = $2 WHERE id = $1', [row.id, status]);
  const alive = (await entrantsOf(client, row.id)).filter((entrant) => entrant.eliminated_in === null);
  const players: string[] = [];
  for (let index = 0; index < alive.length; index += 2) {
    const pair = [alive[index], alive[index + 1]];
    const seats = [await seatFor(client, pair[0].player_id, null), await seatFor(client, pair[1].player_id, null)];
    await openRoom(client, { kind: 'tournament', mode: 'eight-ball', tier: row.tier, seats, tournamentId: row.id });
    players.push(pair[0].player_id, pair[1].player_id);
  }
  return players;
}

/** Matches of a round can end together, so a round is over only once every loser is recorded. */
const ROUND_SURVIVORS: Partial<Record<BracketStatus, number>> = { round_of_8: 4, semi_finals: 2, final: 1 };
const NEXT_ROUND: Partial<Record<BracketStatus, BracketStatus>> = { round_of_8: 'semi_finals', semi_finals: 'final' };

async function payPrizes(client: Db, row: TournamentRow, finalLoser: string): Promise<string[]> {
  const prizes = prizeSplit(TIERS[row.tier - 1].entry);
  const entrants = await entrantsOf(client, row.id);
  const payouts: [string, number][] = [];
  for (const entrant of entrants) {
    if (entrant.eliminated_in === null) payouts.push([entrant.player_id, prizes.first]);
    else if (entrant.player_id === finalLoser) payouts.push([entrant.player_id, prizes.second]);
    else if (entrant.eliminated_in === 'semi_finals') payouts.push([entrant.player_id, prizes.semiFinal]);
  }
  for (const [playerId, amount] of payouts) {
    await lockPlayer(client, playerId);
    await writePair(client, { from: ESCROW, to: wallet(playerId), amount, currency: 'coins', kind: 'tournament_prize', refId: row.id });
  }
  await writePair(client, { from: ESCROW, to: HOUSE, amount: prizes.house, currency: 'coins', kind: 'house_cut', refId: row.id });
  await client.query(`UPDATE tournaments SET status = 'paid' WHERE id = $1`, [row.id]);
  return payouts.map(([playerId]) => playerId);
}

/** A forfeit advances the opponent; a void advances the lower slot, which always holds seat 1. */
async function bracketMatchEnded(room: Room, tournamentId: string): Promise<void> {
  const loserSeat = room.status === 'voided' ? 2 : room.win?.seat === 1 ? 2 : 1;
  const loser = room.seats[loserSeat - 1].playerId;
  const touched = await transaction(async (client) => {
    const row = await lockBracket(client, tournamentId);
    await client.query('UPDATE tournament_entrants SET eliminated_in = $3 WHERE tournament_id = $1 AND player_id = $2', [row.id, loser, row.status]);
    const alive = (await entrantsOf(client, row.id)).filter((entrant) => entrant.eliminated_in === null);
    if (alive.length !== ROUND_SURVIVORS[row.status]) return [];
    const next = NEXT_ROUND[row.status];
    return next === undefined ? payPrizes(client, row, loser) : openRoundTables(client, row, next);
  });
  touched.forEach(notifyPlayer);
  await publishBracket(tournamentId);
}

async function endOverdueBrackets(): Promise<void> {
  const due = await query<{ id: string }>(
    `SELECT id FROM tournaments WHERE (status = 'open' AND window_ends_at <= now()) OR (status = 'ready_check' AND ready_ends_at <= now())`,
  );
  for (const { id } of due) {
    const players = await transaction(async (client) => {
      const row = await lockBracket(client, id);
      const overdue = row.status === 'open' ? row.window_ends_at : row.status === 'ready_check' ? row.ready_ends_at : null;
      if (overdue === null || overdue.getTime() > Date.now()) return [];
      return refundBracket(client, row);
    });
    players.forEach(notifyPlayer);
    await publishBracket(id);
  }
}

/** Runs at least once a second: ends overdue windows and ready checks, and sends every open bracket page the server's time. */
export async function tickTournaments(): Promise<void> {
  await endOverdueBrackets();
  for (const topic of watchedTopics('tournament:')) await publishBracket(topic.slice('tournament:'.length));
}

export function registerTournamentRoutes(): void {
  setTournamentMatchEnd(bracketMatchEnded);

  route('GET', '/api/tournaments', async () => {
    const body = await transaction(async (client) => {
      const { rows } = await client.query<TournamentRow>(`SELECT * FROM tournaments WHERE status = 'open' ORDER BY tier`);
      return { tournaments: await Promise.all(rows.map((row) => bracketBody(client, row))) };
    });
    return { status: 200, body };
  });

  route('GET', '/api/tournaments/{id}', async ({ params }) => {
    const body = await transaction(async (client) => {
      assertUuid(params.id);
      const { rows } = await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1', [params.id]);
      if (rows.length === 0) throw notFound();
      return bracketBody(client, rows[0]);
    });
    return { status: 200, body };
  });

  route('POST', '/api/tournaments/{id}/register', async ({ session, params }) => {
    const body = await transaction(async (client) => {
      const row = await lockBracket(client, params.id);
      const tier = TIERS[row.tier - 1];
      await lockPlayer(client, session.playerId);
      const player = await playerById(client, session.playerId);
      if (player.level < tier.minLevel) throw tierLocked(tier.minLevel);
      const entrants = await entrantsOf(client, row.id);
      if (entrants.some((entrant) => entrant.player_id === player.id)) throw new ApiError(409, 'already_registered', 'You are already in this bracket.');
      if (entrants.length >= SEATS) throw new ApiError(409, 'tournament_full', BRACKET_SIZE_MESSAGE);
      if (row.status !== 'open') throw new ApiError(409, 'tournament_closed', 'This bracket is closed.');
      if ((await balance(client, player.id, 'coins')) < tier.entry) throw new ApiError(409, 'insufficient_coins', NOT_ENOUGH_COINS);
      if (inLiveMatch(player.id)) throw new ApiError(409, 'in_match', 'You are already in a match.');

      await writePair(client, { from: wallet(player.id), to: ESCROW, amount: tier.entry, currency: 'coins', kind: 'tournament_entry', refId: row.id });
      await client.query('INSERT INTO tournament_entrants (tournament_id, player_id) VALUES ($1,$2)', [row.id, player.id]);
      if (entrants.length === 0) {
        await client.query(`UPDATE tournaments SET window_ends_at = now() + make_interval(secs => $2) WHERE id = $1`, [row.id, config.tournamentWindowSeconds]);
      }
      if (entrants.length + 1 === SEATS) {
        await drawSlots(client, row.id);
        await client.query(
          `UPDATE tournaments SET status = 'ready_check', ready_ends_at = now() + make_interval(secs => $2) WHERE id = $1`,
          [row.id, config.readyCheckSeconds],
        );
        await ensureOpenBracket(client, row.tier);
      }
      const { rows } = await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1', [row.id]);
      return bracketBody(client, rows[0]);
    });
    notifyPlayer(session.playerId);
    await publishBracket(params.id);
    return { status: 201, body };
  });

  route('POST', '/api/tournaments/{id}/ready', async ({ session, params }) => {
    const { body, players } = await transaction(async (client) => {
      const row = await lockBracket(client, params.id);
      const entrants = await entrantsOf(client, row.id);
      if (!entrants.some((entrant) => entrant.player_id === session.playerId)) throw new ApiError(403, 'not_entered', 'You are not in this bracket.');
      if (row.status !== 'ready_check') throw new ApiError(409, 'not_in_ready_check', 'No ready check is running.');
      await client.query('UPDATE tournament_entrants SET ready = true WHERE tournament_id = $1 AND player_id = $2', [row.id, session.playerId]);
      const everyone = entrants.every((entrant) => entrant.ready || entrant.player_id === session.playerId);
      const seated = everyone ? await openRoundTables(client, row, 'round_of_8') : [];
      const { rows } = await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1', [row.id]);
      return { body: await bracketBody(client, rows[0]), players: seated };
    });
    players.forEach(notifyPlayer);
    await publishBracket(params.id);
    return { status: 200, body };
  });
}

