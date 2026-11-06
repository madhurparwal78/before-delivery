// What a crate shows at a moment of a sequence: each slot's unit and lift, the lid and the stamp.
// Every step shares one feel: it starts unhurried and then snaps decisively into place.
import { DROP_HEIGHT, type CrateView, type StampKind, type Tone } from "./model.js";

const DROP_MS = 170;
const LID_MS = 300;
const STAMP_MS = 180;
/** The lid swing and the stamp press, back to back. */
export const SEAL_MS = LID_MS + STAMP_MS;

/** CSS `cubic-bezier(.55,0,.15,1)`, the page's one easing, solved for progress `p` in 0..1. */
function ease(p: number): number {
  const [x1, y1, x2, y2] = [0.55, 0, 0.15, 1];
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < p) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

const clamp = (p: number) => Math.min(1, Math.max(0, p));

export interface UnitStep {
  at: number;
  dir: 1 | -1;
}

/** When each changed slot's unit moves, and when the lid and stamp run, in ms from the start. */
export interface Plan {
  units: Map<number, UnitStep>;
  lid: UnitStep | null;
}

export interface Pose {
  slots: { tone: Tone | null; lift: number }[];
  /** 0 open … 1 shut, and whether the lid is in the picture at all. */
  lid: number;
  lidShown: boolean;
  stamp: { kind: StampKind; scale: number; alpha: number } | null;
}

/** The lid falls with weight and rebounds a hair as it lands. */
function lidSwing(p: number): number {
  if (p < 0.86) return ease(p / 0.86);
  return 1 - 0.035 * Math.sin((Math.PI * (p - 0.86)) / 0.14);
}

function stampPress(kind: StampKind, p: number): Pose["stamp"] {
  if (p <= 0) return null;
  return { kind, scale: 1 + 0.35 * (1 - ease(clamp(p))), alpha: Math.min(1, p * 5) };
}

export function restPose(view: CrateView): Pose {
  return {
    slots: view.slots.map((tone) => ({ tone, lift: 0 })),
    lid: view.lidShut ? 1 : 0,
    lidShown: view.lidShut,
    stamp: view.stamp ? stampPress(view.stamp, 1) : null,
  };
}

/** The pose `t` ms into a sequence that takes the crate from one view to the next. */
export function poseAt(from: CrateView, to: CrateView, plan: Plan, t: number): Pose {
  const pose = restPose(to);
  for (const [index, step] of plan.units) {
    const p = clamp((t - step.at) / DROP_MS);
    const before = from.slots[index] ?? null;
    const after = to.slots[index] ?? null;
    if (t < step.at) pose.slots[index] = { tone: before, lift: 0 };
    else if (step.dir === 1) pose.slots[index] = { tone: after, lift: before === null ? DROP_HEIGHT * (1 - ease(p)) : 0 };
    else pose.slots[index] = p >= 1 ? { tone: null, lift: 0 } : { tone: before, lift: DROP_HEIGHT * ease(p) };
  }
  const lid = plan.lid;
  if (lid) {
    const stamp = (to.stamp ?? from.stamp) as StampKind;
    if (lid.dir === 1) {
      const swing = clamp((t - lid.at) / LID_MS);
      const press = clamp((t - lid.at - LID_MS) / STAMP_MS);
      pose.lid = t < lid.at ? 0 : lidSwing(swing);
      pose.lidShown = t >= lid.at;
      pose.stamp = press > 0 ? stampPress(stamp, press) : null;
    } else {
      const lift = clamp((t - lid.at) / STAMP_MS);
      const open = clamp((t - lid.at - STAMP_MS) / LID_MS);
      pose.lid = 1 - ease(open);
      pose.lidShown = open < 1;
      pose.stamp = lift < 1 ? stampPress(stamp, 1 - lift) : null;
    }
  }
  return pose;
}

/** The sequence is over once every step it holds has finished. */
export function planEnd(plan: Plan): number {
  let end = plan.lid ? plan.lid.at + SEAL_MS : 0;
  for (const step of plan.units.values()) end = Math.max(end, step.at + DROP_MS);
  return end;
}
