import { CHAPTERS, DEFAULTS, FINISHES, chapterAt, isFinish, isHub, isModel, type ChapterId, type FinishId, type HubId, type ModelId } from "./catalogue.js";
import { clusterTime, parseInstant } from "./clock.js";
import type { Lock, Reading } from "./types.js";

/** Everything the cluster, the elevations and the price section show is derived here from one server reading. */

const MUTED = [156, 158, 163] as const;
const hex = (rgb: readonly number[]): string => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export const needleAngle = (hoursLeft: number): number => -135 + (270 * Math.min(hoursLeft, 96)) / 96;
export const two = (n: number): string => String(n).padStart(2, "0");

/** True when the caller's own lock on this hub and model is on the chosen finish: the holder of the last unit sees paint. */
export const holdsFinish = (reading: Reading, finish: FinishId): boolean => reading.lock !== null && reading.lock.finish === finish;

/** A lock cannot be asked for until a current reading is drawn, while the hub is stale or while the finish has no unit left. */
export const readingBlocksLock = (reading: Reading | null, failed: boolean): boolean => !reading || failed || reading.stale || reading.unitsLeft === 0;

/** `Lock this price` also stays off while the rider already holds this exact finish. */
export const lockBlocked = (reading: Reading | null, failed: boolean): boolean =>
  readingBlocksLock(reading, failed) || (reading !== null && holdsFinish(reading, reading.finish));

export const paintOf = (finish: FinishId): readonly [number, number, number] => (FINISHES.find((f) => f.id === finish) ?? FINISHES[0]!).paint;

export function tankRgb(reading: Reading, finish: FinishId): readonly number[] {
  return reading.unitsLeft === 0 && !holdsFinish(reading, finish) ? MUTED : paintOf(finish);
}
export const tankHex = (reading: Reading, finish: FinishId): string => hex(tankRgb(reading, finish));

function rideText(reading: Reading): string {
  const start = reading.nextSlot ? parseInstant(reading.nextSlot.startsAt) : null;
  return start === null ? "--:--" : clusterTime(start);
}
export const displayText = (reading: Reading): string => `UNITS ${two(reading.unitsLeft)} RIDE ${rideText(reading)}`;

export const lockedLock = (reading: Reading | null): Lock | null => (reading?.lock && reading.lock.state === "locked" ? reading.lock : null);

// --- the showroom URL

export type RoomUrl = { model: ModelId; hub: HubId; finish: FinishId; ch: ChapterId; part: string | null; at: number };

/** A part belongs to one chapter: leaving that chapter clears it, and a URL naming it elsewhere drops it. */
export const partFits = (part: string, at: number): boolean => chapterAt(at).parts.some((p) => p.id === part);

const chapterById = (id: string): (typeof CHAPTERS)[number] | undefined => CHAPTERS.find((c) => c.id === id);

/** Reads model, hub, finish, chapter, part and progress, applying every fallback the brief lists. */
export function parseRoomUrl(search: string): RoomUrl {
  const q = new URLSearchParams(search);
  const model = q.get("model");
  const hub = q.get("hub");
  const finish = q.get("finish");
  const rawAt = q.get("at");
  const num = rawAt !== null && rawAt.trim() !== "" ? Number(rawAt) : Number.NaN;
  const atValid = Number.isFinite(num) && num >= 0 && num <= 1;
  const chRaw = q.get("ch");
  const chValid = chRaw !== null ? chapterById(chRaw) : undefined;
  const at = atValid ? num : chValid ? chValid.jump : 0;
  const chapter = chapterAt(at);
  const partRaw = q.get("part");
  return {
    model: isModel(model) ? model : DEFAULTS.model,
    hub: isHub(hub) ? hub : DEFAULTS.hub,
    finish: isFinish(finish) ? finish : DEFAULTS.finish,
    ch: chapter.id,
    part: partRaw !== null && partFits(partRaw, at) ? partRaw : null,
    at: Math.round(at * 1000) / 1000,
  };
}

export function roomUrl(s: RoomUrl): string {
  const part = s.part ? `&part=${s.part}` : "";
  return `/showroom?model=${s.model}&hub=${s.hub}&finish=${s.finish}&ch=${s.ch}${part}&at=${s.at.toFixed(3)}`;
}

