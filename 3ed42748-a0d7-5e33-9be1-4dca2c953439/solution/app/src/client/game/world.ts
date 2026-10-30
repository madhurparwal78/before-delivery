// The courier on Bramble and the camera rigs. Gravity always points at the centre: the walker
// keeps a unit position and a unit forward tangent and turns them about the planet's axes.
// Each rig's pose and limits live here: intro dive, follow camera, route orbit and photo camera.
import { Vector3 } from "three";
import { clamp01, easePrint } from "../lib/motion";

export const RADIUS = 60;
const WALK_MPS = 4;
const TURN_DPS = 120;
const TURN_RAMP_S = 0.2;
const JUMP_SPEED = 4.2;
const GRAVITY = 12;
const DEG = Math.PI / 180;

export class Walker {
  /** Unit vector from the centre to the courier; the depot is +Z, north is +Y. */
  readonly p = new Vector3(0, 0, 1);
  /** Unit tangent the courier faces. */
  readonly f = new Vector3(0, 1, 0);
  height = 0;
  private vUp = 0;
  turnRate = 0;
  moving = false;
  forwardInput = 0;
  turnInput = 0;
  private lastHeading = 0;

  get grounded(): boolean {
    return this.height <= 0 && this.vUp <= 0;
  }

  get turning(): boolean {
    return this.turnRate !== 0;
  }

  jump(): void {
    if (this.grounded) this.vUp = JUMP_SPEED;
  }

  /** Clears input and motion, e.g. when photo mode freezes the courier. */
  halt(): void {
    this.forwardInput = 0;
    this.turnInput = 0;
    this.turnRate = 0;
  }

  update(dt: number, reduced: boolean): void {
    const target = this.turnInput * TURN_DPS;
    if (reduced) this.turnRate = target;
    else {
      const step = (TURN_DPS / TURN_RAMP_S) * dt;
      this.turnRate += Math.max(-step, Math.min(step, target - this.turnRate));
    }
    if (this.turnRate !== 0) this.f.applyAxisAngle(this.p, -this.turnRate * DEG * dt);
    const ds = this.forwardInput * WALK_MPS * dt;
    this.moving = ds !== 0;
    if (this.moving) {
      const axis = new Vector3().crossVectors(this.p, this.f).normalize();
      const angle = ds / RADIUS;
      this.p.applyAxisAngle(axis, angle).normalize();
      this.f.applyAxisAngle(axis, angle);
    }
    this.f.addScaledVector(this.p, -this.f.dot(this.p)).normalize();
    if (this.height > 0 || this.vUp > 0) {
      this.height += this.vUp * dt;
      this.vUp -= GRAVITY * dt;
      if (this.height <= 0) {
        this.height = 0;
        this.vUp = 0;
      }
    }
  }

  latLon(): { lat: number; lon: number } {
    return {
      lat: Math.asin(Math.max(-1, Math.min(1, this.p.y))) / DEG,
      lon: Math.atan2(this.p.x, this.p.z) / DEG,
    };
  }

  /** Compass heading, clockwise from north, 0 to below 360. */
  heading(): number {
    const cosLat = Math.hypot(this.p.x, this.p.z);
    if (cosLat < 1e-6) return this.lastHeading;
    const sinLon = this.p.x / cosLat;
    const cosLon = this.p.z / cosLat;
    const north = new Vector3(-this.p.y * sinLon, cosLat, -this.p.y * cosLon);
    const east = new Vector3(cosLon, 0, -sinLon);
    const h = Math.atan2(this.f.dot(east), this.f.dot(north)) / DEG;
    this.lastHeading = (h + 360) % 360;
    return this.lastHeading;
  }

  ground(out = new Vector3()): Vector3 {
    return out.copy(this.p).multiplyScalar(RADIUS);
  }

  feet(out = new Vector3()): Vector3 {
    return out.copy(this.p).multiplyScalar(RADIUS + this.height);
  }
}

export interface Pose {
  pos: Vector3;
  target: Vector3;
  up: Vector3;
  fov: number;
}

export const clonePose = (p: Pose): Pose => ({
  pos: p.pos.clone(),
  target: p.target.clone(),
  up: p.up.clone(),
  fov: p.fov,
});

export interface Blocker {
  centre: Vector3;
  radius: number;
}

const CLEARANCE_M = 1.5;

/** Keeps a pose out of the planet and out of homes: closer along the same line until clear. */
function cleared(pose: Pose, blockers: readonly Blocker[]): Pose {
  const towards = pose.pos.clone().sub(pose.target);
  let length = towards.length();
  const dir = towards.divideScalar(length || 1);
  for (const b of blockers) {
    const oc = pose.target.clone().sub(b.centre);
    const half = oc.dot(dir);
    const c = oc.lengthSq() - b.radius * b.radius;
    const disc = half * half - c;
    if (disc <= 0) continue;
    const t = -half - Math.sqrt(disc);
    const exit = -half + Math.sqrt(disc);
    if (c < 0) continue;
    if (t > 0 && t < length) length = Math.max(0.5, t - 0.2);
    else if (exit > 0 && t < 0) length = Math.max(0.5, exit + 0.2);
  }
  pose.pos.copy(pose.target).addScaledVector(dir, length);
  const r = pose.pos.length();
  if (r < RADIUS + CLEARANCE_M) pose.pos.multiplyScalar((RADIUS + CLEARANCE_M) / r);
  return pose;
}

const FOLLOW_FOV = 55;
const INTRO_FOV = 40;
export const PHOTO_FOV = 50;

/** Resting over-the-shoulder pose: 7 m behind, 3.5 m up, looking 2 m ahead and 1 m above the ground. */
export function followPose(w: Walker, blockers: readonly Blocker[]): Pose {
  const ground = w.ground();
  return cleared(
    {
      pos: ground.clone().addScaledVector(w.p, 3.5).addScaledVector(w.f, -7),
      target: ground.clone().addScaledVector(w.f, 2).addScaledVector(w.p, 1),
      up: w.p.clone(),
      fov: FOLLOW_FOV,
    },
    blockers,
  );
}

/** The intro's first frame: 240 m from the centre on the line through the courier, the whole planet in view. */
export function introPose(w: Walker): Pose {
  return { pos: w.p.clone().multiplyScalar(240), target: new Vector3(), up: w.f.clone(), fov: INTRO_FOV };
}

/** The route orbit: on the outward line through the route's midpoint, framing courier and door. */
export function orbitPose(from: Vector3, door: Vector3, aspect: number): Pose {
  const a = from.clone().normalize();
  const b = door.clone().normalize();
  const half = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / 2;
  let mid = a.clone().add(b);
  if (mid.lengthSq() < 1e-8) mid = new Vector3().crossVectors(a, new Vector3(0, 1, 0.3)).normalize();
  mid.normalize();
  let normal = new Vector3().crossVectors(a, b);
  if (normal.lengthSq() < 1e-10) normal = new Vector3().crossVectors(mid, Math.abs(mid.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  normal.normalize();
  const along = new Vector3().crossVectors(normal, mid).normalize();
  const vTan = Math.tan((FOLLOW_FOV / 2) * DEG);
  const wide = aspect >= 1;
  const spanTan = wide ? vTan * aspect : vTan;
  const fit = Math.cos(half) + Math.sin(half) / (0.7 * spanTan);
  const visible = 1.08 / Math.max(Math.cos(half), 0.25);
  const distance = Math.min(4, Math.max(2.2, fit, visible)) * RADIUS;
  return {
    pos: mid.clone().multiplyScalar(distance),
    target: mid.clone().multiplyScalar(RADIUS * 0.6),
    up: wide ? normal : along,
    fov: FOLLOW_FOV,
  };
}

/** Photo camera: 8 m from the feet, 20° above the local horizon, looking 1 m above the feet. */
export function photoPose(w: Walker, yawDeg: number, fov: number, blockers: readonly Blocker[]): Pose {
  const ground = w.ground();
  const back = w.f.clone().negate().applyAxisAngle(w.p, -yawDeg * DEG);
  const elevation = 20 * DEG;
  return cleared(
    {
      pos: ground
        .clone()
        .addScaledVector(back, 8 * Math.cos(elevation))
        .addScaledVector(w.p, 8 * Math.sin(elevation)),
      target: ground.clone().addScaledVector(w.p, 1),
      up: w.p.clone(),
      fov,
    },
    blockers,
  );
}

/** Straight-line blend (the intro dive: the distance to the courier only ever falls). */
export function blendLinear(a: Pose, b: Pose, t: number): Pose {
  return {
    pos: a.pos.clone().lerp(b.pos, t),
    target: a.target.clone().lerp(b.target, t),
    up: a.up.clone().lerp(b.up, t).normalize(),
    fov: a.fov + (b.fov - a.fov) * t,
  };
}

/** Blend over the planet: direction slerps and radius lerps, so the camera never cuts through it. */
export function blendArc(a: Pose, b: Pose, t: number): Pose {
  const ra = a.pos.length();
  const rb = b.pos.length();
  const da = a.pos.clone().divideScalar(ra);
  const db = b.pos.clone().divideScalar(rb);
  const angle = Math.acos(Math.max(-1, Math.min(1, da.dot(db))));
  let dir: Vector3;
  if (angle < 1e-5) dir = da.clone();
  else {
    const s = Math.sin(angle);
    dir = da
      .clone()
      .multiplyScalar(Math.sin((1 - t) * angle) / s)
      .addScaledVector(db, Math.sin(t * angle) / s);
  }
  return {
    pos: dir.normalize().multiplyScalar(ra + (rb - ra) * t),
    target: a.target.clone().lerp(b.target, t),
    up: a.up.clone().lerp(b.up, t).normalize(),
    fov: a.fov + (b.fov - a.fov) * t,
  };
}

/** A timed move from a fixed pose to a pose that may itself be moving. */
export class CameraTween {
  constructor(
    readonly from: Pose,
    readonly to: () => Pose,
    readonly start: number,
    readonly duration: number,
  ) {}

  done(now: number): boolean {
    return now >= this.start + this.duration;
  }

  pose(now: number): Pose {
    return blendArc(this.from, this.to(), easePrint(clamp01((now - this.start) / this.duration)));
  }
}
