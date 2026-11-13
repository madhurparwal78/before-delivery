import { randomToken } from './http.js';
import type { AppConfig } from '../shared/config.js';
import type { LiveHub } from './live.js';
import { replayLog } from '../shared/scoring.js';
import { applyEntry, generateWords, initialEngineState, seedFor, type LogEntry } from '../shared/engine.js';

// Race rooms, in the app server's memory. The server times every step.

export type RoomState = 'open' | 'countdown' | 'racing' | 'finished';

export interface RoomRacer {
  typistId: string;
  name: string;
  token: string;
  host: boolean;
  connected: boolean;
  lastSeen: number;
  left: boolean;
  progress: number;
  place: number | null;
  speed: number | null;
  accuracy: number | null;
  finished: boolean;
  log: LogEntry[];
  durationMs: number | null;
}

export interface Room {
  code: string;
  state: RoomState;
  racers: Map<string, RoomRacer>;
  words: string[];
  countdownFrom: number | null;
  goAt: number | null;
  startedAt: number | null;
  createdAt: number;
  hostTypistId: string;
  fixedQuoteId: string | null;
}

export interface RoomSnapshot {
  code: string;
  state: RoomState;
  racers: { name: string; host: boolean; left: boolean; progress: number; place: number | null; speed: number | null; accuracy: number | null }[];
  words: string[] | null;
  elapsedMs: number | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function normalizeCode(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}

export interface RoomEvent {
  kind: string;
  payload: unknown;
}

export class RoomEngine {
  private readonly rooms = new Map<string, Room>();
  private readonly config: AppConfig;
  private readonly hub: LiveHub;
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private fixedText: { target: string; words: string[]; quoteId: string | null } | null = null;
  private raceSequence = 0;
  private eventSequence = 0;

  constructor(config: AppConfig, hub: LiveHub, private readonly seedBase: number) {
    this.config = config;
    this.hub = hub;
    setInterval(() => this.sweep(), 500).unref();
  }

  /** Every race start takes the next ticket sequence number. */
  private nextRaceSequence(): number {
    this.raceSequence += 1;
    return this.raceSequence;
  }

  setFixedText(target: string, words: string[], quoteId: string | null = null): void {
    this.fixedText = { target, words, quoteId };
  }

  takeFixedText(target: string): { words: string[]; quoteId: string | null } | null {
    if (this.fixedText !== null && this.fixedText.target === target) {
      const fixed = this.fixedText;
      this.fixedText = null;
      return { words: fixed.words, quoteId: fixed.quoteId };
    }
    return null;
  }

  private roomTopic(code: string): string {
    return `room:${code}`;
  }

  createRoom(typistId: string, name: string, token: string): RoomSnapshot {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      state: 'open',
      racers: new Map(),
      words: [],
      countdownFrom: null,
      goAt: null,
      startedAt: null,
      createdAt: Date.now(),
      hostTypistId: typistId,
      fixedQuoteId: null,
    };
    room.racers.set(typistId, {
      typistId, name, token, host: true, connected: true, lastSeen: Date.now(),
      left: false, progress: 0, place: null, speed: null, accuracy: null, finished: false, log: [], durationMs: null,
    });
    this.rooms.set(code, room);
    this.watch(code, typistId, token);
    return this.snapshot(room);
  }

  room(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  snapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      state: room.state,
      racers: Array.from(room.racers.values()).map((r) => ({
        name: r.name, host: r.host, left: r.left, progress: r.progress, place: r.place, speed: r.speed, accuracy: r.accuracy,
      })),
      words: room.state === 'racing' || room.state === 'finished' ? room.words : null,
      elapsedMs: room.startedAt === null ? null : Date.now() - room.startedAt,
    };
  }

  /** Watch a room from a live connection, so closed connections can be noticed. */
  watch(code: string, typistId: string, token: string): void {
    const room = this.rooms.get(normalizeCode(code));
    if (room === undefined) return;
    const racer = room.racers.get(typistId);
    if (racer === undefined) return;
    racer.token = token;
    racer.connected = true;
    racer.lastSeen = Date.now();
    this.hub.sendToToken(token, { kind: 'room-state', payload: { ...this.snapshot(room), joinedTypistId: typistId } });
  }

  /** A racer's live connection closed: start the rejoin window. */
  connectionClosed(code: string | undefined, token: string): void {
    for (const room of this.rooms.values()) {
      if (code !== undefined && room.code !== normalizeCode(code)) continue;
      for (const racer of room.racers.values()) {
        if (racer.token === token) {
          racer.lastSeen = Date.now();
        }
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    const rejoinMs = this.config.raceRejoinSeconds * 1000;
    for (const room of Array.from(this.rooms.values())) {
      for (const racer of room.racers.values()) {
        const live = this.hub.hasToken(racer.token);
        if (!live && now - racer.lastSeen > rejoinMs) {
          racer.connected = false;
          if (room.state === 'open' && !racer.left) {
            racer.left = true;
            this.announce(room, { kind: 'racer-left', payload: { name: racer.name } });
            room.racers.delete(racer.typistId);
            if (racer.host) this.handOverHost(room);
            if (room.racers.size === 0) {
              this.clearTimers(room.code);
              this.rooms.delete(room.code);
            }
          } else if ((room.state === 'countdown' || room.state === 'racing') && !racer.left) {
            racer.left = true;
            this.announce(room, { kind: 'racer-left', payload: { name: racer.name } });
            this.checkRaceOver(room);
          }
        }
      }
      if (room.state === 'racing' && room.startedAt !== null) {
        const elapsed = now - room.startedAt;
        if (elapsed >= this.config.raceTimeLimitSeconds * 1000) this.finishRoom(room);
      }
    }
  }

  private handOverHost(room: Room): void {
    let earliest: RoomRacer | null = null;
    for (const racer of room.racers.values()) {
      if (earliest === null || racer.lastSeen < earliest.lastSeen) earliest = racer;
    }
    if (earliest === null) return;
    for (const racer of room.racers.values()) racer.host = false;
    earliest.host = true;
    room.hostTypistId = earliest.typistId;
    this.announce(room, { kind: 'host-changed', payload: { name: earliest.name } });
    this.pushState(room);
  }

  private announce(room: Room, event: RoomEvent): void {
    this.eventSequence++;
    const id = this.eventSequence;
    const payload = event.payload as Record<string, unknown>;
    this.hub.broadcast(this.roomTopic(room.code), { kind: event.kind, payload: { ...payload, id, code: room.code } });
  }

  private pushState(room: Room): void {
    this.hub.broadcast(this.roomTopic(room.code), { kind: 'room-state', payload: this.snapshot(room) });
  }

  join(code: string, typistId: string, name: string, token: string): { ok: true; room: Room; rejoined: boolean } | { ok: false; error: 'room_not_found' | 'room_full' | 'race_started' } {
    const room = this.rooms.get(normalizeCode(code));
    if (room === undefined) return { ok: false, error: 'room_not_found' };
    const existing = room.racers.get(typistId);
    if (existing !== undefined) {
      if (!existing.left) {
        existing.token = token;
        existing.connected = true;
        existing.lastSeen = Date.now();
        this.watch(room.code, typistId, token);
        return { ok: true, room, rejoined: true };
      }
      return { ok: false, error: 'race_started' };
    }
    if (room.state !== 'open') return { ok: false, error: 'race_started' };
    if (room.racers.size >= this.config.maxRoomSeats) return { ok: false, error: 'room_full' };
    room.racers.set(typistId, {
      typistId, name, token, host: false, connected: true, lastSeen: Date.now(),
      left: false, progress: 0, place: null, speed: null, accuracy: null, finished: false, log: [], durationMs: null,
    });
    this.announce(room, { kind: 'racer-joined', payload: { name } });
    this.pushState(room);
    this.watch(room.code, typistId, token);
    return { ok: true, room, rejoined: false };
  }

  start(code: string, typistId: string): { ok: true } | { ok: false; error: 'room_not_found' | 'not_host' | 'race_started' | 'not_enough_racers' } {
    const room = this.rooms.get(normalizeCode(code));
    if (room === undefined) return { ok: false, error: 'room_not_found' };
    const racer = room.racers.get(typistId);
    if (racer === undefined || !racer.host) return { ok: false, error: 'not_host' };
    if (room.state !== 'open') return { ok: false, error: 'race_started' };
    const seated = Array.from(room.racers.values()).filter((r) => !r.left);
    if (seated.length < 2) return { ok: false, error: 'not_enough_racers' };

    const fixed = this.takeFixedText('race');
    room.words = fixed?.words ?? generateWords(seedFor(this.seedBase, this.nextRaceSequence()), this.config.raceWords, false, false);
    room.fixedQuoteId = fixed?.quoteId ?? null;
    room.state = 'countdown';
    room.countdownFrom = this.config.raceCountdownSeconds;
    this.pushState(room);

    const steps = this.config.raceCountdownSeconds;
    for (let i = 0; i < steps; i++) {
      const timer = setTimeout(() => {
        this.announce(room, { kind: 'countdown', payload: { step: steps - i } });
      }, i * 1000);
      this.addTimer(room.code, timer);
    }
    const goTimer = setTimeout(() => {
      room.state = 'racing';
      room.startedAt = Date.now();
      room.goAt = Date.now();
      this.announce(room, { kind: 'countdown', payload: { step: 'Go' } });
      this.pushState(room);
      this.addTimer(room.code, setTimeout(() => this.sweep(), this.config.raceTimeLimitSeconds * 1000));
    }, steps * 1000);
    this.addTimer(room.code, goTimer);
    return { ok: true };
  }

  private addTimer(code: string, timer: NodeJS.Timeout): void {
    const list = this.timers.get(code) ?? [];
    list.push(timer);
    this.timers.set(code, list);
  }

  private clearTimers(code: string): void {
    const list = this.timers.get(normalizeCode(code));
    if (list === undefined) return;
    for (const timer of list) clearTimeout(timer);
    this.timers.delete(normalizeCode(code));
  }

  /** A racer's typed entries: progress for everyone, the racer's own echo on rejoin. */
  typed(code: string, typistId: string, log: LogEntry[]): void {
    const room = this.rooms.get(normalizeCode(code));
    if (room === undefined || room.state !== 'racing') return;
    const racer = room.racers.get(typistId);
    if (racer === undefined || racer.finished) return;
    racer.log = log;
    const progress = this.progressOf(room, log);
    if (progress > racer.progress) racer.progress = progress;
    this.hub.broadcast(this.roomTopic(room.code), { kind: 'progress', payload: { typistId, progress: racer.progress } });
  }

  private progressOf(room: Room, log: LogEntry[]): number {
    const state = initialEngineState(room.words);
    for (const entry of log) {
      const outcome = applyEntry(state, entry, { maxExtraLetters: this.config.maxExtraLetters, timeLimitMs: null });
      if (outcome === null) continue;
      if (outcome.ended) break;
    }
    let completed = 0;
    for (const word of state.words) {
      if (word.typed === word.word) completed++;
      else if (word.typed !== '') break;
    }
    if (state.words[state.words.length - 1] !== undefined && state.words[state.words.length - 1].typed === state.words[state.words.length - 1].word && state.ended) {
      completed = state.words.length;
    }
    return Math.floor((100 * completed) / Math.max(1, room.words.length));
  }

  finish(code: string, typistId: string, log: LogEntry[]): { ok: true; place: number; speed: number; accuracy: number } | { ok: false; error: 'room_not_found' | 'race_over' | 'invalid_log' | 'wrong_text' | 'impossible_interval' | 'replay_mismatch' } {
    const room = this.rooms.get(normalizeCode(code));
    if (room === undefined) return { ok: false, error: 'room_not_found' };
    const racer = room.racers.get(typistId);
    if (racer === undefined) return { ok: false, error: 'room_not_found' };
    if (room.state !== 'racing') return { ok: false, error: 'race_over' };
    if (room.startedAt !== null && Date.now() - room.startedAt > this.config.raceTimeLimitSeconds * 1000) {
      this.finishRoom(room);
      return { ok: false, error: 'race_over' };
    }
    const replay = replayLog(room.words, log, { maxExtraLetters: this.config.maxExtraLetters, timeLimitMs: null });
    if (!replay.score.ended) return { ok: false, error: 'replay_mismatch' };
    if (replay.durationMs === 0) return { ok: false, error: 'invalid_log' };
    racer.finished = true;
    racer.speed = replay.figures.speed;
    racer.accuracy = replay.figures.accuracy;
    racer.durationMs = replay.durationMs;
    racer.place = this.placeFor(room, typistId, replay.durationMs);
    this.announce(room, { kind: 'racer-finished', payload: { name: racer.name, place: racer.place, speed: replay.figures.speed } });
    this.pushState(room);
    this.checkRaceOver(room);
    return { ok: true, place: racer.place, speed: replay.figures.speed, accuracy: replay.figures.accuracy };
  }

  private placeFor(room: Room, typistId: string, durationMs: number): number {
    // Equal durations share a place, and the next place skips.
    let place = 1;
    for (const racer of room.racers.values()) {
      if (racer.typistId === typistId || racer.durationMs === null) continue;
      if (racer.durationMs < durationMs) place++;
    }
    return place;
  }

  private checkRaceOver(room: Room): void {
    const active = Array.from(room.racers.values()).filter((r) => !r.left && !r.finished);
    if (active.length === 0) this.finishRoom(room);
  }

  private finishRoom(room: Room): void {
    if (room.state === 'finished') return;
    room.state = 'finished';
    this.clearTimers(room.code);
    for (const racer of room.racers.values()) {
      if (!racer.finished) {
        racer.place = null;
        racer.speed = null;
        racer.accuracy = null;
      }
    }
    this.announce(room, { kind: 'race-over', payload: {} });
    this.pushState(room);
  }

  racerLog(code: string, typistId: string): LogEntry[] {
    const room = this.rooms.get(normalizeCode(code));
    const racer = room?.racers.get(typistId);
    return racer?.log ?? [];
  }
}

export function roomCodeValid(raw: string): boolean {
  const normalized = normalizeCode(raw);
  return normalized.length === 6 && Array.from(normalized).every((c) => CODE_ALPHABET.includes(c));
}
