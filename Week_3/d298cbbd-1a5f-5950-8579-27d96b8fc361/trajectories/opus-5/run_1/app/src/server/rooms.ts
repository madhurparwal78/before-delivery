import { randomInt } from 'node:crypto';
import { config } from './config.js';
import type { LiveConnection } from './live.js';
import { generateWords, ticketSeed } from '../shared/generator.js';
import { nextTicketSequence, takeFixedText } from './tickets.js';
import { TypingEngine } from '../shared/engine.js';
import type { LogEntry } from '../shared/engine.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type RoomState = 'open' | 'countdown' | 'racing' | 'finished';
export type Place = number | 'DNF' | 'Left' | null;

export interface Racer {
  readonly typistId: string;
  readonly name: string;
  readonly seatedAt: number;
  readonly connections: Set<LiveConnection>;
  entries: LogEntry[];
  progress: number;
  place: Place;
  speed: number | null;
  accuracy: number | null;
  left: boolean;
  finishedDuration: number | null;
  releaseTimer: NodeJS.Timeout | null;
}

export interface RoomEvent {
  readonly seq: number;
  readonly kind: 'join' | 'leave' | 'host' | 'finish' | 'finished';
  readonly actorId: string | null;
  readonly payload: Record<string, unknown>;
}

export interface Room {
  readonly code: string;
  state: RoomState;
  hostId: string;
  readonly racers: Map<string, Racer>;
  words: string[] | null;
  goAt: number | null;
  readonly journal: RoomEvent[];
  timers: NodeJS.Timeout[];
}

const rooms = new Map<string, Room>();

export function normaliseCode(input: string): string {
  const letters = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.length === 6 ? `${letters.slice(0, 3)}-${letters.slice(3)}` : letters;
}

function newCode(): string {
  for (;;) {
    let letters = '';
    for (let i = 0; i < 6; i += 1) {
      letters += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    }
    const code = `${letters.slice(0, 3)}-${letters.slice(3)}`;
    if (!rooms.has(code)) return code;
  }
}

export function roomByCode(code: string): Room | null {
  return rooms.get(normaliseCode(code)) ?? null;
}

function seatRacer(room: Room, typistId: string, name: string): Racer {
  const racer: Racer = {
    typistId,
    name,
    seatedAt: Date.now(),
    connections: new Set(),
    entries: [],
    progress: 0,
    place: null,
    speed: null,
    accuracy: null,
    left: false,
    finishedDuration: null,
    releaseTimer: null,
  };
  room.racers.set(typistId, racer);
  return racer;
}

export function createRoom(typistId: string, name: string): Room {
  const room: Room = {
    code: newCode(),
    state: 'open',
    hostId: typistId,
    racers: new Map(),
    words: null,
    goAt: null,
    journal: [],
    timers: [],
  };
  rooms.set(room.code, room);
  seatRacer(room, typistId, name);
  return room;
}

export type SeatOutcome = 'joined' | 'rejoined' | 'room_full' | 'race_started';

/**
 * The one seat claim. The server is a single process, so this runs to completion without
 * interleaving: of any number of racers claiming the last seat, exactly one is seated.
 */
export function claimSeat(room: Room, typistId: string, name: string): SeatOutcome {
  const seated = room.racers.get(typistId);
  if (seated) {
    cancelRelease(seated);
    return 'rejoined';
  }
  if (room.state !== 'open') return 'race_started';
  if (room.racers.size >= 8) return 'room_full';
  seatRacer(room, typistId, name);
  announce(room, 'join', typistId, { name });
  return 'joined';
}

function cancelRelease(racer: Racer): void {
  if (racer.releaseTimer) {
    clearTimeout(racer.releaseTimer);
    racer.releaseTimer = null;
  }
}

export function roomSnapshot(room: Room): Record<string, unknown> {
  return {
    code: room.code,
    state: room.state,
    racers: [...room.racers.values()]
      .sort((a, b) => a.seatedAt - b.seatedAt)
      .map((racer) => ({
        name: racer.name,
        host: racer.typistId === room.hostId,
        left: racer.left,
        progress: racer.progress,
        place: racer.place,
        speed: racer.speed,
        accuracy: racer.accuracy,
      })),
    words: room.words,
    elapsedMs: room.goAt === null ? null : Date.now() - room.goAt,
  };
}

function broadcast(room: Room, event: string, data: Record<string, unknown>): void {
  for (const racer of room.racers.values()) {
    for (const connection of racer.connections) connection.send(event, data);
  }
}

export function broadcastState(room: Room): void {
  const snapshot = roomSnapshot(room);
  for (const racer of room.racers.values()) {
    for (const connection of racer.connections) {
      connection.send('room', { ...snapshot, seq: lastSeq(room), ownEntries: racer.entries });
    }
  }
}

function lastSeq(room: Room): number {
  return room.journal.at(-1)?.seq ?? 0;
}

function announce(
  room: Room,
  kind: RoomEvent['kind'],
  actorId: string | null,
  payload: Record<string, unknown>,
): void {
  const event: RoomEvent = { seq: lastSeq(room) + 1, kind, actorId, payload };
  room.journal.push(event);
  broadcast(room, 'event', { ...event });
}

export function eventsSince(room: Room, since: number): RoomEvent[] {
  return room.journal.filter((event) => event.seq > since);
}

export function attachConnection(room: Room, racer: Racer, connection: LiveConnection): void {
  racer.connections.add(connection);
  cancelRelease(racer);
  connection.onClose(() => {
    racer.connections.delete(connection);
    if (racer.connections.size === 0) startRelease(room, racer);
  });
}

/** The rejoin window: a lobby seat is freed, and a racing seat is marked Left, after it. */
function startRelease(room: Room, racer: Racer): void {
  cancelRelease(racer);
  racer.releaseTimer = setTimeout(() => {
    racer.releaseTimer = null;
    if (racer.connections.size > 0) return;
    if (room.state === 'open') releaseSeat(room, racer);
    else markLeft(room, racer);
  }, config.raceRejoinSeconds * 1000);
  racer.releaseTimer.unref();
}

function releaseSeat(room: Room, racer: Racer): void {
  room.racers.delete(racer.typistId);
  announce(room, 'leave', racer.typistId, { name: racer.name });
  if (room.racers.size === 0) {
    for (const timer of room.timers) clearTimeout(timer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === racer.typistId) {
    const next = [...room.racers.values()].sort((a, b) => a.seatedAt - b.seatedAt)[0];
    if (next) {
      room.hostId = next.typistId;
      announce(room, 'host', next.typistId, { name: next.name });
    }
  }
  broadcastState(room);
}

function markLeft(room: Room, racer: Racer): void {
  if (racer.left || racer.finishedDuration !== null) return;
  racer.left = true;
  announce(room, 'leave', racer.typistId, { name: racer.name });
  broadcastState(room);
  endRaceIfDone(room);
}

export async function raceWords(): Promise<string[]> {
  const fixed = await takeFixedText(['race']);
  const sequence = await nextTicketSequence();
  if (fixed) return fixed.words;
  return generateWords(ticketSeed(config.textSeed, sequence), config.raceWords, {
    punctuation: false,
    numbers: false,
  });
}

export function startCountdown(room: Room, words: string[]): void {
  room.state = 'countdown';
  room.words = words;
  broadcastState(room);
  for (let step = config.raceCountdownSeconds; step >= 1; step -= 1) {
    const delay = (config.raceCountdownSeconds - step) * 1000;
    const timer = setTimeout(() => {
      broadcast(room, 'countdown', { step: String(step) });
    }, delay);
    timer.unref();
    room.timers.push(timer);
  }
  const go = setTimeout(() => {
    room.state = 'racing';
    room.goAt = Date.now();
    broadcast(room, 'countdown', { step: 'Go' });
    broadcastState(room);
    const cutoff = setTimeout(() => {
      endRace(room);
    }, config.raceTimeLimitSeconds * 1000);
    cutoff.unref();
    room.timers.push(cutoff);
  }, config.raceCountdownSeconds * 1000);
  go.unref();
  room.timers.push(go);
}

export function updateProgress(room: Room, racer: Racer, entries: LogEntry[]): void {
  racer.entries = entries;
  if (!room.words) return;
  const engine = new TypingEngine(room.words, 'finite', config.maxExtraLetters);
  engine.applyAll(entries);
  const progress = Math.floor((100 * engine.wordsCompletedCorrectly()) / room.words.length);
  if (progress > racer.progress) {
    racer.progress = progress;
    broadcast(room, 'progress', { name: racer.name, progress });
  }
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const last = value % 10;
  if (last === 1) return `${value}st`;
  if (last === 2) return `${value}nd`;
  if (last === 3) return `${value}rd`;
  return `${value}th`;
}

/** Places finishers by replayed duration, with shared places for equal durations. */
function placeFinishers(room: Room): void {
  const finishers = [...room.racers.values()]
    .filter((racer) => racer.finishedDuration !== null)
    .sort((a, b) => (a.finishedDuration as number) - (b.finishedDuration as number));
  let place = 0;
  let previous: number | null = null;
  finishers.forEach((racer, index) => {
    const duration = racer.finishedDuration as number;
    if (previous === null || duration !== previous) place = index + 1;
    previous = duration;
    racer.place = place;
  });
}

export function recordFinish(
  room: Room,
  racer: Racer,
  duration: number,
  speed: number,
  accuracy: number,
): number {
  racer.finishedDuration = duration;
  racer.speed = speed;
  racer.accuracy = accuracy;
  racer.progress = 100;
  placeFinishers(room);
  const place = racer.place as number;
  announce(room, 'finish', racer.typistId, {
    name: racer.name,
    ordinal: ordinal(place),
    place,
    speed,
  });
  broadcastState(room);
  endRaceIfDone(room);
  return place;
}

export function markDnf(room: Room, racer: Racer): void {
  racer.place = 'DNF';
  broadcastState(room);
  endRaceIfDone(room);
}

function endRaceIfDone(room: Room): void {
  if (room.state !== 'racing') return;
  const racing = [...room.racers.values()].filter((racer) => !racer.left);
  const done = racing.every((racer) => racer.finishedDuration !== null || racer.place === 'DNF');
  if (racing.length > 0 && done) endRace(room);
}

export function endRace(room: Room): void {
  if (room.state === 'finished') return;
  room.state = 'finished';
  for (const racer of room.racers.values()) {
    if (racer.left) racer.place = 'Left';
    else if (racer.finishedDuration === null) racer.place = 'DNF';
  }
  announce(room, 'finished', null, {});
  broadcastState(room);
}
