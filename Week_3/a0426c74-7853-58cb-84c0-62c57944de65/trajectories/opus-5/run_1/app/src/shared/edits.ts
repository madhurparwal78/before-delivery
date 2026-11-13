import { TOLERANCE, round6 } from './numbers.js';
import type { ArcEntity, CircleEntity, Entity, LineEntity } from './model.js';
import type { EntityInput, ModifySet, Operation } from './operations.js';
import {
  type Vec,
  add,
  angleBetween,
  angleOf,
  arcContainsAngle,
  arcSweep,
  cross,
  dist,
  dot,
  entityPrims,
  infiniteIntersection,
  mirrorEntity,
  moveEntity,
  mul,
  norm,
  normAngle,
  pointAt,
  primIntersections,
  rotateEntity,
  sub,
  vec,
} from './geometry.js';

export type EditOutcome =
  | { ok: true; ops: Operation[]; changed: number }
  | { ok: false; message: string };

export const EDIT_MESSAGES = {
  trimType: 'TRIM works on lines, arcs and circles. Explode a polyline first.',
  trimNoCross: 'Nothing to trim: that entity doesn\u2019t cross a cutting edge.',
  extendNoBoundary: 'Nothing to extend: no boundary in that direction.',
  filletParallel: 'These lines are parallel. Nothing to fillet.',
  filletRadius: 'Radius too large for these lines.',
  chamferParallel: 'These lines are parallel. Nothing to chamfer.',
  chamferDistance: 'Distance too large for these lines.',
  offsetRadius: 'Offset would make a radius of zero or less.',
  nothingToPick: 'Nothing there to pick.',
} as const;

export interface IdFactory {
  (): string;
}

export function toInput(entity: Entity): EntityInput {
  const common = {
    layer: entity.layer,
    colour: entity.colour,
    linetype: entity.linetype,
    lineweight: entity.lineweight,
  };
  switch (entity.type) {
    case 'line':
      return { ...common, type: 'line', x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 };
    case 'circle':
      return { ...common, type: 'circle', cx: entity.cx, cy: entity.cy, r: entity.r };
    case 'arc':
      return { ...common, type: 'arc', cx: entity.cx, cy: entity.cy, r: entity.r, start: entity.start, end: entity.end };
    case 'pline':
      return { ...common, type: 'pline', points: entity.points.map(([x, y]) => [x, y] as [number, number]), closed: entity.closed };
    case 'insert':
      return {
        ...common,
        type: 'insert',
        block: entity.block,
        x: entity.x,
        y: entity.y,
        scale: entity.scale,
        rotation: entity.rotation,
        attributes: { ...entity.attributes },
      };
    case 'hatch':
      return { ...common, type: 'hatch', seed_x: entity.seed_x, seed_y: entity.seed_y };
    case 'dimension':
      return {
        ...common,
        type: 'dimension',
        kind: entity.kind,
        style: entity.style,
        refs: entity.refs.map((ref) => ({ ...ref })),
        points: entity.points.map(([x, y]) => [x, y] as [number, number]),
        override: entity.override,
        text_x: entity.text_x,
        text_y: entity.text_y,
      };
  }
}

function crossingsWith(target: Entity, edges: Entity[]): Vec[] {
  const points: Vec[] = [];
  for (const edge of edges) {
    if (edge.handle === target.handle) continue;
    for (const p of entityPrims(target)) {
      for (const q of entityPrims(edge)) {
        points.push(...primIntersections(p, q));
      }
    }
  }
  const unique: Vec[] = [];
  for (const point of points) {
    if (!unique.some((other) => dist(other, point) <= TOLERANCE)) unique.push(point);
  }
  return unique;
}

function lineParam(line: LineEntity, point: Vec): number {
  const a = vec(line.x1, line.y1);
  const b = vec(line.x2, line.y2);
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < 1e-18) return 0;
  return dot(sub(point, a), d) / l2;
}

function linePoint(line: LineEntity, t: number): Vec {
  const a = vec(line.x1, line.y1);
  const b = vec(line.x2, line.y2);
  return add(a, mul(sub(b, a), t));
}

export function trim(target: Entity, pick: Vec, edges: Entity[], nextId: IdFactory): EditOutcome {
  if (target.type !== 'line' && target.type !== 'arc' && target.type !== 'circle') {
    return { ok: false, message: EDIT_MESSAGES.trimType };
  }
  const crossings = crossingsWith(target, edges);

  if (target.type === 'line') {
    const params = crossings
      .map((point) => lineParam(target, point))
      .filter((t) => t > TOLERANCE && t < 1 - TOLERANCE)
      .sort((a, b) => a - b);
    if (params.length === 0) return { ok: false, message: EDIT_MESSAGES.trimNoCross };
    const bounds = [0, ...params, 1];
    const pickT = Math.min(1, Math.max(0, lineParam(target, pick)));
    let removed = -1;
    for (let index = 0; index + 1 < bounds.length; index += 1) {
      if (pickT >= bounds[index] - TOLERANCE && pickT <= bounds[index + 1] + TOLERANCE) {
        removed = index;
        break;
      }
    }
    if (removed < 0) return { ok: false, message: EDIT_MESSAGES.trimNoCross };
    const pieces: [number, number][] = [];
    for (let index = 0; index + 1 < bounds.length; index += 1) {
      if (index === removed) continue;
      if (bounds[index + 1] - bounds[index] > TOLERANCE) pieces.push([bounds[index], bounds[index + 1]]);
    }
    if (pieces.length === 0) {
      return { ok: true, ops: [{ op_id: nextId(), type: 'delete', handles: [target.handle] }], changed: 1 };
    }
    const keeperIndex = pieces.findIndex(([from]) => from <= TOLERANCE);
    const keeper = pieces[keeperIndex >= 0 ? keeperIndex : 0];
    const ops: Operation[] = [];
    const keepStart = linePoint(target, keeper[0]);
    const keepEnd = linePoint(target, keeper[1]);
    ops.push({
      op_id: nextId(),
      type: 'modify',
      handle: target.handle,
      set: { x1: round6(keepStart.x), y1: round6(keepStart.y), x2: round6(keepEnd.x), y2: round6(keepEnd.y) },
    });
    for (const [from, to] of pieces) {
      if (from === keeper[0] && to === keeper[1]) continue;
      const a = linePoint(target, from);
      const b = linePoint(target, to);
      ops.push({
        op_id: nextId(),
        type: 'add',
        entity: { ...toInput(target), type: 'line', x1: round6(a.x), y1: round6(a.y), x2: round6(b.x), y2: round6(b.y) },
      });
    }
    return { ok: true, ops, changed: 1 + (ops.length - 1) };
  }

  if (target.type === 'arc') {
    const sweep = arcSweep(target.start, target.end);
    const centre = vec(target.cx, target.cy);
    const params = crossings
      .map((point) => normAngle(angleOf(sub(point, centre)) - target.start))
      .filter((offset) => offset > 0.001 && offset < sweep - 0.001)
      .sort((a, b) => a - b);
    if (params.length === 0) return { ok: false, message: EDIT_MESSAGES.trimNoCross };
    const bounds = [0, ...params, sweep];
    const pickOffset = normAngle(angleOf(sub(pick, centre)) - target.start);
    let removed = -1;
    for (let index = 0; index + 1 < bounds.length; index += 1) {
      if (pickOffset >= bounds[index] - 0.001 && pickOffset <= bounds[index + 1] + 0.001) {
        removed = index;
        break;
      }
    }
    if (removed < 0) return { ok: false, message: EDIT_MESSAGES.trimNoCross };
    const pieces: [number, number][] = [];
    for (let index = 0; index + 1 < bounds.length; index += 1) {
      if (index === removed) continue;
      if (bounds[index + 1] - bounds[index] > 0.001) pieces.push([bounds[index], bounds[index + 1]]);
    }
    if (pieces.length === 0) {
      return { ok: true, ops: [{ op_id: nextId(), type: 'delete', handles: [target.handle] }], changed: 1 };
    }
    const keeper = pieces.find(([from]) => from <= 0.001) ?? pieces[0];
    const ops: Operation[] = [];
    ops.push({
      op_id: nextId(),
      type: 'modify',
      handle: target.handle,
      set: { start: round6(normAngle(target.start + keeper[0])), end: round6(normAngle(target.start + keeper[1])) },
    });
    for (const [from, to] of pieces) {
      if (from === keeper[0] && to === keeper[1]) continue;
      ops.push({
        op_id: nextId(),
        type: 'add',
        entity: {
          ...toInput(target),
          type: 'arc',
          cx: target.cx,
          cy: target.cy,
          r: target.r,
          start: round6(normAngle(target.start + from)),
          end: round6(normAngle(target.start + to)),
        },
      });
    }
    return { ok: true, ops, changed: 1 + (ops.length - 1) };
  }

  const centre = vec(target.cx, target.cy);
  const angles = crossings.map((point) => angleOf(sub(point, centre))).sort((a, b) => a - b);
  if (angles.length < 2) return { ok: false, message: EDIT_MESSAGES.trimNoCross };
  const pickAngle = angleOf(sub(pick, centre));
  let fromIndex = angles.length - 1;
  for (let index = 0; index < angles.length; index += 1) {
    const start = angles[index];
    const end = angles[(index + 1) % angles.length];
    if (arcContainsAngle(start, end, pickAngle)) {
      fromIndex = index;
      break;
    }
  }
  const gapStart = angles[fromIndex];
  const gapEnd = angles[(fromIndex + 1) % angles.length];
  const ops: Operation[] = [
    { op_id: nextId(), type: 'delete', handles: [target.handle] },
    {
      op_id: nextId(),
      type: 'add',
      entity: {
        ...toInput(target),
        type: 'arc',
        cx: target.cx,
        cy: target.cy,
        r: target.r,
        start: round6(gapEnd),
        end: round6(gapStart),
      },
    },
  ];
  return { ok: true, ops, changed: 1 };
}

const RAY_LENGTH = 1e7;

export function extend(target: Entity, pick: Vec, boundaries: Entity[], nextId: IdFactory): EditOutcome {
  if (target.type === 'line') {
    const a = vec(target.x1, target.y1);
    const b = vec(target.x2, target.y2);
    const atStart = dist(pick, a) <= dist(pick, b);
    const end = atStart ? a : b;
    const other = atStart ? b : a;
    const direction = norm(sub(end, other));
    const ray: Entity = {
      handle: 'ray',
      type: 'line',
      layer: target.layer,
      x1: end.x,
      y1: end.y,
      x2: end.x + direction.x * RAY_LENGTH,
      y2: end.y + direction.y * RAY_LENGTH,
    };
    let best: Vec | null = null;
    let bestDistance = Infinity;
    for (const boundary of boundaries) {
      if (boundary.handle === target.handle) continue;
      for (const point of crossingsWith(ray, [boundary])) {
        const d = dist(point, end);
        if (d > TOLERANCE && d < bestDistance) {
          bestDistance = d;
          best = point;
        }
      }
    }
    if (!best) return { ok: false, message: EDIT_MESSAGES.extendNoBoundary };
    const set = atStart
      ? { x1: round6(best.x), y1: round6(best.y) }
      : { x2: round6(best.x), y2: round6(best.y) };
    return { ok: true, ops: [{ op_id: nextId(), type: 'modify', handle: target.handle, set }], changed: 1 };
  }
  if (target.type === 'arc') {
    const centre = vec(target.cx, target.cy);
    const sweep = arcSweep(target.start, target.end);
    const startPoint = pointAt(centre, target.r, target.start);
    const endPoint = pointAt(centre, target.r, target.end);
    const atStart = dist(pick, startPoint) <= dist(pick, endPoint);
    const circle: Entity = {
      handle: 'circle',
      type: 'circle',
      layer: target.layer,
      cx: target.cx,
      cy: target.cy,
      r: target.r,
    };
    let bestAngle: number | null = null;
    let bestStep = Infinity;
    for (const boundary of boundaries) {
      if (boundary.handle === target.handle) continue;
      for (const point of crossingsWith(circle, [boundary])) {
        const angle = angleOf(sub(point, centre));
        const step = atStart ? normAngle(target.start - angle) : normAngle(angle - target.end);
        if (step > 0.001 && step < 360 - sweep + 0.001 && step < bestStep) {
          bestStep = step;
          bestAngle = angle;
        }
      }
    }
    if (bestAngle === null) return { ok: false, message: EDIT_MESSAGES.extendNoBoundary };
    const set = atStart ? { start: round6(bestAngle) } : { end: round6(bestAngle) };
    return { ok: true, ops: [{ op_id: nextId(), type: 'modify', handle: target.handle, set }], changed: 1 };
  }
  return { ok: false, message: EDIT_MESSAGES.extendNoBoundary };
}

interface KeptLine {
  line: LineEntity;
  keptEnd: Vec;
  cutEnd: 'start' | 'end';
  direction: Vec;
  keptLength: number;
}

function keptPart(line: LineEntity, pick: Vec, crossing: Vec): KeptLine {
  const a = vec(line.x1, line.y1);
  const b = vec(line.x2, line.y2);
  const towardsPick = sub(pick, crossing);
  const keepA = dot(sub(a, crossing), towardsPick) >= dot(sub(b, crossing), towardsPick);
  const keptEnd = keepA ? a : b;
  return {
    line,
    keptEnd,
    cutEnd: keepA ? 'end' : 'start',
    direction: norm(sub(keptEnd, crossing)),
    keptLength: dist(keptEnd, crossing),
  };
}

function setCutEnd(cutEnd: 'start' | 'end', point: Vec): ModifySet {
  return cutEnd === 'start'
    ? { x1: round6(point.x), y1: round6(point.y) }
    : { x2: round6(point.x), y2: round6(point.y) };
}

export function fillet(
  first: LineEntity,
  firstPick: Vec,
  second: LineEntity,
  secondPick: Vec,
  radius: number,
  nextId: IdFactory,
): EditOutcome {
  const crossing = infiniteIntersection(
    vec(first.x1, first.y1),
    vec(first.x2, first.y2),
    vec(second.x1, second.y1),
    vec(second.x2, second.y2),
  );
  if (!crossing) return { ok: false, message: EDIT_MESSAGES.filletParallel };
  const keptFirst = keptPart(first, firstPick, crossing);
  const keptSecond = keptPart(second, secondPick, crossing);
  const theta = angleBetween(keptFirst.direction, keptSecond.direction);
  if (radius === 0) {
    return {
      ok: true,
      ops: [
        { op_id: nextId(), type: 'modify', handle: first.handle, set: setCutEnd(keptFirst.cutEnd, crossing) },
        { op_id: nextId(), type: 'modify', handle: second.handle, set: setCutEnd(keptSecond.cutEnd, crossing) },
      ],
      changed: 2,
    };
  }
  const tangentDistance = radius / Math.tan(((theta / 2) * Math.PI) / 180);
  if (tangentDistance > keptFirst.keptLength + TOLERANCE || tangentDistance > keptSecond.keptLength + TOLERANCE) {
    return { ok: false, message: EDIT_MESSAGES.filletRadius };
  }
  const tangentFirst = add(crossing, mul(keptFirst.direction, tangentDistance));
  const tangentSecond = add(crossing, mul(keptSecond.direction, tangentDistance));
  const bisector = norm(add(keptFirst.direction, keptSecond.direction));
  const centreDistance = radius / Math.sin(((theta / 2) * Math.PI) / 180);
  const centre = add(crossing, mul(bisector, centreDistance));
  const angleFirst = angleOf(sub(tangentFirst, centre));
  const angleSecond = angleOf(sub(tangentSecond, centre));
  const wanted = 180 - theta;
  const startAngle = Math.abs(arcSweep(angleFirst, angleSecond) - wanted) < 0.001 ? angleFirst : angleSecond;
  const endAngle = startAngle === angleFirst ? angleSecond : angleFirst;
  return {
    ok: true,
    ops: [
      { op_id: nextId(), type: 'modify', handle: first.handle, set: setCutEnd(keptFirst.cutEnd, tangentFirst) },
      { op_id: nextId(), type: 'modify', handle: second.handle, set: setCutEnd(keptSecond.cutEnd, tangentSecond) },
      {
        op_id: nextId(),
        type: 'add',
        entity: {
          ...toInput(first),
          type: 'arc',
          cx: round6(centre.x),
          cy: round6(centre.y),
          r: round6(radius),
          start: round6(startAngle),
          end: round6(endAngle),
        },
      },
    ],
    changed: 2,
  };
}

export function chamfer(
  first: LineEntity,
  firstPick: Vec,
  second: LineEntity,
  secondPick: Vec,
  firstDistance: number,
  secondDistance: number,
  nextId: IdFactory,
): EditOutcome {
  const crossing = infiniteIntersection(
    vec(first.x1, first.y1),
    vec(first.x2, first.y2),
    vec(second.x1, second.y1),
    vec(second.x2, second.y2),
  );
  if (!crossing) return { ok: false, message: EDIT_MESSAGES.chamferParallel };
  const keptFirst = keptPart(first, firstPick, crossing);
  const keptSecond = keptPart(second, secondPick, crossing);
  if (firstDistance === 0 && secondDistance === 0) {
    return {
      ok: true,
      ops: [
        { op_id: nextId(), type: 'modify', handle: first.handle, set: setCutEnd(keptFirst.cutEnd, crossing) },
        { op_id: nextId(), type: 'modify', handle: second.handle, set: setCutEnd(keptSecond.cutEnd, crossing) },
      ],
      changed: 2,
    };
  }
  if (firstDistance > keptFirst.keptLength + TOLERANCE || secondDistance > keptSecond.keptLength + TOLERANCE) {
    return { ok: false, message: EDIT_MESSAGES.chamferDistance };
  }
  const pointFirst = add(crossing, mul(keptFirst.direction, firstDistance));
  const pointSecond = add(crossing, mul(keptSecond.direction, secondDistance));
  return {
    ok: true,
    ops: [
      { op_id: nextId(), type: 'modify', handle: first.handle, set: setCutEnd(keptFirst.cutEnd, pointFirst) },
      { op_id: nextId(), type: 'modify', handle: second.handle, set: setCutEnd(keptSecond.cutEnd, pointSecond) },
      {
        op_id: nextId(),
        type: 'add',
        entity: {
          ...toInput(first),
          type: 'line',
          x1: round6(pointFirst.x),
          y1: round6(pointFirst.y),
          x2: round6(pointSecond.x),
          y2: round6(pointSecond.y),
        },
      },
    ],
    changed: 2,
  };
}

function offsetLine(line: LineEntity, distance: number, side: Vec): EntityInput {
  const a = vec(line.x1, line.y1);
  const b = vec(line.x2, line.y2);
  const direction = norm(sub(b, a));
  const normal = vec(-direction.y, direction.x);
  const sign = cross(sub(b, a), sub(side, a)) >= 0 ? 1 : -1;
  const shift = mul(normal, distance * sign);
  return {
    ...toInput(line),
    type: 'line',
    x1: round6(a.x + shift.x),
    y1: round6(a.y + shift.y),
    x2: round6(b.x + shift.x),
    y2: round6(b.y + shift.y),
  };
}

export function offset(target: Entity, distance: number, side: Vec, nextId: IdFactory): EditOutcome {
  if (target.type === 'line') {
    return { ok: true, ops: [{ op_id: nextId(), type: 'add', entity: offsetLine(target, distance, side) }], changed: 1 };
  }
  if (target.type === 'circle' || target.type === 'arc') {
    const centre = vec(target.cx, target.cy);
    const outside = dist(side, centre) > target.r;
    const radius = round6(outside ? target.r + distance : target.r - distance);
    if (radius <= 0) return { ok: false, message: EDIT_MESSAGES.offsetRadius };
    const entity: EntityInput =
      target.type === 'circle'
        ? { ...toInput(target), type: 'circle', cx: target.cx, cy: target.cy, r: radius }
        : { ...toInput(target), type: 'arc', cx: target.cx, cy: target.cy, r: radius, start: target.start, end: target.end };
    return { ok: true, ops: [{ op_id: nextId(), type: 'add', entity }], changed: 1 };
  }
  if (target.type === 'pline') {
    const points = target.points.map(([x, y]) => vec(x, y));
    const segments: { a: Vec; b: Vec }[] = [];
    const count = target.closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const direction = norm(sub(b, a));
      const normal = vec(-direction.y, direction.x);
      const sign = cross(sub(b, a), sub(side, a)) >= 0 ? 1 : -1;
      const shift = mul(normal, distance * sign);
      segments.push({ a: add(a, shift), b: add(b, shift) });
    }
    const out: Vec[] = [];
    if (!target.closed) out.push(segments[0].a);
    for (let index = 0; index < segments.length - (target.closed ? 0 : 1); index += 1) {
      const current = segments[index];
      const next = segments[(index + 1) % segments.length];
      const joint = infiniteIntersection(current.a, current.b, next.a, next.b);
      out.push(joint ?? current.b);
    }
    if (!target.closed) out.push(segments[segments.length - 1].b);
    const ordered = target.closed ? [out[out.length - 1], ...out.slice(0, -1)] : out;
    return {
      ok: true,
      ops: [
        {
          op_id: nextId(),
          type: 'add',
          entity: {
            ...toInput(target),
            type: 'pline',
            points: ordered.map((point) => [round6(point.x), round6(point.y)] as [number, number]),
            closed: target.closed,
          },
        },
      ],
      changed: 1,
    };
  }
  return { ok: false, message: EDIT_MESSAGES.nothingToPick };
}

export function mirror(
  entities: Entity[],
  axisFirst: Vec,
  axisSecond: Vec,
  keepOriginals: boolean,
  nextId: IdFactory,
): EditOutcome {
  const ops: Operation[] = [];
  for (const entity of entities) {
    const clone = structuredClone(entity);
    mirrorEntity(clone, axisFirst, axisSecond);
    ops.push({ op_id: nextId(), type: 'add', entity: toInput(clone) });
  }
  if (!keepOriginals) {
    ops.push({ op_id: nextId(), type: 'delete', handles: entities.map((entity) => entity.handle) });
  }
  return { ok: true, ops, changed: entities.length };
}

export function arrayRectangular(
  entities: Entity[],
  rows: number,
  columns: number,
  rowGap: number,
  columnGap: number,
  nextId: IdFactory,
): EditOutcome {
  const ops: Operation[] = [];
  let copies = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (row === 0 && column === 0) continue;
      for (const entity of entities) {
        const clone = structuredClone(entity);
        moveEntity(clone, column * columnGap, row * rowGap);
        ops.push({ op_id: nextId(), type: 'add', entity: toInput(clone) });
      }
      copies += 1;
    }
  }
  return { ok: true, ops, changed: copies * entities.length };
}

export function arrayPolar(
  entities: Entity[],
  centre: Vec,
  count: number,
  totalAngle: number,
  nextId: IdFactory,
): EditOutcome {
  const step = Math.abs(totalAngle - 360) < 0.001 ? totalAngle / count : totalAngle / (count - 1);
  const ops: Operation[] = [];
  for (let index = 1; index < count; index += 1) {
    for (const entity of entities) {
      const clone = structuredClone(entity);
      rotateEntity(clone, centre, step * index);
      ops.push({ op_id: nextId(), type: 'add', entity: toInput(clone) });
    }
  }
  return { ok: true, ops, changed: (count - 1) * entities.length };
}

export function isTrimTarget(entity: Entity): entity is LineEntity | ArcEntity | CircleEntity {
  return entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle';
}

