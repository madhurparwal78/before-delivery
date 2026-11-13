import type { PoolClient } from './db.js';
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { TableBody, Mode, PocketName, SeatView, MatchResultView } from '../shared/types.js';
import { tierById, matchXp, NO_GUIDELINES_UNLOCK_LEVEL, HOUSE_CUT_NUMERATOR, HOUSE_CUT_DENOMINATOR } from '../shared/game.js';
import { ApiError, errors } from './errors.js';
import { copy } from './copy.js';
import { id as newId } from './util.js';
import { loadPlayer, applyXp } from './players.js';
import { writePair, walletBalance } from './ledger.js';
import { rackFor } from './rules/rack.js';
import { referee, calledPocketRequiredFor, reSpot, resultLines, type Ruling } from './rules/referee.js';
import { traceShot, cueOverlap, ballInHandDefault, ballsLeftForSeat, groupOf, type Ball, type TableState } from './rules/physics.js';
import { logger } from './logger.js';

export interface MatchRow {
  id: string;
  mode: Mode;
  tier: number;
  kind: 'stake' | 'private' | 'tournament' | 'grading';
  status: 'paired' | 'in_play' | 'settled' | 'forfeited' | 'voided';
  seat1_player: string | null;
  seat2_player: string | null;
  seat1_session: string | null;
  seat2_session: string | null;
  active_seat: 1 | 2;
  phase: 'break' | 'open' | 'groups';
  group_seat1: 'solids' | 'stripes' | null;
  group_seat2: 'solids' | 'stripes' | null;
  balls: Ball[];
  cue_ball_across: number;
  cue_ball_along: number;
  ball_in_hand: boolean;
  ball_in_hand_seat: 1 | 2 | null;
  ball_in_hand_behind_head: boolean;
  called_pocket: PocketName | null;
  script: ScriptEntry[] | null;
  script_index: number;
  pot: number;
  entry: number;
  shot_clock_seconds: number;
  turn_started_at: Date;
  seat1_connected_at: Date;
  seat2_connected_at: Date;
  seat1_dropped_since: Date | null;
  seat2_dropped_since: Date | null;
  seat1_timeouts: number;
  seat2_timeouts: number;
  seat1_cue_stats: { aim: number; power: number; spin: number; time: number } | null;
  seat2_cue_stats: { aim: number; power: number; spin: number; time: number } | null;
  result_line: string | null;
  winner_seat: 1 | 2 | null;
  voided: boolean;
  settlement_written: boolean;
  escrow_closed: boolean;
  tournament_id: string | null;
  tournament_round: number | null;
  rematch_seat1: boolean;
  rematch_seat2: boolean;
  settled_at: Date | null;
}

export interface ScriptEntry {
  firstContact: number | null;
  pocketed: { ball: number; pocket: PocketName }[];
  cushion: boolean;
  scratch: boolean;
  offTable: number[];
}

export interface MatchEvent {
  kind: 'table';
  tableId: string;
}

export interface MatchHooks {
  onTableChange(tableId: string, playerIds: string[]): void;
  onMeChange(playerId: string): void;
  onTournamentChange(tournamentId: string): void;
  clockTick(): void;
}

export class MatchService {
  constructor(private db: Db, private config: Config, private hooks: MatchHooks) {}

  // ---------- Queue ----------

  async joinQueue(playerId: string, mode: Mode, tierId: number, sessionId: string): Promise<{ ticketId: string }> {
    const tier = tierById(tierId);
    return this.db.tx(async (client) => {
      const player = await requireRow(client, playerId);
      if (player.level < tier.minLevel) {
        throw new ApiError(403, 'level_locked', copy.lockedTier(tier.minLevel));
      }
      if (mode === 'no-guidelines' && player.level < NO_GUIDELINES_UNLOCK_LEVEL) {
        throw new ApiError(403, 'mode_locked', copy.modeLocked(NO_GUIDELINES_UNLOCK_LEVEL));
      }
      const coins = await walletBalance(client, playerId, 'coins');
      if (coins < tier.entry) {
        throw new ApiError(409, 'insufficient_coins', copy.refusedCoins);
      }
      const existing = await client.query(`SELECT id, status FROM queue_tickets WHERE player_id = $1 AND status = 'queued' FOR UPDATE`, [playerId]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ApiError(409, 'already_queued', 'Already in the queue.');
      }
      await this.assertNotInMatch(client, playerId);

      // Try to pair with the longest-waiting fitting ticket.
      const waiting = await client.query<{ id: string; player_id: string; session_id: string | null; mode: string; tier: number; created_at: Date; level: number }>(
        `SELECT q.id, q.player_id, q.session_id, q.mode, q.tier, q.created_at, p.level
         FROM queue_tickets q JOIN players p ON p.id = q.player_id
         WHERE q.status = 'queued' AND q.mode = $1 AND q.tier = $2 AND q.player_id <> $3 AND p.deleted_at IS NULL
         ORDER BY q.created_at ASC
         FOR UPDATE OF q`,
        [mode, tierId, playerId]
      );
      for (const candidate of waiting.rows) {
        if (Math.abs(candidate.level - player.level) > this.bandFor(candidate.created_at)) continue;
        const candidateCoins = await walletBalance(client, candidate.player_id, 'coins');
        if (candidateCoins < tier.entry) continue;
        const opponent = await requireRow(client, candidate.player_id);
        if (await this.hasLiveMatch(client, candidate.player_id)) continue;

        const match = await this.createMatch(client, {
          mode,
          tier: tierId,
          kind: 'stake',
          seat1: candidate.player_id,
          seat2: playerId,
          seat1Session: candidate.session_id,
          seat2Session: sessionId,
        });
        await client.query(`UPDATE queue_tickets SET status = 'paired', match_id = $2 WHERE id = $1`, [candidate.id, match]);
        const ticketId = newId('ticket');
        await client.query(
          `INSERT INTO queue_tickets (id, player_id, mode, tier, status, match_id) VALUES ($1,$2,$3,$4,'paired',$5)`,
          [ticketId, playerId, mode, tierId, match]
        );
        return { ticketId };
      }

      const ticketId = newId('ticket');
      await client.query(
        `INSERT INTO queue_tickets (id, player_id, session_id, mode, tier, status) VALUES ($1,$2,$3,$4,$5,'queued')`,
        [ticketId, playerId, sessionId, mode, tierId]
      );
      return { ticketId };
    }).then(async (result) => {
      await this.tryPairQueued(mode, tierId);
      return result;
    });
  }

  bandFor(createdAt: Date): number {
    const waitedMs = Date.now() - createdAt.getTime();
    return 3 + 3 * Math.floor(waitedMs / 10_000);
  }

  async queueStatus(playerId: string): Promise<{ status: 'queued' | 'paired' | 'none'; band?: number; tableUrl?: string }> {
    await this.tryPairAny(playerId);
    const res = await this.db.query<{ status: string; mode: string; tier: number; created_at: Date; match_id: string | null }>(
      `SELECT status, mode, tier, created_at, match_id FROM queue_tickets WHERE player_id = $1 AND status IN ('queued','paired') ORDER BY created_at DESC LIMIT 1`,
      [playerId]
    );
    const row = res.rows[0];
    if (!row) return { status: 'none' };
    if (row.status === 'paired' && row.match_id) {
      return { status: 'paired', tableUrl: `/table/${row.match_id}` };
    }
    const band = this.bandFor(row.created_at);
    return { status: 'queued', band };
  }

  async cancelQueue(playerId: string): Promise<{ status: 'cancelled' }> {
    return this.db.tx(async (client) => {
      const res = await client.query(`SELECT id, status, match_id FROM queue_tickets WHERE player_id = $1 AND status IN ('queued','paired') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [playerId]);
      const row = res.rows[0];
      if (!row) throw new ApiError(409, 'not_queued', 'Not in the queue.');
      if (row.status === 'paired') throw new ApiError(409, 'already_paired', 'Already paired.');
      await client.query(`DELETE FROM queue_tickets WHERE id = $1`, [row.id]);
      return { status: 'cancelled' as const };
    });
  }

  async tryPairAny(playerId: string): Promise<void> {
    const res = await this.db.query<{ mode: string; tier: number }>(
      `SELECT mode, tier FROM queue_tickets WHERE player_id = $1 AND status = 'queued' LIMIT 1`, [playerId]
    );
    if (res.rows[0]) await this.tryPairQueued(res.rows[0].mode as Mode, res.rows[0].tier);
  }

  async tryPairQueued(mode: string, tierId: number): Promise<void> {
    try {
      await this.db.tx(async (client) => {
        const waiting = await client.query<{ id: string; player_id: string; session_id: string | null; created_at: Date; level: number }>(
          `SELECT q.id, q.player_id, q.session_id, q.created_at, p.level
           FROM queue_tickets q JOIN players p ON p.id = q.player_id
           WHERE q.status = 'queued' AND q.mode = $1 AND q.tier = $2 AND p.deleted_at IS NULL
           ORDER BY q.created_at ASC
           FOR UPDATE OF q`,
          [mode, tierId]
        );
        const tier = tierById(tierId);
        const pending: { id: string; player_id: string; session_id: string | null; level: number; created_at: Date }[] = waiting.rows;
        const used = new Set<string>();
        for (const a of pending) {
          if (used.has(a.player_id)) continue;
          for (const b of pending) {
            if (b.player_id === a.player_id || used.has(b.player_id)) continue;
            const longerWait = a.created_at < b.created_at ? a : b;
            const band = this.bandFor(longerWait.created_at);
            if (Math.abs(a.level - b.level) > band) continue;
            const coinsA = await walletBalance(client, a.player_id, 'coins');
            const coinsB = await walletBalance(client, b.player_id, 'coins');
            if (coinsA < tier.entry || coinsB < tier.entry) continue;
            if (await this.hasLiveMatch(client, a.player_id)) continue;
            if (await this.hasLiveMatch(client, b.player_id)) continue;
            const match = await this.createMatch(client, {
              mode: mode as Mode,
              tier: tierId,
              kind: 'stake',
              seat1: a.player_id,
              seat2: b.player_id,
              seat1Session: a.session_id,
              seat2Session: b.session_id,
            });
            await client.query(`UPDATE queue_tickets SET status = 'paired', match_id = $2 WHERE id = $1`, [a.id, match]);
            await client.query(`UPDATE queue_tickets SET status = 'paired', match_id = $2 WHERE id = $1`, [b.id, match]);
            used.add(a.player_id);
            used.add(b.player_id);
          }
        }
      });
    } catch (err) {
      logger.warn(`pairing attempt failed: ${(err as Error).message}`);
    }
  }

  async createMatchRaw(client: PoolClient, spec: Parameters<MatchService['createMatch']>[1]): Promise<string> {
    return this.createMatch(client, spec);
  }

  private async createMatch(
    client: PoolClient,
    spec: {
      mode: Mode;
      tier: number;
      kind: 'stake' | 'private' | 'tournament' | 'grading';
      seat1: string;
      seat2: string | null;
      seat1Session: string | null;
      seat2Session: string | null;
      tournamentId?: string;
      tournamentRound?: number;
      activeSeat?: 1 | 2;
      phase?: 'break' | 'open' | 'groups';
      groups?: { 1: 'solids' | 'stripes' | null; 2: 'solids' | 'stripes' | null };
      balls?: Ball[];
      script?: ScriptEntry[] | null;
      cueStats?: { seat1: { aim: number; power: number; spin: number; time: number } | null; seat2: { aim: number; power: number; spin: number; time: number } | null };
      entry?: number;
    }
  ): Promise<string> {
    const matchId = newId('table');
    const tier = tierById(spec.tier);
    const entry = spec.kind === 'stake' ? tier.entry : 0;
    const balls = spec.balls ?? rackFor(spec.mode);
    const stats1 = spec.cueStats?.seat1 ?? { aim: 0, power: 0, spin: 0, time: 0 };
    const stats2 = spec.cueStats?.seat2 ?? { aim: 0, power: 0, spin: 0, time: 0 };
    const cueBall = balls.find((b) => b.number === 0) ?? { number: 0, across: 50, along: 88 };

    if (spec.kind === 'stake') {
      const pot = tier.pot;
      for (const playerId of [spec.seat1, spec.seat2]) {
        if (!playerId) continue;
        const coins = await walletBalance(client, playerId, 'coins');
        if (coins < entry) throw new ApiError(409, 'insufficient_coins', copy.refusedCoins);
        await writePair(client, {
          kind: 'match_entry',
          refId: matchId,
          currency: 'coins',
          lines: [
            { playerId, currency: 'coins', account: 'wallet', amount: -entry },
            { playerId, currency: 'coins', account: 'escrow', amount: entry },
          ],
        });
      }
      void pot;
    }

    await client.query(
      `INSERT INTO matches (id, mode, tier, kind, status, seat1_player, seat2_player, seat1_session, seat2_session,
         active_seat, phase, group_seat1, group_seat2, balls, cue_ball_across, cue_ball_along,
         shot_clock_seconds, seat1_cue_stats, seat2_cue_stats, entry, pot, script, tournament_id, tournament_round)
       VALUES ($1,$2,$3,$4,'in_play',$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,
         $16,$17::jsonb,$18::jsonb,$19,$20,$21::jsonb,$22,$23)`,
      [
        matchId, spec.mode, spec.tier, spec.kind, spec.seat1, spec.seat2,
        spec.seat1Session, spec.seat2Session,
        spec.activeSeat ?? 1, spec.phase ?? 'break',
        spec.groups?.[1] ?? null, spec.groups?.[2] ?? null,
        JSON.stringify(balls), cueBall.across, cueBall.along,
        this.config.shotClockSeconds + (stats1.time ?? 0),
        JSON.stringify(stats1), JSON.stringify(stats2),
        entry, spec.kind === 'stake' ? tier.pot : 0,
        spec.script ? JSON.stringify(spec.script) : null,
        spec.tournamentId ?? null, spec.tournamentRound ?? null,
      ]
    );
    return matchId;
  }

  private async hasLiveMatch(client: PoolClient, playerId: string): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`,
      [playerId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  private async assertNotInMatch(client: PoolClient, playerId: string): Promise<void> {
    if (await this.hasLiveMatch(client, playerId)) {
      throw new ApiError(409, 'in_match', 'Finish your current match first.');
    }
  }

  // ---------- Table reads ----------

  async loadMatch(client: PoolClient, tableId: string): Promise<MatchRow> {
    const res = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [tableId]);
    const row = res.rows[0];
    if (!row) throw errors.notFound();
    return row;
  }

  async loadMatchNoLock(tableId: string): Promise<MatchRow | null> {
    const res = await this.db.query<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [tableId]);
    return res.rows[0] ?? null;
  }

  async seatOf(row: MatchRow, playerId: string): Promise<1 | 2 | null> {
    if (row.seat1_player === playerId) return 1;
    if (row.seat2_player === playerId) return 2;
    return null;
  }

  async tableBody(viewerSession: string | null, row: MatchRow): Promise<TableBody> {
    const viewerPlayerId = await this.playerForSession(viewerSession);
    const seat = viewerPlayerId ? await this.seatOf(row, viewerPlayerId) : null;
    const seatedHere = seat !== null && ((seat === 1 && row.seat1_session === viewerSession) || (seat === 2 && row.seat2_session === viewerSession));

    const state = this.stateOf(row);
    const nowActive = row.status === 'in_play' ? row.active_seat : row.active_seat;

    const seats: SeatView[] = [];
    for (const seatNum of [1, 2] as const) {
      const playerId = seatNum === 1 ? row.seat1_player : row.seat2_player;
      const displayName = playerId ? await this.displayName(playerId) : 'Open';
      seats.push({
        seat: seatNum,
        playerId: playerId ?? '',
        displayName,
        group: seatNum === 1 ? row.group_seat1 : row.group_seat2,
        ballsLeft: ballsLeftForSeat(state, seatNum),
        connected: this.isConnected(row, seatNum),
      });
    }

    const result = row.status === 'in_play' ? null : await this.resultFor(row, viewerPlayerId);
    return {
      id: row.id,
      mode: row.mode,
      tier: row.tier,
      status: row.status === 'paired' ? 'in_play' : row.status,
      seats,
      activeSeat: nowActive,
      ballInHand: row.ball_in_hand,
      calledPocketRequired: row.status === 'in_play' && calledPocketRequiredFor(state, row.active_seat),
      shotClockSeconds: this.remainingShotClock(row),
      reconnectSeconds: this.reconnectRemaining(row),
      pot: row.kind === 'stake' ? row.pot : (row.kind === 'tournament' ? -1 : 0),
      seatedHere,
      ruleBanner: this.bannerFor(row, viewerPlayerId),
      balls: state.balls.filter((b) => b.number !== 0).map((b) => b.number),
      result,
    };
  }

  private resultFor(row: MatchRow, viewerPlayerId: string | null): Promise<MatchResultView | null> {
    return (async () => {
      if (row.status === 'in_play') return null;
      if (!viewerPlayerId) return null;
      const seat = await this.seatOf(row, viewerPlayerId);
      if (seat === null) return null;
      const opponentName = seat === 1 ? await this.displayName(row.seat2_player ?? '') : await this.displayName(row.seat1_player ?? '');
      const won = row.winner_seat === seat && !row.voided;
      const entry = row.entry;
      const coins = row.kind === 'stake' ? (row.voided ? copy.entryReturned(entry) : won ? copy.potWon(row.pot) : copy.entryLost(entry)) : copy.noStake;
      const xpGained = row.kind === 'grading' || row.kind === 'stake' || row.kind === 'tournament' ? matchXp(row.tier, won && !row.voided) : 0;
      const client = await this.db.pool.connect();
      try {
        const player = viewerPlayerId ? await loadPlayer(client, viewerPlayerId) : null;
        const line = row.voided ? copy.resultVoid : (row.result_line ?? '');
        const winnerLine = row.result_line ?? '';
        let viewerLine: string;
        if (row.voided) {
          viewerLine = copy.resultVoid;
        } else if (row.result_line) {
          const reason = (row.result_line.match(/winner:(\w+)/)?.[1]) ?? '';
          viewerLine = this.viewerResultLine(row, seat, reason, opponentName);
        } else {
          viewerLine = line;
        }
        const levelUps = player ? applyXp(player, 0).levelUps : [];
        return {
          line: viewerLine,
          coinChange: coins,
          xpGained,
          levelUps,
          coins: player ? player.coins : 0,
        };
      } finally {
        client.release();
      }
    })();
  }

  private viewerResultLine(row: MatchRow, seat: 1 | 2, reason: string, opponentName: string): string {
    if (seat === row.winner_seat) {
      switch (reason) {
        case 'win8called': return copy.result8CalledWin;
        case 'win8early': return copy.result8EarlyWin(opponentName);
        case 'win8uncalled': return copy.resultUncalledWin(opponentName);
        case 'win8scratch': return copy.resultScratch8Win(opponentName);
        case 'win8foul': return copy.resultFoul8Win(opponentName);
        case 'win9': return copy.resultNineWin;
        case 'forfeit': return copy.resultForfeitWin(opponentName);
        default: return copy.result8CalledWin;
      }
    }
    switch (reason) {
      case 'win8called': return copy.result8CalledLose(opponentName);
      case 'win8early': return copy.result8EarlyLose;
      case 'win8uncalled': return copy.resultUncalledLose;
      case 'win8scratch': return copy.resultScratch8Lose;
      case 'win8foul': return copy.resultFoul8Lose;
      case 'win9': return copy.resultNineLose(opponentName);
      case 'forfeit': return copy.resultForfeitLose;
      default: return copy.result8CalledLose(opponentName);
    }
  }

  private bannerFor(row: MatchRow, viewerPlayerId: string | null): string {
    void row; void viewerPlayerId;
    return '';
  }

  isConnected(row: MatchRow, seat: 1 | 2): boolean {
    const since = seat === 1 ? row.seat1_dropped_since : row.seat2_dropped_since;
    return since === null;
  }

  remainingShotClock(row: MatchRow): number {
    if (row.status !== 'in_play') return 0;
    const elapsed = (Date.now() - row.turn_started_at.getTime()) / 1000;
    return Math.max(0, Math.ceil(row.shot_clock_seconds - elapsed));
  }

  reconnectRemaining(row: MatchRow): number | null {
    const seat = row.active_seat;
    const since = seat === 1 ? row.seat1_dropped_since : row.seat2_dropped_since;
    if (!since) return null;
    const grace = this.config.reconnectGraceSeconds;
    const elapsed = (Date.now() - since.getTime()) / 1000;
    if (elapsed >= grace) return 0;
    return Math.max(0, Math.ceil(grace - elapsed));
  }

  stateOf(row: MatchRow): TableState {
    const cueBall = { across: row.cue_ball_across, along: row.cue_ball_along };
    const objectBalls = row.balls.filter((b) => b.number !== 0);
    return {
      mode: row.mode,
      phase: row.phase,
      groups: { 1: row.group_seat1, 2: row.group_seat2 },
      balls: row.ball_in_hand ? objectBalls : [{ number: 0, across: cueBall.across, along: cueBall.along }, ...objectBalls],
      cueBall: row.ball_in_hand ? ballInHandDefault() : cueBall,
    };
  }

  private async displayName(playerId: string): Promise<string> {
    if (!playerId) return '';
    const res = await this.db.query<{ display_name: string }>(`SELECT display_name FROM players WHERE id = $1`, [playerId]);
    return res.rows[0]?.display_name ?? '';
  }

  async playerForSession(sessionId: string | null): Promise<string | null> {
    if (!sessionId) return null;
    const res = await this.db.query<{ player_id: string }>(`SELECT player_id FROM sessions WHERE id = $1`, [sessionId]);
    return res.rows[0]?.player_id ?? null;
  }

  // ---------- Shots ----------

  async takeShot(
    tableId: string,
    sessionId: string,
    body: { aimDegrees: number; power: number; sideSpin: number; topSpin: number; calledPocket: PocketName | null }
  ): Promise<TableBody> {
    const row = await this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      const playerId = await this.playerForSession(sessionId);
      if (!playerId) throw errors.unauthenticated();
      const seat = await this.seatOf(match, playerId);
      if (seat === null) throw new ApiError(403, 'not_seated', copy.tableNotYours);
      const seatedSession = seat === 1 ? match.seat1_session : match.seat2_session;
      if (seatedSession !== null && seatedSession !== sessionId) {
        throw new ApiError(409, 'other_device', copy.secondDevice);
      }
      if (match.status !== 'in_play') {
        throw new ApiError(409, 'match_over', 'The match is over.');
      }
      if (match.active_seat !== seat) {
        throw new ApiError(409, 'not_your_turn', "It is not your turn.");
      }
      if (this.remainingShotClock(match) <= 0 && this.turnExpired(match)) {
        throw new ApiError(409, 'shot_clock_expired', copy.lateShot);
      }

      const state = this.stateOf(match);
      if (calledPocketRequiredFor(state, seat) && body.calledPocket === null) {
        throw new ApiError(409, 'called_pocket_required', copy.callPocket);
      }

      if (body.power <= 0) {
        // A zero-power release is a cancel: no turn used.
        return { match, ruling: null, cancel: false, cancelled: true };
      }

      let trace;
      let outcome: ScriptEntry | null = null;
      if (match.script && match.script_index < match.script.length) {
        outcome = match.script[match.script_index];
      }
      if (outcome) {
        trace = {
          firstContact: outcome.firstContact,
          cutAngle: 0,
          contactPoint: null,
          cushionFirst: false,
          pocketed: outcome.pocketed,
          path: [],
          cueBallRest: { across: match.cue_ball_across, along: match.cue_ball_along },
          offTable: outcome.offTable,
          ballsAtRest: match.balls.filter((b) => b.number !== 0),
          cushionAfterContact: outcome.cushion,
          cueScratch: outcome.scratch,
        };
        for (const off of outcome.offTable) {
          if (off !== 0) {
            const idx = trace.ballsAtRest.findIndex((b) => b.number === off);
            if (idx >= 0) trace.ballsAtRest.splice(idx, 1);
          }
        }
        for (const pot of outcome.pocketed) {
          const idx = trace.ballsAtRest.findIndex((b) => b.number === pot.ball);
          if (idx >= 0) trace.ballsAtRest.splice(idx, 1);
        }
        if (outcome.scratch) {
          trace.cueBallRest = { across: 50, along: 12 };
        }
      } else if (match.script && match.script_index >= match.script.length) {
        throw new ApiError(409, 'script_exhausted', 'No scripted shot remains.');
      } else {
        trace = traceShot(state, body.aimDegrees, body.power, body.sideSpin, body.topSpin);
      }

      const isBreak = match.phase === 'break';
      const ruling = referee(state, {
        seat,
        isBreak,
        calledPocket: body.calledPocket,
        trace,
        power: body.power,
        mode: match.mode,
      });

      await client.query(
        `INSERT INTO shots (id, match_id, seat, aim_degrees, power, side_spin, top_spin, called_pocket, ruling)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [newId('shot'), match.id, seat, body.aimDegrees, body.power, body.sideSpin, body.topSpin, body.calledPocket, JSON.stringify(ruling)]
      );

      const updated = await this.applyRuling(client, match, seat, ruling, trace);
      return { match: updated, ruling, cancelled: false };
    });

    this.hooks.onTableChange(tableId, [row.match.seat1_player ?? '', row.match.seat2_player ?? ''].filter(Boolean));
    if (row.match.status !== 'in_play') {
      if (row.match.seat1_player) this.hooks.onMeChange(row.match.seat1_player);
      if (row.match.seat2_player) this.hooks.onMeChange(row.match.seat2_player);
      if (row.match.tournament_id) this.hooks.onTournamentChange(row.match.tournament_id);
    }
    return await this.tableBody(sessionId, row.match);
  }

  private turnExpired(match: MatchRow): boolean {
    return (Date.now() - match.turn_started_at.getTime()) / 1000 > match.shot_clock_seconds + 1;
  }

  private async applyRuling(client: PoolClient, match: MatchRow, seat: 1 | 2, ruling: Ruling, trace: ReturnType<typeof traceShot>): Promise<MatchRow> {
    const opponent = (seat === 1 ? 2 : 1) as 1 | 2;
    let balls = trace.ballsAtRest.map((b) => ({ ...b }));
    let cueBall = trace.cueBallRest;

    if (ruling.eightOnBreak || ruling.offTableRespots.includes(8)) {
      if (!balls.some((b) => b.number === 8)) {
        balls.push({ number: 8, across: 50, along: 50 });
      }
    }
    if (match.mode === 'nine-ball' && ruling.offTableRespots.includes(9)) {
      if (!balls.some((b) => b.number === 9)) {
        balls.push({ number: 9, across: 50, along: 50 });
      }
    }
    for (const number of ruling.offTableRespots) {
      if (number === 8 || number === 9) continue;
      if (!balls.some((b) => b.number === number)) {
        balls.push({ number, across: 50, along: 50 });
      }
    }

    let phase = match.phase;
    let group1 = match.group_seat1;
    let group2 = match.group_seat2;
    if (ruling.groupClaim !== null && ruling.groupClaimSeat !== null) {
      const claimSeat = ruling.groupClaimSeat;
      if (claimSeat === 1) {
        group1 = ruling.groupClaim;
        group2 = ruling.groupClaim === 'solids' ? 'stripes' : 'solids';
      } else {
        group2 = ruling.groupClaim;
        group1 = ruling.groupClaim === 'solids' ? 'stripes' : 'solids';
      }
      phase = 'groups';
    }

    const matchOver = ruling.win !== null;
    const keepTurn = !matchOver && ruling.keepTurn && ruling.ballInHandTo === null && !ruling.illegalBreak;
    const nextSeat: 1 | 2 = matchOver ? seat : keepTurn ? seat : ruling.ballInHandTo ?? opponent;
    const isBreak = phase === 'break';
    const nowBreakDone = isBreak && !matchOver && ruling.illegalBreak === false && phase === 'break';
    if (isBreak && !matchOver && !ruling.eightOnBreak && !ruling.illegalBreak) {
      phase = 'open';
    }
    if (isBreak && ruling.eightOnBreak) {
      phase = 'break';
    }
    if (isBreak && ruling.illegalBreak) {
      phase = 'break';
    }

    const ballInHand = !matchOver && (ruling.ballInHandTo !== null || ruling.illegalBreak);
    const ballInHandSeat: 1 | 2 | null = ballInHand ? (ruling.illegalBreak ? opponent : ruling.ballInHandTo) : null;
    const behindHead = ruling.illegalBreak;

    if (ruling.win !== null) {
      const winnerSeat = ruling.win === 'shooter' ? seat : opponent;
      const reason = this.reasonOf(match, ruling);
      await this.settleMatch(client, match, { winnerSeat, reason });
      const res = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [match.id]);
      return res.rows[0];
    }

    const cueBallNext = ballInHand ? ballInHandDefault() : cueBall;
    const timeoutCount = seat === 1 ? match.seat1_timeouts : match.seat2_timeouts;

    await client.query(
      `UPDATE matches SET
         phase = $2, group_seat1 = $3, group_seat2 = $4,
         balls = $5::jsonb, cue_ball_across = $6, cue_ball_along = $7,
         ball_in_hand = $8, ball_in_hand_seat = $9, ball_in_hand_behind_head = $10,
         active_seat = $11, turn_started_at = now(),
         called_pocket = NULL,
         shot_clock_seconds = $12,
         script_index = script_index + 1
       WHERE id = $1`,
      [
        match.id, phase, group1, group2,
        JSON.stringify(balls), cueBallNext.across, cueBallNext.along,
        ballInHand, ballInHandSeat, behindHead,
        nextSeat,
        this.config.shotClockSeconds + (nextSeat === 1 ? (match.seat1_cue_stats?.time ?? 0) : (match.seat2_cue_stats?.time ?? 0)),
      ]
    );
    void timeoutCount; void nowBreakDone;
    const res = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [match.id]);
    return res.rows[0];
  }

  private reasonOf(match: MatchRow, ruling: Ruling): 'win8called' | 'win8early' | 'win8uncalled' | 'win8scratch' | 'win8foul' | 'win9' | 'forfeit' {
    if (match.mode === 'nine-ball') return 'win9';
    switch (ruling.loseReason) {
      case 'early8': return 'win8early';
      case 'uncalled': return 'win8uncalled';
      case 'scratch8': return 'win8scratch';
      case 'foul8': return 'win8foul';
      default: return 'win8called';
    }
  }

  // ---------- Settlement ----------

  async settleMatch(client: PoolClient, match: MatchRow, outcome: { winnerSeat: 1 | 2; reason: string }): Promise<void> {
    if (await this.escrowEmpty(client, match.id)) return;
    if (match.kind === 'stake' && !match.voided) {
      const winnerId = outcome.winnerSeat === 1 ? match.seat1_player : match.seat2_player;
      if (winnerId) {
        await writePair(client, {
          kind: 'match_win',
          refId: match.id,
          currency: 'coins',
          lines: [
            { playerId: winnerId, currency: 'coins', account: 'escrow', amount: -match.pot },
            { playerId: winnerId, currency: 'coins', account: 'wallet', amount: match.pot },
          ],
        });
        const cut = (match.entry * 2) - match.pot;
        await writePair(client, {
          kind: 'house_cut',
          refId: match.id,
          currency: 'coins',
          lines: [
            { playerId: null, currency: 'coins', account: 'escrow', amount: -cut },
            { playerId: null, currency: 'coins', account: 'house', amount: cut },
          ],
        });
      }
    }
    if (match.kind === 'grading' && match.entry > 0) {
      // A grading table holds real escrow like any stake table; the pot pays out and the cut balances it.
      const winnerId = outcome.winnerSeat === 1 ? match.seat1_player : match.seat2_player;
      if (winnerId) {
        await writePair(client, {
          kind: 'match_win',
          refId: match.id,
          currency: 'coins',
          lines: [
            { playerId: winnerId, currency: 'coins', account: 'escrow', amount: -match.pot },
            { playerId: winnerId, currency: 'coins', account: 'wallet', amount: match.pot },
          ],
        });
        const cut = (match.entry * 2) - match.pot;
        await writePair(client, {
          kind: 'house_cut',
          refId: match.id,
          currency: 'coins',
          lines: [
            { playerId: null, currency: 'coins', account: 'escrow', amount: -cut },
            { playerId: null, currency: 'coins', account: 'house', amount: cut },
          ],
        });
      }
    }
    await this.applyOutcome(client, match, outcome.winnerSeat, outcome.reason);
  }

  private async applyOutcome(client: PoolClient, match: MatchRow, winnerSeat: 1 | 2, reason: string): Promise<void> {
    const status = reason === 'forfeit' ? 'forfeited' : 'settled';
    await client.query(
      `UPDATE matches SET status = $2, winner_seat = $3, result_line = $4, settled_at = now(),
         escrow_closed = $5, settlement_written = true
       WHERE id = $1`,
      [match.id, status, winnerSeat, `winner:${reason}`, true]
    );

    for (const seatNum of [1, 2] as const) {
      const playerId = seatNum === 1 ? match.seat1_player : match.seat2_player;
      if (!playerId) continue;
      const won = seatNum === winnerSeat && match.kind !== 'private';
      const player = await loadPlayer(client, playerId);
      if (!player) continue;
      if (match.kind === 'private') continue;
      const xpGained = matchXp(match.tier, won);
      const { levelUps, finalLevel, finalXp, cashGrant } = applyXp(player, xpGained);
      const coins = await walletBalance(client, playerId, 'coins');
      const cash = await walletBalance(client, playerId, 'cash');
      const newWins = won ? player.wins + 1 : player.wins;
      const newLosses = won ? player.losses : player.losses + 1;
      const streak = won ? player.win_streak + 1 : 0;
      const highestPot = won && match.kind === 'stake' ? Math.max(player.highest_pot, match.pot) : player.highest_pot;
      const weeklyWins = won ? player.weekly_wins + 1 : player.weekly_wins;
      if (cashGrant > 0) {
        await writePair(client, {
          kind: 'level_reward',
          refId: match.id,
          currency: 'cash',
          lines: [
            { playerId: null, currency: 'cash', account: 'system', amount: -cashGrant },
            { playerId, currency: 'cash', account: 'wallet', amount: cashGrant },
          ],
        });
      }
      await client.query(
        `UPDATE players SET level = $2, xp = $3, wins = $4, losses = $5, win_streak = $6,
           highest_pot = GREATEST(highest_pot, $7), weekly_wins = $8, last_win_at = CASE WHEN $9 THEN now() ELSE last_win_at END,
           coins = $10, cash = $11
         WHERE id = $1`,
        [playerId, finalLevel, finalXp, newWins, newLosses, streak, highestPot, weeklyWins, won, coins, cash + cashGrant]
      );
      if (won) {
        await client.query(`UPDATE club_members SET weekly_wins = weekly_wins + 1 WHERE player_id = $1`, [playerId]);
      }
    }
    if (match.tournament_id) {
      await this.advanceTournament(client, match, winnerSeat);
    }
  }

  private async advanceTournament(client: PoolClient, match: MatchRow, winnerSeat: 1 | 2): Promise<void> {
    const res = await client.query<{ id: string }>(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [match.tournament_id ?? '']);
    if (!res.rows[0]) return;
    const tmRes = await client.query<{ round: number; match_index: number; seat1_slot: number; seat2_slot: number; winner_slot: number | null }>(
      `SELECT round, match_index, seat1_slot, seat2_slot, winner_slot FROM tournament_matches WHERE match_id = $1`,
      [match.id]
    );
    const tm = tmRes.rows[0];
    if (!tm) return;
    if (tm.winner_slot !== null) return;
    const winnerSlot = winnerSeat === 1 ? tm.seat1_slot : tm.seat2_slot;
    await client.query(`UPDATE tournament_matches SET winner_slot = $4 WHERE tournament_id = $1 AND round = $2 AND match_index = $3`,
      [match.tournament_id, tm.round, tm.match_index, winnerSlot]);

    const roundMatches = await client.query<{ match_index: number; winner_slot: number | null; seat1_slot: number; seat2_slot: number; voided: boolean }>(
      `SELECT match_index, winner_slot, seat1_slot, seat2_slot, voided FROM tournament_matches WHERE tournament_id = $1 AND round = $2 ORDER BY match_index`,
      [match.tournament_id, tm.round]
    );
    const allDone = roundMatches.rows.every((r) => r.winner_slot !== null);
    if (!allDone) return;

    const winners = roundMatches.rows.map((r) => r.winner_slot ?? (r.seat1_slot ?? 0));
    const round = tm.round;
    if (roundMatches.rows.length === 1) {
      // Final finished: the tournament service pays the prizes exactly once.
      const { payTournamentPrizesOnce } = await import('./tournaments.js');
      await payTournamentPrizesOnce(client, match.tournament_id ?? '');
      return;
    }
    const nextRound = round === 1 ? 2 : 3;
    const label = nextRound === 2 ? 'semi_finals' : 'final';
    await client.query(`UPDATE tournaments SET status = $2, round = $3 WHERE id = $1`, [match.tournament_id, label, nextRound]);
    for (let i = 0; i < winners.length; i += 2) {
      const slot1 = winners[i];
      const slot2 = winners[i + 1] ?? winners[i];
      await client.query(
        `INSERT INTO tournament_matches (tournament_id, round, match_index, seat1_slot, seat2_slot) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [match.tournament_id, nextRound, Math.floor(i / 2), slot1, slot2]
      );
      await this.createBracketMatch(client, match.tournament_id ?? '', nextRound, Math.floor(i / 2), slot1, slot2);
    }
  }

  private async createBracketMatch(client: PoolClient, tournamentId: string, round: number, matchIndex: number, slot1: number, slot2: number): Promise<void> {
    const entrants = await client.query<{ player_id: string }>(
      `SELECT player_id FROM tournament_entrants WHERE tournament_id = $1 AND slot = ANY($2) ORDER BY slot`,
      [tournamentId, [slot1, slot2]]
    );
    if (entrants.rows.length < 2) return;
    const tournament = await client.query<{ tier: number }>(`SELECT tier FROM tournaments WHERE id = $1`, [tournamentId]);
    const tier = tournament.rows[0]?.tier ?? 1;
    await this.createMatch(client, {
      mode: 'eight-ball',
      tier,
      kind: 'tournament',
      seat1: entrants.rows[0].player_id,
      seat2: entrants.rows[1].player_id,
      seat1Session: null,
      seat2Session: null,
      tournamentId,
      tournamentRound: round,
    });
  }

  private async recacheBalances(client: PoolClient, playerId: string): Promise<void> {
    const coins = await walletBalance(client, playerId, 'coins');
    const cash = await walletBalance(client, playerId, 'cash');
    await client.query(`UPDATE players SET coins = $2, cash = $3 WHERE id = $1`, [playerId, coins, cash]);
  }

  async voidMatch(client: PoolClient, match: MatchRow): Promise<void> {
    if (await this.escrowEmpty(client, match.id)) return;
    for (const seatNum of [1, 2] as const) {
      const playerId = seatNum === 1 ? match.seat1_player : match.seat2_player;
      if (!playerId) continue;
      await writePair(client, {
        kind: 'match_refund',
        refId: match.id,
        currency: 'coins',
        lines: [
          { playerId, currency: 'coins', account: 'escrow', amount: -match.entry },
          { playerId, currency: 'coins', account: 'wallet', amount: match.entry },
        ],
      });
      await this.recacheBalances(client, playerId);
    }
    await client.query(`UPDATE matches SET status = 'voided', voided = true, result_line = 'winner:none', settled_at = now(), escrow_closed = true, settlement_written = true WHERE id = $1`, [match.id]);
    if (match.tournament_id) {
      const tm = await client.query<{ round: number; match_index: number; seat1_slot: number; seat2_slot: number }>(
        `SELECT round, match_index, seat1_slot, seat2_slot FROM tournament_matches WHERE match_id = $1`, [match.id]
      );
      if (tm.rows[0]) {
        const row = tm.rows[0];
        const winnerSlot = Math.min(row.seat1_slot ?? 99, row.seat2_slot ?? 99);
        await client.query(`UPDATE tournament_matches SET winner_slot = $4, voided = true WHERE tournament_id = $1 AND round = $2 AND match_index = $3`,
          [match.tournament_id, row.round, row.match_index, winnerSlot]);
        const clone: MatchRow = { ...match, id: match.id };
        await this.advanceTournament(client, clone, winnerSlot === row.seat1_slot ? 1 : 2);
      }
    }
  }

  async forfeitMatch(client: PoolClient, match: MatchRow, forfeitSeat: 1 | 2): Promise<void> {
    const winnerSeat = (forfeitSeat === 1 ? 2 : 1) as 1 | 2;
    await this.settleMatch(client, match, { winnerSeat, reason: 'forfeit' });
  }

  // ---------- Placement ----------

  async placeBall(tableId: string, sessionId: string, across: number, along: number): Promise<TableBody> {
    const row = await this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      const playerId = await this.playerForSession(sessionId);
      if (!playerId) throw errors.unauthenticated();
      const seat = await this.seatOf(match, playerId);
      if (seat === null) throw new ApiError(403, 'not_seated', copy.tableNotYours);
      const seatedSession = seat === 1 ? match.seat1_session : match.seat2_session;
      if (seatedSession !== null && seatedSession !== sessionId) {
        throw new ApiError(409, 'other_device', copy.secondDevice);
      }
      if (match.status !== 'in_play') throw new ApiError(409, 'match_over', 'The match is over.');
      if (match.active_seat !== seat) throw new ApiError(409, 'not_your_turn', 'It is not your turn.');
      if (!match.ball_in_hand) throw new ApiError(409, 'no_ball_in_hand', 'You do not have ball in hand.');
      if (match.ball_in_hand_behind_head && along > 25) {
        throw errors.validation({ along: 'Place the ball behind the head string.' });
      }
      const state = this.stateOf(match);
      if (cueOverlap(state, across, along)) {
        throw new ApiError(409, 'cue_ball_overlap', 'The cue ball overlaps another ball.');
      }
      await client.query(
        `UPDATE matches SET cue_ball_across = $2, cue_ball_along = $3, ball_in_hand = false, ball_in_hand_seat = NULL, called_pocket = NULL WHERE id = $1`,
        [match.id, across, along]
      );
      const res = await client.query<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [match.id]);
      return res.rows[0];
    });
    this.hooks.onTableChange(tableId, [row.seat1_player ?? '', row.seat2_player ?? ''].filter(Boolean));
    return this.tableBody(sessionId, row);
  }

  // ---------- Connection heartbeats ----------

  async heartbeat(tableId: string, sessionId: string): Promise<void> {
    await this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      const playerId = await this.playerForSession(sessionId);
      if (!playerId) return;
      const seat = await this.seatOf(match, playerId);
      if (seat === null) return;
      if (seat === 1) {
        await client.query(`UPDATE matches SET seat1_connected_at = now(), seat1_dropped_since = NULL WHERE id = $1`, [match.id]);
      } else {
        await client.query(`UPDATE matches SET seat2_connected_at = now(), seat2_dropped_since = NULL WHERE id = $1`, [match.id]);
      }
    }).catch(() => undefined);
  }

  private async escrowEmpty(client: PoolClient, refId: string): Promise<boolean> {
    const res = await client.query<{ s: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger_lines WHERE ref_id = $1 AND account = 'escrow'`,
      [refId]
    );
    return Number(res.rows[0]?.s ?? 0) === 0;
  }

  /** Any match whose escrow holds value is settled or voided exactly once. */
  async closeOpenEscrow(): Promise<void> {
    await this.db.tx(async (client) => {
      const rows = await client.query<MatchRow>(
        `SELECT m.* FROM matches m
         WHERE m.status IN ('settled','forfeited','voided')
           AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.ref_id = m.id AND l.account = 'escrow' AND l.amount > 0)
         FOR UPDATE OF m`
      );
      for (const row of rows.rows) {
        const match = this.coerceMatch(row);
        if (match.voided) {
          await this.voidMatch(client, match);
        } else {
          const winnerSeat = (match.winner_seat ?? 1) as 1 | 2;
          const reason = (match.result_line?.match(/winner:(\w+)/)?.[1]) ?? 'win8called';
          await this.settleMatch(client, match, { winnerSeat, reason });
        }
      }
    }).catch((err) => {
      logger.warn(`escrow close failed: ${(err as Error).message}`);
    });
  }

  private coerceMatch(row: MatchRow): MatchRow {
    return row;
  }

  async markDisconnected(tableId: string, seat: 1 | 2): Promise<void> {
    await this.db.query(`UPDATE matches SET ${seat === 1 ? 'seat1_dropped_since' : 'seat2_dropped_since'} = now() WHERE id = $1`, [tableId]);
  }

  /** The clock expiry foul: the turn passes with ball in hand. */
  async expireTurn(tableId: string, seat: 1 | 2): Promise<void> {
    await this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      if (match.status !== 'in_play') return;
      if (match.active_seat !== seat) return;
      if (this.remainingShotClock(match) > 0) return;
      const opponent = (seat === 1 ? 2 : 1) as 1 | 2;
      const timeouts = seat === 1 ? match.seat1_timeouts + 1 : match.seat2_timeouts + 1;
      await client.query(
        `UPDATE matches SET active_seat = $2, ball_in_hand = true, ball_in_hand_seat = $2, ball_in_hand_behind_head = false,
           turn_started_at = now(), ${seat === 1 ? 'seat1_timeouts' : 'seat2_timeouts'} = $3
         WHERE id = $1`,
        [match.id, opponent, timeouts]
      );
      const forfeits = match.kind === 'stake' || match.kind === 'tournament' ? timeouts >= 3 : false;
      if (forfeits) {
        await this.forfeitMatch(client, match, seat);
        return;
      }
      await client.query(
        `UPDATE matches SET active_seat = $2, ball_in_hand = true, ball_in_hand_seat = $2, ball_in_hand_behind_head = false,
           turn_started_at = now(), ${seat === 1 ? 'seat1_timeouts' : 'seat2_timeouts'} = $3
         WHERE id = $1`,
        [match.id, opponent, timeouts]
      );
    });
  }

  /** Both players dropped past the grace: the match is void and entries return. */
  async voidExpired(tableId: string): Promise<void> {
    await this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      if (match.status !== 'in_play') return;
      await this.voidMatch(client, match);
    });
  }

  /** A grading or tournament table starts unclaimed; the first session of a seated player takes the seat. */
  async claimSeatIfNeeded(tableId: string, playerId: string, sessionId: string | null): Promise<string | null> {
    return this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      if (match.seat1_player !== playerId && match.seat2_player !== playerId) return sessionId;
      const seat = match.seat1_player === playerId ? 1 : 2;
      const current = seat === 1 ? match.seat1_session : match.seat2_session;
      if (current && current !== sessionId) return sessionId;
      if (!sessionId) return sessionId;
      if (current === sessionId) return sessionId;
      await client.query(
        `UPDATE matches SET ${seat === 1 ? 'seat1_session' : 'seat2_session'} = $2,
           ${seat === 1 ? 'seat1_dropped_since' : 'seat2_dropped_since'} = NULL
         WHERE id = $1`,
        [match.id, sessionId]
      );
      return sessionId;
    });
  }

  async rematch(tableId: string, playerId: string, sessionId: string): Promise<{ status: string; tableUrl?: string }> {
    return this.db.tx(async (client) => {
      const match = await this.loadMatch(client, tableId);
      const seat = await this.seatOf(match, playerId);
      if (seat === null) throw new ApiError(403, 'not_seated', copy.tableNotYours);
      if (match.status === 'in_play') throw new ApiError(409, 'match_not_over', 'The match is still running.');
      const seatedSession = seat === 1 ? match.seat1_session : match.seat2_session;
      if (seatedSession && seatedSession !== sessionId) {
        throw new ApiError(409, 'other_device', copy.secondDevice);
      }
      if (match.kind === 'stake') {
        const coins = await walletBalance(client, playerId, 'coins');
        const tier = tierById(match.tier);
        if (coins < tier.entry) {
          throw new ApiError(409, 'insufficient_coins', copy.rematchShort);
        }
      }
      const otherSeat = (seat === 1 ? 2 : 1) as 1 | 2;
      const otherAsked = otherSeat === 1 ? match.rematch_seat1 : match.rematch_seat2;
      if (!otherAsked) {
        await client.query(`UPDATE matches SET ${seat === 1 ? 'rematch_seat1' : 'rematch_seat2'} = true WHERE id = $1`, [match.id]);
        return { status: 'waiting' };
      }
      const seat1 = match.seat1_player;
      const seat2 = match.seat2_player;
      if (!seat1 || !seat2) return { status: 'waiting' };
      const newId_ = await this.createMatchRaw(client, {
        mode: match.mode,
        tier: match.tier,
        kind: match.kind,
        seat1,
        seat2,
        seat1Session: match.seat1_session,
        seat2Session: match.seat2_session,
      });
      await client.query(`UPDATE matches SET rematch_seat1 = false, rematch_seat2 = false WHERE id = $1`, [match.id]);
      return { status: 'paired', tableUrl: `/table/${newId_}` };
    });
  }
}

async function requireRow(client: PoolClient, playerId: string) {
  const res = await client.query(`SELECT id, level FROM players WHERE id = $1 AND deleted_at IS NULL`, [playerId]);
  const row = res.rows[0];
  if (!row) throw errors.unauthenticated();
  return row as { id: string; level: number };
}
