// The authoritative fixed-tick round simulation. Live rounds, the frames API and /api/simulate all run this code.
import {
  BUMPER_HEIGHT,
  type Course,
  CHECKPOINT_SPACING,
  generateCourse,
  supportAt,
  SWEEPER_HALF_THICKNESS,
  SWEEPER_TOP,
  sweeperAngle,
} from "./course.js";
import {
  BUTTON,
  type BeanState,
  type Marker,
  round3,
  type RoundKind,
  slotsFor,
  TICKS_PER_SECOND,
  timeLimitTicks,
} from "./rules.js";

const DT = 1 / TICKS_PER_SECOND;
const GRAVITY = 30;
const RUN_SPEED = 8;
const JUMP_SPEED = 10;
const DIVE_SPEED = 12;
const DIVE_LIFT = 3;
const DIVE_TICKS = 12;
const FALL_Y = -5;
const FALLING_TICKS = 20;
const ALIVE_AGAIN_TICKS = 40;
const BEAN_RADIUS = 0.45;
const SPAWN_X = [3, 1, -1, -3] as const;
const SPAWN_ROW_Z = -2;
const SPAWN_ROW_GAP = 2;
const SPAWN_RING = 8;
const KNOCK_SPEED = 5;
const KNOCK_LIFT = 6;
const BUMP_LIFT = 5;
const BUMP_AIRTIME = 0.3;
const BUMP_LANE_KEEP = 0.35;
const BUMP_BACK_SPEED = 2;
const ARENA_FLING = 7;
const ARENA_SWEEP = 4;
const ARENA_LIFT = 6;
const SAFE_LANE = 1;

export interface InputEntry {
  tick: number;
  userId: number;
  buttons: number;
}

export interface ForfeitEntry {
  tick: number;
  userId: number;
}

export interface TickBean {
  userId: number;
  x: number;
  y: number;
  z: number;
  state: BeanState;
}

export interface RoundResult {
  userId: number;
  outcome: "qualified" | "eliminated";
  finishTick: number | null;
  eliminatedTick: number | null;
  position: number;
}

interface Bean {
  userId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  diveTicks: number;
  state: BeanState;
  fallTick: number;
  checkpointZ: number;
  qualifiedTick: number | null;
  eliminatedTick: number | null;
}

function inPlay(state: BeanState): boolean {
  return state === "alive" || state === "falling" || state === "respawning";
}

function spawn(kind: RoundKind, index: number, count: number): { x: number; z: number } {
  if (kind === "survival") {
    const angle = (2 * Math.PI * index) / count;
    return { x: SPAWN_RING * Math.cos(angle), z: SPAWN_RING * Math.sin(angle) };
  }
  return { x: SPAWN_X[index % 4] ?? 0, z: SPAWN_ROW_Z - SPAWN_ROW_GAP * Math.floor(index / 4) };
}

// One live or replayed round. Inputs are the effective inputs: the value set for a tick drives the step from that tick.
export class RoundSimulation {
  readonly kind: RoundKind;
  readonly seed: number;
  readonly course: Course;
  readonly slots: number;
  readonly limit: number;
  tick = 0;
  lastTick: number | null = null;
  private readonly beans: Bean[];
  private readonly held = new Map<number, number>();
  private readonly scheduled = new Map<number, Map<number, number>>();
  private readonly forfeits = new Map<number, number>();

  constructor(kind: RoundKind, seed: number, starters: readonly number[]) {
    this.kind = kind;
    this.seed = seed;
    this.course = generateCourse(kind, seed);
    this.slots = slotsFor(kind, starters.length);
    this.limit = timeLimitTicks(kind);
    const ordered = [...starters].sort((a, b) => a - b);
    this.beans = ordered.map((userId, index) => {
      const at = spawn(kind, index, ordered.length);
      return {
        userId, x: at.x, y: 0, z: at.z, vx: 0, vy: 0, vz: 0, grounded: true, diveTicks: 0,
        state: "alive", fallTick: 0, checkpointZ: 0, qualifiedTick: null, eliminatedTick: null,
      };
    });
    this.decide([]);
  }

  get decided(): boolean {
    return this.lastTick !== null;
  }

  // In play and not already leaving by a forfeit that the next step applies.
  isInPlay(userId: number): boolean {
    const bean = this.beans.find((candidate) => candidate.userId === userId);
    return bean !== undefined && inPlay(bean.state) && !this.forfeits.has(userId);
  }

  // Sets the input a player holds from `tick` on; a later call for the same tick replaces the earlier one.
  setInput(userId: number, tick: number, buttons: number): void {
    let forTick = this.scheduled.get(tick);
    if (forTick === undefined) {
      forTick = new Map();
      this.scheduled.set(tick, forTick);
    }
    forTick.set(userId, buttons);
  }

  setForfeit(userId: number, tick: number): void {
    this.forfeits.set(userId, tick);
  }

  step(): void {
    if (this.decided) return;
    const from = this.tick;
    const next = from + 1;
    const due = this.scheduled.get(from);
    if (due !== undefined) {
      for (const [userId, buttons] of due) this.held.set(userId, buttons);
      this.scheduled.delete(from);
    }
    const fallers: Bean[] = [];
    const finishers: Bean[] = [];
    for (const bean of this.beans) {
      if (!inPlay(bean.state)) continue;
      if (this.forfeits.get(bean.userId) === next) {
        bean.state = "eliminated";
        bean.eliminatedTick = next;
        continue;
      }
      if (bean.state === "falling") {
        if (next >= bean.fallTick + FALLING_TICKS) {
          bean.state = "respawning";
          Object.assign(bean, { x: 0, y: 0, z: bean.checkpointZ, vx: 0, vy: 0, vz: 0 });
        } else {
          this.integrate(bean);
        }
        continue;
      }
      if (bean.state === "respawning") {
        if (next >= bean.fallTick + ALIVE_AGAIN_TICKS) {
          Object.assign(bean, { state: "alive", grounded: true, diveTicks: 0 });
        }
        continue;
      }
      this.move(bean, this.held.get(bean.userId) ?? 0, from);
      if (bean.y < FALL_Y) {
        fallers.push(bean);
        if (this.kind === "survival") {
          bean.state = "eliminated";
          bean.eliminatedTick = next;
        } else {
          bean.state = "falling";
          bean.fallTick = next;
        }
        continue;
      }
      if (this.kind !== "survival") {
        while (bean.checkpointZ + CHECKPOINT_SPACING < this.course.finishZ && bean.z >= bean.checkpointZ + CHECKPOINT_SPACING) {
          bean.checkpointZ += CHECKPOINT_SPACING;
        }
        if (bean.z >= this.course.finishZ) finishers.push(bean);
      }
    }
    this.tick = next;
    let qualified = this.beans.filter((bean) => bean.state === "qualified").length;
    for (const bean of finishers) {
      if (qualified >= this.slots) break;
      bean.state = "qualified";
      bean.qualifiedTick = next;
      qualified += 1;
    }
    this.decide(fallers);
  }

  private integrate(bean: Bean): void {
    bean.vy -= GRAVITY * DT;
    bean.x += bean.vx * DT;
    bean.y += bean.vy * DT;
    bean.z += bean.vz * DT;
  }

  private move(bean: Bean, buttons: number, from: number): void {
    let dx = (buttons & BUTTON.left ? 1 : 0) - (buttons & BUTTON.right ? 1 : 0);
    let dz = (buttons & BUTTON.forward ? 1 : 0) - (buttons & BUTTON.back ? 1 : 0);
    const length = Math.hypot(dx, dz);
    if (length > 0) {
      dx /= length;
      dz /= length;
    }
    if (bean.diveTicks === 0) {
      if (buttons & BUTTON.dive) {
        if (length > 0) {
          bean.vx = dx * DIVE_SPEED;
          bean.vz = dz * DIVE_SPEED;
        } else {
          bean.vx = 0;
          bean.vz = DIVE_SPEED;
        }
        bean.vy += DIVE_LIFT;
        bean.diveTicks = DIVE_TICKS;
      } else if (bean.grounded) {
        bean.vx = dx * RUN_SPEED;
        bean.vz = dz * RUN_SPEED;
        if (buttons & BUTTON.jump) bean.vy = JUMP_SPEED;
      }
    }
    const previousY = bean.y;
    this.integrate(bean);
    if (bean.diveTicks > 0) bean.diveTicks -= 1;
    if (bean.y <= 0 && previousY >= 0 && supportAt(this.course, bean.x, bean.z, from + 1)) {
      bean.y = 0;
      bean.vy = 0;
      bean.grounded = true;
    } else {
      bean.grounded = false;
    }
    this.collide(bean, from + 1);
  }

  private knock(bean: Bean, kx: number, kz: number, speed: number, lift: number): void {
    // On the linear courses a knock from an outer lane always points back toward the middle, never over the side.
    const x = this.kind !== "survival" && Math.abs(bean.x) > SAFE_LANE && kx * bean.x > 0 ? -kx : kx;
    const length = Math.hypot(x, kz) || 1;
    bean.vx = (x / length) * speed;
    bean.vz = (kz / length) * speed;
    bean.vy = lift;
    bean.grounded = false;
    bean.diveTicks = 0;
  }

  private collide(bean: Bean, tick: number): void {
    if (bean.y < SWEEPER_TOP) {
      for (const sweeper of this.course.sweepers) {
        const rx = bean.x - sweeper.x;
        const rz = bean.z - sweeper.z;
        const base = sweeperAngle(sweeper, tick);
        for (let arm = 0; arm < sweeper.arms; arm++) {
          const angle = base + (2 * Math.PI * arm) / sweeper.arms;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const along = rx * cos + rz * sin;
          const across = -rx * sin + rz * cos;
          if (along < 0 || along > sweeper.radius + BEAN_RADIUS || Math.abs(across) > SWEEPER_HALF_THICKNESS + BEAN_RADIUS) continue;
          const turn = Math.sign(sweeper.radiansPerTick);
          const tx = -sin * turn;
          const tz = cos * turn;
          if (this.kind === "survival") {
            const r = Math.hypot(rx, rz);
            const ox = r > 0.01 ? rx / r : tx;
            const oz = r > 0.01 ? rz / r : tz;
            const fx = ox * ARENA_FLING + tx * ARENA_SWEEP;
            const fz = oz * ARENA_FLING + tz * ARENA_SWEEP;
            this.knock(bean, fx, fz, Math.hypot(fx, fz), ARENA_LIFT);
          } else {
            this.knock(bean, tx, tz, KNOCK_SPEED, KNOCK_LIFT);
          }
          return;
        }
      }
    }
    if (bean.y < BUMPER_HEIGHT) {
      for (const bumper of this.course.bumpers) {
        const rx = bean.x - bumper.x;
        const rz = bean.z - bumper.z;
        const distance = Math.hypot(rx, rz);
        if (distance >= bumper.radius + BEAN_RADIUS) continue;
        // Bumpers knock a runner back and in toward the middle lane, which bumpers never block.
        const vx = (bean.x * BUMP_LANE_KEEP - bean.x) / BUMP_AIRTIME;
        this.knock(bean, vx, -BUMP_BACK_SPEED, Math.hypot(vx, BUMP_BACK_SPEED), BUMP_LIFT);
        return;
      }
    }
  }

  private decide(fallers: Bean[]): void {
    const tick = this.tick;
    const qualified = this.beans.filter((bean) => bean.state === "qualified").length;
    const standing = this.beans.filter((bean) => bean.state !== "eliminated").length;
    const anyInPlay = this.beans.some((bean) => inPlay(bean.state));
    const decided =
      (this.kind === "race" && qualified >= this.slots) ||
      (this.kind === "survival" && standing <= this.slots) ||
      (this.kind === "final" && qualified > 0) ||
      !anyInPlay ||
      tick >= this.limit;
    if (!decided) return;
    this.lastTick = tick;
    if (this.kind === "survival") {
      let kept = standing;
      for (const bean of [...fallers].sort((a, b) => a.userId - b.userId)) {
        if (kept >= this.slots) break;
        bean.state = "alive";
        bean.eliminatedTick = null;
        kept += 1;
      }
      for (const bean of this.beans) {
        if (inPlay(bean.state)) {
          bean.state = "qualified";
          bean.qualifiedTick = tick;
        }
      }
      return;
    }
    for (const bean of this.beans) {
      if (inPlay(bean.state)) {
        bean.state = "eliminated";
        bean.eliminatedTick = tick;
      }
    }
  }

  tickBeans(): TickBean[] {
    return this.beans.map((bean) => ({
      userId: bean.userId, x: round3(bean.x), y: round3(bean.y), z: round3(bean.z), state: bean.state,
    }));
  }

  results(): RoundResult[] {
    const ranked = rankBeans(this.kind, this.beans.map((bean) => ({
      userId: bean.userId, z: round3(bean.z), state: bean.state,
      qualifiedTick: bean.qualifiedTick, eliminatedTick: bean.eliminatedTick,
    })));
    return ranked.map((bean, index) => ({
      userId: bean.userId,
      outcome: bean.state === "qualified" ? "qualified" : "eliminated",
      finishTick: bean.state === "qualified" ? bean.qualifiedTick : null,
      eliminatedTick: bean.state === "qualified" ? null : bean.eliminatedTick,
      position: index + 1,
    }));
  }
}

interface RankInput {
  userId: number;
  z: number;
  state: BeanState;
  qualifiedTick: number | null;
  eliminatedTick: number | null;
}

// Rank order at a tick: qualifiers by qualifying tick, then beans in play, then eliminated beans, newest out first.
export function rankBeans<T extends RankInput>(kind: RoundKind, beans: readonly T[]): T[] {
  const group = (bean: T): number => (bean.state === "qualified" ? 0 : inPlay(bean.state) ? 1 : 2);
  return [...beans].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return (a.qualifiedTick ?? 0) - (b.qualifiedTick ?? 0) || a.userId - b.userId;
    if (ga === 2) {
      const byTick = (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0);
      if (byTick !== 0) return byTick;
    }
    if (kind === "survival") return a.userId - b.userId;
    return b.z - a.z || a.userId - b.userId;
  });
}

export function slotsLeft(kind: RoundKind, slots: number, states: readonly BeanState[]): number {
  if (kind === "survival") return Math.max(states.filter((state) => state === "alive").length - slots, 0);
  return slots - states.filter((state) => state === "qualified").length;
}

interface FrameBean extends TickBean {
  rank: number;
  finishTick: number | null;
  marker: Marker | null;
}

export interface Frame {
  tick: number;
  lastTick: number;
  slots: number;
  slotsLeft: number;
  beans: FrameBean[];
}

// A whole resolved round, kept tick by tick so any frame can be read back.
export class ReplayedRound {
  readonly kind: RoundKind;
  readonly slots: number;
  readonly lastTick: number;
  readonly results: RoundResult[];
  readonly ticks: TickBean[][];
  private readonly outcome: Map<number, RoundResult>;

  constructor(kind: RoundKind, seed: number, starters: readonly number[], inputs: readonly InputEntry[], forfeits: readonly ForfeitEntry[]) {
    const simulation = new RoundSimulation(kind, seed, starters);
    for (const input of inputs) simulation.setInput(input.userId, input.tick, input.buttons);
    for (const forfeit of forfeits) simulation.setForfeit(forfeit.userId, forfeit.tick);
    const ticks = [simulation.tickBeans()];
    while (!simulation.decided) {
      simulation.step();
      ticks.push(simulation.tickBeans());
    }
    this.kind = kind;
    this.slots = simulation.slots;
    this.lastTick = simulation.tick;
    this.results = simulation.results();
    this.ticks = ticks;
    this.outcome = new Map(this.results.map((result) => [result.userId, result]));
  }

  frame(tick: number): Frame {
    const beans = this.ticks[tick] ?? [];
    const ranked = rankBeans(this.kind, beans.map((bean) => {
      const result = this.outcome.get(bean.userId);
      return {
        ...bean,
        qualifiedTick: result?.finishTick ?? null,
        eliminatedTick: result?.eliminatedTick ?? null,
      };
    }));
    const lastQualifier = tick === this.lastTick ? ranked.filter((bean) => bean.state === "qualified").length : 0;
    return {
      tick,
      lastTick: this.lastTick,
      slots: this.slots,
      slotsLeft: slotsLeft(this.kind, this.slots, beans.map((bean) => bean.state)),
      beans: ranked.map((bean, index) => {
        const rank = index + 1;
        const marker: Marker | null =
          lastQualifier === 0 ? null : rank === lastQualifier ? "last_slot" : rank === lastQualifier + 1 ? "first_out" : null;
        return {
          userId: bean.userId, x: bean.x, y: bean.y, z: bean.z, state: bean.state, rank,
          finishTick: bean.state === "qualified" ? bean.qualifiedTick : null, marker,
        };
      }),
    };
  }
}

