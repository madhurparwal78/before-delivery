import { POCKET_POSITIONS } from "../../shared/constants";
import type { FrameSample, PieceId, PieceState, PocketId, ShotEvents } from "../../shared/types";

/** Plays the server's trajectory frames back on animation frames: never a prediction. */

const PLAYBACK_CAP_MS = 2400;
const REAL_SPEED_FACTOR = 2;
const STRAIGHT_LINE_MS = 333;
const DROP_MS = 140;
const FRAME_SECONDS = 1 / 60;

export type Spot = { x: number; y: number } | null;

interface PieceSink {
  /** current displayed position of a piece, null when it is not on the board */
  position(id: PieceId): Spot;
  place(id: PieceId, spot: Spot, scale: number): void;
}

interface Plan {
  frames: Map<PieceId, Spot>[];
  durationMs: number;
  secondsPerFrame: number;
  pockets: Map<PieceId, PocketId>;
  ids: PieceId[];
}

function carry(previous: Map<PieceId, Spot>, sample: FrameSample): Map<PieceId, Spot> {
  const next = new Map(previous);
  for (const piece of sample.pieces) next.set(piece.id, piece.x === null || piece.y === null ? null : { x: piece.x, y: piece.y });
  return next;
}

function plan(sink: PieceSink, frames: FrameSample[], final: PieceState[], events: ShotEvents): Plan {
  const ids = final.map((f) => f.id);
  const start = new Map<PieceId, Spot>(ids.map((id) => [id, sink.position(id)]));
  const pockets = new Map<PieceId, PocketId>(events.pocketed.map((p) => [p.id, p.pocket]));
  if (frames.length > 1) {
    const steps: Map<PieceId, Spot>[] = [];
    let current = start;
    for (const sample of frames) {
      current = carry(current, sample);
      steps.push(current);
    }
    const simulated = (frames[frames.length - 1] as FrameSample).t;
    const rate = simulated <= (PLAYBACK_CAP_MS / 1000) * REAL_SPEED_FACTOR ? REAL_SPEED_FACTOR : simulated / (PLAYBACK_CAP_MS / 1000);
    return { frames: steps, durationMs: Math.min(PLAYBACK_CAP_MS, (simulated / rate) * 1000), secondsPerFrame: FRAME_SECONDS / rate, pockets, ids };
  }
  const end = new Map<PieceId, Spot>(final.map((f) => [f.id, f.x === null || f.y === null ? null : { x: f.x, y: f.y }]));
  for (const id of ids) {
    if (id !== "striker" && end.get(id) === null && !pockets.has(id)) pockets.set(id, "se");
  }
  return { frames: [start, end], durationMs: STRAIGHT_LINE_MS, secondsPerFrame: STRAIGHT_LINE_MS / 1000, pockets, ids };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Running {
  skip: () => void;
  done: Promise<void>;
}

/** Starts a playback. The returned promise settles when the pieces are at the frames' last positions. */
export function play(sink: PieceSink, frames: FrameSample[], final: PieceState[], events: ShotEvents): Running {
  const steps = plan(sink, frames, final, events);
  const last = steps.frames.length - 1;
  let started: number | null = null;
  let finished = false;
  let handle = 0;
  const dropping = new Map<PieceId, { at: number; from: { x: number; y: number }; to: { x: number; y: number } }>();
  let resolve: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    resolve = r;
  });

  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(handle);
    const end = steps.frames[last] as Map<PieceId, Spot>;
    for (const id of steps.ids) sink.place(id, end.get(id) ?? null, 1);
    resolve();
  };

  const frame = (): void => {
    if (finished) return;
    const now = performance.now();
    started ??= now;
    const elapsed = now - started;
    if (elapsed >= steps.durationMs) {
      finish();
      return;
    }
    const position = Math.min(last, elapsed / 1000 / steps.secondsPerFrame);
    const index = Math.min(last - 1, Math.floor(position));
    const mix = position - index;
    const from = steps.frames[index] as Map<PieceId, Spot>;
    const to = steps.frames[index + 1] as Map<PieceId, Spot>;
    for (const id of steps.ids) {
      const a = from.get(id) ?? null;
      const b = to.get(id) ?? null;
      const drop = dropping.get(id);
      if (a && !b && !drop) {
        const pocket = steps.pockets.get(id);
        if (pocket) dropping.set(id, { at: now, from: a, to: POCKET_POSITIONS[pocket] });
      }
      const active = dropping.get(id);
      if (active) {
        const t = Math.min(1, (now - active.at) / DROP_MS);
        sink.place(id, t >= 1 ? null : { x: lerp(active.from.x, active.to.x, t), y: lerp(active.from.y, active.to.y, t) }, 1 - 0.65 * t);
      } else if (a && b) {
        sink.place(id, { x: lerp(a.x, b.x, mix), y: lerp(a.y, b.y, mix) }, 1);
      } else if (b) {
        sink.place(id, b, 1);
      }
    }
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return { skip: finish, done };
}
