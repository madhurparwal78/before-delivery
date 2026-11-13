import { ROUND_PENDING_SECONDS, TICK_RATE } from '../../shared/rounds.js';
import { BUTTONS_MAX, RoundEngine, isInPlay } from '../../shared/sim/index.js';
import type { ClientMessage } from '../../shared/types.js';
import { transaction } from '../db.js';
import { invalidTransition } from '../errors.js';
import { hub } from '../ws/hub.js';
import {
  ROUND_COUNT,
  type RoundRow,
  createRound,
  roundPayload,
  setRoundState,
  storeForfeit,
  storeInputs,
  storeResolution,
} from './matches.js';
import { pushParty } from './parties.js';
import { announcePresence } from './presence.js';

export type InputRejection = 'late' | 'early' | 'not_playing' | 'invalid';

/** How far either side of the latest simulated tick an input may be stamped. */
const INPUT_WINDOW_TICKS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const runners = new Map<number, MatchRunner>();

export function runnerFor(matchId: number): MatchRunner | null {
  return runners.get(matchId) ?? null;
}

/** Runs one match: a race, a survival round and a final, at the fixed tick rate. */
export class MatchRunner {
  private readonly matchId: number;
  private readonly participants: number[];
  private readonly scheduled = new Map<number, Map<number, number>>();
  private readonly writes: Promise<unknown>[] = [];
  private round: RoundRow | null = null;
  private engine: RoundEngine | null = null;

  constructor(matchId: number, participants: readonly number[]) {
    this.matchId = matchId;
    this.participants = [...participants];
  }

  static start(matchId: number, participants: readonly number[], firstRound: RoundRow): void {
    const runner = new MatchRunner(matchId, participants);
    runners.set(matchId, runner);
    void runner.run(firstRound);
  }

  private async run(firstRound: RoundRow): Promise<void> {
    let row: RoundRow = firstRound;
    let winnerId: number | null = null;
    for (let n = 1; n <= ROUND_COUNT; n += 1) {
      const qualifiers = await this.playRound(row);
      if (n === ROUND_COUNT || qualifiers.length <= 1) {
        winnerId = qualifiers[0] ?? null;
        break;
      }
      row = await transaction((tx) => createRound(tx, this.matchId, n + 1, qualifiers));
    }
    await this.finish(winnerId);
  }

  private async playRound(row: RoundRow): Promise<number[]> {
    this.round = row;
    this.scheduled.clear();
    await this.pushRound(row);
    await sleep(ROUND_PENDING_SECONDS * 1000);
    await setRoundState(row.id, 'running');
    row.state = 'running';
    await this.pushRound(row);

    const engine = new RoundEngine(row.kind, Number(row.seed), row.starters);
    this.engine = engine;
    this.broadcastTick(engine, 0);
    let due = Date.now();
    while (!engine.resolved) {
      due += 1000 / TICK_RATE;
      await sleep(Math.max(0, due - Date.now()));
      const entries = this.scheduled.get(engine.tick);
      if (entries !== undefined) {
        for (const [userId, buttons] of entries) engine.setButtons(userId, buttons);
        this.writes.push(storeInputs(row.id, engine.tick, new Map(entries)));
        this.scheduled.delete(engine.tick);
      }
      engine.step();
      this.broadcastTick(engine, engine.tick);
    }
    await Promise.all(this.writes);
    this.writes.length = 0;
    const lastTick = engine.lastTick ?? 0;
    await storeResolution(row.id, lastTick, engine.results());
    row.state = 'resolved';
    row.last_tick = lastTick;
    this.engine = null;
    await this.pushRound(row);
    return engine.qualifiers();
  }

  private broadcastTick(engine: RoundEngine, tick: number): void {
    const round = this.round;
    if (round === null) return;
    hub.broadcast(this.participants, {
      type: 'tick',
      matchId: this.matchId,
      round: round.n,
      tick,
      beans: engine.tickBeans(tick),
    });
  }

  private async pushRound(row: RoundRow): Promise<void> {
    const round = await roundPayload(row);
    hub.broadcast(this.participants, { type: 'round', matchId: this.matchId, round });
  }

  /** Accepts an input inside the published tick window, or names the rejection. */
  handleInput(userId: number, message: ClientMessage & { type: 'input' }): InputRejection | null {
    const round = this.round;
    if (
      round === null ||
      message.matchId !== this.matchId ||
      message.round !== round.n ||
      !Number.isInteger(message.tick) ||
      !Number.isInteger(message.buttons) ||
      message.buttons < 0 ||
      message.buttons > BUTTONS_MAX
    ) {
      return 'invalid';
    }
    const engine = this.engine;
    if (engine === null || round.state !== 'running' || !this.inPlay(engine, userId)) {
      return 'not_playing';
    }
    const latest = engine.tick;
    if (message.tick < latest - INPUT_WINDOW_TICKS) return 'late';
    if (message.tick > latest + INPUT_WINDOW_TICKS) return 'early';
    const effective = Math.max(message.tick, latest);
    const bucket = this.scheduled.get(effective) ?? new Map<number, number>();
    bucket.set(userId, message.buttons);
    this.scheduled.set(effective, bucket);
    return null;
  }

  forfeit(userId: number): void {
    const round = this.round;
    const engine = this.engine;
    if (round === null || engine === null || round.state !== 'running') {
      throw invalidTransition(round?.state ?? 'resolved');
    }
    if (!this.inPlay(engine, userId)) throw invalidTransition('eliminated');
    const tick = engine.tick + 1;
    engine.forfeitAt(userId, tick);
    this.writes.push(storeForfeit(round.id, userId, tick));
  }

  private inPlay(engine: RoundEngine, userId: number): boolean {
    const state = engine.stateOf(userId);
    return state !== null && isInPlay(state) && !engine.hasForfeited(userId);
  }

  private async finish(winnerId: number | null): Promise<void> {
    const partyIds = await transaction(async (tx) => {
      const match = await tx.queryOne<{ lobby_id: number }>(
        `UPDATE matches SET state = 'finished', finished_at = now(), winner_id = $2
         WHERE id = $1 RETURNING lobby_id`,
        [this.matchId, winnerId],
      );
      if (match !== null) {
        await tx.query(`UPDATE lobbies SET state = 'finished' WHERE id = $1`, [match.lobby_id]);
        await tx.query('DELETE FROM lobby_seats WHERE lobby_id = $1', [match.lobby_id]);
      }
      const parties = await tx.query<{ id: number }>(
        `UPDATE parties SET state = 'idle', lobby_id = NULL, match_id = NULL, queued_at = NULL
         WHERE match_id = $1 RETURNING id`,
        [this.matchId],
      );
      return parties.map((row) => row.id);
    });
    runners.delete(this.matchId);
    for (const partyId of partyIds) await pushParty(partyId);
    await announcePresence(this.participants);
  }
}
