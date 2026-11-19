// Online lobbies: setup, countdown, live race, rejoin window, finish grace.
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { PushHub } from './push.js';
import { notFound } from './errors.js';
import { shortId } from './ids.js';
import { writeMovement, balanceOf } from './ledger.js';
import { ONLINE_RESULT_COINS, ONLINE_RESULT_LATER, LAYOUTS } from '../shared/domain.js';
import { RaceCar, type Pedals } from '../shared/raceModel.js';

export interface LobbyPlayer {
  playerId: string;
  ready: boolean;
  connected: boolean;
  reconnecting: boolean;
}

export interface LobbyState {
  lobbyId: string;
  hostId: string;
  state: 'open' | 'countdown' | 'racing' | 'finished';
  aiCount: number;
  countdown: number | null;
  graceSecondsLeft: number | null;
}

interface LobbyRaceCar {
  name: string;
  playerId: string | null; // null for AI
  car: RaceCar;
  input: Pedals;
  finishMs: number | null;
  dnf: boolean;
  isHuman: boolean;
}

/** Races in progress, keyed by lobby. One per lobby, created with the lobby. */
interface LobbyRace {
  lobbyId: string;
  cars: LobbyRaceCar[];
  step: number;
  firstFinishMs: number | null;
  finishDeadlineStep: number | null;
  tickTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
}

const races = new Map<string, LobbyRace>();

function lobbyFromRow(row: { lobby_id: string; host_id: string; state: string; ai_count: number; countdown: number | null; grace_seconds_left: number | null }): LobbyState {
  return {
    lobbyId: row.lobby_id, hostId: row.host_id,
    state: row.state as LobbyState['state'], aiCount: row.ai_count,
    countdown: row.countdown, graceSecondsLeft: row.grace_seconds_left
  };
}

export async function createLobby(db: Db, hostId: string, aiCount: number): Promise<LobbyState> {
  const lobbyId = `lob_${shortId(10)}`;
  await db.query('INSERT INTO lobbies (lobby_id, host_id, state, ai_count) VALUES ($1,$2,$3,$4)', [lobbyId, hostId, 'open', aiCount]);
  await db.query('INSERT INTO lobby_players (lobby_id, player_id, ready, connected, reconnecting) VALUES ($1,$2,false,true,false)', [lobbyId, hostId]);
  return { lobbyId, hostId, state: 'open', aiCount, countdown: null, graceSecondsLeft: null };
}

export async function lobbyBody(db: Db, cfg: Config, hub: PushHub, lobbyId: string, viewerId: string | null): Promise<unknown> {
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) throw notFound('No such lobby.');
  const playersR = await db.query('SELECT player_id, ready, connected, reconnecting FROM lobby_players WHERE lobby_id = $1', [lobbyId]);
  const race = races.get(lobbyId);
  const players: unknown[] = [];
  for (const p of playersR.rows as { player_id: string; ready: boolean; connected: boolean; reconnecting: boolean }[]) {
    let position: number | null = null;
    let lap = 1;
    let finishMs: number | null = null;
    let dnf = false;
    const rc = race?.cars.find(c => c.playerId === p.player_id);
    if (rc) {
      lap = rc.car.lap;
      finishMs = rc.finishMs;
      dnf = rc.dnf;
      position = racePosition(race, rc);
    }
    players.push({
      playerId: p.player_id,
      name: await playerNameOf(db, p.player_id),
      ready: p.ready,
      connection: p.reconnecting ? 'reconnecting' : 'connected',
      rejoinSecondsLeft: p.reconnecting ? rejoinLeft(cfg, lobbyId, p.player_id) : null,
      position, lap, finishMs, dnf
    });
  }
  const ai: unknown[] = (race?.cars ?? []).filter(c => !c.isHuman).map(c => ({
    name: c.name, position: racePosition(race, c), lap: c.car.lap, finishMs: c.finishMs
  }));
  return {
    lobbyId,
    hostId: lobby.hostId,
    state: lobby.state,
    countdown: lobby.countdown,
    graceSecondsLeft: lobby.graceSecondsLeft,
    players,
    ai
  };
  void viewerId;
}

function racePosition(race: LobbyRace | undefined, car: LobbyRaceCar): number | null {
  if (!race) return null;
  const rank = (c: LobbyRaceCar): { finished: boolean; finishMs: number; laps: number; dist: number; human: boolean } => ({
    finished: c.finishMs !== null, finishMs: c.finishMs ?? Infinity, laps: c.car.lap, dist: c.car.distance, human: c.isHuman
  });
  const others = race.cars.filter(c => c !== car).map(rank);
  const me = rank(car);
  let pos = 1;
  for (const o of others) {
    const meAhead = me.finished && !o.finished ? true :
      me.finished && o.finished ? me.finishMs <= o.finishMs :
      !me.finished && o.finished ? false :
      me.laps !== o.laps ? me.laps > o.laps :
      me.dist !== o.dist ? me.dist > o.dist : me.human;
    if (!meAhead) pos++;
  }
  return pos;
}

async function playerNameOf(db: Db, playerId: string): Promise<string> {
  const r = await db.query('SELECT name FROM players WHERE player_id = $1', [playerId]);
  return r.rows[0]?.name ?? playerId;
}

interface RejoinInfo { deadline: number }
const rejoins = new Map<string, RejoinInfo>();
const rejoinKey = (lobbyId: string, playerId: string): string => `${lobbyId}:${playerId}`;

function rejoinLeft(cfg: Config, lobbyId: string, playerId: string): number | null {
  const info = rejoins.get(rejoinKey(lobbyId, playerId));
  if (!info) return null;
  const left = Math.ceil((info.deadline - Date.now()) / 1000);
  return Math.max(0, left);
}

async function loadLobby(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<LobbyState | null> {
  // The lobby's state always comes from Postgres, never from a cache.
  void cfg; void hub;
  const r = await db.query('SELECT lobby_id, host_id, state, ai_count, countdown, grace_seconds_left FROM lobbies WHERE lobby_id = $1', [lobbyId]);
  if (r.rows.length === 0) return null;
  return lobbyFromRow(r.rows[0]);
}

export async function joinLobby(db: Db, cfg: Config, hub: PushHub, lobbyId: string, playerId: string): Promise<void> {
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) throw notFound('No such lobby.');
  const state = lobby.state;
  if (state !== 'open') {
    throw new LobbyError(state === 'finished' ? 'LOBBY_CLOSED' : state === 'racing' ? 'LOBBY_CLOSED' : 'LOBBY_CLOSED', 'This lobby has already started.');
  }
  const countR = await db.query('SELECT COUNT(*)::int AS n FROM lobby_players WHERE lobby_id = $1', [lobbyId]);
  if ((countR.rows[0].n as number) >= 2) {
    throw new LobbyError('LOBBY_FULL', 'This lobby is full.');
  }
  const existing = await db.query('SELECT 1 FROM lobby_players WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  if (existing.rows.length === 0) {
    await db.query('INSERT INTO lobby_players (lobby_id, player_id) VALUES ($1,$2)', [lobbyId, playerId]);
  } else {
    await db.query('UPDATE lobby_players SET connected = true, reconnecting = false WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
    rejoins.delete(rejoinKey(lobbyId, playerId));
  }
}

export class LobbyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function setReady(db: Db, cfg: Config, hub: PushHub, lobbyId: string, playerId: string, ready: boolean): Promise<void> {
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) throw notFound('No such lobby.');
  if (lobby.state === 'racing' || lobby.state === 'finished') {
    throw new LobbyError('LOBBY_CLOSED', 'This lobby has already started.');
  }
  const member = await db.query('SELECT 1 FROM lobby_players WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  if (member.rows.length === 0) throw notFound('Not a member of this lobby.');
  await db.query('UPDATE lobby_players SET ready = $3 WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId, ready]);
  // An un-ready during the countdown cancels it: the lobby returns to waiting.
  if (!ready && lobby.state === 'countdown') {
    await cancelCountdown(db, cfg, hub, lobbyId);
    return;
  }
  await pushLobbyUpdate(db, cfg, hub, lobbyId);
  await maybeStartCountdown(db, cfg, hub, lobbyId);
}

async function maybeStartCountdown(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) return;
  if (lobby.state !== 'open') return;
  const playersR = await db.query('SELECT player_id, ready FROM lobby_players WHERE lobby_id = $1', [lobbyId]);
  const humans = playersR.rows as { player_id: string; ready: boolean }[];
  if (humans.length >= 2 && humans.every(p => p.ready)) {
    await startCountdown(db, cfg, hub, lobbyId);
  }
}

async function startCountdown(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  await db.query('UPDATE lobbies SET state = $2, countdown = 3, countdown_started_at = now() WHERE lobby_id = $1', [lobbyId, 'countdown']);
  await pushLobbyUpdate(db, cfg, hub, lobbyId);
  const tick = async (n: number): Promise<void> => {
    if (n <= 0) {
      await startRace(db, cfg, hub, lobbyId);
      return;
    }
    const lobby = await loadLobby(db, cfg, hub, lobbyId);
    if (!lobby || lobby.state !== 'countdown') return; // cancelled
    await db.query('UPDATE lobbies SET countdown = $2 WHERE lobby_id = $1', [lobbyId, n - 1]);
    await pushLobbyUpdate(db, cfg, hub, lobbyId);
    setTimeout(() => void tick(n - 1), 1000).unref?.();
  };
  setTimeout(() => void tick(2), 1000).unref?.();
}

async function cancelCountdown(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  await db.query('UPDATE lobbies SET state = $2, countdown = NULL WHERE lobby_id = $1 AND state = $3', [lobbyId, 'open', 'countdown']);
  await pushLobbyUpdate(db, cfg, hub, lobbyId);
}

async function startRace(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  const playersR = await db.query('SELECT player_id FROM lobby_players WHERE lobby_id = $1', [lobbyId]);
  const lobbyR = await db.query('SELECT host_id, ai_count FROM lobbies WHERE lobby_id = $1', [lobbyId]);
  const aiCount = lobbyR.rows[0].ai_count as number;
  const layout = LAYOUTS['saltflat-ring'];
  const cars: LobbyRaceCar[] = [];
  for (const p of playersR.rows as { player_id: string }[]) {
    const car = await playerCarFor(db, p.player_id);
    cars.push({
      name: await playerNameOf(db, p.player_id), playerId: p.player_id, car,
      input: { throttle: 0, brake: 0, drift: 0, lane: 'middle' },
      finishMs: null, dnf: false, isHuman: true
    });
  }
  for (let i = 0; i < aiCount; i++) {
    const aiCar = new RaceCar(layout, { accelMps2: 4.0, brakeMps2: 8.0, topMps: 45, gripPct: 100, laneChangeSteps: 30 }, 1, false, false);
    cars.push({
      name: `Rookie AI ${i + 1}`, playerId: null, car: aiCar,
      input: { throttle: 0, brake: 0, drift: 0, lane: 'middle' },
      finishMs: null, dnf: false, isHuman: false
    });
  }
  const race: LobbyRace = {
    lobbyId, cars, step: 0, firstFinishMs: null, finishDeadlineStep: null,
    tickTimer: null, graceTimer: null
  };
  races.set(lobbyId, race);
  await db.query('UPDATE lobbies SET state = $2, countdown = NULL, started_at = now() WHERE lobby_id = $1', [lobbyId, 'racing']);
  await pushLobbyUpdate(db, cfg, hub, lobbyId);

  const interval = setInterval(() => {
    void raceTick(db, cfg, hub, lobbyId);
  }, 1000 / 60);
  race.tickTimer = interval;
}

async function playerCarFor(db: Db, playerId: string): Promise<RaceCar> {
  const layout = LAYOUTS['saltflat-ring'];
  const selR = await db.query(
    'SELECT oc.car_id FROM owned_cars oc WHERE oc.player_id = $1 AND oc.selected = true',
    [playerId]
  );
  const carId = selR.rows[0]?.car_id ?? 'kestrel-hatch';
  const stagesR = await db.query('SELECT system, stage FROM car_stages WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  const stages: Record<string, number> = { engine: 0, tires: 0, brakes: 0, suspension: 0 };
  for (const row of stagesR.rows as { system: string; stage: number }[]) stages[row.system] = row.stage;
  const { CARS } = await import('../shared/domain.js');
  const spec = CARS.find(c => c.carId === carId) ?? CARS[0];
  const stats = { ...spec.stats };
  stats.accelMps2 += stages.engine * 1.0;
  stats.topMps += stages.engine * 2;
  stats.gripPct += stages.tires * 4;
  stats.brakeMps2 += stages.brakes * 1.5;
  stats.laneChangeSteps = Math.max(6, stats.laneChangeSteps - stages.suspension * 6);
  return new RaceCar(layout, stats, 1, false, false);
}

async function raceTick(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  const race = races.get(lobbyId);
  if (!race || race.tickTimer === null) return;
  // AI and finished cars coast; humans follow their key state.
  for (const c of race.cars) {
    if (c.finishMs !== null || c.dnf) continue;
    if (c.isHuman) {
      c.car.step(race.step, c.input);
    } else {
      const p = aiPedals(c.car);
      c.car.step(race.step, p);
    }
    if (c.car.finished && c.finishMs === null) {
      c.finishMs = Math.round(((race.step + 1) * 1000) / 60);
      if (race.firstFinishMs === null) {
        race.firstFinishMs = c.finishMs;
        race.finishDeadlineStep = race.step + cfg.finishGraceSeconds * 60;
        await db.query('UPDATE lobbies SET grace_seconds_left = $2 WHERE lobby_id = $1', [lobbyId, cfg.finishGraceSeconds]);
      }
    }
  }
  race.step++;
  if (race.step % 12 === 0) {
    hub.sendToLobby(lobbyId, { type: 'lobby', lobby: await lobbyBody(db, cfg, hub, lobbyId, null) });
  }
  // End conditions
  const humans = race.cars.filter(c => c.isHuman);
  const connectedHumans = humans.filter(c => !c.dnf);
  const allFinished = humans.length > 0 && connectedHumans.every(c => c.finishMs !== null);
  const graceOver = race.finishDeadlineStep !== null && race.step >= race.finishDeadlineStep;
  if (allFinished || graceOver || (race.firstFinishMs !== null && connectedHumans.length === 0)) {
    await finishRace(db, cfg, hub, lobbyId);
  }
}

function aiPedals(car: RaceCar): Pedals {
  return car.referencePedals();
}

async function finishRace(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  const race = races.get(lobbyId);
  if (!race) return;
  if (race.tickTimer) { clearInterval(race.tickTimer); race.tickTimer = null; }
  if (race.graceTimer) { clearTimeout(race.graceTimer); race.graceTimer = null; }
  // Humans that never finished are dnf
  for (const c of race.cars) {
    if (c.isHuman && c.finishMs === null) c.dnf = true;
  }
  await db.query('UPDATE lobbies SET state = $2, grace_seconds_left = NULL, finished_at = now() WHERE lobby_id = $1', [lobbyId, 'finished']);
  // Pay the humans by final position
  const finished = race.cars.filter(c => c.finishMs !== null).sort((a, b) => (a.finishMs ?? 0) - (b.finishMs ?? 0));
  for (const c of finished) {
    if (!c.isHuman || !c.playerId) continue;
    const pos = finished.filter(f => f.isHuman).findIndex(f => f === c) + 1;
    const amount = ONLINE_RESULT_COINS[pos] ?? ONLINE_RESULT_LATER;
    if (amount > 0) {
      await writeMovement(db, c.playerId, 'result', amount, null);
      const balance = await balanceOf(db, c.playerId);
      hub.sendToPlayer(c.playerId, { type: 'balance', balance, movementId: `lobby_${lobbyId}_${c.playerId}`, purchaseId: null });
    }
  }
  hub.sendToLobby(lobbyId, { type: 'lobby', lobby: await lobbyBody(db, cfg, hub, lobbyId, null) });
}

/** A human's key state, sent over the WebSocket on every change. */
export function setKeyState(lobbyId: string, playerId: string, keyState: unknown): void {
  const race = races.get(lobbyId);
  if (!race) return;
  const car = race.cars.find(c => c.playerId === playerId);
  if (!car) return;
  const k = keyState as { throttle?: number; brake?: number; drift?: number; lane?: string } | null;
  car.input = {
    throttle: k?.throttle === 1 ? 1 : 0,
    brake: k?.brake === 1 ? 1 : 0,
    drift: k?.drift === 1 ? 1 : 0,
    lane: k?.lane === 'left' || k?.lane === 'right' ? k.lane : 'middle'
  };
}

export async function handleDisconnect(db: Db, cfg: Config, hub: PushHub, lobbyId: string, playerId: string): Promise<void> {
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) return;
  const member = await db.query('SELECT 1 FROM lobby_players WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  if (member.rows.length === 0) return;
  await db.query('UPDATE lobby_players SET connected = false, reconnecting = true WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  rejoins.set(rejoinKey(lobbyId, playerId), { deadline: Date.now() + cfg.rejoinSeconds * 1000 });
  const race = races.get(lobbyId);
  if (race) {
    const car = race.cars.find(c => c.playerId === playerId);
    if (car) car.input = { throttle: 0, brake: 0, drift: 0, lane: 'middle' };
  }
  if (lobby.state === 'countdown') {
    await db.query('UPDATE lobby_players SET ready = false WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
    await cancelCountdown(db, cfg, hub, lobbyId);
  } else if (lobby.state === 'open') {
    await db.query('UPDATE lobby_players SET ready = false WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
    await pushLobbyUpdate(db, cfg, hub, lobbyId);
  }
  setTimeout(() => void expireRejoin(db, cfg, hub, lobbyId, playerId), cfg.rejoinSeconds * 1000).unref?.();
}

async function expireRejoin(db: Db, cfg: Config, hub: PushHub, lobbyId: string, playerId: string): Promise<void> {
  const stillGone = !hub.lobbyHasConnection(lobbyId, playerId);
  if (!stillGone) return;
  const lobby = await loadLobby(db, cfg, hub, lobbyId);
  if (!lobby) return;
  rejoins.delete(rejoinKey(lobbyId, playerId));
  if (lobby.state === 'open') {
    await db.query('DELETE FROM lobby_players WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  } else if (lobby.state === 'racing' || lobby.state === 'finished') {
    const race = races.get(lobbyId);
    const car = race?.cars.find(c => c.playerId === playerId);
    if (car && car.finishMs === null) car.dnf = true;
    await db.query('UPDATE lobby_players SET ready = false WHERE lobby_id = $1 AND player_id = $2', [lobbyId, playerId]);
  }
  await pushLobbyUpdate(db, cfg, hub, lobbyId);
}

export async function pushLobbyUpdate(db: Db, cfg: Config, hub: PushHub, lobbyId: string): Promise<void> {
  const body = await lobbyBody(db, cfg, hub, lobbyId, null);
  hub.sendToLobby(lobbyId, { type: 'lobby', lobby: body });
}
