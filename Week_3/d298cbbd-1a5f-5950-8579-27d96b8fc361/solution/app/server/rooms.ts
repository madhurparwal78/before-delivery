/** Private race rooms. They live in this process's memory; every rule that changes a room is decided here, synchronously. */

import { createHash, randomInt } from "node:crypto";
import { TypingEngine, isLoggableKey } from "../shared/engine";
import type { LogEntry } from "../shared/engine";
import { fromHundredths, ratioHundredths } from "../shared/numbers";
import type { RacerView, RoomEvent, RoomEventRecord, RoomState, RoomView } from "../shared/protocol";
import { generateWords } from "../shared/texts";
import { ROOM_SEATS, config } from "./config";
import type { Viewer } from "./auth";
import type { LiveConnection } from "./connection";
import { fail, json } from "./http";
import type { Reply } from "./http";
import { judgeRun } from "./runCheck";
import { nextTextSeed, takeFixedText } from "./tickets";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const FINISHED_ROOM_KEEP_MS = 15 * 60 * 1000;
const STEP_MS = 1000;

interface Racer {
  readonly typistId: string;
  readonly name: string;
  readonly seat: number;
  readonly connections: Set<LiveConnection>;
  readonly entries: LogEntry[];
  engine: TypingEngine | null;
  progress: number;
  place: number | null;
  duration: number | null;
  speed: number | null;
  accuracy: number | null;
  dnf: boolean;
  left: boolean;
  finishReply: Reply | null;
  dropTimer: NodeJS.Timeout | null;
}

interface Room {
  readonly code: string;
  readonly racers: Racer[];
  hostSeat: number;
  state: RoomState;
  words: string[] | null;
  goAt: number | null;
  nextSeat: number;
  readonly events: RoomEventRecord[];
  readonly timers: Set<NodeJS.Timeout>;
  finishedAt: number | null;
}

const rooms = new Map<string, Room>();

function normaliseCode(typed: string): string {
  return typed.replace(/[\s-]/g, "").toUpperCase();
}

function racerIn(room: Room, viewer: Viewer): Racer | undefined {
  return room.racers.find((racer) => racer.typistId === viewer.typistId);
}

function newRacer(room: Room, viewer: Viewer): Racer {
  const racer: Racer = {
    typistId: viewer.typistId,
    name: viewer.name,
    seat: room.nextSeat++,
    connections: new Set(),
    entries: [],
    engine: null,
    progress: 0,
    place: null,
    duration: null,
    speed: null,
    accuracy: null,
    dnf: false,
    left: false,
    finishReply: null,
    dropTimer: null,
  };
  room.racers.push(racer);
  return racer;
}

function racerView(room: Room, racer: Racer): RacerView {
  return { seat: racer.seat, name: racer.name, host: room.hostSeat === racer.seat, left: racer.left, progress: racer.progress, place: racer.place, dnf: racer.dnf, speed: racer.speed, accuracy: racer.accuracy };
}

function roomView(room: Room): RoomView {
  return {
    code: room.code,
    state: room.state,
    racers: room.racers.map((racer) => racerView(room, racer)),
    words: room.words,
    elapsedMs: room.goAt !== null && (room.state === "racing" || room.state === "finished") ? Math.max(0, Date.now() - room.goAt) : null,
  };
}

function record(room: Room, event: RoomEvent): RoomEventRecord {
  const entry = { id: room.events.length + 1, event };
  room.events.push(entry);
  return entry;
}

/** Pushes the room's new state, with the events it just produced, to every racer's open connections. */
function broadcast(room: Room, events: RoomEventRecord[]): void {
  const view = roomView(room);
  for (const racer of room.racers) {
    for (const connection of racer.connections) connection.send({ type: "room", room: view, events, entries: null, you: racer.seat, through: room.events.length });
  }
}

function change(room: Room, ...events: RoomEvent[]): void {
  broadcast(room, events.map((event) => record(room, event)));
}

function later(room: Room, ms: number, work: () => void): void {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    work();
  }, ms);
  room.timers.add(timer);
}

function discard(room: Room): void {
  for (const timer of room.timers) clearTimeout(timer);
  for (const racer of room.racers) if (racer.dropTimer) clearTimeout(racer.dropTimer);
  rooms.delete(room.code);
}

export function createRoom(viewer: Viewer): string {
  let code: string;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length))).join("");
  } while (rooms.has(code));
  const room: Room = { code, racers: [], hostSeat: 1, state: "open", words: null, goAt: null, nextSeat: 1, events: [], timers: new Set(), finishedAt: null };
  newRacer(room, viewer);
  rooms.set(code, room);
  return code;
}

export function joinRoom(viewer: Viewer, typed: string): Reply {
  const room = rooms.get(normaliseCode(typed));
  if (!room) return fail(404, "room_not_found");
  const seated = racerIn(room, viewer);
  if (seated) return json(200, { code: room.code, rejoined: true });
  if (room.state !== "open") return fail(409, "race_started");
  if (room.racers.length >= ROOM_SEATS) return fail(409, "room_full");
  const racer = newRacer(room, viewer);
  change(room, { kind: "joined", seat: racer.seat, racer: racer.name });
  return json(200, { code: room.code, rejoined: false });
}

export function readRoom(viewer: Viewer, typed: string): Reply {
  const room = rooms.get(normaliseCode(typed));
  if (!room || !racerIn(room, viewer)) return fail(404, "room_not_found");
  return json(200, roomView(room));
}

export async function startRace(viewer: Viewer, typed: string): Promise<Reply> {
  const room = rooms.get(normaliseCode(typed));
  const racer = room && racerIn(room, viewer);
  if (!room || !racer) return fail(404, "room_not_found");
  if (room.hostSeat !== racer.seat) return fail(403, "not_host");
  if (room.state !== "open") return fail(409, "race_started");
  if (room.racers.length < 2) return fail(409, "not_enough_racers");
  room.state = "countdown";
  try {
    const { seed } = await nextTextSeed();
    const fixed = takeFixedText("race");
    room.words = fixed ? [...fixed.words] : generateWords(seed, config.raceWords, false, false);
  } catch (error) {
    room.state = "open";
    throw error;
  }
  const words = room.words;
  for (const member of room.racers) member.engine = new TypingEngine(words, { timeLimitMs: null, maxExtraLetters: config.maxExtraLetters });
  const steps = config.raceCountdownSeconds;
  for (let i = 0; i < steps; i++) later(room, i * STEP_MS, () => change(room, { kind: "step", step: String(steps - i) }));
  later(room, steps * STEP_MS, () => {
    room.state = "racing";
    room.goAt = Date.now();
    later(room, config.raceTimeLimitSeconds * 1000, () => endRace(room));
    change(room, { kind: "step", step: "Go" });
  });
  return json(200, { state: "countdown" });
}

function endRace(room: Room): void {
  if (room.state !== "racing") return;
  room.state = "finished";
  room.finishedAt = Date.now();
  for (const timer of room.timers) clearTimeout(timer);
  room.timers.clear();
  change(room, { kind: "over" });
}

function raceComplete(room: Room): boolean {
  return room.racers.every((racer) => racer.left || racer.place !== null || racer.dnf);
}

/** Types a racer's entries into their copy of the room's words; progress is computed here from the entries, never taken from the browser. */
export function receiveEntries(connection: LiveConnection, typed: string, entries: LogEntry[]): void {
  const room = rooms.get(normaliseCode(typed));
  const racer = room && connection.viewer && racerIn(room, connection.viewer);
  if (!room || !racer || room.state !== "racing" || !racer.engine) return;
  for (const entry of entries) {
    if (!isLoggableKey(entry.k) || !Number.isInteger(entry.t) || racer.entries.length >= config.maxLogEvents) continue;
    if (racer.engine.apply(entry)) racer.entries.push({ k: entry.k, t: entry.t });
  }
  const progress = Math.floor((100 * racer.engine.wordsCompletedCorrectly) / racer.engine.words.length);
  if (progress > racer.progress) {
    racer.progress = progress;
    change(room);
  }
}

function placeOf(room: Room, racer: Racer): number {
  return 1 + room.racers.filter((other) => other.duration !== null && racer.duration !== null && other.duration < racer.duration).length;
}

/** Replays a racer's finish like a run, places it by replayed duration, and ends the race when everyone is done. */
export function finishRace(viewer: Viewer, typed: string, raw: Buffer, body: unknown): Reply {
  const room = rooms.get(normaliseCode(typed));
  const racer = room && racerIn(room, viewer);
  if (!room || !racer) return fail(404, "room_not_found");
  if (room.state !== "racing" || racer.left || !racer.engine) return fail(409, "race_over");
  if (racer.finishReply) return racer.finishReply;
  const judged = judgeRun(body, racer.engine.words, { kind: "race" });
  const proofKey = createHash("sha256").update(raw).digest("hex");
  if (!judged.counted) {
    racer.dnf = true;
    racer.finishReply = fail(422, judged.code, { verdict: "not_counted", proofKey });
    change(room);
    if (raceComplete(room)) endRace(room);
    return racer.finishReply;
  }
  racer.duration = judged.score.duration;
  racer.progress = 100;
  racer.speed = fromHundredths(ratioHundredths(judged.score.speed));
  racer.accuracy = fromHundredths(ratioHundredths(judged.score.accuracy));
  for (const member of room.racers) if (member.duration !== null) member.place = placeOf(room, member);
  const place = placeOf(room, racer);
  racer.finishReply = json(200, { place, verdict: "counted", speed: racer.speed, accuracy: racer.accuracy, proofKey });
  change(room, { kind: "finished", seat: racer.seat, racer: racer.name, place, speed: racer.speed });
  if (raceComplete(room)) endRace(room);
  return racer.finishReply;
}

function removeFromLobby(room: Room, racer: Racer): void {
  room.racers.splice(room.racers.indexOf(racer), 1);
  if (room.racers.length === 0) return discard(room);
  const events: RoomEvent[] = [{ kind: "left", seat: racer.seat, racer: racer.name }];
  if (room.hostSeat === racer.seat) {
    const [heir] = room.racers;
    if (heir) {
      room.hostSeat = heir.seat;
      events.push({ kind: "host", seat: heir.seat, racer: heir.name });
    }
  }
  change(room, ...events);
}

function connectionsClosed(room: Room, racer: Racer): void {
  racer.dropTimer = setTimeout(() => {
    racer.dropTimer = null;
    if (room.state === "open") return removeFromLobby(room, racer);
    if (room.state === "finished" || racer.place !== null || racer.dnf) return;
    racer.left = true;
    change(room, { kind: "left", seat: racer.seat, racer: racer.name });
    if (room.state === "racing" && raceComplete(room)) endRace(room);
  }, config.raceRejoinSeconds * 1000);
}

/** Subscribes a connection to its room: a snapshot, the events missed since `since`, and the racer's own entries. */
export function attach(connection: LiveConnection, typed: string, since: number | null): void {
  const room = rooms.get(normaliseCode(typed));
  const racer = room && connection.viewer && racerIn(room, connection.viewer);
  if (!room || !racer) {
    connection.send({ type: "room-gone", code: normaliseCode(typed) });
    return;
  }
  connection.roomCode = room.code;
  racer.connections.add(connection);
  if (racer.dropTimer) {
    clearTimeout(racer.dropTimer);
    racer.dropTimer = null;
  }
  const missed = room.events.filter((entry) => entry.id > (since ?? room.events.length));
  connection.send({ type: "room", room: roomView(room), events: missed, entries: racer.entries, you: racer.seat, through: room.events.length });
}

export function detach(connection: LiveConnection): void {
  const room = connection.roomCode ? rooms.get(connection.roomCode) : undefined;
  const racer = room && connection.viewer && racerIn(room, connection.viewer);
  connection.roomCode = null;
  if (!room || !racer) return;
  racer.connections.delete(connection);
  if (racer.connections.size === 0) connectionsClosed(room, racer);
}

/** Forgets finished rooms nobody can still be reading. */
export function sweepFinishedRooms(): void {
  for (const room of rooms.values()) if (room.finishedAt !== null && Date.now() - room.finishedAt > FINISHED_ROOM_KEEP_MS) discard(room);
}
