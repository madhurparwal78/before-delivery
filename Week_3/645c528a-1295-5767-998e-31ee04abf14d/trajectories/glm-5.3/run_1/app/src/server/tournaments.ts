import type { Db, PoolClient } from './db.js';
import type { Ctx } from './http.js';
import { sendJson } from './http.js';
import { ApiError, errors } from './errors.js';
import { copy } from './copy.js';
import { requirePlayerId } from './auth.js';
import { id as newId } from './util.js';
import { writePair, walletBalance } from './ledger.js';
import { loadPlayer } from './players.js';
import { tierById, tournamentPrizes, TOURNAMENT_SIZE, tournamentPool } from '../shared/game.js';
import { ensureOpenTournament } from './seed.js';
import type { TournamentBody, TournamentEntrant } from '../shared/types.js';
import { logger } from './logger.js';

export interface TournamentDeps {
  db: Db;
  onTournamentChange: (tournamentId: string, playerIds: string[]) => void;
  onMeChange: (playerId: string) => void;
}

const TIER_ENTRIES = [0, 100, 500, 2500, 10000, 50000];

export async function listTournaments(deps: TournamentDeps, ctx: Ctx): Promise<void> {
  await requirePlayerId(deps.db, ctx);
  const rows = await deps.db.query<{ id: string; tier: number }>(
    `SELECT id, tier FROM tournaments WHERE status = 'open' ORDER BY tier`
  );
  const bodies: TournamentBody[] = [];
  for (const row of rows.rows) {
    bodies.push(await tournamentBody(deps.db, row.id, null));
  }
  sendJson(ctx, 200, { tournaments: bodies });
}

export async function getTournament(deps: TournamentDeps, ctx: Ctx, tournamentId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  sendJson(ctx, 200, await tournamentBody(deps.db, tournamentId, playerId));
}

async function tournamentBody(db: Db, tournamentId: string, viewerId: string | null): Promise<TournamentBody> {
  const tournament = (await db.query<{ id: string; tier: number; status: TournamentBody['status']; entry: string; window_started_at: Date | null; window_ends_at: Date | null; ready_ends_at: Date | null }>(
    `SELECT id, tier, status, entry, window_started_at, window_ends_at, ready_ends_at FROM tournaments WHERE id = $1`,
    [tournamentId]
  )).rows[0];
  if (!tournament) throw errors.notFound();
  const entrants = await db.query<{ player_id: string; display_name: string; slot: number | null; ready: boolean; position: number }>(
    `SELECT e.player_id, p.display_name, e.slot, e.ready, e.position
     FROM tournament_entrants e JOIN players p ON p.id = e.player_id
     WHERE e.tournament_id = $1 ORDER BY e.position`,
    [tournamentId]
  );
  const entriesOut: TournamentEntrant[] = entrants.rows.map((r) => ({
    slot: r.slot,
    playerId: r.player_id,
    displayName: r.display_name,
    ready: r.ready,
  }));
  const windowSecondsLeft = tournament.window_ends_at
    ? Math.max(0, Math.ceil((tournament.window_ends_at.getTime() - Date.now()) / 1000))
    : null;
  const readySecondsLeft = tournament.ready_ends_at
    ? Math.max(0, Math.ceil((tournament.ready_ends_at.getTime() - Date.now()) / 1000))
    : null;
  void viewerId;
  const prizes = tournamentPrizes(tournament.tier);
  return {
    id: tournament.id,
    tier: tournament.tier,
    tierName: tierById(tournament.tier).name,
    status: tournament.status,
    entry: Number(tournament.entry),
    entrantCount: entriesOut.length,
    entrants: entriesOut,
    prizes,
    windowSecondsLeft,
    readySecondsLeft,
  };
}

export async function register(deps: TournamentDeps, ctx: Ctx, tournamentId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const body = await deps.db.tx(async (client) => {
    const tournament = (await client.query<{ id: string; tier: number; status: string; entry: string }>(
      `SELECT id, tier, status, entry FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]
    )).rows[0];
    if (!tournament) throw errors.notFound();
    if (tournament.status !== 'open') {
      throw new ApiError(409, 'tournament_closed', 'This bracket is closed.');
    }
    const tier = tierById(tournament.tier);
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    if (player.level < tier.minLevel) throw new ApiError(403, 'level_locked', copy.lockedTier(tier.minLevel));
    const coins = await walletBalance(client, playerId, 'coins');
    const entry = Number(tournament.entry);
    if (coins < entry) throw new ApiError(409, 'insufficient_coins', copy.refusedCoins);
    const live = (await client.query(
      `SELECT 1 FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`, [playerId]
    )).rowCount ?? 0;
    if (live > 0) throw new ApiError(409, 'in_match', 'Finish your current match first.');

    const existing = (await client.query(`SELECT 1 FROM tournament_entrants WHERE tournament_id = $1 AND player_id = $2`, [tournamentId, playerId])).rowCount ?? 0;
    if (existing > 0) throw new ApiError(409, 'already_registered', 'You are already registered.');
    const count = (await client.query<{ n: string; max: number }>(
      `SELECT COUNT(*) AS n, (SELECT position FROM tournament_entrants WHERE tournament_id = $1 ORDER BY position DESC LIMIT 1) AS max FROM tournament_entrants WHERE tournament_id = $1`,
      [tournamentId]
    )).rows[0];
    if (Number(count?.n ?? 0) >= TOURNAMENT_SIZE) throw new ApiError(409, 'tournament_full', copy.bracketFull);

    const position = (count?.max ?? 0) + 1;
    await writePair(client, {
      kind: 'tournament_entry',
      refId: tournamentId,
      currency: 'coins',
      lines: [
        { playerId, currency: 'coins', account: 'wallet', amount: -entry },
        { playerId, currency: 'coins', account: 'escrow', amount: entry },
      ],
    });
    await client.query(`INSERT INTO tournament_entrants (tournament_id, player_id, position) VALUES ($1,$2,$3)`, [tournamentId, playerId, position]);
    const refreshed = (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId])).rows[0];
    const n = Number(refreshed?.n ?? 0);
    if (n === 1) {
      const windowSeconds = Number(process.env.TOURNAMENT_WINDOW_SECONDS ?? 300);
      await client.query(
        `UPDATE tournaments SET window_started_at = now(), window_ends_at = now() + ($2 || ' seconds')::interval WHERE id = $1`,
        [tournamentId, windowSeconds]
      );
    }
    if (n >= TOURNAMENT_SIZE) {
      await drawBracket(client, tournamentId);
    }
    return null;
  });
  void body;
  const entrants = await deps.db.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId]);
  deps.onTournamentChange(tournamentId, entrants.rows.map((r) => r.player_id).concat(playerId));
  deps.onMeChange(playerId);
  sendJson(ctx, 201, await tournamentBody(deps.db, tournamentId, playerId));
}

async function drawBracket(client: PoolClient, tournamentId: string): Promise<void> {
  const tournament = (await client.query<{ tier: number; entry: string }>(`SELECT tier, entry FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId])).rows[0];
  if (!tournament) return;
  const entrants = await client.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1 ORDER BY position`, [tournamentId]);
  const slots = entrants.rows.map((_, i) => i + 1);
  // Random draw.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  let index = 0;
  for (const row of entrants.rows) {
    await client.query(`UPDATE tournament_entrants SET slot = $3 WHERE tournament_id = $1 AND player_id = $2`, [tournamentId, row.player_id, slots[index]]);
    index++;
  }
  const readySeconds = Number(process.env.READY_CHECK_SECONDS ?? 30);
  await client.query(
    `UPDATE tournaments SET status = 'ready_check', ready_ends_at = now() + ($2 || ' seconds')::interval, bracket_drawn = true WHERE id = $1`,
    [tournamentId, readySeconds]
  );
}

export async function ready(deps: TournamentDeps, ctx: Ctx, tournamentId: string): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  await deps.db.tx(async (client) => {
    const tournament = (await client.query<{ status: string; ready_ends_at: Date | null }>(`SELECT status, ready_ends_at FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId])).rows[0];
    if (!tournament) throw errors.notFound();
    const entrant = (await client.query(`SELECT 1 FROM tournament_entrants WHERE tournament_id = $1 AND player_id = $2 FOR UPDATE`, [tournamentId, playerId])).rows[0];
    if (!entrant) throw new ApiError(403, 'not_entered', 'You are not entered in this bracket.');
    if (tournament.status !== 'ready_check') throw new ApiError(409, 'not_in_ready_check', 'The ready check is not running.');
    await client.query(`UPDATE tournament_entrants SET ready = true WHERE tournament_id = $1 AND player_id = $2`, [tournamentId, playerId]);
    const readyCount = (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id = $1 AND ready`, [tournamentId])).rows[0];
    const all = (await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId])).rows[0];
    if (Number(readyCount?.n ?? 0) >= TOURNAMENT_SIZE && Number(all?.n ?? 0) >= TOURNAMENT_SIZE) {
      await startRoundOfEight(client, tournamentId);
    }
  });
  sendJson(ctx, 200, await tournamentBody(deps.db, tournamentId, playerId));
}

async function startRoundOfEight(client: PoolClient, tournamentId: string): Promise<void> {
  await client.query(`UPDATE tournaments SET status = 'round_of_8', round = 1, ready_ends_at = NULL WHERE id = $1`, [tournamentId]);
  const tournament = (await client.query<{ tier: number }>(`SELECT tier FROM tournaments WHERE id = $1`, [tournamentId])).rows[0];
  const tier = tournament?.tier ?? 1;
  const entrants = await client.query<{ slot: number; player_id: string }>(
    `SELECT slot, player_id FROM tournament_entrants WHERE tournament_id = $1 ORDER BY slot`, [tournamentId]
  );
  const bySlot = new Map(entrants.rows.map((r) => [r.slot, r.player_id]));
  for (let matchIndex = 0; matchIndex < 4; matchIndex++) {
    const slot1 = matchIndex * 2 + 1;
    const slot2 = matchIndex * 2 + 2;
    await client.query(
      `INSERT INTO tournament_matches (tournament_id, round, match_index, seat1_slot, seat2_slot) VALUES ($1,1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [tournamentId, matchIndex, slot1, slot2]
    );
    const p1 = bySlot.get(slot1);
    const p2 = bySlot.get(slot2);
    if (!p1 || !p2) continue;
    const created = await client.query<{ id: string }>(
      `INSERT INTO matches (id, mode, tier, kind, status, seat1_player, seat2_player, active_seat, phase, balls,
         shot_clock_seconds, entry, pot, tournament_id, tournament_round)
       VALUES ($1,'eight-ball',$2,'tournament','in_play',$3,$4,1,'break','[]'::jsonb,$5,0,0,$6,1) RETURNING id`,
      [newId('table'), tier, p1, p2, Number(process.env.SHOT_CLOCK_SECONDS ?? 30), tournamentId]
    );
    await client.query(`UPDATE tournament_matches SET match_id = $3 WHERE tournament_id = $1 AND round = 1 AND match_index = $2`,
      [tournamentId, matchIndex, created.rows[0].id]);
  }
}

/** Runs window expiry, ready-check expiry and refunds. Called by the clock. */

/** Advances any bracket whose current round has all winners recorded. */
export async function sweepBrackets(deps: TournamentDeps): Promise<void> {
  try {
    const rounds = await deps.db.query<{ id: string; round: number }>(
      `SELECT t.id, t.round FROM tournaments t
       WHERE t.status IN ('round_of_8','semi_finals','final')
         AND EXISTS (
           SELECT 1 FROM tournament_matches tm
           WHERE tm.tournament_id = t.id AND tm.round = t.round AND tm.winner_slot IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM tournament_matches tm2
           WHERE tm2.tournament_id = t.id AND tm2.round = t.round AND tm2.winner_slot IS NULL
         )`
    );
    for (const row of rounds.rows) {
      await advanceRound(deps, row.id, row.round);
    }
  } catch (err) {
    logger.warn(`bracket sweep failed: ${(err as Error).message}`);
  }
}

async function advanceRound(deps: TournamentDeps, tournamentId: string, round: number): Promise<void> {
  await deps.db.tx(async (client) => {
    const tournament = (await client.query<{ id: string; tier: number; entry: string; status: string; round: number }>(
      `SELECT id, tier, entry, status, round FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]
    )).rows[0];
    if (!tournament) return;
    if (tournament.status === 'paid' || tournament.status === 'refunded') return;
    const matches = await client.query<{ match_index: number; winner_slot: number }>(
      `SELECT match_index, winner_slot FROM tournament_matches WHERE tournament_id = $1 AND round = $2 ORDER BY match_index`,
      [tournamentId, round]
    );
    const winners = matches.rows.map((row) => row.winner_slot);
    if (matches.rows.length === 0) return;
    if (winners.some((slot) => slot === null)) return;
    if (matches.rows.length === 1) {
      await payTournamentPrizesOnce(client, tournamentId);
      return;
    }
    // Only the tournament's own current round may advance.
    if (tournament.round !== round) return;
    const nextRound = round === 1 ? 2 : 3;
    const label = nextRound === 2 ? 'semi_finals' : 'final';
    await client.query(`UPDATE tournaments SET status = $2, round = $3 WHERE id = $1`, [tournamentId, label, nextRound]);
    for (let i = 0; i < winners.length; i += 2) {
      const slot1 = winners[i] ?? 0;
      const slot2 = winners[i + 1] ?? slot1;
      await client.query(
        `INSERT INTO tournament_matches (tournament_id, round, match_index, seat1_slot, seat2_slot) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [tournamentId, nextRound, Math.floor(i / 2), slot1, slot2]
      );
      const entrants = await client.query<{ player_id: string }>(
        `SELECT player_id FROM tournament_entrants WHERE tournament_id = $1 AND slot = ANY($2) ORDER BY slot`,
        [tournamentId, [slot1, slot2]]
      );
      if (entrants.rows.length < 2) continue;
      const tier = tournament.tier;
      const created = await client.query<{ id: string }>(
        `INSERT INTO matches (id, mode, tier, kind, status, seat1_player, seat2_player, active_seat, phase, balls,
           shot_clock_seconds, entry, pot, tournament_id, tournament_round)
         VALUES ($1,'eight-ball',$2,'tournament','in_play',$3,$4,1,'break','[]'::jsonb,$5,0,0,$6,$7) RETURNING id`,
        [newId('table'), tier, entrants.rows[0].player_id, entrants.rows[1].player_id, Number(process.env.SHOT_CLOCK_SECONDS ?? 30), tournamentId, nextRound]
      );
      await client.query(
        `UPDATE tournament_matches SET match_id = $4 WHERE tournament_id = $1 AND round = $2 AND match_index = $3`,
        [tournamentId, nextRound, Math.floor(i / 2), created.rows[0].id]
      );
    }
  });
  const entrants = await deps.db.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId]);
  deps.onTournamentChange(tournamentId, entrants.rows.map((r) => r.player_id));
}

export async function payTournamentPrizesOnce(client: PoolClient, tournamentId: string): Promise<void> {
  const t = (await client.query<{ id: string; tier: number; entry: string; status: string }>(`SELECT id, tier, entry, status FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId])).rows[0];
  if (!t || t.status === 'paid' || t.status === 'refunded') return;
  const { tournamentPrizes } = await import('../shared/game.js');
  const prizes = tournamentPrizes(t.tier);
  const rows = await client.query<{ slot: number; player_id: string }>(
    `SELECT slot, player_id FROM tournament_entrants WHERE tournament_id = $1 ORDER BY slot`,
    [tournamentId]
  );
  const finalMatch = await client.query<{ winner_slot: number | null }>(
    `SELECT winner_slot FROM tournament_matches WHERE tournament_id = $1 AND round = 3 ORDER BY match_index LIMIT 1`, [tournamentId]
  );
  const winnerSlot = finalMatch.rows[0]?.winner_slot ?? null;
  const semiRows = await client.query<{ seat1_slot: number; seat2_slot: number; winner_slot: number | null }>(
    `SELECT seat1_slot, seat2_slot, winner_slot FROM tournament_matches WHERE tournament_id = $1 AND round = 2`, [tournamentId]
  );
  const semiLoserSlots = semiRows.rows.map((r) => (r.winner_slot === r.seat1_slot ? r.seat2_slot : r.seat1_slot));
  const finalistSlots = semiRows.rows.map((r) => r.winner_slot ?? 0);
  const secondSlot = winnerSlot !== null ? finalistSlots.find((s) => s !== winnerSlot) ?? null : null;
  const prizeForSlot = (slot: number): number | null => {
    if (slot === winnerSlot) return prizes.first;
    if (slot === secondSlot) return prizes.second;
    if (semiLoserSlots.includes(slot)) return prizes.semiFinal;
    return null;
  };
  let paid = 0;
  for (const row of rows.rows) {
    const prize = prizeForSlot(row.slot);
    if (prize === null) continue;
    await writePair(client, {
      kind: 'tournament_prize',
      refId: tournamentId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'escrow', amount: -prize },
        { playerId: row.player_id, currency: 'coins', account: 'wallet', amount: prize },
      ],
    });
    await client.query(`UPDATE tournament_entrants SET prize_paid = $3 WHERE tournament_id = $1 AND player_id = $2`, [tournamentId, row.player_id, prize]);
    paid += prize;
  }
  const houseShare = Number(t.entry) * 8 - paid;
  if (houseShare > 0) {
    await writePair(client, {
      kind: 'house_cut',
      refId: tournamentId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'escrow', amount: -houseShare },
        { playerId: null, currency: 'coins', account: 'house', amount: houseShare },
      ],
    });
  }
  await client.query(`UPDATE tournaments SET status = 'paid' WHERE id = $1`, [tournamentId]);
  await ensureOpenTournament(client, t.tier);
  for (const row of rows.rows) {
    const coins = await walletBalance(client, row.player_id, 'coins');
    await client.query(`UPDATE players SET coins = $2 WHERE id = $1`, [row.player_id, coins]);
  }
}

export async function sweepTournaments(deps: TournamentDeps): Promise<void> {
  try {
    // Window expired with fewer than 8: refund everyone.
    const short = await deps.db.query<{ id: string; tier: number }>(
      `SELECT id, tier FROM tournaments WHERE status = 'open' AND window_ends_at IS NOT NULL AND window_ends_at < now() AND NOT EXISTS (
         SELECT 1 FROM tournament_entrants e WHERE e.tournament_id = tournaments.id AND (SELECT COUNT(*) FROM tournament_entrants x WHERE x.tournament_id = tournaments.id) >= 8
       )`
    );
    for (const row of short.rows) {
      const count = await deps.db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id = $1`, [row.id]);
      if (Number(count.rows[0]?.n ?? 0) >= TOURNAMENT_SIZE) continue;
      await refundTournament(deps, row.id, copy.windowShort(Number(TIER_ENTRIES[row.tier])));
    }

    // Ready check expired with not everyone ready.
    const missed = await deps.db.query<{ id: string }>(
      `SELECT id FROM tournaments WHERE status = 'ready_check' AND ready_ends_at IS NOT NULL AND ready_ends_at < now() AND EXISTS (
         SELECT 1 FROM tournament_entrants e WHERE e.tournament_id = tournaments.id AND e.ready = false
       )`
    );
    for (const row of missed.rows) {
      const tier = (await deps.db.query<{ tier: number }>(`SELECT tier FROM tournaments WHERE id = $1`, [row.id])).rows[0];
      await refundTournament(deps, row.id, copy.readyMissed(Number(TIER_ENTRIES[tier?.tier ?? 1])));
    }
  } catch (err) {
    logger.warn(`tournament sweep failed: ${(err as Error).message}`);
  }
}

async function refundTournament(deps: TournamentDeps, tournamentId: string, message: string): Promise<void> {
  void message;
  await deps.db.tx(async (client) => {
    const tournament = (await client.query<{ id: string; tier: number; status: string }>(`SELECT id, tier, status FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId])).rows[0];
    if (!tournament || tournament.status === 'refunded' || tournament.status === 'paid') return;
    const entrants = await client.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId]);
    const entry = TIER_ENTRIES[tournament.tier];
    for (const row of entrants.rows) {
      await writePair(client, {
        kind: 'tournament_refund',
        refId: tournamentId,
        currency: 'coins',
        lines: [
          { playerId: row.player_id, currency: 'coins', account: 'escrow', amount: -entry },
          { playerId: row.player_id, currency: 'coins', account: 'wallet', amount: entry },
        ],
      });
    }
    await client.query(`UPDATE tournaments SET status = 'refunded' WHERE id = $1`, [tournamentId]);
    await ensureOpenTournament(client, tournament.tier);
  });
  const entrants = await deps.db.query<{ player_id: string }>(`SELECT player_id FROM tournament_entrants WHERE tournament_id = $1`, [tournamentId]);
  deps.onTournamentChange(tournamentId, entrants.rows.map((r) => r.player_id));
  for (const row of entrants.rows) deps.onMeChange(row.player_id);
}

export { tournamentPool };
