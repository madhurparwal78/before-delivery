import type { SceneDocument, SceneObject, Vec3, Quat } from './scene';
import { canonicalJson } from './canonical';

export const STEP_SECONDS = 1 / 120;
export const SOLVER_ITERATIONS = 4;
export const GRAVITY = 9.81;

export type Body = {
  id: string;
  kind: SceneObject['kind'];
  position: Vec3;
  velocity: Vec3;
  rotation: Quat;
  angle: number;
  angularVelocity: number;
  mass: number;
  rampLength: number;
  rampAngle: number;
  friction: number;
  isStatic: boolean;
  startX: number;
  footX: number;
  launchVx: number;
  launchVy: number;
};

export type StepState = {
  objects: Array<{ id: string; position: Vec3; rotation: Quat; velocity: Vec3 }>;
  step: number;
};

export function stateHashInput(state: StepState): string {
  const sorted = [...state.objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonicalJson({ objects: sorted, step: state.step });
}

export function makeBody(object: SceneObject, paramsOverride: Record<string, number> = {}): Body {
  const p = (name: string): number => {
    const override = paramsOverride[`${object.id}.${name}`];
    if (typeof override === 'number') return override;
    return object.params[name] ?? 0;
  };
  const rampAngleRad = (p('angle_deg') * Math.PI) / 180;
  const body: Body = {
    id: object.id,
    kind: object.kind,
    position: [...object.position] as Vec3,
    velocity: [0, 0, 0],
    rotation: normaliseQuat(object.rotation),
    angle: 0,
    angularVelocity: 0,
    mass: p('mass_kg'),
    rampLength: p('length_m'),
    rampAngle: rampAngleRad,
    friction: p('friction'),
    isStatic: object.kind === 'model',
    startX: object.position[0] - p('length_m') * Math.cos(rampAngleRad),
    footX: object.position[0],
    launchVx: 0,
    launchVy: 0,
  };
  if (object.kind === 'ramp') {
    // The cart starts at rest at the top of the ramp; the ramp's foot sits at the object origin.
    body.position = [
      object.position[0] - body.rampLength * Math.cos(rampAngleRad),
      object.position[1] + body.rampLength * Math.sin(rampAngleRad),
      object.position[2],
    ];
  } else if (object.kind === 'pendulum') {
    body.angle = (p('release_deg') * Math.PI) / 180;
  } else if (object.kind === 'launcher') {
    const speed = p('speed_mps');
    const angle = (p('launch_angle_deg') * Math.PI) / 180;
    body.launchVx = speed * Math.cos(angle);
    body.launchVy = speed * Math.sin(angle);
    body.position = [object.position[0], object.position[1] + p('height_m'), object.position[2]];
    body.velocity = [body.launchVx, body.launchVy, 0];
  }
  return body;
}

export function normaliseQuat(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len === 0) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function stepState(bodies: Body[], step: number): StepState {
  return {
    objects: bodies.map((b) => ({
      id: b.id,
      position: [round6(b.position[0]), round6(b.position[1]), round6(b.position[2])] as Vec3,
      rotation: b.kind === 'pendulum' ? quatFromZAngle(b.angle) : b.rotation,
      velocity: [round6(b.velocity[0]), round6(b.velocity[1]), round6(b.velocity[2])] as Vec3,
    })),
    step,
  };
}

export function quatFromZAngle(angle: number): Quat {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function runSteps(bodies: Body[], n: number): void {
  for (let i = 0; i < n; i++) {
    for (const b of bodies) stepBody(b);
  }
}

export function stepBody(b: Body): void {
  switch (b.kind) {
    case 'ramp': {
      const a = GRAVITY * (Math.sin(b.rampAngle) - b.friction * Math.cos(b.rampAngle));
      if (a <= 0) {
        b.velocity[0] = 0;
        b.velocity[1] = 0;
        return;
      }
      b.velocity[0] += a * Math.cos(b.rampAngle) * STEP_SECONDS;
      b.velocity[1] += -a * Math.sin(b.rampAngle) * STEP_SECONDS;
      b.position[0] += b.velocity[0] * STEP_SECONDS;
      b.position[1] += b.velocity[1] * STEP_SECONDS;
      if (b.position[1] <= 0) {
        b.position[1] = 0;
        if (b.velocity[1] < 0) b.velocity[1] = 0;
      }
      if (b.position[0] >= b.footX) {
        b.position[0] = b.footX;
        b.velocity[0] = 0;
        b.velocity[1] = 0;
      }
      return;
    }
    case 'pendulum': {
      const alpha = -(GRAVITY / b.rampLength) * Math.sin(b.angle);
      b.angularVelocity += alpha * STEP_SECONDS;
      b.angle += b.angularVelocity * STEP_SECONDS;
      return;
    }
    case 'launcher': {
      b.velocity[1] -= GRAVITY * STEP_SECONDS;
      b.position[0] += b.velocity[0] * STEP_SECONDS;
      b.position[1] += b.velocity[1] * STEP_SECONDS;
      if (b.position[1] <= 0) {
        b.position[1] = 0;
        b.velocity = [0, 0, 0];
      }
      return;
    }
    case 'crate': {
      b.velocity[1] -= GRAVITY * STEP_SECONDS;
      b.position[0] += b.velocity[0] * STEP_SECONDS;
      b.position[1] += b.velocity[1] * STEP_SECONDS;
      if (b.position[1] <= 0) {
        b.position[1] = 0;
        b.velocity[1] = 0;
      }
      return;
    }
    case 'model':
      return;
  }
}

export function simulate(doc: SceneDocument, steps: number, paramsOverride: Record<string, number> = {}): StepState {
  const bodies = doc.objects.map((o) => makeBody(o, paramsOverride));
  runSteps(bodies, steps);
  return stepState(bodies, steps);
}

export function stepZeroState(doc: SceneDocument, paramsOverride: Record<string, number> = {}): StepState {
  const bodies = doc.objects.map((o) => makeBody(o, paramsOverride));
  return stepState(bodies, 0);
}
