// The frame rule and the score, each decided only here. The server computes them;
// the page re-uses the frame rule for `data-in-view` and `Frame guide`.

import { CreatureSpec, CreatureState, creatureAt, isPresent, hourOfTick } from "./creatures";
import { Config } from "./config";
import { Heading } from "./world";

export interface Pose {
  island: number;
  tile: [number, number];
  camera: [number, number];
  heading: Heading;
  zoom: number;
  focus: number;
  tick: number;
}

export function forwardLateral(ex: number, ey: number, heading: Heading, cx: number, cy: number): { a: number; l: number } {
  switch (heading) {
    case "N": return { a: ey - cy, l: cx - ex };
    case "E": return { a: cx - ex, l: cy - ey };
    case "S": return { a: cy - ey, l: ex - cx };
    case "W": return { a: ex - cx, l: ey - cy };
  }
}

export function isInFrame(a: number, l: number, zoom: number): boolean {
  return a >= 1 && a <= 24 && 2 * zoom * Math.abs(l) <= a;
}

/** In-frame creatures sorted by a, then |l|, then id. */
export function creaturesInFrame(pose: Pose, creatures: readonly CreatureState[]): CreatureState[] {
  const [ex, ey] = pose.tile;
  const hits: { c: CreatureState; a: number; l: number }[] = [];
  const all = [...creatures];
  all.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const c of all) {
    const { a, l } = forwardLateral(ex, ey, pose.heading, c.x, c.y);
    if (isInFrame(a, l, pose.zoom)) hits.push({ c, a, l });
  }
  hits.sort((p, q) => p.a - q.a || Math.abs(p.l) - Math.abs(q.l) || (p.c.id < q.c.id ? -1 : 1));
  return hits.map(h => h.c);
}

/** The creature truth the server scores against, at the pose's own tick. */
export function creatureStatesForScoring(spec: readonly CreatureSpec[], pose: Pose, config: Config): CreatureState[] {
  const weather = hourWeather(pose.tick, config);
  const hour = hourOfTick(pose.tick, config.worldDayTicks);
  const out: CreatureState[] = [];
  for (const c of spec) {
    if (c.island !== pose.island) continue;
    if (!isPresent(c, hour, weather)) continue;
    const p = creatureAt(c, pose.tick);
    out.push({ id: c.id, name: c.name, island: c.island, size: c.size, x: p.x, y: p.y, heading: p.heading });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function hourWeather(tick: number, config: Config): "clear" | "rain" {
  const hour = hourOfTick(tick, config.worldDayTicks);
  return hour >= config.rainStartHour && hour < config.rainEndHour ? "rain" : "clear";
}

export type Facing = "toward" | "side" | "away";

export function facingOf(creatureHeading: Heading, explorerHeading: Heading): Facing {
  const opposite: Record<Heading, Heading> = { N: "S", S: "N", E: "W", W: "E" };
  if (creatureHeading === opposite[explorerHeading]) return "toward";
  if (creatureHeading === explorerHeading) return "away";
  return "side";
}

export interface Score { size: number; centring: number; facing: number; sharpness: number; total: number }
export interface Measures { distance: number; best_distance: number; offset: number; focus_error: number; creature_facing: Facing }

/** The score, in whole numbers. */
export function scoreOf(pose: Pose, subject: CreatureState): { score: Score; measures: Measures } {
  const { a, l } = forwardLateral(pose.tile[0], pose.tile[1], pose.heading, subject.x, subject.y);
  const S = subject.size;
  const size = Math.max(0, 30 - 10 * Math.abs(a - 2 * pose.zoom * S));
  const centring = Math.max(0, 25 - 10 * Math.abs(l) * pose.zoom);
  const facingKind = facingOf(subject.heading, pose.heading);
  const facing = facingKind === "toward" ? 25 : facingKind === "side" ? 15 : 0;
  const sharpness = Math.max(0, 20 - 5 * Math.abs(pose.focus - a));
  return {
    score: { size, centring, facing, sharpness, total: size + centring + facing + sharpness },
    measures: {
      distance: a,
      best_distance: 2 * pose.zoom * S,
      offset: l,
      focus_error: Math.abs(pose.focus - a),
      creature_facing: facingKind
    }
  };
}
