import { randomUUID } from 'node:crypto';
import {
  LAYOUTS,
  LOBBY_AI_CAR_ID,
  LOBBY_AI_NAMES,
  LOBBY_AI_PACE_FACTOR,
  LOBBY_COUNTDOWN_SECONDS,
  LOBBY_LAPS,
  LOBBY_LAYOUT,
  MAX_HUMANS_PER_LOBBY,
  type StageMap,
  statsWithStages,
  stepLimitFor,
} from '../shared/catalogue.js';
import {
  AiCar,
  CarSim,
  type Contender,
  type InputState,
  rankContenders,
} from '../shared/race-model.js';
import { onlineResultCoins } from '../shared/payouts.js';
import { config } from './config.js';
import { db, one, withPlayerLock, type Queryable } from './db.js';
import { conflict, notFound, validationFailed } from './errors.js';
import { writeMovement } from './ledger.js';
import { pushToPlayers } from './pushes.js';

export type LobbyState = 'open' | 'countdown' | 'racing' | 'finished';

interface LobbyMember {
  playerId: string;
  name: string;
  ready: boolean;
  connection: 'connected' | 'reconnecting';
  rejoinDeadlineMs: number | null;
  input: InputState;
  sim: CarSim | null;
  finishStep: number | null;
  dnf: boolean;
}

interface LobbyRuntime {
  lobbyId: string;
  hostId: string;
  aiCount: number;
  state: LobbyState;
  countdown: number | null;
  members: Map<string, LobbyMember>;
  order: string[];
  ai: AiCar[];
  step: number;
  startedAtMs: number | null;
  graceDeadlineMs: number | null;
  timer: NodeJS.Timeout | null;
  paid: boolean;
}

const lobbies = new Map<string, LobbyRuntime>();
const RACE_LOOP_MS = 16;
const COUNTDOWN_TICK_MS = 1000;

function idleInput(): InputState {
  return { throttle: 0, brake: 0, drift: 0, lane: 'middle' };
}

function clearTimer(lobby: LobbyRuntime): void {
  if (lobby.timer !== null) {
    clearInterval(lobby.timer);
    lobby.timer = null;
  }
}

async function loadRuntime(lobbyId: string): Promise<LobbyRuntime | null> {
  const existing = lobbies.get(lobbyId);
  if (existing) return existing;
  const row = await one<{ lobby_id: string; host_id: string; state: string; ai_count: number }>(
    db,
    'select lobby_id, host_id, state, ai_count from lobbies where lobby_id = $1',
    [lobbyId],
  );
  if (!row) return null;
  const runtime: LobbyRuntime = {
    lobbyId: row.lobby_id,
    hostId: row.host_id,
    aiCount: row.ai_count,
    state: row.state === 'open' ? 'open' : (row.state as LobbyState),
    countdown: null,
    members: new Map(),
    order: [],
    ai: [],
    step: 0,
    startedAtMs: null,
    graceDeadlineMs: null,
    timer: null,
    paid: false,
  };
  const { rows } = await db.query<{ player_id: string; name: string; ready: boolean }>(
    `select lp.player_id, p.name, lp.ready from lobby_players lp
     join players p on p.player_id = lp.player_id
     where lp.lobby_id = $1 order by lp.joined_seq asc`,
    [lobbyId],
  );
  for (const member of rows) {
    runtime.members.set(member.player_id, {
      playerId: member.player_id,
      name: member.name,
      ready: member.ready,
      connection: 'connected',
      rejoinDeadlineMs: null,
      input: idleInput(),
      sim: null,
      finishStep: null,
      dnf: false,
    });
    runtime.order.push(member.player_id);
  }
  lobbies.set(lobbyId, runtime);
  return runtime;
}

export interface LobbyBody {
  lobbyId: string;
  hostId: string;
  state: LobbyState;
  countdown: number | null;
  graceSecondsLeft: number | null;
  players: {
    playerId: string;
    name: string;
    ready: boolean;
    connection: 'connected' | 'reconnecting';
    rejoinSecondsLeft: number | null;
    position: number | null;
    lap: number;
    finishMs: number | null;
    dnf: boolean;
  }[];
  ai: { name: string; position: number | null; lap: number; finishMs: number | null }[];
}

function contendersOf(lobby: LobbyRuntime): Contender[] {
  const layoutLength = LAYOUTS[LOBBY_LAYOUT].lengthM;
  const human: Contender[] = lobby.order.map((playerId) => {
    const member = lobby.members.get(playerId)!;
    return {
      name: member.playerId,
      isPlayer: true,
      lapsCompleted: member.sim?.lapsCompleted ?? 0,
      lapPos: member.sim?.lapPos ?? 0,
      finishStep: member.finishStep,
    };
  });
  const ai: Contender[] = lobby.ai.map((car, index) => {
    const distance = car.distanceAtStep(lobby.step);
    const finished = lobby.step >= car.finishStep;
    return {
      name: `ai:${index}`,
      isPlayer: false,
      lapsCompleted: Math.floor(distance / layoutLength),
      lapPos: distance % layoutLength,
      finishStep: finished ? car.finishStep : null,
    };
  });
  return [...human, ...ai];
}

function positions(lobby: LobbyRuntime): Map<string, number> {
  const ranked = rankContenders(contendersOf(lobby));
  const places = new Map<string, number>();
  ranked.forEach((entry, index) => places.set(entry.name, index + 1));
  return places;
}

export function lobbyBody(lobby: LobbyRuntime): LobbyBody {
  const racing = lobby.state === 'racing' || lobby.state === 'finished';
  const places = racing ? positions(lobby) : new Map<string, number>();
  const now = Date.now();
  return {
    lobbyId: lobby.lobbyId,
    hostId: lobby.hostId,
    state: lobby.state,
    countdown: lobby.countdown,
    graceSecondsLeft:
      lobby.graceDeadlineMs === null
        ? null
        : Math.max(0, Math.ceil((lobby.graceDeadlineMs - now) / 1000)),
    players: lobby.order.map((playerId) => {
      const member = lobby.members.get(playerId)!;
      return {
        playerId,
        name: member.name,
        ready: member.ready,
        connection: member.connection,
        rejoinSecondsLeft:
          member.rejoinDeadlineMs === null
            ? null
            : Math.max(0, Math.ceil((member.rejoinDeadlineMs - now) / 1000)),
        position: places.get(playerId) ?? null,
        lap: Math.min((member.sim?.lapsCompleted ?? 0) + 1, LOBBY_LAPS),
        finishMs: member.finishStep === null ? null : Math.round((member.finishStep * 1000) / 60),
        dnf: member.dnf,
      };
    }),
    ai: lobby.ai.map((car, index) => {
      const distance = car.distanceAtStep(lobby.step);
      const finished = lobby.step >= car.finishStep;
      return {
        name: car.name,
        position: places.get(`ai:${index}`) ?? null,
        lap: Math.min(Math.floor(distance / LAYOUTS[LOBBY_LAYOUT].lengthM) + 1, LOBBY_LAPS),
        finishMs: finished ? car.finishMs : null,
      };
    }),
  };
}

function publish(lobby: LobbyRuntime): void {
  pushToPlayers([...lobby.members.keys()], { type: 'lobby', ...lobbyBody(lobby) });
}

export async function createLobby(
  playerId: string,
  body: Record<string, unknown>,
): Promise<{ lobbyId: string; inviteUrl: string; state: LobbyState }> {
  const aiCount = body.aiCount;
  if (aiCount !== 0 && aiCount !== 1 && aiCount !== 2) {
    throw validationFailed({ aiCount: 'Choose 0, 1 or 2 AI drivers.' });
  }
  const lobbyId = randomUUID();
  await db.query(
    `insert into lobbies (lobby_id, host_id, state, ai_count) values ($1, $2, 'open', $3)`,
    [lobbyId, playerId, aiCount],
  );
  await db.query('insert into lobby_players (lobby_id, player_id) values ($1, $2)', [
    lobbyId,
    playerId,
  ]);
  await loadRuntime(lobbyId);
  return { lobbyId, inviteUrl: `/lobby/${lobbyId}`, state: 'open' };
}

export async function readLobby(lobbyId: string): Promise<LobbyBody> {
  const lobby = await loadRuntime(lobbyId);
  if (!lobby) throw notFound();
  return lobbyBody(lobby);
}

export async function joinLobby(lobbyId: string, playerId: string, name: string): Promise<LobbyBody> {
  const lobby = await loadRuntime(lobbyId);
  if (!lobby) throw notFound();
  if (lobby.members.has(playerId)) return lobbyBody(lobby);
  if (lobby.state !== 'open') throw conflict('LOBBY_CLOSED', 'This lobby has already started.');
  if (lobby.members.size >= MAX_HUMANS_PER_LOBBY) {
    throw conflict('LOBBY_FULL', 'This lobby is full.');
  }
  await db.query(
    'insert into lobby_players (lobby_id, player_id) values ($1, $2) on conflict do nothing',
    [lobbyId, playerId],
  );
  lobby.members.set(playerId, {
    playerId,
    name,
    ready: false,
    connection: 'connected',
    rejoinDeadlineMs: null,
    input: idleInput(),
    sim: null,
    finishStep: null,
    dnf: false,
  });
  lobby.order.push(playerId);
  publish(lobby);
  return lobbyBody(lobby);
}

export async function setReady(
  lobbyId: string,
  playerId: string,
  ready: unknown,
): Promise<LobbyBody> {
  const lobby = await loadRuntime(lobbyId);
  if (!lobby) throw notFound();
  const member = lobby.members.get(playerId);
  if (!member) throw notFound();
  if (lobby.state === 'racing' || lobby.state === 'finished') {
    throw conflict('LOBBY_CLOSED', 'This lobby has already started.');
  }
  if (typeof ready !== 'boolean') throw validationFailed({ ready: 'Send true or false.' });
  member.ready = ready;
  await db.query('update lobby_players set ready = $3 where lobby_id = $1 and player_id = $2', [
    lobbyId,
    playerId,
    ready,
  ]);
  evaluateReadiness(lobby);
  publish(lobby);
  return lobbyBody(lobby);
}

/** The single place the lobby's open/countdown transitions are decided. */
function evaluateReadiness(lobby: LobbyRuntime): void {
  const humans = [...lobby.members.values()];
  const allReady =
    humans.length === MAX_HUMANS_PER_LOBBY &&
    humans.every((member) => member.ready && member.connection === 'connected');
  if (lobby.state === 'open' && allReady) {
    startCountdown(lobby);
    return;
  }
  if (lobby.state === 'countdown' && !allReady) {
    cancelCountdown(lobby);
  }
}

function startCountdown(lobby: LobbyRuntime): void {
  clearTimer(lobby);
  lobby.state = 'countdown';
  lobby.countdown = LOBBY_COUNTDOWN_SECONDS;
  void db.query('update lobbies set state = $2 where lobby_id = $1', [lobby.lobbyId, 'countdown']);
  lobby.timer = setInterval(() => {
    if (lobby.countdown === null) return;
    lobby.countdown -= 1;
    if (lobby.countdown <= 0) {
      startRace(lobby);
      return;
    }
    publish(lobby);
  }, COUNTDOWN_TICK_MS);
}

function cancelCountdown(lobby: LobbyRuntime): void {
  clearTimer(lobby);
  lobby.state = 'open';
  lobby.countdown = null;
  void db.query('update lobbies set state = $2 where lobby_id = $1', [lobby.lobbyId, 'open']);
}

async function raceStats(playerId: string): Promise<{ stages: StageMap; carId: string }> {
  const row = await one<{
    car_id: string;
    stage_engine: number;
    stage_tires: number;
    stage_brakes: number;
    stage_suspension: number;
  }>(
    db,
    `select oc.car_id, oc.stage_engine, oc.stage_tires, oc.stage_brakes, oc.stage_suspension
     from players p join owned_cars oc
       on oc.player_id = p.player_id and oc.car_id = p.selected_car_id
     where p.player_id = $1`,
    [playerId],
  );
  if (!row) return { carId: LOBBY_AI_CAR_ID, stages: { engine: 0, tires: 0, brakes: 0, suspension: 0 } };
  return {
    carId: row.car_id,
    stages: {
      engine: row.stage_engine,
      tires: row.stage_tires,
      brakes: row.stage_brakes,
      suspension: row.stage_suspension,
    },
  };
}

function startRace(lobby: LobbyRuntime): void {
  clearTimer(lobby);
  lobby.state = 'racing';
  lobby.countdown = null;
  lobby.step = 0;
  lobby.startedAtMs = Date.now();
  void db.query('update lobbies set state = $2 where lobby_id = $1', [lobby.lobbyId, 'racing']);

  const layout = LAYOUTS[LOBBY_LAYOUT];
  const stepLimit = stepLimitFor('circuit', LOBBY_LAPS);
  lobby.ai = LOBBY_AI_NAMES.slice(0, lobby.aiCount).map(
    (name) =>
      new AiCar(name, LOBBY_AI_CAR_ID, LOBBY_AI_PACE_FACTOR, {
        layout,
        stats: statsWithStages(LOBBY_AI_CAR_ID, {
          engine: 0,
          tires: 0,
          brakes: 0,
          suspension: 0,
        }),
        mode: 'circuit',
        laps: LOBBY_LAPS,
        stepLimit,
      }),
  );

  void Promise.all(
    [...lobby.members.values()].map(async (member) => {
      const setup = await raceStats(member.playerId);
      member.sim = new CarSim({
        layout,
        stats: statsWithStages(setup.carId, setup.stages),
        mode: 'circuit',
        laps: LOBBY_LAPS,
        stepLimit,
      });
    }),
  ).then(() => {
    publish(lobby);
    lobby.timer = setInterval(() => advanceRace(lobby), RACE_LOOP_MS);
  });
}

function advanceRace(lobby: LobbyRuntime): void {
  if (lobby.startedAtMs === null) return;
  const target = Math.floor(((Date.now() - lobby.startedAtMs) * 60) / 1000);
  const limit = Math.min(target, lobby.step + 20);
  while (lobby.step < limit) {
    lobby.step += 1;
    for (const member of lobby.members.values()) {
      if (!member.sim || member.finishStep !== null || member.sim.ended) continue;
      const input = member.connection === 'connected' ? member.input : idleInput();
      member.sim.step(input);
      if (member.sim.reachedEnd) member.finishStep = member.sim.stepsCompleted;
    }
  }

  const someoneFinished =
    [...lobby.members.values()].some((member) => member.finishStep !== null) ||
    lobby.ai.some((car) => lobby.step >= car.finishStep);
  if (someoneFinished && lobby.graceDeadlineMs === null) {
    lobby.graceDeadlineMs = Date.now() + config.finishGraceSeconds * 1000;
  }

  const connectedHumans = [...lobby.members.values()].filter(
    (member) => member.connection === 'connected',
  );
  const allConnectedFinished =
    connectedHumans.length > 0 && connectedHumans.every((member) => member.finishStep !== null);
  const graceOver = lobby.graceDeadlineMs !== null && Date.now() >= lobby.graceDeadlineMs;
  if (allConnectedFinished || graceOver) {
    finishRace(lobby);
    return;
  }
  publish(lobby);
}

function finishRace(lobby: LobbyRuntime): void {
  clearTimer(lobby);
  for (const member of lobby.members.values()) {
    if (member.finishStep === null) member.dnf = true;
  }
  lobby.state = 'finished';
  lobby.graceDeadlineMs = null;
  void db.query('update lobbies set state = $2 where lobby_id = $1', [lobby.lobbyId, 'finished']);
  publish(lobby);
  if (!lobby.paid) {
    lobby.paid = true;
    void payLobby(lobby);
  }
}

async function payLobby(lobby: LobbyRuntime): Promise<void> {
  const places = positions(lobby);
  for (const member of lobby.members.values()) {
    if (member.finishStep === null) continue;
    const coins = onlineResultCoins(places.get(member.playerId) ?? 3);
    await withPlayerLock(member.playerId, (tx: Queryable) =>
      writeMovement(tx, { playerId: member.playerId, kind: 'result', amount: coins }),
    );
  }
}

export function setLobbyInput(playerId: string, input: InputState): void {
  for (const lobby of lobbies.values()) {
    const member = lobby.members.get(playerId);
    if (member) member.input = input;
  }
}

export function handleConnection(playerId: string): void {
  for (const lobby of lobbies.values()) {
    const member = lobby.members.get(playerId);
    if (!member || member.connection === 'connected') continue;
    member.connection = 'connected';
    member.rejoinDeadlineMs = null;
    publish(lobby);
  }
}

export function handleDisconnection(playerId: string): void {
  for (const lobby of lobbies.values()) {
    const member = lobby.members.get(playerId);
    if (!member) continue;
    member.connection = 'reconnecting';
    member.rejoinDeadlineMs = Date.now() + config.rejoinSeconds * 1000;
    if (lobby.state === 'open' || lobby.state === 'countdown') {
      member.ready = false;
      void db.query(
        'update lobby_players set ready = false where lobby_id = $1 and player_id = $2',
        [lobby.lobbyId, playerId],
      );
      evaluateReadiness(lobby);
    }
    publish(lobby);
    setTimeout(() => closeRejoinWindow(lobby.lobbyId, playerId), config.rejoinSeconds * 1000).unref();
  }
}

function closeRejoinWindow(lobbyId: string, playerId: string): void {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  const member = lobby.members.get(playerId);
  if (!member || member.connection === 'connected') return;
  member.rejoinDeadlineMs = null;
  if (lobby.state === 'racing') {
    member.dnf = true;
  } else {
    lobby.members.delete(playerId);
    lobby.order = lobby.order.filter((id) => id !== playerId);
    void db.query('delete from lobby_players where lobby_id = $1 and player_id = $2', [
      lobbyId,
      playerId,
    ]);
  }
  publish(lobby);
}
