// The camera rig: the one owner of the camera pose. The globe applies it, user gestures feed it,
// and the readout and the URL read it. Eases end exactly at their durations; with reduced motion
// every move lands at once.
import { baseHeightAt } from "../../shared/corridorLine";
import { inverse, pointAt } from "../../shared/geodesy";
import type { CorridorShape } from "./corridorMath";
import { prefersReducedMotion } from "./motion";

export interface Pose {
  lonDeg: number;
  latDeg: number;
  heightM: number;
  headingDeg: number;
  pitchDeg: number;
}

const CHASE_BACK_M = 150;
export const CHASE_UP_COVERED_M = 80;
export const CHASE_UP_GROUND_M = 60;
const MIN_CLEARANCE_M = 10;
export const CHASE_MS = 340;
export const FLY_MS = 1100;

type Ease = (t: number) => number;
export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;
export const easeOutQuart: Ease = (t) => 1 - (1 - t) ** 4;

type PoseSource = "rig" | "user";
type Listener = (pose: Pose, source: PoseSource) => void;

/** The finest loaded terrain under a point (height and level), or null when none is loaded there. */
type GroundSampler = (lonDeg: number, latDeg: number) => { heightM: number; level: number } | null;

function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

/** A pose `back` metres behind `target` along the centreline and `up` metres above it, looking at it. */
export function lookingAt(shape: CorridorShape, targetChainageM: number, target: { lonDeg: number; latDeg: number; heightM: number }, up: number): Pose {
  const eye = pointAt(shape.line, targetChainageM - CHASE_BACK_M, 0);
  const toward = inverse(eye, target);
  return {
    lonDeg: eye.lonDeg,
    latDeg: eye.latDeg,
    heightM: target.heightM + up,
    headingDeg: ((toward.azimuthDeg % 360) + 360) % 360,
    pitchDeg: (-Math.atan2(up, toward.distanceM) * 180) / Math.PI,
  };
}

export class CameraRig {
  private current: Pose;
  private motion: { from: Pose; to: Pose; start: number; duration: number; ease: Ease; arcM: number } | null = null;
  private frame = 0;
  private readonly listeners = new Set<Listener>();
  ground: GroundSampler = () => null;

  constructor(
    initial: Pose,
    private readonly shape: CorridorShape,
  ) {
    this.current = initial;
  }

  get pose(): Pose {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ground under a point: the finest loaded terrain, else the interpolated tower base height. */
  groundAt(lonDeg: number, latDeg: number, chainageM: number): number {
    return this.ground(lonDeg, latDeg)?.heightM ?? baseHeightAt(this.shape.marks, chainageM);
  }

  private emit(source: PoseSource): void {
    for (const listener of this.listeners) listener(this.current, source);
  }

  /** A pose the user's gesture produced: it ends any ease in progress. */
  takeFromUser(pose: Pose): void {
    this.cancel();
    this.current = pose;
    this.emit("user");
  }

  /** Puts the camera exactly at a pose (a URL camera, or a reduced-motion move). */
  jumpTo(pose: Pose): void {
    this.cancel();
    this.current = pose;
    this.emit("rig");
  }

  /**
   * Eases from the current pose; a new ease restarts from wherever the camera is. A fly (`arc`)
   * rises above the straight path and settles back, as a camera flight between two places does.
   */
  easeTo(target: Pose, duration: number, ease: Ease, arc = false): void {
    if (prefersReducedMotion() || duration <= 0) {
      this.jumpTo(target);
      return;
    }
    this.cancel();
    const distance = inverse(this.current, target).distanceM;
    const arcM = arc ? Math.min(400, 40 + distance * 0.25) : 0;
    this.motion = { from: this.current, to: target, start: performance.now(), duration, ease, arcM };
    const step = (now: number): void => {
      const motion = this.motion;
      if (motion === null) return;
      const t = Math.min(1, Math.max(0, (now - motion.start) / motion.duration));
      const k = motion.ease(t);
      this.current = {
        lonDeg: motion.from.lonDeg + (motion.to.lonDeg - motion.from.lonDeg) * k,
        latDeg: motion.from.latDeg + (motion.to.latDeg - motion.from.latDeg) * k,
        heightM: motion.from.heightM + (motion.to.heightM - motion.from.heightM) * k + motion.arcM * Math.sin(Math.PI * k),
        headingDeg: (lerpAngle(motion.from.headingDeg, motion.to.headingDeg, k) + 360) % 360,
        pitchDeg: motion.from.pitchDeg + (motion.to.pitchDeg - motion.from.pitchDeg) * k,
      };
      if (t >= 1) {
        this.current = motion.to;
        this.motion = null;
      } else {
        this.frame = requestAnimationFrame(step);
      }
      this.emit("rig");
    };
    this.frame = requestAnimationFrame(step);
  }

  cancel(): void {
    if (this.motion !== null) cancelAnimationFrame(this.frame);
    this.motion = null;
  }

  /** Keeps a pose at least 10 m above the loaded ground. */
  clampAboveGround(pose: Pose, chainageM: number): Pose {
    const floor = this.groundAt(pose.lonDeg, pose.latDeg, chainageM) + MIN_CLEARANCE_M;
    return pose.heightM < floor ? { ...pose, heightM: floor } : pose;
  }
}

export function formatCam(pose: Pose): string {
  const heading = ((pose.headingDeg % 360) + 360) % 360;
  return [pose.lonDeg.toFixed(7), pose.latDeg.toFixed(7), pose.heightM.toFixed(1), heading.toFixed(1), pose.pitchDeg.toFixed(1)].join(",");
}

export function parseCam(value: string | null): Pose | null {
  if (value === null) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lonDeg = 0, latDeg = 0, heightM = 0, headingDeg = 0, pitchDeg = 0] = parts;
  return { lonDeg, latDeg, heightM, headingDeg, pitchDeg };
}
