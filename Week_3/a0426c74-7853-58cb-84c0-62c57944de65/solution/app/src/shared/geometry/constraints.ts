// The constraint solver: geometric and dimensional constraints over lines and circles, applied in creation order.
import * as copy from '../copy.ts';
import type { Constraint, Entity, Parameter, Point } from '../types.ts';
import { evaluateExpression } from './expression.ts';
import { RAD, SOLVE_TOL, distance, midpoint, rotateAbout, round6 } from './numbers.ts';
import { lineEnds } from './transform.ts';

const MAX_PASSES = 50;

/** `horizontal L1`, `length L1 = d1`, `coincident L1 L2`. */
export function constraintLabel(constraint: Constraint): string {
  const handles = constraint.refs.map((ref) => ref.handle).join(' ');
  return constraint.expression === undefined ? `${constraint.kind} ${handles}` : `${constraint.kind} ${handles} = ${constraint.expression}`;
}

export interface SolveInput {
  /** current model entities (only lines and circles take part), with a grip drag or move already applied; `fixed` points hold their position here */
  entities: Readonly<Record<string, Entity>>;
  /** every constraint in creation order, including a new one last */
  constraints: readonly Constraint[];
  parameters: Readonly<Record<string, Parameter>>;
  /** the point a grip is dragging (null point: the whole line): it stays where it is dragged unless fixed */
  dragged?: { handle: string; point: 'start' | 'end' | null };
}
export type SolveOutcome = { ok: true; changed: Entity[] } | { ok: false; message: string };

/** A line being solved: its two end points, each either free or pinned to a position. */
interface Segment { ends: [Point, Point]; pinned: [Point | null, Point | null] }
interface Round { radius: number }

const lengthOf = ([a, b]: [Point, Point]): number => distance(a, b);
const angleOf = ([a, b]: [Point, Point]): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
const free = (segment: Segment, end: 0 | 1): boolean => segment.pinned[end] === null;
const canMove = (segment: Segment): boolean => free(segment, 0) || free(segment, 1);

/** Turns a line by `radians` about its midpoint, or about its pinned end. */
function rotate(segment: Segment, radians: number): void {
  const [a, b] = segment.ends;
  const about: Point = !free(segment, 0) ? a : !free(segment, 1) ? b : midpoint(a, b);
  if (free(segment, 0)) segment.ends[0] = rotateAbout(a, about, radians / RAD);
  if (free(segment, 1)) segment.ends[1] = rotateAbout(b, about, radians / RAD);
}

/** Gives a line the length `target`: both free ends move equally, a pinned end stays. */
function resize(segment: Segment, target: number): void {
  const [a, b] = segment.ends;
  const length = lengthOf(segment.ends);
  const direction: Point = length === 0 ? [1, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const pull = (target - length) / 2;
  if (free(segment, 0) && free(segment, 1)) {
    segment.ends = [[a[0] - direction[0] * pull, a[1] - direction[1] * pull], [b[0] + direction[0] * pull, b[1] + direction[1] * pull]];
  } else if (free(segment, 1)) {
    segment.ends[1] = [a[0] + direction[0] * target, a[1] + direction[1] * target];
  } else if (free(segment, 0)) {
    segment.ends[0] = [b[0] - direction[0] * target, b[1] - direction[1] * target];
  }
}

/** Smallest turn that makes `angle` equal `wanted` modulo a half turn. */
function halfTurnGap(wanted: number, angle: number): number {
  const gap = (wanted - angle) % Math.PI;
  return gap > Math.PI / 2 ? gap - Math.PI : gap < -Math.PI / 2 ? gap + Math.PI : gap;
}

/** Both lines turn half of the gap each; a line with both ends pinned stays and the other takes all of it. */
function align(first: Segment, second: Segment, offset: number): void {
  const gap = halfTurnGap(angleOf(first.ends) + offset, angleOf(second.ends));
  if (canMove(first) && canMove(second)) {
    rotate(first, -gap / 2);
    rotate(second, gap / 2);
  } else if (canMove(second)) rotate(second, gap);
  else if (canMove(first)) rotate(first, -gap);
}

function levelAxis(segment: Segment, axis: 0 | 1): void {
  const [a, b] = segment.ends;
  if (free(segment, 0) && free(segment, 1)) {
    const mean = (a[axis] + b[axis]) / 2;
    segment.ends = [axis === 0 ? [mean, a[1]] : [a[0], mean], axis === 0 ? [mean, b[1]] : [b[0], mean]];
  } else if (free(segment, 1)) segment.ends[1] = axis === 0 ? [a[0], b[1]] : [b[0], a[1]];
  else if (free(segment, 0)) segment.ends[0] = axis === 0 ? [b[0], a[1]] : [a[0], b[1]];
}

function join(first: Segment, firstEnd: 0 | 1, second: Segment, secondEnd: 0 | 1): void {
  const p = first.ends[firstEnd];
  const q = second.ends[secondEnd];
  const middle = midpoint(p, q);
  if (free(first, firstEnd) && free(second, secondEnd)) {
    first.ends[firstEnd] = middle;
    second.ends[secondEnd] = middle;
  } else if (free(first, firstEnd)) first.ends[firstEnd] = q;
  else if (free(second, secondEnd)) second.ends[secondEnd] = p;
}

interface World {
  segments: Map<string, Segment>;
  rounds: Map<string, Round>;
  /** values of the `length` and `radius` expressions by constraint id */
  targets: Map<string, number>;
}

const endIndex = (point: 'start' | 'end' | null | undefined): 0 | 1 => (point === 'end' ? 1 : 0);

function lineAt(world: World, constraint: Constraint, ref: number): { segment: Segment; handle: string; point: 'start' | 'end' | null | undefined } | null {
  const target = constraint.refs[ref];
  const segment = target === undefined ? undefined : world.segments.get(target.handle);
  return target === undefined || segment === undefined ? null : { segment, handle: target.handle, point: target.point };
}

/** Applies one constraint by moving only free points; a constraint whose entities are gone does nothing. */
function apply(world: World, constraint: Constraint): void {
  const first = lineAt(world, constraint, 0);
  const second = lineAt(world, constraint, 1);
  switch (constraint.kind) {
    case 'coincident':
      if (first !== null && second !== null) join(first.segment, endIndex(first.point), second.segment, endIndex(second.point));
      break;
    case 'horizontal':
      if (first !== null) levelAxis(first.segment, 1);
      break;
    case 'vertical':
      if (first !== null) levelAxis(first.segment, 0);
      break;
    case 'parallel':
      if (first !== null && second !== null) align(first.segment, second.segment, 0);
      break;
    case 'perpendicular':
      if (first !== null && second !== null) align(first.segment, second.segment, Math.PI / 2);
      break;
    case 'equal':
      if (first !== null && second !== null) {
        const mean = (lengthOf(first.segment.ends) + lengthOf(second.segment.ends)) / 2;
        const target = canMove(first.segment) && canMove(second.segment) ? mean : null;
        if (target !== null) {
          resize(first.segment, target);
          resize(second.segment, target);
        } else if (canMove(second.segment)) resize(second.segment, lengthOf(first.segment.ends));
        else if (canMove(first.segment)) resize(first.segment, lengthOf(second.segment.ends));
      }
      break;
    case 'length': {
      const target = world.targets.get(constraint.id);
      if (first !== null && target !== undefined) resize(first.segment, target);
      break;
    }
    case 'radius': {
      const round = world.rounds.get(constraint.refs[0]?.handle ?? '');
      const target = world.targets.get(constraint.id);
      if (round !== undefined && target !== undefined) round.radius = target;
      break;
    }
    case 'fixed':
      break;
  }
}

function satisfied(world: World, constraint: Constraint): boolean {
  const first = lineAt(world, constraint, 0);
  const second = lineAt(world, constraint, 1);
  const target = world.targets.get(constraint.id);
  switch (constraint.kind) {
    case 'coincident': {
      if (first === null || second === null) return true;
      return distance(first.segment.ends[endIndex(first.point)], second.segment.ends[endIndex(second.point)]) <= SOLVE_TOL;
    }
    case 'horizontal':
      return first === null || Math.abs(first.segment.ends[0][1] - first.segment.ends[1][1]) <= SOLVE_TOL;
    case 'vertical':
      return first === null || Math.abs(first.segment.ends[0][0] - first.segment.ends[1][0]) <= SOLVE_TOL;
    case 'parallel':
    case 'perpendicular': {
      if (first === null || second === null) return true;
      const wanted = constraint.kind === 'parallel' ? 0 : Math.PI / 2;
      return Math.abs(halfTurnGap(angleOf(first.segment.ends) + wanted, angleOf(second.segment.ends))) * lengthOf(second.segment.ends) <= SOLVE_TOL;
    }
    case 'equal':
      return first === null || second === null || Math.abs(lengthOf(first.segment.ends) - lengthOf(second.segment.ends)) <= SOLVE_TOL;
    case 'length':
      return first === null || target === undefined || Math.abs(lengthOf(first.segment.ends) - target) <= SOLVE_TOL;
    case 'radius': {
      const round = world.rounds.get(constraint.refs[0]?.handle ?? '');
      return round === undefined || target === undefined || Math.abs(round.radius - target) <= SOLVE_TOL;
    }
    case 'fixed':
      return first === null || ([0, 1] as const).every((end) => {
        const pin = first.segment.pinned[end];
        const at = first.segment.ends[end];
        return pin === null || distance(pin, at) <= SOLVE_TOL;
      });
  }
}

function buildWorld(input: SolveInput): World | { message: string } {
  const world: World = { segments: new Map(), rounds: new Map(), targets: new Map() };
  for (const constraint of input.constraints) {
    for (const ref of constraint.refs) {
      const entity = input.entities[ref.handle];
      if (entity === undefined) continue;
      const ends = entity.type === 'line' ? lineEnds(entity) : null;
      if (ends !== null && !world.segments.has(ref.handle)) {
        world.segments.set(ref.handle, { ends: [[...ends[0]], [...ends[1]]], pinned: [null, null] });
      } else if (entity.type === 'circle' && !world.rounds.has(ref.handle)) world.rounds.set(ref.handle, { radius: entity.r });
    }
    if (constraint.expression !== undefined) {
      const outcome = evaluateExpression(constraint.expression, input.parameters, constraint.expression);
      if (!outcome.ok) return { message: outcome.message };
      world.targets.set(constraint.id, outcome.value);
    }
  }
  const pin = (handle: string, end: 0 | 1, at: Point): void => {
    const segment = world.segments.get(handle);
    if (segment !== undefined) segment.pinned[end] = at;
  };
  if (input.dragged !== undefined) {
    const segment = world.segments.get(input.dragged.handle);
    if (segment !== undefined) {
      const ends = input.dragged.point === null ? [0, 1] as const : [endIndex(input.dragged.point)] as const;
      for (const end of ends) pin(input.dragged.handle, end, segment.ends[end]);
    }
  }
  for (const constraint of input.constraints) {
    if (constraint.kind !== 'fixed') continue;
    const target = constraint.refs[0];
    const held = target === undefined ? undefined : input.entities[target.handle];
    const heldEnds = held?.type === 'line' ? lineEnds(held) : null;
    if (target === undefined || heldEnds === null) continue;
    const ends = target.point === null || target.point === undefined ? [0, 1] as const : [endIndex(target.point)] as const;
    for (const end of ends) pin(target.handle, end, heldEnds[end]);
  }
  return world;
}

function holdPins(world: World): void {
  for (const segment of world.segments.values()) {
    for (const end of [0, 1] as const) {
      const pin = segment.pinned[end];
      if (pin !== null) segment.ends[end] = pin;
    }
  }
}

function changedEntities(world: World, entities: Readonly<Record<string, Entity>>): Entity[] {
  const changed: Entity[] = [];
  for (const [handle, segment] of world.segments) {
    const entity = entities[handle];
    if (entity?.type !== 'line') continue;
    const [a, b] = segment.ends;
    const next = { ...entity, x1: round6(a[0]), y1: round6(a[1]), x2: round6(b[0]), y2: round6(b[1]) };
    if (next.x1 !== entity.x1 || next.y1 !== entity.y1 || next.x2 !== entity.x2 || next.y2 !== entity.y2) changed.push(next);
  }
  for (const [handle, round] of world.rounds) {
    const entity = entities[handle];
    if (entity?.type === 'circle' && round6(round.radius) !== entity.r) changed.push({ ...entity, r: round6(round.radius) });
  }
  return changed;
}

/** The constraint a failed trigger conflicts with: the first unsatisfied one other than the trigger, else the earlier one it shares a handle with. */
function conflictWith(unsatisfied: readonly Constraint[], constraints: readonly Constraint[], trigger: string): Constraint {
  const other = unsatisfied.find((constraint) => constraintLabel(constraint) !== trigger);
  if (other !== undefined) return other;
  const failing = unsatisfied[0];
  const handles = new Set(failing.refs.map((ref) => ref.handle));
  return constraints.find((constraint) => constraint !== failing && constraint.refs.some((ref) => handles.has(ref.handle))) ?? failing;
}

/**
 * Applies the constraints in creation order, at most 50 passes, to 0.0001; fixed entities never move, others move as little as they must.
 * `changed` holds the entities whose geometry changed. On failure `message` is `Over-constrained: <trigger> conflicts with <existing>.`,
 * `trigger` being the label of the new constraint or of the edit, `<existing>` the first unsatisfied constraint in creation order.
 * Expression errors inside a constraint come back as `{ ok: false }` with their own sentence.
 */
export function solveConstraints(input: SolveInput, trigger: string): SolveOutcome {
  const world = buildWorld(input);
  if ('message' in world) return { ok: false, message: world.message };
  holdPins(world);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const constraint of input.constraints) {
      apply(world, constraint);
      holdPins(world);
    }
    if (input.constraints.every((constraint) => satisfied(world, constraint))) break;
  }
  const unsatisfied = input.constraints.filter((constraint) => !satisfied(world, constraint));
  if (unsatisfied.length > 0) return { ok: false, message: copy.overConstrained(trigger, constraintLabel(conflictWith(unsatisfied, input.constraints, trigger))) };
  return { ok: true, changed: changedEntities(world, input.entities) };
}
