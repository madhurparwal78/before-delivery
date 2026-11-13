import { canonicalJson, type Json } from './canonical.js';
import { dcos, dsin, radians } from './dmath.js';
import { sha256HexOfText } from './sha256.js';
import type { Quat, SceneDocument, SceneObject, Vec3 } from './scene.js';

export const STEP_SECONDS = 1 / 120;
export const SOLVER_ITERATIONS = 4;
export const MAX_STEPS_PER_FRAME = 8;
export const MAX_VERIFY_STEPS = 12000;

export interface Body {
  readonly id: string;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly velocity: Vec3;
}

interface BodyState {
  id: string;
  kind: SceneObject['kind'];
  rotation: Quat;
  origin: Vec3;
  /** ramp */
  slopeAngle: number;
  slopeLength: number;
  friction: number;
  travelled: number;
  slopeSpeed: number;
  /** pendulum */
  angle: number;
  angularSpeed: number;
  armLength: number;
  /** free bodies */
  position: Vec3;
  velocity: Vec3;
}

export type ParamOverrides = Readonly<Record<string, number>>;

function effectiveParams(object: SceneObject, overrides: ParamOverrides): Record<string, number> {
  const params: Record<string, number> = { ...object.params };
  for (const key of Object.keys(params)) {
    const override = overrides[`${object.id}.${key}`];
    if (override !== undefined) params[key] = override;
  }
  return params;
}

function initialState(object: SceneObject, overrides: ParamOverrides): BodyState {
  const params = effectiveParams(object, overrides);
  const state: BodyState = {
    id: object.id,
    kind: object.kind,
    rotation: [...object.rotation] as Quat,
    origin: [...object.position] as Vec3,
    slopeAngle: 0,
    slopeLength: 0,
    friction: 0,
    travelled: 0,
    slopeSpeed: 0,
    angle: 0,
    angularSpeed: 0,
    armLength: 0,
    position: [...object.position] as Vec3,
    velocity: [0, 0, 0],
  };

  if (object.kind === 'ramp') {
    state.slopeAngle = radians(params.angle_deg);
    state.slopeLength = params.length_m;
    state.friction = params.friction;
  } else if (object.kind === 'pendulum') {
    state.armLength = params.length_m;
    state.angle = radians(params.release_deg);
  } else if (object.kind === 'launcher') {
    const angle = radians(params.launch_angle_deg);
    state.position = [object.position[0], object.position[1] + params.height_m, object.position[2]];
    state.velocity = [params.speed_mps * dcos(angle), params.speed_mps * dsin(angle), 0];
  }
  return state;
}

/** One solver iteration: a quarter of a fixed step. */
function solve(state: BodyState, gravity: number, dt: number): void {
  if (state.kind === 'ramp') {
    const sin = dsin(state.slopeAngle);
    const cos = dcos(state.slopeAngle);
    if (state.travelled < state.slopeLength) {
      const acceleration = gravity * (sin - state.friction * cos);
      if (acceleration > 0 || state.slopeSpeed > 0) {
        state.slopeSpeed += (acceleration > 0 ? acceleration : 0) * dt;
        state.travelled += state.slopeSpeed * dt;
      }
    } else {
      const deceleration = gravity * state.friction;
      state.slopeSpeed -= deceleration * dt;
      if (state.slopeSpeed < 0) state.slopeSpeed = 0;
      state.travelled += state.slopeSpeed * dt;
    }
    return;
  }
  if (state.kind === 'pendulum') {
    state.angularSpeed += (-(gravity / state.armLength) * dsin(state.angle)) * dt;
    state.angle += state.angularSpeed * dt;
    return;
  }
  if (state.kind === 'launcher' || state.kind === 'crate') {
    const ground = state.origin[1];
    state.velocity[1] -= gravity * dt;
    state.position[0] += state.velocity[0] * dt;
    state.position[1] += state.velocity[1] * dt;
    state.position[2] += state.velocity[2] * dt;
    if (state.position[1] <= ground) {
      state.position[1] = ground;
      state.velocity = [0, 0, 0];
    }
  }
}

function bodyOf(state: BodyState): Body {
  if (state.kind === 'ramp') {
    const sin = dsin(state.slopeAngle);
    const cos = dcos(state.slopeAngle);
    const top: Vec3 = [
      state.origin[0] + state.slopeLength * cos,
      state.origin[1] + state.slopeLength * sin,
      state.origin[2],
    ];
    if (state.travelled < state.slopeLength) {
      return {
        id: state.id,
        position: [
          top[0] - state.travelled * cos,
          top[1] - state.travelled * sin,
          top[2],
        ],
        rotation: state.rotation,
        velocity: [-state.slopeSpeed * cos, -state.slopeSpeed * sin, 0],
      };
    }
    const beyond = state.travelled - state.slopeLength;
    return {
      id: state.id,
      position: [state.origin[0] - beyond, state.origin[1], state.origin[2]],
      rotation: state.rotation,
      velocity: [-state.slopeSpeed, 0, 0],
    };
  }
  if (state.kind === 'pendulum') {
    const sin = dsin(state.angle);
    const cos = dcos(state.angle);
    return {
      id: state.id,
      position: [
        state.origin[0] + state.armLength * sin,
        state.origin[1] - state.armLength * cos,
        state.origin[2],
      ],
      rotation: state.rotation,
      velocity: [
        state.armLength * state.angularSpeed * cos,
        state.armLength * state.angularSpeed * sin,
        0,
      ],
    };
  }
  return {
    id: state.id,
    position: [...state.position] as Vec3,
    rotation: state.rotation,
    velocity: [...state.velocity] as Vec3,
  };
}

export class Simulation {
  private readonly states: BodyState[];

  private currentStep = 0;

  constructor(document: SceneDocument, overrides: ParamOverrides = {}) {
    this.gravity = document.gravity;
    this.states = [...document.objects]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((object) => initialState(object, overrides));
  }

  private readonly gravity: number;

  get step(): number {
    return this.currentStep;
  }

  advanceOne(): void {
    const dt = STEP_SECONDS / SOLVER_ITERATIONS;
    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
      for (const state of this.states) solve(state, this.gravity, dt);
    }
    this.currentStep += 1;
  }

  advance(steps: number): void {
    for (let i = 0; i < steps; i += 1) this.advanceOne();
  }

  bodies(): Body[] {
    return this.states.map(bodyOf);
  }

  stateHash(): string {
    return stateHash(this.bodies(), this.currentStep);
  }
}

export function stateHash(bodies: readonly Body[], step: number): string {
  const payload: Json = {
    objects: [...bodies]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((body) => ({
        id: body.id,
        position: [...body.position],
        rotation: [...body.rotation],
        velocity: [...body.velocity],
      })) as Json,
    step,
  };
  return sha256HexOfText(canonicalJson(payload));
}

export function simulateHash(
  document: SceneDocument,
  steps: number,
  overrides: ParamOverrides = {},
): { step: number; stateHash: string } {
  const simulation = new Simulation(document, overrides);
  simulation.advance(steps);
  return { step: simulation.step, stateHash: simulation.stateHash() };
}

export function stepZeroHash(document: SceneDocument): string {
  return simulateHash(document, 0).stateHash;
}
