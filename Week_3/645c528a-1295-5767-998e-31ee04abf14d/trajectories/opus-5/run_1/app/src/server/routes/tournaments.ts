import { randomUUID } from 'node:crypto';
import { TIERS, tierOf, tournamentPrizes } from '../../shared/catalog.js';
import { TOURNAMENT_COPY } from '../../shared/copy.js';
import { config } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { publish } from '../events.js';
import type { Ctx, Router } from '../http.js';
import { fromEscrow, houseCut, toEscrow } from '../ledger.js';
import { requireSession } from '../session.js';
import { createMatchRow, playerHasLiveMatch, publishPlayer, type MatchRow } from '../tables.js';

interface TournamentRow {
  id: string;
  tier: number;
  status: string;
  window_started_at: Date | null;
  ready_started_at: Date | null;
}

export async function tournamentBody(id: string): Promise<Record<string, unknown> | null> {
  const row = await queryOne<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  if (!row) return null;
  const tier = tierOf(row.tier);
  const entrants = await query<{ player_id: string; display_name: string; slot: number | null; ready: boolean }>(
    `SELECT e.player_id, p.display_name, e.slot, e.ready FROM tournament_entrants e JOIN players p ON p.id = e.player_id
      WHERE e.tournament_id = $1 ORDER BY COALESCE(e.slot, 99), e.registered_at`,
    [id],
  );
  const windowSecondsLeft = row.window_started_at
    ? Math.max(0, Math.ceil((new Date(row.window_started_at).getTime() + config.tournamentWindowSeconds * 1000 - Date.now()) / 1000))
    : null;
  const readySecondsLeft =
    row.status === 'ready_check' && row.ready_started_at
      ? Math.max(0, Math.ceil((new Date(row.ready_started_at).getTime() + config.readyCheckSeconds * 1000 - Date.now()) / 1000))
      : null;
  const matches = await query<{ id: string; seat1: string | null; seat2: string | null; status: string; tournament_round: string | null }>(
    `SELECT id, seat1, seat2, status, tournament_round FROM matches WHERE tournament_id = $1 ORDER BY created_at`,
    [id],
  );
  return {
    id: row.id,
    tier: row.tier,
    tierName: tier.name,
    status: row.status,
    entry: tier.entry,
    entrantCount: entrants.length,
    entrants: entrants.map((entrant) => ({
      slot: entrant.slot,
      playerId: entrant.player_id,
      displayName: entrant.display_name,
      ready: entrant.ready,
    })),
    prizes: tournamentPrizes(tier.entry),
    windowSecondsLeft: entrants.length === 0 ? null : windowSecondsLeft,
    readySecondsLeft,
    matches: matches.map((match) => ({
      id: match.id,
      round: match.tournament_round,
      status: match.status,
      tableUrl: `/table/${match.id}`,
      seats: [match.seat1, match.seat2],
    })),
  };
}

async function openTournamentFor(tier: number): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM tournaments WHERE tier = $1 AND status = 'open' ORDER BY created_at LIMIT 1`,
    [tier],
  );
  if (existing) return existing.id;
  const id = randomUUID();
  await query(`INSERT INTO tournaments (id, tier, status) VALUES ($1,$2,'open')`, [id, tier]);
  return id;
}

export function registerTournamentRoutes(router: Router): void {
  router.get('/api/tournaments', async () => {
    const bodies = [];
    for (const tier of TIERS) {
      const id = await openTournamentFor(tier.tier);
      const body = await tournamentBody(id);
      if (body) bodies.push(body);
    }
    return { status: 200, body: { tournaments: bodies } };
  });

  router.get('/api/tournaments/:id', async (ctx: Ctx) => {
    const body = await tournamentBody(ctx.params.id as string);
    if (!body) throw ApiError.notFound('No such tournament.');
    return { status: 200, body };
  });

  router.post('/api/tournaments/:id/register', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const id = ctx.params.id as string;
    const tournament = await queryOne<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
    if (!tournament) throw ApiError.notFound('No such tournament.');
    const tier = tierOf(tournament.tier);
    if (player.level < tier.minLevel) throw new ApiError(403, 'level_locked', `Reach level ${tier.minLevel}`);
    if (await playerHasLiveMatch(player.id)) throw new ApiError(409, 'in_match', 'Finish your match first.');

    const outcome = await transaction(async (client) => {
      const locked = await client.query<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
      const row = locked.rows[0];
      if (!row) return 'closed' as const;
      if (row.status !== 'open') return 'closed' as const;
      const mine = await client.query(`SELECT 1 FROM tournament_entrants WHERE tournament_id = $1 AND player_id = $2`, [id, player.id]);
      if (mine.rows.length > 0) return 'already' as const;
      const count = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM tournament_entrants WHERE tournament_id = $1`, [id]);
      const entrants = Number(count.rows[0]?.count ?? '0');
      if (entrants >= 8) return 'full' as const;
      const wallet = await client.query<{ coins: string }>(`SELECT coins FROM players WHERE id = $1 FOR UPDATE`, [player.id]);
      if (Number(wallet.rows[0]?.coins ?? 0) < tier.entry) return 'coins' as const;
      await client.query(`INSERT INTO tournament_entrants (tournament_id, player_id) VALUES ($1,$2)`, [id, player.id]);
      await toEscrow(client, player.id, tier.entry, 'tournament_entry', id);
      if (!row.window_started_at) {
        await client.query(`UPDATE tournaments SET window_started_at = now() WHERE id = $1`, [id]);
      }
      if (entrants + 1 === 8) {
        const all = await client.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [id]);
        const slots = all.rows.map((entrant) => entrant.player_id);
        for (let index = slots.length - 1; index > 0; index -= 1) {
          const swap = Math.floor(Math.random() * (index + 1));
          const current = slots[index] as string;
          slots[index] = slots[swap] as string;
          slots[swap] = current;
        }
        for (let index = 0; index < slots.length; index += 1) {
          await client.query(`UPDATE tournament_entrants SET slot = $1 WHERE tournament_id = $2 AND player_id = $3`, [
            index + 1,
            id,
            slots[index],
          ]);
        }
        await client.query(`UPDATE tournaments SET status = 'ready_check', ready_started_at = now() WHERE id = $1`, [id]);
        await client.query(`INSERT INTO tournaments (id, tier, status) VALUES ($1, $2, 'open')`, [randomUUID(), row.tier]);
        return 'drawn' as const;
      }
      return 'entered' as const;
    });

    if (outcome === 'closed') throw new ApiError(409, 'tournament_closed', 'That bracket has closed.');
    if (outcome === 'already') throw new ApiError(409, 'already_registered', 'You are already registered.');
    if (outcome === 'full') throw new ApiError(409, 'tournament_full', TOURNAMENT_COPY.bracketFull);
    if (outcome === 'coins') throw new ApiError(409, 'insufficient_coins', 'Not enough Coins for this table.');

    publishPlayer(player.id);
    const body = await tournamentBody(id);
    publish(`tournament:${id}`, 'tournament', { changed: true, drawn: outcome === 'drawn' });
    publish('tournaments', 'tournaments', { changed: true });
    return { status: 201, body };
  });

  router.post('/api/tournaments/:id/ready', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const id = ctx.params.id as string;
    const tournament = await queryOne<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
    if (!tournament) throw ApiError.notFound('No such tournament.');
    const entrant = await queryOne<{ player_id: string }>(
      `SELECT player_id FROM tournament_entrants WHERE tournament_id = $1 AND player_id = $2`,
      [id, player.id],
    );
    if (!entrant) throw new ApiError(403, 'not_entered', 'You are not in this bracket.');
    if (tournament.status !== 'ready_check') throw new ApiError(409, 'not_in_ready_check', 'There is no ready check running.');
    await query(`UPDATE tournament_entrants SET ready = TRUE WHERE tournament_id = $1 AND player_id = $2`, [id, player.id]);
    const pending = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM tournament_entrants WHERE tournament_id = $1 AND ready = FALSE`,
      [id],
    );
    if (Number(pending?.count ?? '0') === 0) await startRoundOfEight(id);
    publish(`tournament:${id}`, 'tournament', { changed: true });
    return { status: 200, body: await tournamentBody(id) };
  });
}

async function startRoundOfEight(id: string): Promise<void> {
  const tournament = await queryOne<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  if (!tournament || tournament.status !== 'ready_check') return;
  await query(`UPDATE tournaments SET status = 'round_of_8' WHERE id = $1`, [id]);
  const entrants = await query<{ player_id: string; slot: number | null }>(
    `SELECT player_id, slot FROM tournament_entrants WHERE tournament_id = $1 ORDER BY slot`,
    [id],
  );
  for (let index = 0; index < entrants.length; index += 2) {
    const first = entrants[index];
    const second = entrants[index + 1];
    if (!first || !second) continue;
    await createMatchRow({
      mode: 'eight-ball',
      tier: tournament.tier,
      kind: 'tournament',
      seat1: first.player_id,
      seat2: second.player_id,
      status: 'in_play',
      entry: 0,
      pot: 0,
      tournamentId: id,
      tournamentRound: 'round_of_8',
    });
  }
  publish(`tournament:${id}`, 'tournament', { changed: true });
}

async function refundTournament(id: string): Promise<void> {
  const tier = await queryOne<{ tier: number }>(`SELECT tier FROM tournaments WHERE id = $1`, [id]);
  if (!tier) return;
  const entry = tierOf(tier.tier).entry;
  const refunded = await transaction(async (client) => {
    const locked = await client.query<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
    const row = locked.rows[0];
    if (!row || (row.status !== 'open' && row.status !== 'ready_check')) return [];
    const entrants = await client.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [id]);
    for (const entrant of entrants.rows) {
      await fromEscrow(client, entrant.player_id, entry, 'tournament_refund', id);
    }
    await client.query(`UPDATE tournaments SET status = 'refunded' WHERE id = $1`, [id]);
    return entrants.rows.map((entrant) => entrant.player_id);
  });
  for (const playerId of refunded) publishPlayer(playerId);
  publish(`tournament:${id}`, 'tournament', { changed: true, refunded: true });
  publish('tournaments', 'tournaments', { changed: true });
}

/** Window ends, ready checks end, rounds advance and the final pays the published prizes. */
export async function advanceTournaments(): Promise<void> {
  const rows = await query<TournamentRow>(
    `SELECT * FROM tournaments WHERE status IN ('open','ready_check','round_of_8','semi_finals','final')`,
  ).catch(() => []);
  for (const tournament of rows) {
    if (tournament.status === 'open' && tournament.window_started_at) {
      const ends = new Date(tournament.window_started_at).getTime() + config.tournamentWindowSeconds * 1000;
      if (Date.now() > ends) {
        await refundTournament(tournament.id);
        await openTournamentFor(tournament.tier);
        continue;
      }
    }
    if (tournament.status === 'ready_check' && tournament.ready_started_at) {
      const ends = new Date(tournament.ready_started_at).getTime() + config.readyCheckSeconds * 1000;
      if (Date.now() > ends) {
        const pending = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM tournament_entrants WHERE tournament_id = $1 AND ready = FALSE`,
          [tournament.id],
        );
        if (Number(pending?.count ?? '0') > 0) {
          await refundTournament(tournament.id);
          await openTournamentFor(tournament.tier);
        } else {
          await startRoundOfEight(tournament.id);
        }
        continue;
      }
    }
    if (tournament.status === 'round_of_8' || tournament.status === 'semi_finals' || tournament.status === 'final') {
      await advanceRound(tournament);
    }
  }
}

async function advanceRound(tournament: TournamentRow): Promise<void> {
  const matches = await query<MatchRow>(
    `SELECT * FROM matches WHERE tournament_id = $1 AND tournament_round = $2 ORDER BY created_at`,
    [tournament.id, tournament.status],
  );
  if (matches.length === 0) return;
  if (matches.some((match) => match.status === 'in_play' || match.status === 'waiting')) return;
  const winners: string[] = [];
  const losers: string[] = [];
  for (const match of matches) {
    const winnerSeat = match.winner_seat;
    const first = match.seat1;
    const second = match.seat2;
    if (match.status === 'voided' || !winnerSeat) {
      if (first) winners.push(first);
      if (second) losers.push(second);
      continue;
    }
    const winner = winnerSeat === 1 ? first : second;
    const loser = winnerSeat === 1 ? second : first;
    if (winner) winners.push(winner);
    if (loser) losers.push(loser);
  }
  if (tournament.status === 'final') {
    await payPrizes(tournament, winners[0] ?? null);
    return;
  }
  const nextRound = tournament.status === 'round_of_8' ? 'semi_finals' : 'final';
  await query(`UPDATE tournaments SET status = $1 WHERE id = $2`, [nextRound, tournament.id]);
  for (let index = 0; index < winners.length; index += 2) {
    const first = winners[index];
    const second = winners[index + 1];
    if (!first || !second) continue;
    await createMatchRow({
      mode: 'eight-ball',
      tier: tournament.tier,
      kind: 'tournament',
      seat1: first,
      seat2: second,
      status: 'in_play',
      entry: 0,
      pot: 0,
      tournamentId: tournament.id,
      tournamentRound: nextRound,
    });
  }
  publish(`tournament:${tournament.id}`, 'tournament', { changed: true });
}

async function payPrizes(tournament: TournamentRow, championId: string | null): Promise<void> {
  const tier = tierOf(tournament.tier);
  const prizes = tournamentPrizes(tier.entry);
  const paid = await transaction(async (client) => {
    const locked = await client.query<TournamentRow>(`SELECT * FROM tournaments WHERE id = $1 FOR UPDATE`, [tournament.id]);
    if (locked.rows[0]?.status !== 'final') return [];
    const finals = await client.query<MatchRow>(
      `SELECT * FROM matches WHERE tournament_id = $1 AND tournament_round = 'final'`,
      [tournament.id],
    );
    const final = finals.rows[0];
    const runnerUp = final ? (final.winner_seat === 1 ? final.seat2 : final.seat1) : null;
    const semis = await client.query<MatchRow>(
      `SELECT * FROM matches WHERE tournament_id = $1 AND tournament_round = 'semi_finals'`,
      [tournament.id],
    );
    const semiLosers = semis.rows
      .map((match) => (match.winner_seat === 1 ? match.seat2 : match.seat1))
      .filter((id): id is string => Boolean(id));
    const touched: string[] = [];
    if (championId) {
      await fromEscrow(client, championId, prizes.first, 'tournament_prize', tournament.id);
      touched.push(championId);
    }
    if (runnerUp) {
      await fromEscrow(client, runnerUp, prizes.second, 'tournament_prize', tournament.id);
      touched.push(runnerUp);
    }
    for (const loser of semiLosers) {
      await fromEscrow(client, loser, prizes.semiFinal, 'tournament_prize', tournament.id);
      touched.push(loser);
    }
    await houseCut(client, prizes.house, tournament.id);
    await client.query(`UPDATE tournaments SET status = 'paid' WHERE id = $1`, [tournament.id]);
    return touched;
  });
  for (const playerId of paid) publishPlayer(playerId);
  publish(`tournament:${tournament.id}`, 'tournament', { changed: true });
  await openTournamentFor(tournament.tier);
}
