import {
  HALF_BOARD_MM,
  LAUNCH_SPEED,
  MAX_OFFSET,
  MIN_PLACEMENT_DISTANCE,
  STRIKER_RADIUS,
  baselineY,
} from "./constants";
import { simulate } from "./physics";
import type { Body } from "./physics";
import { newMatchState, ruleEnd, ruleShot } from "./rules";
import type { Format, MatchState, PieceId, PieceState, Seat, ShotIntent, ShotOutcome } from "./types";

/** Placement, aiming and the one entry point that plays a shot through the model and the laws. */

export interface LoggedShot extends ShotIntent {
  seat: Seat;
}

type ShotCheck = "ok" | "INVALID_INTENT" | "ILLEGAL_PLACEMENT";

export function strikerSpot(seat: Seat, offset: number): { x: number; y: number } {
  return { x: seat === 0 ? offset : -offset, y: baselineY(seat) };
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/** A striker centre at exactly 36.15 mm from a coin or the queen is legal: touching is allowed. */
export function placementLegal(pieces: readonly PieceState[], seat: Seat, offset: number): boolean {
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_OFFSET) return false;
  const spot = strikerSpot(seat, offset);
  const limit = MIN_PLACEMENT_DISTANCE * MIN_PLACEMENT_DISTANCE;
  return pieces.every(
    (p) => p.id === "striker" || p.state !== "board" || squaredDistance(spot.x, spot.y, p.x as number, p.y as number) + 1e-9 >= limit,
  );
}

export function aimDirection(seat: Seat, degrees: number): { dx: number; dy: number } {
  const radians = (degrees * Math.PI) / 180;
  const sign = seat === 0 ? 1 : -1;
  const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;
  return { dx: round(sign * Math.sin(radians)), dy: round(-sign * Math.cos(radians)) };
}

function validIntent(intent: ShotIntent): boolean {
  const { x, dx, dy, p } = intent;
  if (![x, dx, dy, p].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  if (Math.abs(x) > MAX_OFFSET || Math.abs(x * 2 - Math.round(x * 2)) > 1e-9) return false;
  if (Math.abs(Math.hypot(dx, dy) - 1) > 0.001) return false;
  return p >= 0 && p <= 1 && Math.abs(p * 1000 - Math.round(p * 1000)) < 1e-6;
}

export function checkShot(state: MatchState, seat: Seat, intent: ShotIntent): ShotCheck {
  if (!validIntent(intent)) return "INVALID_INTENT";
  return placementLegal(state.pieces, seat, intent.x) ? "ok" : "ILLEGAL_PLACEMENT";
}

interface AimTrace {
  first: PieceId | "cushion";
  /** how far the striker centre travels before touching it, in mm */
  distance: number;
}

/** The first piece the striker would touch on a straight path, or the cushion. It predicts no rebound. */
export function aimGuide(pieces: readonly PieceState[], seat: Seat, offset: number, dx: number, dy: number): AimTrace {
  const spot = strikerSpot(seat, offset);
  const limit = HALF_BOARD_MM - STRIKER_RADIUS;
  let nearest = Infinity;
  if (dx > 0) nearest = Math.min(nearest, (limit - spot.x) / dx);
  if (dx < 0) nearest = Math.min(nearest, (-limit - spot.x) / dx);
  if (dy > 0) nearest = Math.min(nearest, (limit - spot.y) / dy);
  if (dy < 0) nearest = Math.min(nearest, (-limit - spot.y) / dy);
  let first: PieceId | "cushion" = "cushion";
  for (const p of pieces) {
    if (p.id === "striker" || p.state !== "board") continue;
    const vx = (p.x as number) - spot.x;
    const vy = (p.y as number) - spot.y;
    const along = vx * dx + vy * dy;
    if (along < 0) continue;
    const across = vx * vx + vy * vy - along * along;
    const reach = MIN_PLACEMENT_DISTANCE * MIN_PLACEMENT_DISTANCE;
    if (across > reach) continue;
    const distance = Math.max(0, along - Math.sqrt(reach - across));
    if (distance < nearest) {
      nearest = distance;
      first = p.id;
    }
  }
  return { first, distance: nearest };
}

/** Rules one shot of a match: validates nothing, simulates with dc-model-1, then applies the laws. */
export function playShot(state: MatchState, seat: Seat, intent: ShotIntent): ShotOutcome {
  const spot = strikerSpot(seat, intent.x);
  const speed = LAUNCH_SPEED * intent.p;
  const bodies: Body[] = [];
  for (const p of state.pieces) {
    if (p.state !== "board") continue;
    if (p.id === "striker") bodies.push({ id: "striker", x: spot.x, y: spot.y, vx: speed * intent.dx, vy: speed * intent.dy });
    else bodies.push({ id: p.id, x: p.x as number, y: p.y as number, vx: 0, vy: 0 });
  }
  const result = simulate(bodies);
  const resting = new Map<PieceId, { x: number; y: number }>();
  for (const f of result.final) {
    if (f.id !== "striker" && f.state === "board" && f.x !== null && f.y !== null) resting.set(f.id, { x: f.x, y: f.y });
  }
  const outcome = ruleShot(state, seat, result.events, resting);
  return { ...outcome, frames: result.frames };
}

interface ReplayVerdict {
  state: MatchState;
  valid: boolean;
}

const MAX_REPLAY_SHOTS = 2000;

/** Replays a pass-and-play log from the opening layout: every shot legal and in turn, ending at the match end or a resignation. */
export function replayLocalMatch(format: Format, shots: readonly LoggedShot[], resignedSeat: Seat | null): ReplayVerdict {
  let state = newMatchState(format, 0);
  if (shots.length > MAX_REPLAY_SHOTS) return { state, valid: false };
  for (const shot of shots) {
    if (state.finished || shot.seat !== state.turn) return { state, valid: false };
    if (checkShot(state, shot.seat, shot) !== "ok") return { state, valid: false };
    state = playShot(state, shot.seat, shot).next;
  }
  if (resignedSeat !== null) {
    if (state.finished || resignedSeat !== state.turn) return { state, valid: false };
    return { state: ruleEnd(state, resignedSeat, "resigned"), valid: true };
  }
  return { state, valid: state.finished };
}

