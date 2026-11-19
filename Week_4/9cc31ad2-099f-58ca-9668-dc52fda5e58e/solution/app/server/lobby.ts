import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { WebSocket } from "ws";
import {
  IDLE_INPUT, LANES, LAYOUTS, LOBBY_AI_PACE_PERCENT, STEPS_PER_SECOND, STEP_LIMIT_PER_LAP, aiDistanceAt, aiTrack,
  carModel, createCar, distance, rankStandings, step, stepsToMs, tunedStats,
  type AiTrack, type CarState, type Input, type Lane,
} from "../shared/model.js";
import { garage } from "./garage.js";
import { errors } from "./http.js";
import { addMovement } from "./ledger.js";
import { onlinePayout } from "./payouts.js";
import type { Services } from "./main.js";

type LobbyState = "open" | "countdown" | "racing" | "finished";

const LOBBY_LAYOUT = LAYOUTS["saltflat-ring"];
const LOBBY_LAPS = 1;
const LOBBY_STEP_LIMIT = LOBBY_LAPS * STEP_LIMIT_PER_LAP;
const MAX_HUMANS = 2;
const MAX_AI = 2;
const COUNTDOWN_FROM = 3;
const RACE_TICK_MS = 16;
const IDLE_TICK_MS = 250;
const PUSH_EVERY_STEPS = 6;
const AI_CAR = "kestrel-hatch";

interface Human {
  readonly playerId: string;
  readonly name: string;
  ready: boolean;
  readonly sockets: Set<WebSocket>;
  droppedAt: number | null;
  car: CarState | null;
  keys: Input;
  finishSteps: number | null;
  dnf: boolean;
}

interface Ai {
  readonly name: string;
  readonly track: AiTrack;
}

// One lobby's server-side life: its state, countdown, race and rejoin windows. Only the server's
// clock decides the countdown, cancellation, rejoin window and finish grace.
class Lobby {
  state: LobbyState = "open";
  countdown: number | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private readonly housekeeping: NodeJS.Timeout;
  private loop: NodeJS.Timeout | null = null;
  private raceStart: number | null = null;
  private steps = 0;
  private graceDeadline: number | null = null;
  readonly humans: Human[] = [];
  readonly ai: Ai[];

  constructor(
    private readonly services: Services,
    readonly id: string,
    readonly hostId: string,
    readonly aiCount: number,
  ) {
    const stats = carModel(AI_CAR)!.stats;
    this.ai = Array.from({ length: aiCount }, (_, i) => ({
      name: `Rookie AI ${i + 1}`,
      track: aiTrack(LOBBY_LAYOUT, stats, LOBBY_LAPS, LOBBY_AI_PACE_PERCENT),
    }));
    this.housekeeping = setInterval(() => this.tick(), IDLE_TICK_MS);
  }

  member(playerId: string): Human | undefined {
    return this.humans.find((human) => human.playerId === playerId);
  }

  add(playerId: string, name: string): void {
    this.humans.push({
      playerId, name, ready: false, sockets: new Set(), droppedAt: null, car: null, keys: IDLE_INPUT,
      finishSteps: null, dnf: false,
    });
  }

  private connected(human: Human): boolean {
    return human.sockets.size > 0 || human.droppedAt === null;
  }

  private standings(): number[] {
    return rankStandings([
      ...this.humans.map((human) => ({ finishSteps: human.finishSteps, distance: human.car ? distance(human.car) : 0 })),
      ...this.ai.map((ai) => ({ finishSteps: this.aiFinish(ai), distance: aiDistanceAt(ai.track, this.steps) })),
    ]);
  }

  private aiFinish(ai: Ai): number | null {
    return this.steps >= ai.track.finishSteps ? ai.track.finishSteps : null;
  }

  body() {
    const racing = this.state === "racing" || this.state === "finished";
    const positions = racing ? this.standings() : [];
    const now = performance.now();
    const lapOf = (laps: number) => Math.min(laps + 1, LOBBY_LAPS);
    return {
      lobbyId: this.id,
      hostId: this.hostId,
      state: this.state,
      countdown: this.countdown,
      graceSecondsLeft: this.graceDeadline !== null && this.state === "racing"
        ? Math.max(0, Math.ceil((this.graceDeadline - now) / 1000)) : null,
      players: this.humans.map((human, i) => ({
        playerId: human.playerId,
        name: human.name,
        ready: human.ready,
        connection: this.connected(human) ? "connected" : "reconnecting",
        rejoinSecondsLeft: this.connected(human) || human.droppedAt === null ? null
          : Math.max(0, Math.ceil((human.droppedAt + this.services.config.rejoinSeconds * 1000 - now) / 1000)),
        position: racing ? positions[i] : null,
        lap: human.car ? lapOf(human.car.lapsCompleted) : null,
        finishMs: human.finishSteps === null ? null : stepsToMs(human.finishSteps),
        dnf: human.dnf,
        distanceM: human.car ? distance(human.car) : 0,
        lane: human.car ? LANES[human.car.lane] : "middle",
        speedMps: human.car ? human.car.speed : 0,
      })),
      ai: this.ai.map((ai, j) => {
        const finish = this.aiFinish(ai);
        const covered = racing ? aiDistanceAt(ai.track, this.steps) : 0;
        return {
          name: ai.name,
          position: racing ? positions[this.humans.length + j] : null,
          lap: racing ? lapOf(Math.floor(covered / LOBBY_LAYOUT.length)) : null,
          finishMs: finish === null ? null : stepsToMs(finish),
          distanceM: covered,
          lane: "middle" as Lane,
        };
      }),
    };
  }

  broadcast(): void {
    this.services.hub.sendLocal(this.humans.map((human) => human.playerId), { type: "lobby", ...this.body() });
    void this.services.db.query("UPDATE lobbies SET state = $2, players = $3, updated_at = now() WHERE id = $1",
      [this.id, this.state, JSON.stringify(this.body().players)]);
  }

  setReady(human: Human, ready: boolean): void {
    human.ready = ready;
    this.evaluateCountdown();
    this.broadcast();
  }

  private bothReady(): boolean {
    return this.humans.length === MAX_HUMANS && this.humans.every((human) => human.ready && this.connected(human));
  }

  // The only place a countdown starts or is cancelled.
  private evaluateCountdown(): void {
    if (this.state === "open" && this.bothReady()) {
      let left = COUNTDOWN_FROM;
      this.state = "countdown";
      this.countdown = left;
      this.countdownTimer = setInterval(() => {
        left -= 1;
        if (left === 0) {
          this.clearCountdown();
          void this.startRace();
        } else {
          this.countdown = left;
          this.broadcast();
        }
      }, 1000);
    } else if (this.state === "countdown" && !this.bothReady()) {
      this.clearCountdown();
      this.state = "open";
      this.countdown = null;
    }
  }

  private clearCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  // The countdown has ended, so the race starts; cars are set up from each player's garage.
  private async startRace(): Promise<void> {
    this.state = "racing";
    this.countdown = null;
    for (const human of this.humans) {
      const owned = await garage(this.services.db, human.playerId);
      const car = owned.cars.find((entry) => entry.carId === owned.selectedCarId) ?? owned.cars[0];
      const model = carModel(car.carId)!;
      human.car = createCar(LOBBY_LAYOUT, tunedStats(model.stats, car.stages), "online", LOBBY_LAPS);
    }
    this.raceStart = performance.now();
    this.steps = 0;
    this.loop = setInterval(() => this.tick(), RACE_TICK_MS);
    this.broadcast();
  }

  attach(human: Human, socket: WebSocket): void {
    human.sockets.add(socket);
    human.droppedAt = null;
    this.broadcast();
  }

  detach(human: Human, socket: WebSocket): void {
    human.sockets.delete(socket);
    if (human.sockets.size > 0 || this.state === "finished") return;
    human.droppedAt = performance.now();
    human.keys = IDLE_INPUT;
    if (this.state === "open" || this.state === "countdown") human.ready = false;
    this.evaluateCountdown();
    this.broadcast();
  }

  setKeys(human: Human, keys: Input): void {
    human.keys = keys;
  }

  private tick(): void {
    const now = performance.now();
    const windowMs = this.services.config.rejoinSeconds * 1000;
    let changed = false;
    for (const human of [...this.humans]) {
      if (human.droppedAt === null || human.sockets.size > 0 || now - human.droppedAt < windowMs) continue;
      if (this.state === "open") {
        this.humans.splice(this.humans.indexOf(human), 1);
        changed = true;
      } else if (this.state === "racing" && human.finishSteps === null && !human.dnf) {
        human.dnf = true;
        changed = true;
      }
    }
    if (this.state === "racing" && this.raceStart !== null) changed = this.advanceRace(now, this.raceStart) || changed;
    if (changed) this.broadcast();
  }

  private advanceRace(now: number, raceStart: number): boolean {
    const target = Math.min(Math.floor(((now - raceStart) * STEPS_PER_SECOND) / 1000), LOBBY_STEP_LIMIT);
    let pushed = false;
    while (this.steps < target) {
      this.steps += 1;
      for (const human of this.humans) {
        if (!human.car || human.car.finished || human.dnf) continue;
        step(human.car, this.connected(human) ? human.keys : IDLE_INPUT);
        if (human.car.finished) human.finishSteps = human.car.steps;
      }
      const someoneFinished = this.humans.some((human) => human.finishSteps !== null)
        || this.ai.some((ai) => this.aiFinish(ai) !== null);
      if (someoneFinished && this.graceDeadline === null) {
        this.graceDeadline = now + this.services.config.finishGraceSeconds * 1000;
      }
      if (this.steps % PUSH_EVERY_STEPS === 0) {
        this.broadcast();
        pushed = true;
      }
    }
    const open = this.humans.filter((human) => human.finishSteps === null && !human.dnf);
    const connectedOpen = this.humans.filter((human) => this.connected(human) && !human.dnf);
    const allConnectedDone = connectedOpen.length > 0 && connectedOpen.every((human) => human.finishSteps !== null);
    const graceOver = this.graceDeadline !== null && now >= this.graceDeadline;
    if (open.length === 0 || allConnectedDone || graceOver || this.steps >= LOBBY_STEP_LIMIT) {
      for (const human of open) human.dnf = true;
      void this.finish();
      return true;
    }
    return pushed;
  }

  // A lobby read back after its process stopped mid-race: every human is out and it is over.
  close(): void {
    for (const human of this.humans) human.dnf = true;
    this.state = "finished";
    clearInterval(this.housekeeping);
  }

  private async finish(): Promise<void> {
    this.state = "finished";
    clearInterval(this.housekeeping);
    if (this.loop) clearInterval(this.loop);
    const positions = this.standings();
    this.broadcast();
    for (const [i, human] of this.humans.entries()) {
      if (human.dnf || human.finishSteps === null) continue;
      await this.services.db.withPlayer(human.playerId, (tx) =>
        addMovement(tx, { playerId: human.playerId, kind: "result", amount: onlinePayout(positions[i]) }));
    }
  }
}

const pedal = (value: unknown): 0 | 1 => (value === 1 ? 1 : 0);

interface StoredLobby {
  [key: string]: unknown;
  host_id: string;
  ai_count: number;
  state: LobbyState;
  players: { playerId: string; name: string }[];
}

// The lobbies this instance runs. A lobby missing from memory (after a restart) is read back from
// Postgres; one that was mid-race when its process stopped comes back finished.
export class Lobbies {
  private readonly lobbies = new Map<string, Lobby>();

  constructor(private readonly services: Services) {}

  async create(hostId: string, hostName: string, aiCount: unknown) {
    if (!Number.isInteger(aiCount) || (aiCount as number) < 0 || (aiCount as number) > MAX_AI) {
      throw errors.invalid({ aiCount: "Choose 0, 1 or 2 AI drivers." });
    }
    const lobby = new Lobby(this.services, randomUUID(), hostId, aiCount as number);
    lobby.add(hostId, hostName);
    await this.services.db.query("INSERT INTO lobbies (id, host_id, ai_count, state, players) VALUES ($1,$2,$3,$4,$5)",
      [lobby.id, hostId, aiCount, lobby.state, JSON.stringify(lobby.body().players)]);
    this.lobbies.set(lobby.id, lobby);
    return { lobbyId: lobby.id, inviteUrl: `/lobby/${lobby.id}`, state: lobby.state };
  }

  private async find(lobbyId: string): Promise<Lobby> {
    const known = this.lobbies.get(lobbyId);
    if (known) return known;
    const [row] = await this.services.db.query<StoredLobby>("SELECT host_id, ai_count, state, players FROM lobbies WHERE id = $1", [lobbyId]);
    if (!row) throw errors.notFound();
    const lobby = new Lobby(this.services, lobbyId, row.host_id, row.ai_count);
    for (const player of row.players) lobby.add(player.playerId, player.name);
    if (row.state !== "open") lobby.close();
    this.lobbies.set(lobbyId, lobby);
    return lobby;
  }

  async read(lobbyId: string) {
    return (await this.find(lobbyId)).body();
  }

  async join(lobbyId: string, playerId: string, name: string) {
    const lobby = await this.find(lobbyId);
    if (!lobby.member(playerId)) {
      if (lobby.state !== "open") throw errors.conflict("LOBBY_CLOSED", "This lobby has already started.");
      if (lobby.humans.length >= MAX_HUMANS) throw errors.conflict("LOBBY_FULL", "This lobby is full.");
      lobby.add(playerId, name);
      lobby.broadcast();
    }
    return lobby.body();
  }

  async ready(lobbyId: string, playerId: string, ready: unknown) {
    const lobby = await this.find(lobbyId);
    const human = lobby.member(playerId);
    if (!human) throw errors.notFound();
    if (lobby.state === "racing" || lobby.state === "finished") throw errors.conflict("LOBBY_CLOSED", "This lobby has already started.");
    if (typeof ready !== "boolean") throw errors.invalid({ ready: "Ready must be true or false." });
    lobby.setReady(human, ready);
    return lobby.body();
  }

  subscribe(socket: WebSocket, playerId: string, lobbyId: unknown): void {
    const lobby = typeof lobbyId === "string" ? this.lobbies.get(lobbyId) : undefined;
    const human = lobby?.member(playerId);
    if (!lobby || !human || human.sockets.has(socket)) return;
    lobby.attach(human, socket);
    socket.on("close", () => lobby.detach(human, socket));
  }

  keys(socket: WebSocket, playerId: string, lobbyId: unknown, keys: Record<string, unknown>): void {
    const lobby = typeof lobbyId === "string" ? this.lobbies.get(lobbyId) : undefined;
    const human = lobby?.member(playerId);
    if (!lobby || !human || !human.sockets.has(socket) || lobby.state !== "racing") return;
    const lane = LANES.includes(keys.lane as Lane) ? (keys.lane as Lane) : "middle";
    lobby.setKeys(human, { throttle: pedal(keys.throttle), brake: pedal(keys.brake), drift: pedal(keys.drift), lane });
  }
}
