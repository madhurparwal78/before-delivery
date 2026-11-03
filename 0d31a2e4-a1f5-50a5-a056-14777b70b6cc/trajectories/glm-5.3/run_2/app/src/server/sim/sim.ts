import { checkpointZ, generateCourse, obstacleState, spawnPositions, type Course } from "./course.js";
import { round3, slotsFor, type BeanState, type RoundKind } from "../../shared/domain.js";

export type InputEntry = { tick: number; userId: number; buttons: number };
export type ForfeitEntry = { tick: number; userId: number };

export type SimResultEntry = {
  userId: number;
  outcome: "qualified" | "eliminated";
  finishTick: number | null;
  eliminatedTick: number | null;
  position: number;
};

export type SimBean = {
  userId: number;
  x: number;
  y: number;
  z: number;
  state: BeanState;
  rank: number;
  finishTick: number | null;
};

export type SimFrame = { tick: number; slotsLeft: number; beans: SimBean[] };

export type SimOutcome = {
  kind: RoundKind;
  seed: number;
  slots: number;
  /** Null until the round is decided within the simulated range. */
  lastTick: number | null;
  results: SimResultEntry[];
  frames: Map<number, SimFrame>;
};

type Bean = {
  userId: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  hvelX: number;
  hvelZ: number;
  state: BeanState;
  fallStart: number | null;
  checkpoint: number;
  diveTicksLeft: number;
  finishTick: number | null;
  eliminatedTick: number | null;
  frozen: { x: number; y: number; z: number } | null;
};

const TICKS_PER_SECOND = 20;
const DT = 1 / TICKS_PER_SECOND;
const GRAVITY = 30;
const RUN_SPEED = 8;
const DIVE_SPEED = 12;
const JUMP_VELOCITY = 10;
const DIVE_TICKS = 12;
const FALL_TICKS = 20;
const RESPAWN_TICKS = 20;
const BEAN_RADIUS = 0.45;
const FALL_Y = -5;

export function timeLimitTicks(kind: RoundKind): number {
  return kind === "survival" ? 45 * TICKS_PER_SECOND : 60 * TICKS_PER_SECOND;
}

export function simulateRound(params: {
  kind: RoundKind;
  seed: number;
  starters: number[];
  inputs: InputEntry[];
  forfeits?: ForfeitEntry[];
  recordFrames?: boolean;
  course?: Course;
  /** Simulates ticks 0 to this tick inclusive, instead of running to the round's decision. */
  upToTick?: number;
}): SimOutcome {
  const { kind, seed, starters } = params;
  const course = params.course ?? generateCourse(kind, seed);
  const slots = slotsFor(kind, starters.length);
  const limit = timeLimitTicks(kind);

  const inputAt = new Map<string, number>();
  for (const entry of params.inputs) inputAt.set(`${entry.tick}:${entry.userId}`, entry.buttons);
  const forfeitAt = new Map<number, number>();
  for (const entry of params.forfeits ?? []) {
    if (!forfeitAt.has(entry.userId)) forfeitAt.set(entry.userId, entry.tick);
  }

  const spawns = spawnPositions(kind, starters);
  const beans: Bean[] = starters.map((userId) => ({
    userId,
    x: spawns.get(userId)?.x ?? 0,
    y: 0,
    z: spawns.get(userId)?.z ?? 0,
    vy: 0,
    hvelX: 0,
    hvelZ: 0,
    state: "alive",
    fallStart: null,
    checkpoint: 0,
    diveTicksLeft: 0,
    finishTick: null,
    eliminatedTick: null,
    frozen: null
  }));
  const held = new Map<number, number>(starters.map((id) => [id, 0]));

  const frames = new Map<number, SimFrame>();
  const record = params.recordFrames ?? false;
  const saveFrame = (tick: number) => {
    if (!record) return;
    const ranked = rankBeans(beans, kind);
    frames.set(tick, {
      tick,
      slotsLeft: slotsLeftAt(kind, slots, beans),
      beans: beans.map((bean) => {
        const pos = frozenPos(bean);
        return {
          userId: bean.userId,
          x: round3(pos.x),
          y: round3(pos.y),
          z: round3(pos.z),
          state: bean.state,
          rank: ranked.get(bean.userId) ?? beans.length,
          finishTick: bean.state === "qualified" ? bean.finishTick : null
        };
      })
    });
  };

  const inPlay = (bean: Bean) => bean.state === "alive" || bean.state === "falling" || bean.state === "respawning";
  const qualifiedCount = () => beans.filter((b) => b.state === "qualified").length;

  saveFrame(0);
  let lastTick: number | null = null;
  const stopAt = Math.min(limit, params.upToTick ?? limit);

  for (let tick = 0; tick < stopAt; tick++) {
    step(tick);
    const nextTick = tick + 1;
    saveFrame(nextTick);
    if (decided()) {
      lastTick = nextTick;
      break;
    }
  }
  // A round that reaches its time limit is decided on the final tick.
  if (lastTick === null && stopAt >= limit) {
    lastTick = limit;
  }

  if (lastTick === null) {
    return { kind, seed, slots, lastTick: null, results: [], frames };
  }

  settleLastTick();
  // The deciding frame shows the settled states, so it is recorded again.
  if (lastTick !== null) saveFrame(lastTick);

  const ranked = rankBeans(beans, kind);
  const results: SimResultEntry[] = beans.map((bean) => ({
    userId: bean.userId,
    outcome: bean.state === "qualified" ? "qualified" : "eliminated",
    finishTick: bean.finishTick,
    eliminatedTick: bean.eliminatedTick,
    position: ranked.get(bean.userId) ?? beans.length
  }));

  return { kind, seed, slots, lastTick, results, frames };

  function step(fromTick: number) {
    const nextTick = fromTick + 1;
    const obstacles = obstacleState(course, nextTick);
    const prevXs = obstacleState(course, fromTick).platformXs;
    const finishers: Bean[] = [];

    for (const bean of beans) {
      if (bean.state === "qualified" || bean.state === "eliminated") continue;
      const forfeitTick = forfeitAt.get(bean.userId);
      if (forfeitTick === nextTick) {
        eliminate(bean, nextTick, bean);
        continue;
      }
      if (bean.state === "falling") {
        fallStep(bean, nextTick);
        continue;
      }
      if (bean.state === "respawning") {
        const since = nextTick - (bean.fallStart ?? 0);
        if (since >= FALL_TICKS + RESPAWN_TICKS) {
          bean.state = "alive";
          bean.x = 0;
          bean.y = 0;
          bean.z = bean.checkpoint;
          bean.vy = 0;
          bean.hvelX = 0;
          bean.hvelZ = 0;
          bean.fallStart = null;
          bean.frozen = null;
        }
        continue;
      }
      aliveStep(bean, fromTick, obstacles, prevXs, finishers);
    }

    // Same-tick finishes qualify in ascending id order until the slots are full.
    finishers.sort((a, b) => a.userId - b.userId);
    for (const bean of finishers) {
      if (kind !== "survival" && qualifiedCount() < slots) {
        bean.state = "qualified";
        bean.finishTick = nextTick;
        bean.frozen = { x: bean.x, y: Math.max(0, bean.y), z: bean.z };
      }
    }
  }

  function aliveStep(bean: Bean, fromTick: number, obstacles: ReturnType<typeof obstacleState>, prevXs: number[], finishers: Bean[]) {
    // The input in effect at tick T drives the step from T to T+1.
    const stamped = inputAt.get(`${fromTick}:${bean.userId}`);
    const buttons = stamped ?? held.get(bean.userId) ?? 0;
    held.set(bean.userId, buttons);

    let dx = 0;
    let dz = 0;
    if (buttons & 1) dz += 1;
    if (buttons & 2) dz -= 1;
    if (buttons & 4) dx += 1;
    if (buttons & 8) dx -= 1;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }

    const grounded = bean.y <= 0.001 && bean.vy <= 0;
    if (bean.diveTicksLeft > 0) {
      bean.diveTicksLeft -= 1;
    } else {
      if (grounded) {
        bean.hvelX = dx * RUN_SPEED;
        bean.hvelZ = dz * RUN_SPEED;
        if (buttons & 16) bean.vy = JUMP_VELOCITY;
      }
      if (buttons & 32) {
        const dirX = len > 0 ? dx : 0;
        const dirZ = len > 0 ? dz : 1;
        bean.hvelX = dirX * DIVE_SPEED;
        bean.hvelZ = dirZ * DIVE_SPEED;
        bean.vy += 3;
        bean.diveTicksLeft = DIVE_TICKS;
      }
    }

    bean.x += bean.hvelX * DT;
    bean.z += bean.hvelZ * DT;
    bean.vy -= GRAVITY * DT;
    bean.y += bean.vy * DT;

    collide(bean, obstacles, prevXs);

    const floored = hasFloor(bean);
    if (bean.y < 0 && floored) {
      bean.y = 0;
      if (bean.vy < 0) bean.vy = 0;
    }

    const nextTick = fromTick + 1;
    if (bean.y < FALL_Y) {
      bean.state = "falling";
      bean.fallStart = nextTick;
      if (kind === "survival") {
        eliminate(bean, nextTick, bean);
      }
      return;
    }

    if (kind === "survival") return;

    bean.checkpoint = Math.max(bean.checkpoint, checkpointZ(bean.z));
    if (bean.z >= course.length) finishers.push(bean);
  }

  function fallStep(bean: Bean, nextTick: number) {
    bean.vy -= GRAVITY * DT;
    bean.y += bean.vy * DT;
    bean.x += bean.hvelX * DT;
    bean.z += bean.hvelZ * DT;
    if (nextTick - (bean.fallStart ?? 0) >= FALL_TICKS) {
      bean.state = "respawning";
      bean.frozen = { x: 0, y: 0, z: bean.checkpoint };
    }
  }

  function collide(bean: Bean, obstacles: ReturnType<typeof obstacleState>, prevXs: number[]) {
    const airborne = bean.y > 0.001;
    for (const bumper of course.bumpers) {
      if (!airborne) continue;
      const d = Math.hypot(bean.x - bumper.x, bean.z - bumper.z);
      if (d < bumper.radius + BEAN_RADIUS) {
        if (kind === "survival") {
          bean.hvelX = ((bean.x - bumper.x) / (d || 1)) * bumper.knock;
          bean.hvelZ = ((bean.z - bumper.z) / (d || 1)) * bumper.knock;
        } else {
          // Down the course only, so a straight runner always makes progress.
          bean.hvelX = 0;
          bean.hvelZ = bumper.knock;
        }
      }
    }
    course.platforms.forEach((platform, i) => {
      const px = obstacles.platformXs[i] ?? 0;
      void prevXs;
      // A moving platform is a sliding box: a grounded bean in its footprint is
      // pushed out along x to the platform's edge, never carried off course.
      const halfW = 1.1 + BEAN_RADIUS;
      if (!airborne && Math.abs(bean.z - platform.z) < halfW && Math.abs(bean.x - px) < halfW) {
        const side = bean.x >= px ? 1 : -1;
        bean.x = px + side * halfW;
      }
    });
    course.sweepers.forEach((sweeper, i) => {
      const angle = obstacles.sweeperAngles[i] ?? 0;
      for (const armSign of [1, -1]) {
        const ex = sweeper.x + Math.cos(angle) * sweeper.armLen * armSign;
        const ez = sweeper.z + Math.sin(angle) * sweeper.armLen * armSign;
        // The arm is a bar from the hub to its tip.
        const d = distanceToSegment(bean.x, bean.z, sweeper.x, sweeper.z, ex, ez);
        if (d < 1.1) {
          if (kind === "survival") {
            // Radially outward from the hub, so the arms sweep idle beans off
            // the arena edge.
            const rd = Math.hypot(bean.x - sweeper.x, bean.z - sweeper.z) || 1;
            bean.hvelX = ((bean.x - sweeper.x) / rd) * sweeper.knock;
            bean.hvelZ = ((bean.z - sweeper.z) / rd) * sweeper.knock;
          } else {
            // The arm flicks the bean onward down the course and up into the
            // air, never sideways, so a straight runner always makes progress.
            bean.hvelX = 0;
            bean.hvelZ = sweeper.knock;
          }
          if (bean.vy <= 0) bean.vy = 4;
        }
      }
    });
  }

  function hasFloor(bean: Bean): boolean {
    if (kind === "survival") return Math.hypot(bean.x, bean.z) <= course.ringRadius;
    return Math.abs(bean.x) <= course.halfWidth && bean.z >= -8 && bean.z <= course.length + 6;
  }

  function decided(): boolean {
    if (kind === "race") return qualifiedCount() >= slots;
    if (kind === "final") return qualifiedCount() >= 1;
    // Survival resolves when falls have brought the survivors down to the
    // slots value. With slots equal to the number of starters nothing can
    // decide the round, so it runs to its time limit.
    const survivors = beans.filter((b) => b.state === "alive" || b.state === "respawning").length;
    const eliminated = beans.filter((b) => b.state === "eliminated").length;
    return survivors <= slots && eliminated > 0;
  }

  /**
   * Applies the terminal rules for the deciding tick. In survival, if more
   * beans fall on that tick than are needed to reach the slots value, the
   * fallers with the lowest ids are revived as survivors until the slots are
   * reached; every survivor qualifies on the deciding tick.
   */
  function settleLastTick(): void {
    const decidedTick = lastTick;
    if (decidedTick === null) return;
    if (kind === "survival") {
      const survivingCount = beans.filter((b) => b.state === "alive" || b.state === "respawning").length;
      const eliminatedCount = beans.filter((b) => b.state === "eliminated").length;
      const room = Math.max(0, slots - eliminatedCount - survivingCount);
      let taken = 0;
      const fallers = beans.filter((b) => b.state === "falling").sort((a, b) => a.userId - b.userId);
      for (const bean of fallers) {
        if (taken < room) {
          bean.state = "respawning";
          bean.frozen = null;
          bean.vy = 0;
          bean.hvelX = 0;
          bean.hvelZ = 0;
          taken += 1;
        } else {
          eliminate(bean, decidedTick, bean);
        }
      }
      for (const bean of beans) {
        if (bean.state === "alive" || bean.state === "respawning") {
          bean.state = "qualified";
          bean.finishTick = decidedTick;
          bean.frozen = frozenPos(bean);
        }
      }
      return;
    }
    for (const bean of beans) {
      if (inPlay(bean) && bean.state !== "qualified") {
        eliminate(bean, decidedTick, bean);
      }
    }
  }
}

/** Distance from a point to a segment, used for sweeper arms. */
function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function frozenPos(bean: Bean): { x: number; y: number; z: number } {
  if (bean.frozen) return bean.frozen;
  return { x: bean.x, y: bean.y, z: bean.z };
}

function eliminate(bean: Bean, tick: number, pos: Bean): void {
  if (bean.state === "qualified" || bean.state === "eliminated") return;
  bean.state = "eliminated";
  bean.eliminatedTick = tick;
  bean.frozen = { x: pos.x, y: Math.max(pos.y, FALL_Y), z: pos.z };
}

export function rankBeans(beans: Bean[], kind: RoundKind): Map<number, number> {
  const inPlay = beans.filter((b) => b.state === "alive" || b.state === "falling" || b.state === "respawning");
  const qualified = beans.filter((b) => b.state === "qualified");
  const eliminated = beans.filter((b) => b.state === "eliminated");
  const byZ = (a: Bean, b: Bean) => frozenPos(b).z - frozenPos(a).z || a.userId - b.userId;
  const order = [
    ...qualified.sort((a, b) => (a.finishTick ?? 0) - (b.finishTick ?? 0) || a.userId - b.userId),
    ...inPlay.sort((a, b) => (kind === "survival" ? a.userId - b.userId : byZ(a, b))),
    ...eliminated.sort((a, b) => {
      if ((b.eliminatedTick ?? 0) !== (a.eliminatedTick ?? 0)) return (b.eliminatedTick ?? 0) - (a.eliminatedTick ?? 0);
      return kind === "survival" ? a.userId - b.userId : byZ(a, b);
    })
  ];
  const map = new Map<number, number>();
  order.forEach((bean, i) => map.set(bean.userId, i + 1));
  return map;
}

export function slotsLeftAt(kind: RoundKind, slots: number, beans: Bean[]): number {
  if (kind === "survival") {
    const inPlay = beans.filter((b) => b.state === "alive" || b.state === "falling" || b.state === "respawning").length;
    return Math.max(0, inPlay - slots);
  }
  return Math.max(0, slots - beans.filter((b) => b.state === "qualified").length);
}
