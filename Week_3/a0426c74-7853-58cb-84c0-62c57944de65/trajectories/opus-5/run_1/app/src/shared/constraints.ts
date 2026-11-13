import { SOLVE_TOLERANCE, round6 } from './numbers.js';
import type { Constraint, DrawingModel, Entity } from './model.js';
import { findEntity } from './model.js';
import { type Vec, add, dist, len, mul, norm, sub, vec } from './geometry.js';
import { evaluateExpression } from './expressions.js';

const MAX_PASSES = 50;

export type PointKey = string;

export function pointKey(handle: string, which: 'start' | 'end'): PointKey {
  return `${handle}:${which}`;
}

export function constraintLabel(constraint: Constraint): string {
  const handles: string[] = [];
  for (const ref of constraint.refs) {
    if (!handles.includes(ref.handle)) handles.push(ref.handle);
  }
  const head = `${constraint.kind} ${handles.join(' ')}`;
  return constraint.expression ? `${head} = ${constraint.expression}` : head;
}

interface Accessor {
  get(): Vec;
  set(point: Vec): void;
  key: PointKey;
}

function accessors(model: DrawingModel, handle: string): { start?: Accessor; end?: Accessor } {
  const entity = findEntity(model, handle);
  if (!entity || entity.type !== 'line') return {};
  return {
    start: {
      key: pointKey(handle, 'start'),
      get: () => vec(entity.x1, entity.y1),
      set: (point) => {
        entity.x1 = round6(point.x);
        entity.y1 = round6(point.y);
      },
    },
    end: {
      key: pointKey(handle, 'end'),
      get: () => vec(entity.x2, entity.y2),
      set: (point) => {
        entity.x2 = round6(point.x);
        entity.y2 = round6(point.y);
      },
    },
  };
}

function lineAccessors(model: DrawingModel, handle: string): [Accessor, Accessor] | null {
  const pair = accessors(model, handle);
  if (!pair.start || !pair.end) return null;
  return [pair.start, pair.end];
}

function constraintTarget(model: DrawingModel, constraint: Constraint): number {
  return evaluateExpression(constraint.expression ?? '0', model.parameters, constraint.expression ?? '0');
}

function movePair(a: Accessor, b: Accessor, pinned: Set<PointKey>, target: Vec, mover: 'both' | 'a' | 'b'): void {
  if (mover === 'a' || pinned.has(b.key)) {
    if (!pinned.has(a.key)) a.set(target);
    return;
  }
  if (mover === 'b' || pinned.has(a.key)) {
    if (!pinned.has(b.key)) b.set(target);
    return;
  }
  a.set(target);
  b.set(target);
}

function setLineDirection(
  model: DrawingModel,
  handle: string,
  direction: Vec,
  pinned: Set<PointKey>,
): void {
  const line = lineAccessors(model, handle);
  if (!line) return;
  const [start, end] = line;
  const a = start.get();
  const b = end.get();
  const length = dist(a, b);
  const unit = norm(direction);
  const sign = len(sub(b, a)) === 0 ? 1 : Math.sign(unit.x * (b.x - a.x) + unit.y * (b.y - a.y)) || 1;
  const along = mul(unit, length * sign);
  if (pinned.has(start.key) && pinned.has(end.key)) return;
  if (pinned.has(start.key)) {
    end.set(add(a, along));
    return;
  }
  if (pinned.has(end.key)) {
    start.set(sub(b, along));
    return;
  }
  const centre = vec((a.x + b.x) / 2, (a.y + b.y) / 2);
  start.set(sub(centre, mul(along, 0.5)));
  end.set(add(centre, mul(along, 0.5)));
}

function setLineLength(model: DrawingModel, handle: string, target: number, pinned: Set<PointKey>): void {
  const line = lineAccessors(model, handle);
  if (!line) return;
  const [start, end] = line;
  const a = start.get();
  const b = end.get();
  const direction = len(sub(b, a)) === 0 ? vec(1, 0) : norm(sub(b, a));
  const along = mul(direction, target);
  if (pinned.has(start.key) && pinned.has(end.key)) return;
  if (pinned.has(start.key)) {
    end.set(add(a, along));
    return;
  }
  if (pinned.has(end.key)) {
    start.set(sub(b, along));
    return;
  }
  const centre = vec((a.x + b.x) / 2, (a.y + b.y) / 2);
  start.set(sub(centre, mul(along, 0.5)));
  end.set(add(centre, mul(along, 0.5)));
}

function applyConstraint(model: DrawingModel, constraint: Constraint, pinned: Set<PointKey>): void {
  const refs = constraint.refs;
  switch (constraint.kind) {
    case 'fixed':
      return;
    case 'coincident': {
      const first = refs[0];
      const second = refs[1];
      if (!first || !second || !first.point || !second.point) return;
      const a = accessors(model, first.handle)[first.point];
      const b = accessors(model, second.handle)[second.point];
      if (!a || !b) return;
      const pa = a.get();
      const pb = b.get();
      const mid = vec((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
      movePair(a, b, pinned, pinned.has(b.key) ? pb : pinned.has(a.key) ? pa : mid, 'both');
      return;
    }
    case 'horizontal': {
      const line = lineAccessors(model, refs[0]?.handle ?? '');
      if (!line) return;
      setLineDirection(model, refs[0].handle, vec(1, 0), pinned);
      return;
    }
    case 'vertical': {
      const line = lineAccessors(model, refs[0]?.handle ?? '');
      if (!line) return;
      setLineDirection(model, refs[0].handle, vec(0, 1), pinned);
      return;
    }
    case 'parallel':
    case 'perpendicular': {
      const first = lineAccessors(model, refs[0]?.handle ?? '');
      const second = lineAccessors(model, refs[1]?.handle ?? '');
      if (!first || !second) return;
      const firstPinned = pinned.has(first[0].key) && pinned.has(first[1].key);
      const source = firstPinned ? second : first;
      const targetHandle = firstPinned ? refs[0].handle : refs[1].handle;
      const direction = norm(sub(source[1].get(), source[0].get()));
      const wanted = constraint.kind === 'parallel' ? direction : vec(-direction.y, direction.x);
      setLineDirection(model, targetHandle, wanted, pinned);
      return;
    }
    case 'equal': {
      const first = lineAccessors(model, refs[0]?.handle ?? '');
      const second = lineAccessors(model, refs[1]?.handle ?? '');
      if (!first || !second) return;
      const firstLength = dist(first[0].get(), first[1].get());
      const secondLength = dist(second[0].get(), second[1].get());
      const firstPinned = pinned.has(first[0].key) && pinned.has(first[1].key);
      const secondPinned = pinned.has(second[0].key) && pinned.has(second[1].key);
      if (firstPinned && !secondPinned) {
        setLineLength(model, refs[1].handle, firstLength, pinned);
      } else if (secondPinned && !firstPinned) {
        setLineLength(model, refs[0].handle, secondLength, pinned);
      } else {
        const average = (firstLength + secondLength) / 2;
        setLineLength(model, refs[0].handle, average, pinned);
        setLineLength(model, refs[1].handle, average, pinned);
      }
      return;
    }
    case 'length': {
      setLineLength(model, refs[0]?.handle ?? '', constraintTarget(model, constraint), pinned);
      return;
    }
    case 'radius': {
      const entity = findEntity(model, refs[0]?.handle ?? '');
      if (!entity || (entity.type !== 'circle' && entity.type !== 'arc')) return;
      entity.r = round6(constraintTarget(model, constraint));
      return;
    }
  }
}

export function constraintSatisfied(model: DrawingModel, constraint: Constraint, before: Map<string, Entity>): boolean {
  const refs = constraint.refs;
  switch (constraint.kind) {
    case 'fixed': {
      const entity = findEntity(model, refs[0]?.handle ?? '');
      const original = before.get(refs[0]?.handle ?? '');
      if (!entity || !original) return true;
      if (entity.type !== 'line' || original.type !== 'line') return true;
      if (refs[0].point === 'start') {
        return Math.abs(entity.x1 - original.x1) <= SOLVE_TOLERANCE && Math.abs(entity.y1 - original.y1) <= SOLVE_TOLERANCE;
      }
      if (refs[0].point === 'end') {
        return Math.abs(entity.x2 - original.x2) <= SOLVE_TOLERANCE && Math.abs(entity.y2 - original.y2) <= SOLVE_TOLERANCE;
      }
      return (
        Math.abs(entity.x1 - original.x1) <= SOLVE_TOLERANCE &&
        Math.abs(entity.y1 - original.y1) <= SOLVE_TOLERANCE &&
        Math.abs(entity.x2 - original.x2) <= SOLVE_TOLERANCE &&
        Math.abs(entity.y2 - original.y2) <= SOLVE_TOLERANCE
      );
    }
    case 'coincident': {
      const first = refs[0];
      const second = refs[1];
      if (!first?.point || !second?.point) return true;
      const a = accessors(model, first.handle)[first.point];
      const b = accessors(model, second.handle)[second.point];
      if (!a || !b) return true;
      return dist(a.get(), b.get()) <= SOLVE_TOLERANCE;
    }
    case 'horizontal': {
      const line = lineAccessors(model, refs[0]?.handle ?? '');
      if (!line) return true;
      return Math.abs(line[0].get().y - line[1].get().y) <= SOLVE_TOLERANCE;
    }
    case 'vertical': {
      const line = lineAccessors(model, refs[0]?.handle ?? '');
      if (!line) return true;
      return Math.abs(line[0].get().x - line[1].get().x) <= SOLVE_TOLERANCE;
    }
    case 'parallel':
    case 'perpendicular': {
      const first = lineAccessors(model, refs[0]?.handle ?? '');
      const second = lineAccessors(model, refs[1]?.handle ?? '');
      if (!first || !second) return true;
      const u = norm(sub(first[1].get(), first[0].get()));
      const v = norm(sub(second[1].get(), second[0].get()));
      const value = constraint.kind === 'parallel' ? u.x * v.y - u.y * v.x : u.x * v.x + u.y * v.y;
      return Math.abs(value) <= SOLVE_TOLERANCE;
    }
    case 'equal': {
      const first = lineAccessors(model, refs[0]?.handle ?? '');
      const second = lineAccessors(model, refs[1]?.handle ?? '');
      if (!first || !second) return true;
      return Math.abs(dist(first[0].get(), first[1].get()) - dist(second[0].get(), second[1].get())) <= SOLVE_TOLERANCE;
    }
    case 'length': {
      const line = lineAccessors(model, refs[0]?.handle ?? '');
      if (!line) return true;
      return Math.abs(dist(line[0].get(), line[1].get()) - constraintTarget(model, constraint)) <= SOLVE_TOLERANCE;
    }
    case 'radius': {
      const entity = findEntity(model, refs[0]?.handle ?? '');
      if (!entity || (entity.type !== 'circle' && entity.type !== 'arc')) return true;
      return Math.abs(entity.r - constraintTarget(model, constraint)) <= SOLVE_TOLERANCE;
    }
  }
}

export interface SolveResult {
  ok: boolean;
  unsatisfied: Constraint | null;
}

/** Solve every constraint in creation order, at most 50 passes, keeping fixed and dragged points still. */
export function solveConstraints(model: DrawingModel, draggedPoints: PointKey[] = []): SolveResult {
  const before = new Map<string, Entity>();
  for (const entity of model.entities) before.set(entity.handle, structuredClone(entity));

  const pinned = new Set<PointKey>(draggedPoints);
  for (const constraint of model.constraints) {
    if (constraint.kind !== 'fixed') continue;
    const ref = constraint.refs[0];
    if (!ref) continue;
    if (ref.point === 'start' || ref.point === 'end') pinned.add(pointKey(ref.handle, ref.point));
    else {
      pinned.add(pointKey(ref.handle, 'start'));
      pinned.add(pointKey(ref.handle, 'end'));
    }
  }

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    for (const constraint of model.constraints) applyConstraint(model, constraint, pinned);
    const unsatisfied = model.constraints.find((constraint) => !constraintSatisfied(model, constraint, before));
    if (!unsatisfied) return { ok: true, unsatisfied: null };
  }
  const unsatisfied = model.constraints.find((constraint) => !constraintSatisfied(model, constraint, before)) ?? null;
  return { ok: unsatisfied === null, unsatisfied };
}


