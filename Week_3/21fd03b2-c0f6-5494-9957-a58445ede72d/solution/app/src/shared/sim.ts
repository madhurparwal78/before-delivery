import { canonicalJson, compareIds } from "./canonical";
import type { SceneDocument, SceneObject } from "./doc";
import type { Bounds } from "./gltf";
import type { Vec3, Vec4 } from "./params";
import { sha256Hex } from "./sha256";

/**
 * The fixed-step bench. Every step uses only + - * / and square roots, which IEEE 754 rounds identically in every
 * engine; the trigonometry it needs is the series below, never the platform's maths library.
 */
export const STEP_SECONDS = 1 / 120;
export const MAX_STEPS = 12000;
export const SOLVER_ITERATIONS = 4;
const CRATE_FRICTION = 0.5;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const TWO_PI = 6.283185307179586;
const DEG = 0.017453292519943295;

function sin(x: number): number {
  let r = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  let term = r;
  let sum = r;
  for (let n = 1; n <= 10; n++) {
    term = (-term * r2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function cos(x: number): number {
  return sin(x + HALF_PI);
}

function qmul(a: Vec4, b: Vec4): Vec4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qz(angle: number): Vec4 {
  const half = angle / 2;
  return [0, 0, sin(half), cos(half)];
}

function normalise(q: Vec4): Vec4 {
  const length = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return length === 0 ? [0, 0, 0, 1] : [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function rotate(q: Vec4, v: Vec3): Vec3 {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

export interface Collider {
  min: Vec3;
  max: Vec3;
}

/** A model's scaled box in the world: its glTF bounds scaled and turned by the object, as an axis-aligned box. */
function modelCollider(object: SceneObject, bounds: Bounds): Collider {
  const q = normalise(object.rotation);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const local: Vec3 = [
      (corner & 1 ? bounds.max[0] : bounds.min[0]) * object.scale[0],
      (corner & 2 ? bounds.max[1] : bounds.min[1]) * object.scale[1],
      (corner & 4 ? bounds.max[2] : bounds.min[2]) * object.scale[2],
    ];
    const world = rotate(q, local);
    for (let axis = 0; axis < 3; axis++) {
      const value = world[axis] + object.position[axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

interface BodyState {
  id: string;
  position: Vec3;
  rotation: Vec4;
  velocity: Vec3;
}

interface Stepper extends BodyState {
  advance(gravity: number, colliders: readonly Collider[]): void;
}

function shrink(value: number, amount: number): number {
  if (value > amount) return value - amount;
  if (value < -amount) return value + amount;
  return 0;
}

function pushPointOut(position: Vec3, velocity: Vec3, colliders: readonly Collider[]): void {
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
    for (const c of colliders) {
      if (position[0] <= c.min[0] || position[0] >= c.max[0] || position[1] <= c.min[1] || position[1] >= c.max[1] || position[2] <= c.min[2] || position[2] >= c.max[2]) continue;
      let axis = 0;
      let target = 0;
      let best = Infinity;
      for (let a = 0; a < 3; a++) {
        const toMin = position[a] - c.min[a];
        const toMax = c.max[a] - position[a];
        const depth = toMin < toMax ? toMin : toMax;
        if (depth < best) {
          best = depth;
          axis = a;
          target = toMin < toMax ? c.min[a] : c.max[a];
        }
      }
      position[axis] = target;
      velocity[axis] = 0;
    }
  }
}

function rampBody(object: SceneObject): Stepper {
  const q = normalise(object.rotation);
  const theta = object.params.angle_deg * DEG;
  const length = object.params.length_m;
  const friction = object.params.friction;
  const sinT = sin(theta);
  const cosT = cos(theta);
  const tilt = qmul(q, qz(-theta));
  const origin = object.position;
  const place = (local: Vec3): Vec3 => {
    const world = rotate(q, local);
    return [origin[0] + world[0], origin[1] + world[1], origin[2] + world[2]];
  };
  const top: Vec3 = [-(length * cosT) / 2, length * sinT, 0];
  const foot: Vec3 = [(length * cosT) / 2, 0, 0];
  let onIncline = true;
  let along = 0;
  let speed = 0;
  const body: Stepper = {
    id: object.id,
    position: place(top),
    rotation: tilt,
    velocity: [0, 0, 0],
    advance(gravity) {
      const accel = gravity * (sinT - friction * cosT);
      if (!(accel > 0)) return;
      if (onIncline) {
        speed += accel * STEP_SECONDS;
        along += speed * STEP_SECONDS;
        if (along >= length) {
          along = 0;
          onIncline = false;
        }
      } else {
        speed = shrink(speed, friction * gravity * STEP_SECONDS);
        along += speed * STEP_SECONDS;
      }
      if (onIncline) {
        body.position = place([top[0] + cosT * along, top[1] - sinT * along, 0]);
        body.velocity = rotate(q, [cosT * speed, -sinT * speed, 0]);
        body.rotation = tilt;
      } else {
        body.position = place([foot[0] + along, 0, 0]);
        body.velocity = rotate(q, [speed, 0, 0]);
        body.rotation = q;
      }
    },
  };
  return body;
}

function pendulumBody(object: SceneObject): Stepper {
  const q = normalise(object.rotation);
  const length = object.params.length_m;
  let phi = object.params.release_deg * DEG;
  let omega = 0;
  const pivot = object.position;
  const pose = (body: Stepper): void => {
    const s = sin(phi);
    const c = cos(phi);
    const arm = rotate(q, [length * s, -length * c, 0]);
    body.position = [pivot[0] + arm[0], pivot[1] + arm[1], pivot[2] + arm[2]];
    body.velocity = rotate(q, [length * omega * c, length * omega * s, 0]);
    body.rotation = qmul(q, qz(phi));
  };
  const body: Stepper = {
    id: object.id,
    position: [0, 0, 0],
    rotation: q,
    velocity: [0, 0, 0],
    advance(gravity) {
      omega += -(gravity / length) * sin(phi) * STEP_SECONDS;
      phi += omega * STEP_SECONDS;
      pose(body);
    },
  };
  pose(body);
  return body;
}

function launcherBody(object: SceneObject): Stepper {
  const q = normalise(object.rotation);
  const angle = object.params.launch_angle_deg * DEG;
  const speed = object.params.speed_mps;
  const start = rotate(q, [0, object.params.height_m, 0]);
  const launch = rotate(q, [speed * cos(angle), speed * sin(angle), 0]);
  return {
    id: object.id,
    position: [object.position[0] + start[0], object.position[1] + start[1], object.position[2] + start[2]],
    rotation: q,
    velocity: launch,
    advance(gravity, colliders) {
      const body = this;
      body.velocity[1] -= gravity * STEP_SECONDS;
      for (let axis = 0; axis < 3; axis++) body.position[axis] += body.velocity[axis] * STEP_SECONDS;
      if (body.position[1] < 0) {
        body.position[1] = 0;
        body.velocity = [0, 0, 0];
      }
      pushPointOut(body.position, body.velocity, colliders);
    },
  };
}

function crateBody(object: SceneObject): Stepper {
  const q = normalise(object.rotation);
  const half: Vec3 = [object.scale[0] / 2, object.scale[1], object.scale[2] / 2];
  return {
    id: object.id,
    position: [...object.position],
    rotation: q,
    velocity: [0, 0, 0],
    advance(gravity, colliders) {
      const body = this;
      body.velocity[1] -= gravity * STEP_SECONDS;
      for (let axis = 0; axis < 3; axis++) body.position[axis] += body.velocity[axis] * STEP_SECONDS;
      let resting = false;
      if (body.position[1] <= 0) {
        body.position[1] = 0;
        if (body.velocity[1] < 0) body.velocity[1] = 0;
        resting = true;
      }
      for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
        for (const c of colliders) {
          const lo: Vec3 = [body.position[0] - half[0], body.position[1], body.position[2] - half[2]];
          const hi: Vec3 = [body.position[0] + half[0], body.position[1] + half[1], body.position[2] + half[2]];
          if (lo[0] >= c.max[0] || hi[0] <= c.min[0] || lo[1] >= c.max[1] || hi[1] <= c.min[1] || lo[2] >= c.max[2] || hi[2] <= c.min[2]) continue;
          let axis = 0;
          let shift = 0;
          let best = Infinity;
          for (let a = 0; a < 3; a++) {
            const up = c.max[a] - lo[a];
            const down = hi[a] - c.min[a];
            const depth = up < down ? up : down;
            if (depth < best) {
              best = depth;
              axis = a;
              shift = up < down ? up : -down;
            }
          }
          body.position[axis] += shift;
          body.velocity[axis] = 0;
          if (axis === 1 && shift > 0) resting = true;
        }
      }
      if (resting) {
        const loss = CRATE_FRICTION * gravity * STEP_SECONDS;
        body.velocity[0] = shrink(body.velocity[0], loss);
        body.velocity[2] = shrink(body.velocity[2], loss);
      }
    },
  };
}

function modelBody(object: SceneObject): Stepper {
  return { id: object.id, position: [...object.position], rotation: normalise(object.rotation), velocity: [0, 0, 0], advance() {} };
}

type BoundsLookup = (assetId: string) => Bounds | null;

/** Applies parameter overrides (`<objectId>.<param>`) to a copy of the document. */
function withOverrides(doc: SceneDocument, overrides: Readonly<Record<string, number>>): SceneDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      const params = { ...o.params };
      for (const key of Object.keys(params)) {
        const override = overrides[`${o.id}.${key}`];
        if (override !== undefined) params[key] = override;
      }
      return { ...o, params };
    }),
  };
}

export class Simulation {
  step = 0;
  readonly colliders: Collider[] = [];
  private readonly bodies: Stepper[];
  private readonly gravity: number;

  constructor(doc: SceneDocument, overrides: Readonly<Record<string, number>>, boundsFor: BoundsLookup) {
    const effective = withOverrides(doc, overrides);
    this.gravity = effective.gravity;
    for (const object of effective.objects) {
      if (object.kind !== "model" || object.assetId === null) continue;
      const bounds = boundsFor(object.assetId);
      if (bounds) this.colliders.push(modelCollider(object, bounds));
    }
    this.bodies = [...effective.objects]
      .sort((a, b) => compareIds(a.id, b.id))
      .map((object) => {
        switch (object.kind) {
          case "ramp":
            return rampBody(object);
          case "pendulum":
            return pendulumBody(object);
          case "launcher":
            return launcherBody(object);
          case "crate":
            return crateBody(object);
          case "model":
            return modelBody(object);
        }
      });
  }

  advance(steps: number): void {
    for (let i = 0; i < steps; i++) {
      for (const body of this.bodies) body.advance(this.gravity, this.colliders);
      this.step++;
    }
  }

  pose(id: string): BodyState | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  hash(): string {
    return sha256Hex(
      canonicalJson({
        objects: this.bodies.map((b) => ({ id: b.id, position: b.position, rotation: b.rotation, velocity: b.velocity })),
        step: this.step,
      }),
    );
  }
}

/** The state hash at step 0 (the pre-run state); needs no model bytes. */
export function initialHash(doc: SceneDocument): string {
  return new Simulation(doc, {}, () => null).hash();
}
