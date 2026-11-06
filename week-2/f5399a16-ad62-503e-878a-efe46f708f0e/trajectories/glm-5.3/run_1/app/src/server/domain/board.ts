// Domain rules that several endpoints share: the board and its stamp, the
// target text, licence state, private page lifetimes, and the Ad-ID shape.
// Each rule is decided in exactly one place here.

import type { Db } from "../db";
import type { FrameRate } from "../../shared/framerate";
import { isFrameRate, targetFrames, realSecondsText } from "../../shared/framerate";
import { timecode } from "../../shared/timecode";
import type { Instant } from "../../shared/tz";
import type { Town } from "../../shared/copy";
import { dateOnly, wallDate } from "../../shared/tz";
import { newToken, throwJson, HttpError } from "../http";
import { ARTIST_COPY } from "../../shared/copy";
import type { Json } from "../http";

// A frame as the wire shows it.
export type FrameView = {
  number: number;
  position: number;
  durationFrames: number;
  actionNote: string;
  audioNote: string;
  shot: string;
  visual: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawingUrl: string | null;
};

export type BoardView = {
  jobId: string;
  stamp: string;
  frameRate: FrameRate;
  targetSeconds: number;
  targetFrames: number;
  totalFrames: number;
  secondsText: string;
  targetText: string;
  frames: FrameView[];
};

// The Ad-ID shape: four capital letters, seven capital letters or digits,
// then H or D. Eleven right characters plus any twelfth answer the end copy;
// any other shape answers the shape copy.
export function adIdProblem(adId: string): string | null {
  if (!/^[A-Z0-9]{11}[A-Z0-9]$/.test(adId)) {
    return ARTIST_COPY.adIdShape;
  }
  if (!/^[A-Z]{4}[A-Z0-9]{7}$/.test(adId.slice(0, 11))) {
    return ARTIST_COPY.adIdShape;
  }
  const last = adId[11]!;
  if (last !== "H" && last !== "D") {
    return ARTIST_COPY.adIdEnd;
  }
  return null;
}

export function validAdId(adId: string): boolean {
  return adIdProblem(adId) === null;
}

// The board's target text: `exact`, `<count> frames over` or `<count> frames
// under`, singular at 1.
export function targetTextOf(totalFrames: number, target: number): string {
  if (totalFrames === target) return "exact";
  const diff = Math.abs(totalFrames - target);
  const unit = diff === 1 ? "1 frame" : `${diff} frames`;
  return totalFrames > target ? `${unit} over` : `${unit} under`;
}

export async function loadBoard(db: Db, jobId: string): Promise<BoardView | null> {
  const job = await db.one("select id, target_seconds, frame_rate from jobs where id = $1", [jobId]);
  if (job === null) return null;
  const stampRow = await db.one("select stamp, frame_rate from board_stamps where job_id = $1", [jobId]);
  if (stampRow === null) return null;
  const frameRate = isFrameRate(String(stampRow.frame_rate)) ? (String(stampRow.frame_rate) as FrameRate) : "25";
  const frames = await db.many(
    "select number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded from frames where job_id = $1 order by position",
    [jobId],
  );
  const target = targetFrames(Number(job.target_seconds), frameRate);
  const total = frames.reduce((sum, f) => sum + Number(f.duration_frames), 0);
  return {
    jobId,
    stamp: String(stampRow.stamp),
    frameRate,
    targetSeconds: Number(job.target_seconds),
    targetFrames: target,
    totalFrames: total,
    secondsText: realSecondsText(total, frameRate),
    targetText: targetTextOf(total, target),
    frames: frames.map((f) => frameViewOf(jobId, f)),
  };
}

export function frameViewOf(jobId: string, row: Record<string, unknown>): FrameView {
  return {
    number: Number(row.number),
    position: Number(row.position),
    durationFrames: Number(row.duration_frames),
    actionNote: String(row.action_note),
    audioNote: String(row.audio_note),
    shot: String(row.shot),
    visual: String(row.visual),
    fileName: row.file_name === null ? null : String(row.file_name),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    sha256: row.sha256 === null ? null : String(row.sha256),
    drawingUrl: `/api/jobs/${jobId}/frames/${Number(row.number)}/drawing`,
  };
}

// A new board stamp on every change that makes one.
export async function newBoardStamp(db: Db, jobId: string): Promise<string> {
  const stamp = newToken();
  await db.query("update board_stamps set stamp = $1 where job_id = $2", [stamp, jobId]);
  return stamp;
}

// The stale-edit rule: a stamp shown in its table is still required.
export async function requireStamp(db: Db, jobId: string, given: string | null): Promise<string> {
  const row = await db.one("select stamp from board_stamps where job_id = $1", [jobId]);
  const held = row === null ? "" : String(row.stamp);
  if (given !== held) {
    throw new HttpError(412, "stale", ARTIST_COPY.staleBoard("00:00"), {});
  }
  return held;
}

// Licence state by the market's local wall time: `until` tomorrow is 1 day,
// `until` today ends today, a past `until` has ended printing that date.
export function licenceTextOf(until: string, market: Town, at: Instant): string {
  const today = wallDate(market, at);
  if (until > today) {
    const days = dayDiff(today, until);
    return days === 1 ? ARTIST_COPY.licenceDays(1) : ARTIST_COPY.licenceDays(days);
  }
  if (until === today) return ARTIST_COPY.licenceToday;
  return ARTIST_COPY.licenceEnded(until);
}

function dayDiff(from: string, to: string): number {
  return Math.round((dateOnly(to) - dateOnly(from)) / 86400);
}

export function licenceEndedBefore(until: string, market: Town, at: Instant): boolean {
  return until < wallDate(market, at);
}

// A private page lasts until 23:59:59 producer local wall time on the due
// date, or the page's own seconds after sending, whichever comes first, and
// ends exactly at that instant.
export function pageEndsAt(town: Town, dueDate: string, sentAt: Instant, pageSeconds: number): Instant {
  const dueEnd = endOfLocalDay(town, dueDate);
  const fromSending = sentAt + pageSeconds;
  return dueEnd < fromSending ? dueEnd : fromSending;
}

// 23:59:59 on a town's local date, as a UTC instant: the offset that makes
// the local date match is the one in effect that day, DST boundaries included.
export function endOfLocalDay(town: Town, date: string): Instant {
  const base = dateOnly(date);
  const offsets = town === "dubai" ? [240] : town === "amsterdam" ? [60, 120] : [-300, -240];
  const candidates = offsets
    .map((offset) => base + 86399 - offset * 60)
    .filter((at) => wallDate(town, at) === date);
  if (candidates.length > 0) return Math.max(...candidates);
  return base + 86399;
}

export function asJson(value: unknown): Json {
  return value as Json;
}

export function jsonError(status: number, code: string, message: string): never {
  return throwJson(status, code, message);
}

export { timecode };
