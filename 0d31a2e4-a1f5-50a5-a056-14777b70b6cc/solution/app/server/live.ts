// Live matches hosted by this process: the round flow, the fixed-tick loop, input acceptance and forfeits.
import { randomInt } from "node:crypto";
import type pg from "pg";
import { emit, LOCK, lockKey, one, query, transaction } from "./db.js";
import { instanceId } from "./instance.js";
import { sendTo } from "./hub.js";
import { roundJson } from "./matches.js";
import type { Round } from "../shared/api.js";
import { RoundSimulation } from "../shared/sim.js";
import {
  afterRound, INPUT_WINDOW_TICKS, MAX_BUTTONS, MAX_SEED, ROUND_PENDING_SECONDS, type RoundKind, ROUNDS, slotsFor, TICKS_PER_SECOND,
} from "../shared/rules.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;

interface RoundRow {
  id: number;
  n: number;
  kind: RoundKind;
  seed: number;
  starters: number[];
  slots: number;
}

type Rejection = { tick: number | null; reason: "late" | "early" | "not_playing" | "invalid" };

class LiveMatch {
  readonly id: number;
  readonly participants: number[];
  round: RoundRow | null = null;
  simulation: RoundSimulation | null = null;
  private writes: Promise<void> = Promise.resolve();
  private unsaved = new Map<string, { tick: number; userId: number; buttons: number }>();

  constructor(id: number, participants: number[]) {
    this.id = id;
    this.participants = participants;
  }

  private broadcast(message: object): void {
    for (const userId of this.participants) sendTo(userId, message);
  }

  private async announceRound(): Promise<void> {
    if (this.round === null) return;
    const round: Round = await roundJson(this.round.id);
    this.broadcast({ type: "round", matchId: this.id, round });
  }

  private broadcastTick(simulation: RoundSimulation): void {
    if (this.round === null) return;
    this.broadcast({ type: "tick", matchId: this.id, round: this.round.n, tick: simulation.tick, beans: simulation.tickBeans() });
  }

  accept(userId: number, tick: number, buttons: number): void {
    const simulation = this.simulation;
    if (simulation === null) return;
    const effective = Math.max(tick, simulation.tick);
    simulation.setInput(userId, effective, buttons);
    this.unsaved.set(`${effective}:${userId}`, { tick: effective, userId, buttons });
  }

  async forfeit(userId: number): Promise<boolean> {
    const simulation = this.simulation;
    const round = this.round;
    if (simulation === null || round === null || !simulation.isInPlay(userId)) return false;
    const tick = simulation.tick + 1;
    simulation.setForfeit(userId, tick);
    await query("INSERT INTO round_forfeits (round_id, user_id, tick) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [round.id, userId, tick]);
    return true;
  }

  private flushInputs(roundId: number): Promise<void> {
    if (this.unsaved.size === 0) return this.writes;
    const batch = [...this.unsaved.values()];
    this.unsaved = new Map();
    this.writes = this.writes.then(async () => {
      await query(
        `INSERT INTO round_inputs (round_id, tick, user_id, buttons)
         SELECT $1, * FROM unnest($2::int[], $3::int[], $4::int[])
         ON CONFLICT (round_id, tick, user_id) DO UPDATE SET buttons = EXCLUDED.buttons`,
        [roundId, batch.map((entry) => entry.tick), batch.map((entry) => entry.userId), batch.map((entry) => entry.buttons)]);
    });
    return this.writes;
  }

  private runTicks(simulation: RoundSimulation, roundId: number): Promise<void> {
    return new Promise((resolve) => {
      const started = performance.now();
      const next = (): void => {
        const due = Math.floor((performance.now() - started) / TICK_MS);
        while (simulation.tick < due && !simulation.decided) {
          simulation.step();
          this.broadcastTick(simulation);
        }
        void this.flushInputs(roundId).catch((error: unknown) => console.error(error));
        if (simulation.decided) {
          resolve();
          return;
        }
        setTimeout(next, Math.max(0, started + (simulation.tick + 1) * TICK_MS - performance.now()));
      };
      this.broadcastTick(simulation);
      setTimeout(next, TICK_MS);
    });
  }

  private async playRound(round: RoundRow): Promise<number[]> {
    this.round = round;
    await this.announceRound();
    await sleep(ROUND_PENDING_SECONDS * 1000);
    const simulation = new RoundSimulation(round.kind, round.seed, round.starters);
    this.simulation = simulation;
    await query("UPDATE rounds SET state = 'running' WHERE id = $1", [round.id]);
    await this.announceRound();
    await this.runTicks(simulation, round.id);
    await this.flushInputs(round.id);
    const results = simulation.results();
    await transaction(async (client) => {
      for (const result of results) {
        await query(
          "INSERT INTO round_results (round_id, user_id, outcome, finish_tick, eliminated_tick, position) VALUES ($1, $2, $3, $4, $5, $6)",
          [round.id, result.userId, result.outcome, result.finishTick, result.eliminatedTick, result.position], client);
      }
      await query("UPDATE rounds SET state = 'resolved', last_tick = $2 WHERE id = $1", [round.id, simulation.tick], client);
    });
    this.simulation = null;
    await this.announceRound();
    return results.filter((result) => result.outcome === "qualified").map((result) => result.userId);
  }

  async run(firstRound: RoundRow): Promise<void> {
    let round: RoundRow = firstRound;
    for (;;) {
      const qualifiers = await this.playRound(round);
      const after = afterRound(round.n, qualifiers);
      if ("winner" in after) {
        this.round = null;
        await finishMatch(this.id, after.winner);
        break;
      }
      round = await createRound(this.id, after.next.n, after.next.kind, qualifiers);
    }
    live.delete(this.id);
  }
}

const live = new Map<number, LiveMatch>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRound(matchId: number, n: number, kind: RoundKind, starters: number[], on?: pg.PoolClient): Promise<RoundRow> {
  const sorted = [...starters].sort((a, b) => a - b);
  const row = await one<{ id: number }>(
    "INSERT INTO rounds (match_id, n, kind, seed, state, starters, slots) VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id",
    [matchId, n, kind, randomInt(0, MAX_SEED + 1), sorted, slotsFor(kind, sorted.length)], on);
  if (row === undefined) throw new Error("round not stored");
  const stored = await one<RoundRow>("SELECT id, n, kind, seed, starters, slots FROM rounds WHERE id = $1", [row.id], on);
  if (stored === undefined) throw new Error("round not stored");
  return stored;
}

async function finishMatch(matchId: number, winnerId: number | null): Promise<void> {
  await transaction(async (client) => {
    await lockKey(client, LOCK.seating, 0);
    const match = await one<{ lobby_id: number }>(
      "UPDATE matches SET state = 'finished', finished_at = $2, winner_id = $3 WHERE id = $1 RETURNING lobby_id",
      [matchId, new Date(), winnerId], client);
    if (match !== undefined) await query("UPDATE lobbies SET state = 'finished' WHERE id = $1", [match.lobby_id], client);
    const freed = await query(
      "UPDATE parties SET state = 'idle', lobby_id = NULL, match_id = NULL WHERE match_id = $1 AND state = 'in_match' RETURNING id",
      [matchId], client);
    for (const party of freed) await emit(client, { kind: "party", partyId: Number(party["id"]) });
    if (match !== undefined) await emit(client, { kind: "lobby", lobbyId: match.lobby_id });
  });
}

// Starts the match for a lobby whose countdown has ended. The live process holding most of the seated players'
// connections runs it; with none connected anywhere, the lobby's host does, or any process once that host has gone.
export async function startDueMatches(): Promise<void> {
  const started = await transaction(async (client) => {
    await lockKey(client, LOCK.seating, 0);
    const lobby = await one<{ id: number }>(
      `WITH alive AS (SELECT id FROM server_instances WHERE seen_at > clock_timestamp() - interval '10 seconds'),
       due AS (
         SELECT l.id, l.host_instance,
           (SELECT c.instance_id FROM socket_users c JOIN seats s ON s.user_id = c.user_id AND s.lobby_id = l.id
              WHERE c.instance_id IN (SELECT id FROM alive)
              GROUP BY c.instance_id ORDER BY count(*) DESC, c.instance_id LIMIT 1) AS players_at
         FROM lobbies l WHERE l.state = 'countdown' AND l.countdown_ends_at <= clock_timestamp())
       SELECT l.id FROM lobbies l JOIN due d ON d.id = l.id
       WHERE COALESCE(d.players_at, CASE WHEN d.host_instance IN (SELECT id FROM alive) THEN d.host_instance END, $1) = $1
       ORDER BY l.id LIMIT 1 FOR UPDATE OF l`, [instanceId], client);
    if (lobby === undefined) return null;
    const seated = (await query("SELECT user_id FROM seats WHERE lobby_id = $1 ORDER BY seat", [lobby.id], client))
      .map((row) => Number(row["user_id"]));
    const match = await one<{ id: number }>(
      "INSERT INTO matches (lobby_id, state, started_at) VALUES ($1, 'running', $2) RETURNING id", [lobby.id, new Date()], client);
    if (match === undefined) throw new Error("match not stored");
    await query("INSERT INTO match_participants (match_id, user_id) SELECT $1, unnest($2::int[])", [match.id, seated], client);
    const first = ROUNDS[0];
    if (first === undefined) throw new Error("no rounds defined");
    const round = await createRound(match.id, first.n, first.kind, seated, client);
    await query("UPDATE lobbies SET state = 'running', countdown_ends_at = NULL, match_id = $2 WHERE id = $1", [lobby.id, match.id], client);
    const parties = await query(
      "UPDATE parties SET state = 'in_match', match_id = $2 WHERE lobby_id = $1 AND state = 'in_lobby' RETURNING id",
      [lobby.id, match.id], client);
    for (const party of parties) await emit(client, { kind: "party", partyId: Number(party["id"]) });
    await emit(client, { kind: "lobby", lobbyId: lobby.id });
    return { match: new LiveMatch(match.id, seated), round };
  });
  if (started === null) return;
  live.set(started.match.id, started.match);
  void started.match.run(started.round).catch((error: unknown) => console.error(error));
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

// Judges one input message, in the published order: invalid, not playing, late, early.
export function handleInput(userId: number, message: Record<string, unknown>): Rejection | null {
  const matchId = integer(message["matchId"]);
  const roundNumber = integer(message["round"]);
  const tick = integer(message["tick"]);
  const buttons = integer(message["buttons"]);
  const match = matchId === null ? undefined : live.get(matchId);
  if (tick === null || buttons === null || match === undefined || match.round === null || match.round.n !== roundNumber
    || buttons < 0 || buttons > MAX_BUTTONS) {
    return { tick, reason: "invalid" };
  }
  const simulation = match.simulation;
  if (simulation === null || simulation.decided || !simulation.isInPlay(userId)) return { tick, reason: "not_playing" };
  if (tick < simulation.tick - INPUT_WINDOW_TICKS) return { tick, reason: "late" };
  if (tick > simulation.tick + INPUT_WINDOW_TICKS) return { tick, reason: "early" };
  match.accept(userId, tick, buttons);
  return null;
}

export async function forfeitHere(matchId: number, userId: number): Promise<boolean | null> {
  const match = live.get(matchId);
  return match === undefined ? null : match.forfeit(userId);
}
