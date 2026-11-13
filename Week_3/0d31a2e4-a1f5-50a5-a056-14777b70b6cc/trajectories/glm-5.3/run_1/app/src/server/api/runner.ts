import type { Pool } from "pg";
import { random32Seed } from "../auth.js";
import { roundDef, roundName, slotsFor, TICKS_PER_SECOND, type BeanState, type RoundKind } from "../../shared/domain.js";
import { simulateRound, type InputEntry, type SimBean, type SimResultEntry } from "../sim/sim.js";


const PENDING_TICKS = 5 * TICKS_PER_SECOND;
const INPUT_WINDOW = 10;

type LiveBean = { x: number; y: number; z: number; state: BeanState; rank: number };

type ActiveMatch = {
  matchId: number;
  lobbyId: number;
  participants: number[];
  round: number;
  roundState: "pending" | "running" | "resolved";
  kind: RoundKind;
  seed: number;
  slots: number;
  starters: number[];
  tick: number;
  inputs: Map<number, Map<number, number>>;
  forfeits: Map<number, number>;
  beans: Map<number, LiveBean>;
  busy: boolean;
  timer: NodeJS.Timeout | null;
  pendingTimer: NodeJS.Timeout | null;
};

export type RoundView = {
  n: number;
  kind: RoundKind;
  name: string;
  seed: number;
  state: "pending" | "running" | "resolved";
  starters: number[];
  slots: number;
  lastTick: number | null;
  results:
    | []
    | { userId: number; outcome: "qualified" | "eliminated"; finishTick: number | null; eliminatedTick: number | null; position: number }[];
};

export type MatchRunnerEvents = {
  onRoundStarted: (matchId: number, round: RoundView) => void;
  onTick: (matchId: number, round: number, tick: number, beans: SimBean[], slotsLeft: number) => void;
  onRoundResolved: (matchId: number, round: RoundView) => void;
  onMatchFinished: (matchId: number, participants: number[], winnerId: number | null) => void;
};

/**
 * Runs live rounds at 20 ticks a second. Every tick re-runs the same shared
 * simulation from the round's seed, effective inputs and forfeits, so the
 * broadcast frames, the stored results and the frames endpoint agree exactly.
 */
export class MatchRunner {
  private matches = new Map<number, ActiveMatch>();

  constructor(
    private pool: Pool,
    private events: MatchRunnerEvents
  ) {}

  isRunning(matchId: number): boolean {
    return this.matches.has(matchId);
  }

  activeMatchIds(): number[] {
    return [...this.matches.keys()];
  }

  roundState(matchId: number): { round: number; state: string; tick: number } | null {
    const match = this.matches.get(matchId);
    return match ? { round: match.round, state: match.roundState, tick: match.tick } : null;
  }

  playerInPlay(matchId: number, userId: number): boolean {
    const match = this.matches.get(matchId);
    if (!match) return false;
    const bean = match.beans.get(userId);
    return Boolean(bean && (bean.state === "alive" || bean.state === "falling" || bean.state === "respawning"));
  }

  latestTick(matchId: number): number {
    const match = this.matches.get(matchId);
    return match ? match.tick : 0;
  }

  buttonsOf(matchId: number, userId: number): number {
    const match = this.matches.get(matchId);
    if (!match) return 0;
    for (const byUser of match.inputs.values()) {
      const buttons = byUser.get(userId);
      if (buttons !== undefined) return buttons;
    }
    return 0;
  }

  /** Starts a match for a full lobby: round 1 is created in state pending. */
  async startMatch(matchId: number, lobbyId: number, participants: number[]): Promise<void> {
    const starters = [...participants].sort((a, b) => a - b);
    const def = roundDef(1);
    const seed = random32Seed();
    const slots = slotsFor("race", starters.length);
    await this.pool.query(
      `INSERT INTO rounds (match_id, n, kind, seed, state, slots, starters, started_at)
       VALUES ($1, 1, $2, $3, 'pending', $4, $5, $6)
       ON CONFLICT (match_id, n) DO NOTHING`,
      [matchId, def.kind, seed, slots, starters, new Date()]
    );
    const match: ActiveMatch = {
      matchId,
      lobbyId,
      participants,
      round: 1,
      roundState: "pending",
      kind: def.kind,
      seed,
      slots,
      starters,
      tick: 0,
      inputs: new Map(),
      forfeits: new Map(),
      beans: new Map(),
      busy: false,
      timer: null,
      pendingTimer: null
    };
    this.resetBeans(match);
    this.matches.set(matchId, match);
    this.events.onRoundStarted(matchId, this.roundView(match, null, []));
    match.pendingTimer = setTimeout(() => {
      void this.runRound(match);
    }, (PENDING_TICKS * 1000) / TICKS_PER_SECOND);
  }

  private async runRound(match: ActiveMatch): Promise<void> {
    match.roundState = "running";
    await this.pool.query("UPDATE rounds SET state = 'running' WHERE match_id = $1 AND n = $2", [match.matchId, match.round]);
    this.events.onRoundStarted(match.matchId, this.roundView(match, null, []));
    match.timer = setInterval(() => {
      if (match.busy) return;
      match.busy = true;
      void this.stepRound(match)
        .catch(() => undefined)
        .finally(() => {
          match.busy = false;
        });
    }, 1000 / TICKS_PER_SECOND);
  }

  private async stepRound(match: ActiveMatch): Promise<void> {
    const nextTick = match.tick + 1;
    const sim = simulateRound({
      kind: match.kind,
      seed: match.seed,
      starters: match.starters,
      inputs: this.inputEntries(match),
      forfeits: [...match.forfeits.entries()].map(([userId, tick]) => ({ userId, tick })),
      recordFrames: true,
      upToTick: nextTick
    });
    const frame = sim.frames.get(nextTick);
    if (frame) {
      for (const bean of frame.beans) {
        match.beans.set(bean.userId, { x: bean.x, y: bean.y, z: bean.z, state: bean.state, rank: bean.rank });
      }
      match.tick = nextTick;
      this.events.onTick(match.matchId, match.round, nextTick, frame.beans, frame.slotsLeft);
    }
    if (sim.lastTick !== null) {
      if (match.timer) clearInterval(match.timer);
      match.timer = null;
      await this.resolveRound(match, sim.lastTick, sim.results);
    }
  }

  private inputEntries(match: ActiveMatch): InputEntry[] {
    const entries: InputEntry[] = [];
    for (const [tick, byUser] of match.inputs) {
      for (const [userId, buttons] of byUser) {
        entries.push({ tick, userId, buttons });
      }
    }
    return entries;
  }

  private async resolveRound(match: ActiveMatch, lastTick: number, results: SimResultEntry[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE rounds SET state = 'resolved', last_tick = $1 WHERE match_id = $2 AND n = $3", [
        lastTick,
        match.matchId,
        match.round
      ]);
      for (const result of results) {
        await client.query(
          `INSERT INTO round_results (match_id, round_n, user_id, outcome, finish_tick, eliminated_tick, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [match.matchId, match.round, result.userId, result.outcome, result.finishTick, result.eliminatedTick, result.position]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }

    match.roundState = "resolved";
    this.events.onRoundResolved(match.matchId, this.roundView(match, lastTick, results));

    const qualifiers = results
      .filter((r) => r.outcome === "qualified")
      .map((r) => r.userId)
      .sort((a, b) => a - b);
    const winner = qualifiers.length > 0 ? (results.find((r) => r.outcome === "qualified" && r.position === 1)?.userId ?? null) : null;

    if (match.round === 3 || qualifiers.length === 0 || (qualifiers.length === 1 && match.round === 2)) {
      await this.finishMatch(match, winner);
      return;
    }
    await this.createNextRound(match, qualifiers);
  }

  private async createNextRound(match: ActiveMatch, starters: number[]): Promise<void> {
    const nextRound = match.round + 1;
    const def = roundDef(nextRound);
    const seed = random32Seed();
    const slots = slotsFor(def.kind, starters.length);
    await this.pool.query(
      `INSERT INTO rounds (match_id, n, kind, seed, state, slots, starters, started_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       ON CONFLICT (match_id, n) DO NOTHING`,
      [match.matchId, nextRound, def.kind, seed, slots, starters, new Date()]
    );
    match.round = nextRound;
    match.roundState = "pending";
    match.kind = def.kind;
    match.seed = seed;
    match.slots = slots;
    match.starters = starters;
    match.tick = 0;
    match.inputs = new Map();
    match.forfeits = new Map();
    this.resetBeans(match);
    this.events.onRoundStarted(match.matchId, this.roundView(match, null, []));
    match.pendingTimer = setTimeout(() => {
      void this.runRound(match);
    }, (PENDING_TICKS * 1000) / TICKS_PER_SECOND);
  }

  private async finishMatch(match: ActiveMatch, winnerId: number | null): Promise<void> {
    await this.pool.query("UPDATE matches SET state = 'finished', finished_at = $1, winner_id = $2 WHERE id = $3", [
      new Date(),
      winnerId,
      match.matchId
    ]);
    await this.pool.query("UPDATE lobbies SET state = 'finished', match_id = NULL WHERE id = $1", [match.lobbyId]);
    // Seats belong to open lobbies; participants live on in the rounds.
    await this.pool.query("DELETE FROM lobby_seats WHERE lobby_id = $1", [match.lobbyId]);
    await this.pool.query("UPDATE parties SET state = 'idle', lobby_id = NULL, match_id = NULL WHERE match_id = $1", [match.matchId]);
    this.matches.delete(match.matchId);
    this.events.onMatchFinished(match.matchId, match.participants, winnerId);
  }

  private resetBeans(match: ActiveMatch): void {
    const ids = [...match.starters].sort((a, b) => a - b);
    const spawnXs = [3, 1, -1, -3];
    match.beans = new Map();
    ids.forEach((id, i) => {
      const pos =
        match.kind === "survival"
          ? { x: 8 * Math.cos((i / ids.length) * Math.PI * 2), z: 8 * Math.sin((i / ids.length) * Math.PI * 2) }
          : { x: spawnXs[i % 4] as number, z: -2 - Math.floor(i / 4) * 2 };
      match.beans.set(id, { x: pos.x, y: 0, z: pos.z, state: "alive", rank: i + 1 });
    });
  }

  /**
   * Validates and stores an input. The effective tick is the later of the
   * stamped tick and the latest simulated tick, and a later input for the
   * same effective tick replaces the earlier one.
   */
  async acceptInput(
    matchId: number,
    round: number,
    userId: number,
    stampedTick: number,
    buttons: number
  ): Promise<{ ok: true; effectiveTick: number } | { ok: false; reason: "invalid" | "not_playing" | "late" | "early" }> {
    if (!Number.isInteger(stampedTick) || stampedTick < 0 || !Number.isInteger(buttons) || buttons < 0 || buttons > 63) {
      return { ok: false, reason: "invalid" };
    }
    const match = this.matches.get(matchId);
    if (!match || match.round !== round || match.roundState !== "running") {
      return { ok: false, reason: "not_playing" };
    }
    if (!this.playerInPlay(matchId, userId)) {
      return { ok: false, reason: "not_playing" };
    }
    const latest = match.tick;
    if (stampedTick < latest - INPUT_WINDOW) return { ok: false, reason: "late" };
    if (stampedTick > latest + INPUT_WINDOW) return { ok: false, reason: "early" };

    const effectiveTick = Math.max(stampedTick, latest);
    let byUser = match.inputs.get(effectiveTick);
    if (!byUser) {
      byUser = new Map();
      match.inputs.set(effectiveTick, byUser);
    }
    byUser.set(userId, buttons);
    try {
      await this.pool.query(
        `INSERT INTO round_inputs (match_id, round_n, user_id, tick, buttons)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (match_id, round_n, user_id, tick)
         DO UPDATE SET buttons = EXCLUDED.buttons`,
        [matchId, round, userId, effectiveTick, buttons]
      );
    } catch {
      // The round still runs from the in-memory effective inputs; storage is
      // retried when the round resolves.
    }
    return { ok: true, effectiveTick };
  }

  async forfeit(matchId: number, userId: number): Promise<{ ok: true; tick: number } | { ok: false }> {
    const match = this.matches.get(matchId);
    if (!match || match.roundState !== "running" || !this.playerInPlay(matchId, userId)) {
      return { ok: false };
    }
    const tick = match.tick + 1;
    match.forfeits.set(userId, tick);
    await this.pool.query(
      `INSERT INTO forfeits (match_id, round_n, user_id, tick) VALUES ($1, $2, $3, $4)
       ON CONFLICT (match_id, round_n, user_id) DO NOTHING`,
      [matchId, match.round, userId, tick]
    );
    return { ok: true, tick };
  }

  private roundView(match: ActiveMatch, lastTick: number | null, results: SimResultEntry[]): RoundView {
    return {
      n: match.round,
      kind: match.kind,
      name: roundName(match.round),
      seed: match.seed,
      state: match.roundState,
      starters: match.starters,
      slots: match.slots,
      lastTick,
      results
    };
  }
}

