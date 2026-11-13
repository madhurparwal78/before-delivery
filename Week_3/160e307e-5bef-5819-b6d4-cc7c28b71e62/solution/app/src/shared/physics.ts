import {
  FRAME_EVERY_STEPS,
  FRICTION_DECELERATION,
  HALF_BOARD_MM,
  MAX_SIM_SECONDS,
  PIECE_ORDER,
  POCKET_CAPTURE_SHARE,
  POCKET_IDS,
  POCKET_MAX_SPEED,
  POCKET_POSITIONS,
  POCKET_RADIUS,
  REST_SPEED,
  RESTITUTION_COINS,
  RESTITUTION_CUSHION,
  RESTITUTION_STRIKER,
  STEP_SECONDS,
  SUBSTEPS,
  pieceMass,
  pieceRadius,
} from "./constants";
import type { FrameSample, PieceId, PocketId, ShotEvents } from "./types";

/** dc-model-1: one deterministic model shared by the browser and the server. */

export interface Body {
  id: PieceId;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimulationResult {
  events: ShotEvents;
  frames: FrameSample[];
  /** every simulated body at rest, positions rounded to 0.01 mm, null once pocketed */
  final: { id: PieceId; x: number | null; y: number | null; state: "board" | "pocketed" }[];
  durationSeconds: number;
  maxSpeedAtRest: number;
}

interface Live {
  id: PieceId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  pocketed: boolean;
}

const SUBSTEP_SECONDS = STEP_SECONDS / SUBSTEPS;
const MAX_EVENTS_PER_SUBSTEP = 48;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function restitution(a: Live, b: Live): number {
  return a.id === "striker" || b.id === "striker" ? RESTITUTION_STRIKER : RESTITUTION_COINS;
}

function speedOf(body: Live): number {
  return Math.sqrt(body.vx * body.vx + body.vy * body.vy);
}

function applyFriction(bodies: Live[]): void {
  const drop = FRICTION_DECELERATION * SUBSTEP_SECONDS;
  for (const body of bodies) {
    if (body.pocketed) continue;
    const speed = speedOf(body);
    if (speed === 0) continue;
    const slowed = speed - drop;
    if (slowed <= 0) {
      body.vx = 0;
      body.vy = 0;
    } else {
      const scale = slowed / speed;
      body.vx *= scale;
      body.vy *= scale;
    }
  }
}

type Impact =
  | { time: number; kind: "pair"; a: Live; b: Live }
  | { time: number; kind: "cushion"; a: Live; axis: "x" | "y"; wall: number };

function pairImpactTime(a: Live, b: Live): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const wx = b.vx - a.vx;
  const wy = b.vy - a.vy;
  const along = dx * wx + dy * wy;
  if (along >= 0) return null;
  const reach = a.r + b.r;
  const c = dx * dx + dy * dy - reach * reach;
  if (c <= 0) return 0;
  const speedSquared = wx * wx + wy * wy;
  const disc = along * along - speedSquared * c;
  if (disc < 0) return null;
  return (-along - Math.sqrt(disc)) / speedSquared;
}

function cushionImpact(body: Live): { time: number; axis: "x" | "y"; wall: number } | null {
  let best: { time: number; axis: "x" | "y"; wall: number } | null = null;
  const consider = (axis: "x" | "y", position: number, velocity: number): void => {
    if (velocity === 0) return;
    const wall = velocity > 0 ? HALF_BOARD_MM - body.r : -HALF_BOARD_MM + body.r;
    const time = Math.max(0, (wall - position) / velocity);
    if (best === null || time < best.time) best = { time, axis, wall };
  };
  consider("x", body.x, body.vx);
  consider("y", body.y, body.vy);
  return best;
}

function nextImpact(bodies: Live[], limit: number): Impact | null {
  let best: Impact | null = null;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i] as Live;
    if (a.pocketed) continue;
    const aMoves = a.vx !== 0 || a.vy !== 0;
    if (aMoves) {
      const wall = cushionImpact(a);
      if (wall && wall.time < limit && (best === null || wall.time < best.time)) {
        best = { time: wall.time, kind: "cushion", a, axis: wall.axis, wall: wall.wall };
      }
    }
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j] as Live;
      if (b.pocketed) continue;
      if (!aMoves && b.vx === 0 && b.vy === 0) continue;
      const time = pairImpactTime(a, b);
      if (time !== null && time < limit && (best === null || time < best.time)) {
        best = { time, kind: "pair", a, b };
      }
    }
  }
  return best;
}

function resolvePair(a: Live, b: Live): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / distance;
  const ny = dy / distance;
  const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (approach >= 0) return;
  const impulse = (-(1 + restitution(a, b)) * approach) / (1 / a.m + 1 / b.m);
  a.vx -= (impulse * nx) / a.m;
  a.vy -= (impulse * ny) / a.m;
  b.vx += (impulse * nx) / b.m;
  b.vy += (impulse * ny) / b.m;
}

function advance(bodies: Live[], seconds: number): void {
  if (seconds <= 0) return;
  for (const body of bodies) {
    if (body.pocketed) continue;
    body.x += body.vx * seconds;
    body.y += body.vy * seconds;
  }
}

interface ContactNote {
  striker: Live | null;
  firstContact: PieceId | "cushion" | null;
}

function moveWithImpacts(bodies: Live[], note: ContactNote): void {
  let remaining = SUBSTEP_SECONDS;
  for (let guard = 0; guard < MAX_EVENTS_PER_SUBSTEP && remaining > 0; guard++) {
    const impact = nextImpact(bodies, remaining);
    if (impact === null) break;
    advance(bodies, impact.time);
    remaining -= impact.time;
    if (impact.kind === "pair") {
      resolvePair(impact.a, impact.b);
      if (note.firstContact === null && note.striker) {
        if (impact.a === note.striker) note.firstContact = impact.b.id;
        else if (impact.b === note.striker) note.firstContact = impact.a.id;
      }
    } else {
      const body = impact.a;
      if (impact.axis === "x") {
        body.x = impact.wall;
        body.vx = -body.vx * RESTITUTION_CUSHION;
      } else {
        body.y = impact.wall;
        body.vy = -body.vy * RESTITUTION_CUSHION;
      }
      if (note.firstContact === null && body === note.striker) note.firstContact = "cushion";
    }
  }
  advance(bodies, remaining);
}

function capture(bodies: Live[], events: ShotEvents): void {
  for (const body of bodies) {
    if (body.pocketed) continue;
    if (speedOf(body) >= POCKET_MAX_SPEED) continue;
    const reach = POCKET_RADIUS - POCKET_CAPTURE_SHARE * body.r;
    for (const pocket of POCKET_IDS) {
      const centre = POCKET_POSITIONS[pocket];
      const dx = body.x - centre.x;
      const dy = body.y - centre.y;
      if (dx * dx + dy * dy < reach * reach) {
        body.pocketed = true;
        body.vx = 0;
        body.vy = 0;
        recordPocketed(events, body.id, pocket);
        break;
      }
    }
  }
}

function recordPocketed(events: ShotEvents, id: PieceId, pocket: PocketId): void {
  if (id === "striker") events.strikerPocketed = true;
  else events.pocketed.push({ id, pocket });
}

function sample(bodies: Live[], previous: Map<PieceId, string>, time: number, first: boolean): FrameSample {
  const pieces: FrameSample["pieces"] = [];
  for (const body of bodies) {
    const x = body.pocketed ? null : round2(body.x);
    const y = body.pocketed ? null : round2(body.y);
    const key = `${x}|${y}`;
    if (first ? !body.pocketed && (body.vx !== 0 || body.vy !== 0) : previous.get(body.id) !== key) {
      pieces.push({ id: body.id, x, y });
    }
    previous.set(body.id, key);
  }
  return { t: Math.round(time * 1e4) / 1e4, pieces };
}

/**
 * Runs one shot from the given bodies until every piece is slower than 0.5 mm/s or 12 simulated
 * seconds have passed. Frames sample the simulation every 1/60 second and list only the pieces whose
 * rounded position changed since the previous frame (the first frame lists the moving pieces).
 */
export function simulate(input: readonly Body[]): SimulationResult {
  const bodies: Live[] = [...input]
    .sort((p, q) => (PIECE_ORDER.get(p.id) ?? 0) - (PIECE_ORDER.get(q.id) ?? 0))
    .map((b) => ({ ...b, r: pieceRadius(b.id), m: pieceMass(b.id), pocketed: false }));
  const events: ShotEvents = { firstContact: null, pocketed: [], strikerPocketed: false };
  const note: ContactNote = { striker: bodies.find((b) => b.id === "striker") ?? null, firstContact: null };
  const previous = new Map<PieceId, string>();
  const frames: FrameSample[] = [];
  const baseline = sample(bodies, previous, 0, true);
  frames.push(baseline);

  const maxSteps = Math.round(MAX_SIM_SECONDS / STEP_SECONDS);
  let steps = 0;
  let lastFrameStep = 0;
  while (steps < maxSteps) {
    if (bodies.every((b) => b.pocketed || speedOf(b) < REST_SPEED)) break;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      applyFriction(bodies);
      moveWithImpacts(bodies, note);
      capture(bodies, events);
    }
    steps++;
    if (steps % FRAME_EVERY_STEPS === 0) {
      frames.push(sample(bodies, previous, steps * STEP_SECONDS, false));
      lastFrameStep = steps;
    }
  }
  if (lastFrameStep !== steps) frames.push(sample(bodies, previous, steps * STEP_SECONDS, false));

  const maxSpeedAtRest = bodies.reduce((fastest, b) => (b.pocketed ? fastest : Math.max(fastest, speedOf(b))), 0);
  events.firstContact = note.firstContact;
  return {
    events,
    frames,
    final: bodies.map((b) => ({
      id: b.id,
      x: b.pocketed ? null : round2(b.x),
      y: b.pocketed ? null : round2(b.y),
      state: b.pocketed ? "pocketed" : "board",
    })),
    durationSeconds: Math.round(steps * STEP_SECONDS * 1e4) / 1e4,
    maxSpeedAtRest,
  };
}
