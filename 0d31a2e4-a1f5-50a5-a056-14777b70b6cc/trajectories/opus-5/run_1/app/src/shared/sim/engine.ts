import { TICK_RATE, slotsFor, timeLimitTicks } from '../rounds.js';
import type { BeanState, FrameBean, Marker, RoundKind, RoundResult, TickBean } from '../types.js';
import { hueForUserId } from '../hue.js';
import { type RankInput, rankOrder, slotsLeftFor } from './ranking.js';
import {
  type Course,
  type LinearCourse,
  barAngle,
  buildCourse,
  platformX,
  spawnPosition,
  sweeperAngle,
} from './course.js';

export const BUTTON_FORWARD = 1;
export const BUTTON_BACK = 2;
export const BUTTON_LEFT = 4;
export const BUTTON_RIGHT = 8;
export const BUTTON_JUMP = 16;
export const BUTTON_DIVE = 32;
export const BUTTONS_MAX = 63;

const DT = 1 / TICK_RATE;
const GRAVITY = 30;
const RUN_SPEED = 8;
const JUMP_SPEED = 10;
const DIVE_SPEED = 12;
const DIVE_LIFT = 3;
const DIVE_TICKS = 12;
const FALL_Y = -5;
const FALLING_TICKS = 20;
const RESPAWNING_TICKS = 20;
const BEAN_RADIUS = 0.4;
const HIT_COOLDOWN_TICKS = 6;
/** After a knock back a bean is briefly immune, so no obstacle can trap it. */
const BUMPER_COOLDOWN_TICKS = 20;
const ARENA_KNOCK = 12;
const SWEEPER_KNOCK = 7;
const BUMPER_KNOCK = 10;
const BUMPER_PUSHBACK = 5;
const KNOCK_LIFT = 4;
const SAFE_X = 4.3;

const IN_PLAY: ReadonlySet<BeanState> = new Set<BeanState>(['alive', 'falling', 'respawning']);

export function isInPlay(state: BeanState): boolean {
  return IN_PLAY.has(state);
}

/** Positions leave the simulation rounded to three decimals, halves away from zero. */
export function roundPosition(value: number): number {
  const scaled = Math.round(Math.abs(value) * 1000) / 1000;
  return value < 0 ? -scaled : scaled;
}

interface SimBean {
  userId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: BeanState;
  buttons: number;
  grounded: boolean;
  diveTicks: number;
  cooldown: number;
  fallTick: number;
  maxZ: number;
  qualifyTick: number | null;
  eliminatedTick: number | null;
  finishedThisTick: boolean;
  fellThisTick: boolean;
}

interface Snapshot {
  x: number;
  y: number;
  z: number;
  state: BeanState;
}

/**
 * The authoritative fixed-tick 3D round simulation. Live rounds, the frames endpoint
 * and the simulate endpoint all run this one engine.
 */
export class RoundEngine {
  readonly kind: RoundKind;
  readonly seed: number;
  readonly starters: number[];
  readonly slots: number;
  readonly timeLimit: number;
  readonly course: Course;

  private readonly beans: SimBean[];
  private readonly history: Snapshot[][] = [];
  private readonly forfeits = new Map<number, number>();
  private qualifiedCount = 0;
  private current = 0;
  private resolvedAt: number | null = null;

  constructor(kind: RoundKind, seed: number, starters: readonly number[]) {
    this.kind = kind;
    this.seed = seed;
    this.starters = [...starters].sort((a, b) => a - b);
    this.slots = slotsFor(kind, this.starters.length);
    this.timeLimit = timeLimitTicks(kind);
    this.course = buildCourse(kind, seed);
    this.beans = this.starters.map((userId, index) => {
      const spawn = spawnPosition(this.course, index, this.starters.length);
      return {
        userId,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: 0,
        vy: 0,
        vz: 0,
        state: 'alive',
        buttons: 0,
        grounded: true,
        diveTicks: 0,
        cooldown: 0,
        fallTick: 0,
        maxZ: spawn.z,
        qualifyTick: null,
        eliminatedTick: null,
        finishedThisTick: false,
        fellThisTick: false,
      };
    });
    this.evaluate(0);
    this.record(0);
  }

  get tick(): number {
    return this.current;
  }

  get resolved(): boolean {
    return this.resolvedAt !== null;
  }

  get lastTick(): number | null {
    return this.resolvedAt;
  }

  stateOf(userId: number): BeanState | null {
    return this.beans.find((bean) => bean.userId === userId)?.state ?? null;
  }

  /** The held input of a player, in effect from the current tick onwards. */
  setButtons(userId: number, buttons: number): void {
    const bean = this.beans.find((candidate) => candidate.userId === userId);
    if (bean) bean.buttons = buttons;
  }

  /** A forfeit eliminates the bean at the given tick, keeping its previous position. */
  forfeitAt(userId: number, tick: number): void {
    this.forfeits.set(userId, tick);
  }

  /** True once a forfeit is booked, even before the tick it takes effect on. */
  hasForfeited(userId: number): boolean {
    return this.forfeits.has(userId);
  }

  step(): void {
    if (this.resolvedAt !== null) return;
    const tick = this.current + 1;
    for (const bean of this.beans) this.advance(bean, tick);
    this.settleFinishers(tick);
    this.settleFallers(tick);
    this.current = tick;
    this.evaluate(tick);
    this.record(tick);
  }

  private advance(bean: SimBean, tick: number): void {
    bean.finishedThisTick = false;
    bean.fellThisTick = false;
    if (bean.state === 'qualified' || bean.state === 'eliminated') return;
    if (this.forfeits.get(bean.userId) === tick) {
      bean.state = 'eliminated';
      bean.eliminatedTick = tick;
      return;
    }
    const wasAlive = bean.state === 'alive';
    if (bean.cooldown > 0) bean.cooldown -= 1;

    if (bean.state === 'falling' && tick - bean.fallTick >= FALLING_TICKS) {
      bean.state = 'respawning';
      bean.x = 0;
      bean.y = 0;
      bean.z = this.lastCheckpoint(bean.maxZ);
      bean.vx = 0;
      bean.vy = 0;
      bean.vz = 0;
      bean.diveTicks = 0;
      bean.grounded = true;
      return;
    }
    if (bean.state === 'respawning') {
      if (tick - bean.fallTick >= FALLING_TICKS + RESPAWNING_TICKS) bean.state = 'alive';
      return;
    }
    if (bean.state === 'falling') {
      bean.vy -= GRAVITY * DT;
      bean.x += bean.vx * DT;
      bean.y += bean.vy * DT;
      bean.z += bean.vz * DT;
      return;
    }

    this.driveAlive(bean);
    bean.vy -= GRAVITY * DT;
    bean.x += bean.vx * DT;
    bean.y += bean.vy * DT;
    bean.z += bean.vz * DT;
    this.resolveGround(bean, tick);
    this.hitObstacles(bean, tick);
    bean.maxZ = Math.max(bean.maxZ, bean.z);

    if (wasAlive && bean.y < FALL_Y) {
      bean.fellThisTick = true;
      if (this.course.shape === 'linear') {
        bean.state = 'falling';
        bean.fallTick = tick;
      }
      return;
    }
    if (this.course.shape === 'linear' && bean.z >= this.course.length) {
      bean.finishedThisTick = true;
    }
  }

  private driveAlive(bean: SimBean): void {
    const buttons = bean.buttons;
    let dirX = (buttons & BUTTON_LEFT ? 1 : 0) - (buttons & BUTTON_RIGHT ? 1 : 0);
    let dirZ = (buttons & BUTTON_FORWARD ? 1 : 0) - (buttons & BUTTON_BACK ? 1 : 0);
    const magnitude = Math.hypot(dirX, dirZ);
    if (magnitude > 0) {
      dirX /= magnitude;
      dirZ /= magnitude;
    }
    if (bean.diveTicks > 0) {
      bean.diveTicks -= 1;
      return;
    }
    if (buttons & BUTTON_DIVE) {
      const diveX = magnitude > 0 ? dirX : 0;
      const diveZ = magnitude > 0 ? dirZ : 1;
      bean.vx = DIVE_SPEED * diveX;
      bean.vz = DIVE_SPEED * diveZ;
      bean.vy += DIVE_LIFT;
      bean.diveTicks = DIVE_TICKS;
      bean.grounded = false;
      return;
    }
    if (bean.grounded) {
      bean.vx = RUN_SPEED * dirX;
      bean.vz = RUN_SPEED * dirZ;
      if (buttons & BUTTON_JUMP) {
        bean.vy = JUMP_SPEED;
        bean.grounded = false;
      }
    }
  }

  private hitObstacles(bean: SimBean, tick: number): void {
    if (bean.cooldown > 0) return;
    if (this.course.shape === 'arena') {
      for (const bar of this.course.bars) {
        const angle = barAngle(bar, tick);
        const ux = Math.cos(angle);
        const uz = Math.sin(angle);
        const along = bean.x * ux + bean.z * uz;
        const across = -bean.x * uz + bean.z * ux;
        if (
          bean.y < bar.height &&
          Math.abs(across) < 0.6 + BEAN_RADIUS &&
          along > bar.inner - BEAN_RADIUS &&
          along < bar.outer + BEAN_RADIUS
        ) {
          const radius = Math.hypot(bean.x, bean.z);
          const outX = radius > 0.001 ? bean.x / radius : ux;
          const outZ = radius > 0.001 ? bean.z / radius : uz;
          this.knock(bean, ARENA_KNOCK * outX, ARENA_KNOCK * outZ);
          return;
        }
      }
      return;
    }
    for (const sweeper of this.course.sweepers) {
      const angle = sweeperAngle(sweeper, tick);
      const ux = Math.cos(angle);
      const uz = Math.sin(angle);
      const dx = bean.x - sweeper.x;
      const dz = bean.z - sweeper.z;
      const along = dx * ux + dz * uz;
      const across = -dx * uz + dz * ux;
      if (
        bean.y < sweeper.height &&
        Math.abs(across) < 0.55 + BEAN_RADIUS &&
        Math.abs(along) < sweeper.arm + BEAN_RADIUS
      ) {
        const side = this.safeSide(bean.x, dx >= 0 ? 1 : -1, 2.2);
        this.knock(bean, SWEEPER_KNOCK * side, bean.vz);
        return;
      }
    }
    for (const bumper of this.course.bumpers) {
      const dx = bean.x - bumper.x;
      const dz = bean.z - bumper.z;
      if (bean.y < bumper.height && Math.hypot(dx, dz) < bumper.radius + BEAN_RADIUS) {
        const side = this.safeSide(bean.x, dx >= 0 ? 1 : -1, 2.7);
        this.knock(bean, BUMPER_KNOCK * side, -BUMPER_PUSHBACK, BUMPER_COOLDOWN_TICKS);
        return;
      }
    }
  }

  /** A knock lifts the bean clear of the floor so steering cannot cancel it. */
  private knock(bean: SimBean, vx: number, vz: number, cooldown = HIT_COOLDOWN_TICKS): void {
    bean.vx = vx;
    bean.vz = vz;
    bean.vy = Math.max(bean.vy, 0) + KNOCK_LIFT;
    bean.y += 0.05;
    bean.grounded = false;
    bean.cooldown = cooldown;
  }

  /** Knocks never throw a bean off the side of a linear course. */
  private safeSide(x: number, preferred: number, reach: number): number {
    return Math.abs(x + reach * preferred) > SAFE_X ? -preferred : preferred;
  }

  private resolveGround(bean: SimBean, tick: number): void {
    if (this.course.shape === 'arena') {
      const onFloor = Math.hypot(bean.x, bean.z) <= this.course.radius;
      if (onFloor && bean.y <= 0) {
        bean.y = 0;
        bean.vy = 0;
        bean.grounded = true;
      } else {
        bean.grounded = false;
      }
      return;
    }
    const course: LinearCourse = this.course;
    let support: number | null = null;
    if (bean.z >= course.startZ && bean.z <= course.endZ && Math.abs(bean.x) <= course.halfWidth) {
      support = 0;
    }
    let carry = 0;
    for (const platform of course.platforms) {
      const nowX = platformX(platform, tick);
      const inside =
        Math.abs(bean.x - nowX) <= platform.halfX + BEAN_RADIUS &&
        Math.abs(bean.z - platform.z) <= platform.halfZ + BEAN_RADIUS;
      if (inside && bean.y >= platform.top - 1.25 && (support === null || platform.top > support)) {
        support = platform.top;
        carry = nowX - platformX(platform, tick - 1);
      }
    }
    if (support !== null && bean.y <= support) {
      bean.y = support;
      bean.vy = 0;
      bean.grounded = true;
      bean.x += carry;
    } else {
      bean.grounded = false;
    }
  }

  private lastCheckpoint(maxZ: number): number {
    if (this.course.shape !== 'linear') return 0;
    let checkpoint = 0;
    for (const candidate of this.course.checkpoints) {
      if (candidate <= maxZ) checkpoint = candidate;
    }
    return checkpoint;
  }

  /** Same-tick finishers qualify in ascending player id order while slots remain. */
  private settleFinishers(tick: number): void {
    const finishers = this.beans
      .filter((bean) => bean.finishedThisTick)
      .sort((a, b) => a.userId - b.userId);
    for (const bean of finishers) {
      if (this.qualifiedCount >= this.slots) break;
      bean.state = 'qualified';
      bean.qualifyTick = tick;
      this.qualifiedCount += 1;
    }
  }

  /** In survival the lowest-id fallers are kept as survivors when the slots would be overshot. */
  private settleFallers(tick: number): void {
    if (this.course.shape !== 'arena') return;
    const fallers = this.beans
      .filter((bean) => bean.fellThisTick)
      .sort((a, b) => a.userId - b.userId);
    if (fallers.length === 0) return;
    const remaining = this.beans.filter((bean) => bean.eliminatedTick === null).length;
    const keep = Math.max(0, this.slots - (remaining - fallers.length));
    for (const bean of fallers.slice(keep)) {
      bean.state = 'eliminated';
      bean.eliminatedTick = tick;
    }
  }

  private evaluate(tick: number): void {
    const remaining = this.beans.filter((bean) => bean.eliminatedTick === null).length;
    const inPlay = this.beans.filter((bean) => isInPlay(bean.state)).length;
    let decided = inPlay === 0;
    if (this.kind === 'race') decided = decided || this.qualifiedCount >= this.slots;
    if (this.kind === 'final') decided = decided || this.qualifiedCount >= 1;
    if (this.kind === 'survival') decided = decided || remaining <= this.slots;
    if (decided || tick >= this.timeLimit) this.resolve(tick);
  }

  private resolve(tick: number): void {
    for (const bean of this.beans) {
      if (this.kind === 'survival') {
        if (bean.eliminatedTick === null && bean.qualifyTick === null) {
          bean.state = 'qualified';
          bean.qualifyTick = tick;
          this.qualifiedCount += 1;
        }
      } else if (isInPlay(bean.state) && bean.qualifyTick === null) {
        bean.state = 'eliminated';
        bean.eliminatedTick = tick;
      }
    }
    this.resolvedAt = tick;
  }

  private record(tick: number): void {
    this.history[tick] = this.beans.map((bean) => ({
      x: bean.x,
      y: bean.y,
      z: bean.z,
      state: bean.state,
    }));
  }

  private snapshot(tick: number, index: number): Snapshot {
    const frame = this.history[Math.max(0, Math.min(tick, this.current))];
    const snapshot = frame?.[index];
    if (snapshot === undefined) throw new Error(`no recorded snapshot for tick ${tick}`);
    return snapshot;
  }

  /** The single rank order: qualified, then beans in play, then eliminated. */
  rankedIndices(tick: number): number[] {
    const inputs: RankInput[] = this.beans.map((bean, index) => {
      const qualifyTick = bean.qualifyTick;
      const eliminatedTick = bean.eliminatedTick;
      const settledQualify = qualifyTick !== null && qualifyTick <= tick ? qualifyTick : null;
      const settledEliminated =
        eliminatedTick !== null && eliminatedTick <= tick ? eliminatedTick : null;
      return {
        userId: bean.userId,
        z: this.snapshot(tick, index).z,
        state: this.snapshot(tick, index).state,
        qualifyTick: settledQualify,
        eliminatedTick: settledEliminated,
        zAtEliminated:
          settledEliminated === null ? 0 : this.snapshot(settledEliminated, index).z,
      };
    });
    const order = rankOrder(this.kind, inputs);
    return order.map((userId) => this.beans.findIndex((bean) => bean.userId === userId));
  }

  slotsLeftAt(tick: number): number {
    const states = this.beans.map((_, index) => this.snapshot(tick, index).state);
    return slotsLeftFor(this.kind, this.slots, states);
  }

  frameBeans(tick: number, handles: ReadonlyMap<number, string>): FrameBean[] {
    const order = this.rankedIndices(tick);
    const lastTick = this.resolvedAt;
    const qualifierCount = order.filter((index) => {
      const qualifyTick = this.beans[index].qualifyTick;
      return qualifyTick !== null && qualifyTick <= tick;
    }).length;
    return order.map((index, position) => {
      const bean = this.beans[index];
      const snapshot = this.snapshot(tick, index);
      let marker: Marker | null = null;
      if (lastTick !== null && tick === lastTick && qualifierCount > 0) {
        if (position === qualifierCount - 1) marker = 'last_slot';
        else if (position === qualifierCount) marker = 'first_out';
      }
      const qualifyTick = bean.qualifyTick;
      return {
        userId: bean.userId,
        handle: handles.get(bean.userId) ?? null,
        hue: hueForUserId(bean.userId),
        x: roundPosition(snapshot.x),
        y: roundPosition(snapshot.y),
        z: roundPosition(snapshot.z),
        state: snapshot.state,
        rank: position + 1,
        finishTick: qualifyTick !== null && qualifyTick <= tick ? qualifyTick : null,
        marker,
      };
    });
  }

  tickBeans(tick: number): TickBean[] {
    return this.beans.map((bean, index) => {
      const snapshot = this.snapshot(tick, index);
      return {
        userId: bean.userId,
        x: roundPosition(snapshot.x),
        y: roundPosition(snapshot.y),
        z: roundPosition(snapshot.z),
        state: snapshot.state,
      };
    });
  }

  results(): RoundResult[] {
    const lastTick = this.resolvedAt;
    if (lastTick === null) return [];
    const order = this.rankedIndices(lastTick);
    return order.map((index, position) => {
      const bean = this.beans[index];
      return {
        userId: bean.userId,
        outcome: bean.qualifyTick !== null ? 'qualified' : 'eliminated',
        finishTick: bean.qualifyTick,
        eliminatedTick: bean.eliminatedTick,
        position: position + 1,
      };
    });
  }

  qualifiers(): number[] {
    return this.results()
      .filter((result) => result.outcome === 'qualified')
      .map((result) => result.userId);
  }
}
