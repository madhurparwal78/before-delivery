import { TOLERANCE, fmtAngle, fmtDisplay, round6 } from '../../shared/numbers.js';
import { CANCELLED_PROMPT, PROMPTS, READY_PROMPT, REFUSALS, TEXT_STAGES, resolveCommand, unknownBlock, unknownCommand, unknownXref, CONSTRAINT_KINDS } from '../../shared/commands.js';
import type { ConstraintKind, Entity } from '../../shared/model.js';
import { findBlock, findEntity, findLayer } from '../../shared/model.js';
import type { EntityInput, Operation } from '../../shared/operations.js';
import {
  type Vec,
  angleOf,
  dist,
  distanceToEntity,
  entityArea,
  midpointOf,
  rotateEntity,
  scaleEntity,
  sub,
  vec,
} from '../../shared/geometry.js';
import { arrayPolar, arrayRectangular, chamfer, extend, fillet, mirror, offset, toInput, trim } from '../../shared/edits.js';
import { areaAroundPoint } from '../../shared/hatch.js';
import { linkFor } from '../../shared/dimensions.js';
import { parseNumber, parsePoint } from '../../shared/points.js';
import * as announce from '../../shared/announce.js';
import { RequestFailed } from '../api.js';
import { store } from '../store.js';
import { APERTURE_PX } from '../../shared/snap.js';

export type SlotType = 'point' | 'number' | 'pick' | 'picks' | 'text' | 'yesno';

export interface Slot {
  prompt: string;
  type: SlotType;
  endsCommand?: boolean;
  closes?: boolean;
  fallback?: number | string;
  positive?: boolean;
}

export type SlotValue =
  | { type: 'point'; point: Vec }
  | { type: 'number'; value: number }
  | { type: 'pick'; handle: string; point: Vec }
  | { type: 'picks'; picks: { handle: string; point: Vec }[] }
  | { type: 'text'; text: string };

export interface Run {
  command: string;
  values: SlotValue[];
}

export interface CommandContext {
  setPrompt(text: string): void;
  announce(text: string): void;
  toast(text: string): void;
  focusCommand(): void;
  openLayers(): void;
  openParameters(): void;
  openFind(): void;
  zoomAll(): void;
  render(): void;
  attachXref(name: string, source: string, point: Vec, scale: number, rotation: number): Promise<void>;
}

export interface CommandEngine {
  prompt(): string;
  running(): boolean;
  slot(): Slot | null;
  run(): Run | null;
  submitText(text: string, viaSpace: boolean): void;
  enterPoint(point: Vec): void;
  escape(): void;
  stepBack(): void;
  start(name: string): void;
  previewFrom(): Vec | null;
}

function nextId(): string {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

/** The entity nearest a point within the snap aperture, skipping off, frozen and locked layers. */
export function pickAt(point: Vec): { handle: string; entity: Entity } | null {
  const radius = APERTURE_PX / store.view.zoom;
  let best: { handle: string; entity: Entity; distance: number } | null = null;
  for (const entity of store.model.entities) {
    const layer = findLayer(store.model, entity.layer);
    if (layer && (!layer.on || layer.frozen || layer.locked)) continue;
    const distance = distanceToEntity(entity, point);
    if (distance > radius) continue;
    if (!best || distance < best.distance) best = { handle: entity.handle, entity, distance };
  }
  return best ? { handle: best.handle, entity: best.entity } : null;
}

function pickPointFor(entity: Entity): Vec {
  return midpointOf(entity);
}

function slotsFor(run: Run): Slot[] {
  const values = run.values;
  const pointCount = values.filter((value) => value.type === 'point').length;
  switch (run.command) {
    case 'LINE': {
      const slots: Slot[] = [{ prompt: PROMPTS.LINE_FROM, type: 'point' }];
      for (let index = 0; index <= Math.max(0, pointCount - 1); index += 1) {
        slots.push({ prompt: PROMPTS.LINE_TO, type: 'point', endsCommand: true });
      }
      return slots;
    }
    case 'PLINE': {
      const slots: Slot[] = [{ prompt: PROMPTS.PLINE_FROM, type: 'point' }];
      for (let index = 0; index <= Math.max(0, pointCount - 1); index += 1) {
        slots.push({ prompt: PROMPTS.PLINE_TO, type: 'point', endsCommand: true });
      }
      return slots;
    }
    case 'RECT':
      return [
        { prompt: PROMPTS.RECT_FIRST, type: 'point' },
        { prompt: PROMPTS.RECT_OPPOSITE, type: 'point' },
      ];
    case 'CIRCLE':
      return [
        { prompt: PROMPTS.CIRCLE_CENTRE, type: 'point' },
        { prompt: PROMPTS.CIRCLE_RADIUS, type: 'number', positive: true },
      ];
    case 'ARC':
      return [
        { prompt: PROMPTS.ARC_CENTRE, type: 'point' },
        { prompt: PROMPTS.ARC_START, type: 'point' },
        { prompt: PROMPTS.ARC_END, type: 'point' },
      ];
    case 'MOVE':
      return [
        { prompt: PROMPTS.MOVE_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.MOVE_FROM, type: 'point' },
        { prompt: PROMPTS.MOVE_TO, type: 'point' },
      ];
    case 'COPY': {
      const slots: Slot[] = [
        { prompt: PROMPTS.COPY_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.COPY_FROM, type: 'point' },
      ];
      const copies = Math.max(0, pointCount - 1);
      for (let index = 0; index <= copies; index += 1) {
        slots.push({ prompt: PROMPTS.COPY_TO, type: 'point', endsCommand: true });
      }
      return slots;
    }
    case 'ROTATE':
      return [
        { prompt: PROMPTS.ROTATE_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.ROTATE_ABOUT, type: 'point' },
        { prompt: PROMPTS.ROTATE_ANGLE, type: 'number' },
      ];
    case 'SCALE':
      return [
        { prompt: PROMPTS.SCALE_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.SCALE_ABOUT, type: 'point' },
        { prompt: PROMPTS.SCALE_FACTOR, type: 'number', positive: true },
      ];
    case 'MIRROR':
      return [
        { prompt: PROMPTS.MIRROR_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.MIRROR_AXIS_FIRST, type: 'point' },
        { prompt: PROMPTS.MIRROR_AXIS_SECOND, type: 'point' },
        { prompt: PROMPTS.MIRROR_KEEP, type: 'yesno', fallback: 'Y' },
      ];
    case 'OFFSET': {
      const slots: Slot[] = [{ prompt: PROMPTS.OFFSET_DISTANCE, type: 'number', positive: true }];
      const after = values.slice(1);
      const pairs = Math.floor(after.length / 2);
      for (let index = 0; index <= pairs; index += 1) {
        slots.push({ prompt: PROMPTS.OFFSET_PICK, type: 'pick', endsCommand: true });
        slots.push({ prompt: PROMPTS.OFFSET_SIDE, type: 'point' });
      }
      return slots;
    }
    case 'TRIM': {
      const slots: Slot[] = [{ prompt: PROMPTS.TRIM_EDGES, type: 'picks', closes: true }];
      const parts = values.slice(1).length;
      for (let index = 0; index <= parts; index += 1) {
        slots.push({ prompt: PROMPTS.TRIM_PART, type: 'pick', endsCommand: true });
      }
      return slots;
    }
    case 'EXTEND': {
      const slots: Slot[] = [{ prompt: PROMPTS.EXTEND_BOUNDARIES, type: 'picks', closes: true }];
      const parts = values.slice(1).length;
      for (let index = 0; index <= parts; index += 1) {
        slots.push({ prompt: PROMPTS.EXTEND_END, type: 'pick', endsCommand: true });
      }
      return slots;
    }
    case 'FILLET':
      return [
        { prompt: PROMPTS.FILLET_RADIUS, type: 'number' },
        { prompt: PROMPTS.FILLET_FIRST, type: 'pick' },
        { prompt: PROMPTS.FILLET_SECOND, type: 'pick' },
      ];
    case 'CHAMFER':
      return [
        { prompt: PROMPTS.CHAMFER_FIRST_DISTANCE, type: 'number' },
        { prompt: PROMPTS.CHAMFER_SECOND_DISTANCE, type: 'number' },
        { prompt: PROMPTS.CHAMFER_FIRST, type: 'pick' },
        { prompt: PROMPTS.CHAMFER_SECOND, type: 'pick' },
      ];
    case 'ARRAY': {
      const slots: Slot[] = [
        { prompt: PROMPTS.ARRAY_PICK, type: 'picks', closes: true },
        { prompt: PROMPTS.ARRAY_KIND, type: 'text' },
      ];
      const kindValue = values[1];
      const kind = kindValue && kindValue.type === 'text' ? kindValue.text.trim().toUpperCase() : '';
      if (kind === 'R') {
        slots.push({ prompt: PROMPTS.ARRAY_ROWS, type: 'number', positive: true });
        slots.push({ prompt: PROMPTS.ARRAY_COLUMNS, type: 'number', positive: true });
        slots.push({ prompt: PROMPTS.ARRAY_ROW_GAP, type: 'number' });
        slots.push({ prompt: PROMPTS.ARRAY_COLUMN_GAP, type: 'number' });
      } else if (kind === 'P') {
        slots.push({ prompt: PROMPTS.ARRAY_CENTRE, type: 'point' });
        slots.push({ prompt: PROMPTS.ARRAY_COUNT, type: 'number', positive: true });
        slots.push({ prompt: PROMPTS.ARRAY_TOTAL, type: 'number' });
      }
      return slots;
    }
    case 'HATCH':
      return [{ prompt: PROMPTS.HATCH_POINT, type: 'point' }];
    case 'DIST':
      return [
        { prompt: PROMPTS.DIST_FIRST, type: 'point' },
        { prompt: PROMPTS.DIST_SECOND, type: 'point' },
      ];
    case 'AREA':
      return [{ prompt: PROMPTS.AREA_PICK, type: 'pick' }];
    case 'ERASE':
      return [{ prompt: PROMPTS.ERASE_PICK, type: 'picks', closes: true }];
    case 'EXPLODE':
      return [{ prompt: PROMPTS.EXPLODE_PICK, type: 'picks', closes: true }];
    case 'BLOCK': {
      const slots: Slot[] = [
        { prompt: PROMPTS.BLOCK_NAME, type: 'text' },
        { prompt: PROMPTS.BLOCK_BASE, type: 'point' },
        { prompt: PROMPTS.BLOCK_PICK, type: 'picks', closes: true },
      ];
      const attributes = values.slice(3).length;
      for (let index = 0; index <= attributes; index += 1) {
        slots.push({ prompt: PROMPTS.BLOCK_ATTRIBUTE, type: 'text', endsCommand: true });
      }
      return slots;
    }
    case 'INSERT':
      return [
        { prompt: PROMPTS.INSERT_NAME, type: 'text' },
        { prompt: PROMPTS.INSERT_POINT, type: 'point' },
        { prompt: PROMPTS.INSERT_SCALE, type: 'number', fallback: 1, positive: true },
        { prompt: PROMPTS.INSERT_ROTATION, type: 'number', fallback: 0 },
      ];
    case 'DIMLINEAR':
      return [
        { prompt: PROMPTS.DIMLINEAR_FIRST, type: 'point' },
        { prompt: PROMPTS.DIMLINEAR_SECOND, type: 'point' },
        { prompt: PROMPTS.DIMLINEAR_LINE, type: 'point' },
      ];
    case 'DIMALIGNED':
      return [
        { prompt: PROMPTS.DIMALIGNED_FIRST, type: 'point' },
        { prompt: PROMPTS.DIMALIGNED_SECOND, type: 'point' },
        { prompt: PROMPTS.DIMALIGNED_LINE, type: 'point' },
      ];
    case 'DIMANGLE':
      return [
        { prompt: PROMPTS.DIMANGLE_FIRST, type: 'pick' },
        { prompt: PROMPTS.DIMANGLE_SECOND, type: 'pick' },
        { prompt: PROMPTS.DIMANGLE_ARC, type: 'point' },
      ];
    case 'DIMRADIUS':
      return [
        { prompt: PROMPTS.DIMRADIUS_PICK, type: 'pick' },
        { prompt: PROMPTS.DIMRADIUS_TEXT, type: 'point' },
      ];
    case 'CONSTRAIN': {
      const slots: Slot[] = [{ prompt: PROMPTS.CONSTRAIN_KIND, type: 'text' }];
      const kindValue = values[0];
      const kind = kindValue && kindValue.type === 'text' ? kindValue.text.trim().toLowerCase() : '';
      if (kind === 'coincident') {
        slots.push({ prompt: PROMPTS.CONSTRAIN_FIRST_POINT, type: 'pick' });
        slots.push({ prompt: PROMPTS.CONSTRAIN_SECOND_POINT, type: 'pick' });
      } else if (['parallel', 'perpendicular', 'equal'].includes(kind)) {
        slots.push({ prompt: PROMPTS.CONSTRAIN_FIRST_ENTITY, type: 'pick' });
        slots.push({ prompt: PROMPTS.CONSTRAIN_SECOND_ENTITY, type: 'pick' });
      } else if (['horizontal', 'vertical', 'fixed'].includes(kind)) {
        slots.push({ prompt: PROMPTS.CONSTRAIN_FIRST_ENTITY, type: 'pick' });
      } else if (kind === 'length' || kind === 'radius') {
        slots.push({ prompt: PROMPTS.CONSTRAIN_FIRST_ENTITY, type: 'pick' });
        slots.push({ prompt: PROMPTS.CONSTRAIN_EXPRESSION, type: 'text' });
      }
      return slots;
    }
    case 'PARAM':
      return [{ prompt: PROMPTS.PARAM_ENTRY, type: 'text', endsCommand: true }];
    case 'XATTACH':
      return [
        { prompt: PROMPTS.XATTACH_DRAWING, type: 'text' },
        { prompt: PROMPTS.XATTACH_NAME, type: 'text' },
        { prompt: PROMPTS.XATTACH_POINT, type: 'point' },
        { prompt: PROMPTS.XATTACH_SCALE, type: 'number', fallback: 1, positive: true },
        { prompt: PROMPTS.XATTACH_ROTATION, type: 'number', fallback: 0 },
      ];
    case 'XBIND':
      return [{ prompt: PROMPTS.XBIND_NAME, type: 'text' }];
    default:
      return [];
  }
}

function pointsOf(run: Run): Vec[] {
  return run.values.filter((value): value is { type: 'point'; point: Vec } => value.type === 'point').map((value) => value.point);
}

function numbersOf(run: Run): number[] {
  return run.values
    .filter((value): value is { type: 'number'; value: number } => value.type === 'number')
    .map((value) => value.value);
}

function textsOf(run: Run): string[] {
  return run.values.filter((value): value is { type: 'text'; text: string } => value.type === 'text').map((value) => value.text);
}

function picksOf(run: Run): { handle: string; point: Vec }[] {
  const group = run.values.find((value): value is { type: 'picks'; picks: { handle: string; point: Vec }[] } => value.type === 'picks');
  return group ? group.picks : [];
}

function singlePicks(run: Run): { handle: string; point: Vec }[] {
  return run.values
    .filter((value): value is { type: 'pick'; handle: string; point: Vec } => value.type === 'pick')
    .map((value) => ({ handle: value.handle, point: value.point }));
}

function entitiesOf(items: { handle: string }[]): Entity[] {
  return items
    .map((item) => findEntity(store.model, item.handle))
    .filter((entity): entity is Entity => entity !== undefined);
}

/** Every geometry field of an entity, for a modify operation. */
function geometrySet(entity: Entity): Record<string, unknown> {
  switch (entity.type) {
    case 'line':
      return { x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 };
    case 'circle':
      return { cx: entity.cx, cy: entity.cy, r: entity.r };
    case 'arc':
      return { cx: entity.cx, cy: entity.cy, r: entity.r, start: entity.start, end: entity.end };
    case 'pline':
      return { points: entity.points, closed: entity.closed };
    case 'insert':
      return { x: entity.x, y: entity.y, scale: entity.scale, rotation: entity.rotation };
    case 'hatch':
      return { seed_x: entity.seed_x, seed_y: entity.seed_y };
    case 'dimension':
      return { points: entity.points, text_x: entity.text_x, text_y: entity.text_y };
  }
}

function currentLayer(): string {
  return store.currentLayer;
}

function newEntity(input: EntityInput): Operation {
  return { op_id: nextId(), type: 'add', entity: input };
}

function transformOps(entities: Entity[], change: (entity: Entity) => void): Operation[] {
  const ops: Operation[] = [];
  for (const entity of entities) {
    const clone = structuredClone(entity);
    change(clone);
    ops.push({ op_id: nextId(), type: 'modify', handle: entity.handle, set: geometrySet(clone) });
  }
  return ops;
}

function copyOps(entities: Entity[], dx: number, dy: number): Operation[] {
  return entities.map((entity) => {
    const clone = structuredClone(entity);
    switch (clone.type) {
      case 'line':
        clone.x1 += dx;
        clone.y1 += dy;
        clone.x2 += dx;
        clone.y2 += dy;
        break;
      case 'circle':
      case 'arc':
        clone.cx += dx;
        clone.cy += dy;
        break;
      case 'pline':
        clone.points = clone.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        break;
      case 'insert':
        clone.x += dx;
        clone.y += dy;
        break;
      case 'hatch':
        clone.seed_x += dx;
        clone.seed_y += dy;
        break;
      case 'dimension':
        clone.points = clone.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        clone.text_x += dx;
        clone.text_y += dy;
        break;
    }
    return newEntity(toInput(clone));
  });
}

function endRefFor(entity: Entity, point: Vec): 'start' | 'end' {
  if (entity.type !== 'line') return 'start';
  const start = vec(entity.x1, entity.y1);
  const end = vec(entity.x2, entity.y2);
  return dist(point, start) <= dist(point, end) ? 'start' : 'end';
}

export interface Finished {
  ops: Operation[];
  command: string;
  announcement?: string;
  result?: string;
}

export type FinishOutcome = Finished | { error: string } | { result: string } | null;

function appearance(): { layer: string } {
  return { layer: currentLayer() };
}

/** Build the one operation group a finished command run makes. */
function buildFinish(run: Run, closed: boolean): FinishOutcome {
  const points = pointsOf(run);
  const numbers = numbersOf(run);
  const texts = textsOf(run);
  const picks = picksOf(run);
  const single = singlePicks(run);
  switch (run.command) {
    case 'LINE': {
      const ops: Operation[] = [];
      const all = closed && points.length >= 3 ? [...points, points[0]] : points;
      for (let index = 0; index + 1 < all.length; index += 1) {
        const from = all[index];
        const to = all[index + 1];
        if (dist(from, to) <= TOLERANCE) continue;
        ops.push(newEntity({ ...appearance(), type: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y }));
      }
      return { ops, command: 'LINE' };
    }
    case 'PLINE': {
      if (points.length < 2) return { ops: [], command: 'PLINE' };
      return {
        ops: [
          newEntity({
            ...appearance(),
            type: 'pline',
            points: points.map((point) => [point.x, point.y] as [number, number]),
            closed,
          }),
        ],
        command: 'PLINE',
      };
    }
    case 'RECT': {
      const [first, second] = points;
      const corners: [number, number][] = [
        [first.x, first.y],
        [second.x, first.y],
        [second.x, second.y],
        [first.x, second.y],
      ];
      const area =
        corners.reduce((sum, [x, y], index) => {
          const [nx, ny] = corners[(index + 1) % corners.length];
          return sum + (x * ny - nx * y);
        }, 0) / 2;
      const ordered = area >= 0 ? corners : [corners[0], corners[3], corners[2], corners[1]];
      return {
        ops: [newEntity({ ...appearance(), type: 'pline', points: ordered, closed: true })],
        command: 'RECT',
      };
    }
    case 'CIRCLE': {
      const centre = points[0];
      const radius = numbers.length > 0 ? numbers[0] : dist(centre, points[1] ?? centre);
      if (radius <= 0) return { error: REFUSALS.notPositive };
      return {
        ops: [newEntity({ ...appearance(), type: 'circle', cx: centre.x, cy: centre.y, r: radius })],
        command: 'CIRCLE',
      };
    }
    case 'ARC': {
      const [centre, start, end] = points;
      const radius = dist(centre, start);
      if (radius <= 0) return { error: REFUSALS.notPositive };
      return {
        ops: [
          newEntity({
            ...appearance(),
            type: 'arc',
            cx: centre.x,
            cy: centre.y,
            r: radius,
            start: angleOf(sub(start, centre)),
            end: angleOf(sub(end, centre)),
          }),
        ],
        command: 'ARC',
      };
    }
    case 'MOVE': {
      const [from, to] = points;
      const handles = picks.map((pick) => pick.handle);
      if (handles.length === 0) return { ops: [], command: 'MOVE' };
      return {
        ops: [{ op_id: nextId(), type: 'move', handles, dx: round6(to.x - from.x), dy: round6(to.y - from.y) }],
        command: 'MOVE',
        announcement: announce.moved(handles.length),
      };
    }
    case 'COPY': {
      const entities = entitiesOf(picks);
      const [from, ...targets] = points;
      const ops: Operation[] = [];
      for (const target of targets) {
        ops.push(...copyOps(entities, round6(target.x - from.x), round6(target.y - from.y)));
      }
      return { ops, command: 'COPY', announcement: announce.copied(ops.length) };
    }
    case 'ROTATE': {
      const entities = entitiesOf(picks);
      const about = points[0];
      const angle = numbers[0];
      return {
        ops: transformOps(entities, (entity) => rotateEntity(entity, about, angle)),
        command: 'ROTATE',
        announcement: announce.rotated(entities.length),
      };
    }
    case 'SCALE': {
      const entities = entitiesOf(picks);
      const about = points[0];
      const factor = numbers[0];
      if (factor <= 0) return { error: REFUSALS.notPositive };
      return {
        ops: transformOps(entities, (entity) => scaleEntity(entity, about, factor)),
        command: 'SCALE',
        announcement: announce.scaled(entities.length),
      };
    }
    case 'MIRROR': {
      const entities = entitiesOf(picks);
      const [first, second] = points;
      const keep = (texts[0] ?? 'Y').trim().toUpperCase() !== 'N';
      const outcome = mirror(entities, first, second, keep, nextId);
      if (!outcome.ok) return { error: outcome.message };
      return { ops: outcome.ops, command: 'MIRROR', announcement: announce.mirrored(entities.length) };
    }
    case 'OFFSET': {
      const distance = numbers[0];
      const ops: Operation[] = [];
      let added = 0;
      for (let index = 0; index < single.length; index += 1) {
        const pick = single[index];
        const side = points[index];
        const entity = findEntity(store.model, pick.handle);
        if (!entity || !side) continue;
        const outcome = offset(entity, distance, side, nextId);
        if (!outcome.ok) return { error: outcome.message };
        ops.push(...outcome.ops);
        added += outcome.changed;
      }
      return { ops, command: 'OFFSET', announcement: announce.offsetAdded(added) };
    }
    case 'TRIM': {
      const edges = picks.length > 0 ? entitiesOf(picks) : store.model.entities;
      const ops: Operation[] = [];
      let changed = 0;
      for (const pick of single) {
        const entity = findEntity(store.model, pick.handle);
        if (!entity) continue;
        const outcome = trim(entity, pick.point, edges, nextId);
        if (!outcome.ok) return { error: outcome.message };
        ops.push(...outcome.ops);
        changed += outcome.changed;
      }
      return { ops, command: 'TRIM', announcement: announce.changedBy('Trim', changed) };
    }
    case 'EXTEND': {
      const boundaries = picks.length > 0 ? entitiesOf(picks) : store.model.entities;
      const ops: Operation[] = [];
      let changed = 0;
      for (const pick of single) {
        const entity = findEntity(store.model, pick.handle);
        if (!entity) continue;
        const outcome = extend(entity, pick.point, boundaries, nextId);
        if (!outcome.ok) return { error: outcome.message };
        ops.push(...outcome.ops);
        changed += outcome.changed;
      }
      return { ops, command: 'EXTEND', announcement: announce.changedBy('Extend', changed) };
    }
    case 'FILLET': {
      const radius = numbers[0];
      const [first, second] = single;
      const a = findEntity(store.model, first.handle);
      const b = findEntity(store.model, second.handle);
      if (!a || !b || a.type !== 'line' || b.type !== 'line') return { error: REFUSALS.nothingToPick };
      const outcome = fillet(a, first.point, b, second.point, radius, nextId);
      if (!outcome.ok) return { error: outcome.message };
      return { ops: outcome.ops, command: 'FILLET', announcement: announce.changedBy('Fillet', outcome.changed) };
    }
    case 'CHAMFER': {
      const [firstDistance, secondDistance] = numbers;
      const [first, second] = single;
      const a = findEntity(store.model, first.handle);
      const b = findEntity(store.model, second.handle);
      if (!a || !b || a.type !== 'line' || b.type !== 'line') return { error: REFUSALS.nothingToPick };
      const outcome = chamfer(
        a,
        first.point,
        b,
        second.point,
        firstDistance,
        secondDistance,
        nextId,
      );
      if (!outcome.ok) return { error: outcome.message };
      return { ops: outcome.ops, command: 'CHAMFER', announcement: announce.changedBy('Chamfer', outcome.changed) };
    }
    case 'ARRAY': {
      const entities = entitiesOf(picks);
      const kind = (texts[0] ?? '').trim().toUpperCase();
      if (kind === 'R') {
        const [rows, columns, rowGap, columnGap] = numbers;
        const outcome = arrayRectangular(entities, rows, columns, rowGap, columnGap, nextId);
        if (!outcome.ok) return { error: outcome.message };
        const copies = rows * columns - 1;
        return { ops: outcome.ops, command: 'ARRAY', announcement: announce.arrayed(copies) };
      }
      const centre = points[0];
      const [count, total] = numbers;
      const outcome = arrayPolar(entities, centre, count, total, nextId);
      if (!outcome.ok) return { error: outcome.message };
      return { ops: outcome.ops, command: 'ARRAY', announcement: announce.arrayed(count - 1) };
    }
    case 'HATCH': {
      const seed = points[0];
      if (areaAroundPoint(store.model, seed) === null) return { error: 'No closed boundary around that point.' };
      return {
        ops: [newEntity({ ...appearance(), type: 'hatch', seed_x: seed.x, seed_y: seed.y })],
        command: 'HATCH',
      };
    }
    case 'DIST': {
      const [first, second] = points;
      const distance = dist(first, second);
      const angle = angleOf(sub(second, first));
      return { result: `DIST: ${fmtDisplay(distance)} units, angle ${fmtAngle(angle)} degrees` };
    }
    case 'AREA': {
      const point = points[0] ?? single[0]?.point;
      const picked = single[0] ? findEntity(store.model, single[0].handle) : undefined;
      const direct = picked ? entityArea(picked) : null;
      const area = direct !== null && direct !== undefined ? direct : point ? areaAroundPoint(store.model, point) : null;
      if (area === null) return { error: 'No closed boundary around that point.' };
      return { result: `AREA: ${fmtDisplay(area)}` };
    }
    case 'ERASE': {
      const handles = picks.map((pick) => pick.handle);
      if (handles.length === 0) return { ops: [], command: 'ERASE' };
      return {
        ops: [{ op_id: nextId(), type: 'delete', handles }],
        command: 'ERASE',
        announcement: announce.erased(handles.length),
      };
    }
    case 'EXPLODE': {
      const ops: Operation[] = [];
      let added = 0;
      let handle = '';
      for (const pick of picks) {
        const entity = findEntity(store.model, pick.handle);
        if (!entity || entity.type !== 'insert') continue;
        const block = findBlock(store.model, entity.block);
        if (!block) continue;
        ops.push({ op_id: nextId(), type: 'explode', handle: entity.handle });
        added += block.entities.length;
        handle = entity.handle;
      }
      return { ops, command: 'EXPLODE', announcement: announce.exploded(handle, added) };
    }
    case 'BLOCK': {
      const name = texts[0];
      const base = points[0];
      const attributes = texts.slice(1).map((text) => {
        const [tag, value] = text.split('=');
        return { tag: (tag ?? '').trim(), default: (value ?? '').trim() };
      });
      const existed = findBlock(store.model, name) !== undefined;
      return {
        ops: [
          {
            op_id: nextId(),
            type: 'block_define',
            name,
            base: [base.x, base.y],
            handles: picks.map((pick) => pick.handle),
            attributes: attributes.filter((attribute) => attribute.tag !== ''),
          },
        ],
        command: 'BLOCK',
        announcement: announce.blockDefined(name, existed),
      };
    }
    case 'INSERT': {
      const name = texts[0];
      if (!findBlock(store.model, name)) return { error: unknownBlock(name) };
      const point = points[0];
      const scale = numbers[0] ?? 1;
      const rotation = numbers[1] ?? 0;
      return {
        ops: [
          newEntity({ ...appearance(), type: 'insert', block: name, x: point.x, y: point.y, scale, rotation }),
        ],
        command: 'INSERT',
      };
    }
    case 'DIMLINEAR':
    case 'DIMALIGNED': {
      const [first, second, position] = points;
      const refs = [linkFor(store.model, first), linkFor(store.model, second)].filter(
        (ref): ref is NonNullable<typeof ref> => ref !== null,
      );
      return {
        ops: [
          newEntity({
            ...appearance(),
            type: 'dimension',
            kind: run.command === 'DIMLINEAR' ? 'linear' : 'aligned',
            style: 'Standard',
            refs,
            points: [
              [first.x, first.y],
              [second.x, second.y],
            ],
            text_x: position.x,
            text_y: position.y,
          }),
        ],
        command: run.command,
      };
    }
    case 'DIMANGLE': {
      const [first, second] = single;
      const position = points[0];
      return {
        ops: [
          newEntity({
            ...appearance(),
            type: 'dimension',
            kind: 'angular',
            style: 'Standard',
            refs: [
              { handle: first.handle, point: null },
              { handle: second.handle, point: null },
            ],
            points: [
              [first.point.x, first.point.y],
              [second.point.x, second.point.y],
            ],
            text_x: position.x,
            text_y: position.y,
          }),
        ],
        command: 'DIMANGLE',
      };
    }
    case 'DIMRADIUS': {
      const [pick] = single;
      const position = points[0];
      const entity = findEntity(store.model, pick.handle);
      if (!entity || (entity.type !== 'circle' && entity.type !== 'arc')) return { error: REFUSALS.nothingToPick };
      return {
        ops: [
          newEntity({
            ...appearance(),
            type: 'dimension',
            kind: 'radial',
            style: 'Standard',
            refs: [{ handle: entity.handle, point: 'centre' }],
            points: [[entity.cx, entity.cy]],
            text_x: position.x,
            text_y: position.y,
          }),
        ],
        command: 'DIMRADIUS',
      };
    }
    case 'CONSTRAIN': {
      const kind = (texts[0] ?? '').trim().toLowerCase();
      if (!(CONSTRAINT_KINDS as readonly string[]).includes(kind)) return { error: REFUSALS.notANumber };
      const expression = kind === 'length' || kind === 'radius' ? texts[1] ?? '' : null;
      const refs = single.map((pick) => {
        const entity = findEntity(store.model, pick.handle);
        const point = kind === 'coincident' && entity ? endRefFor(entity, pick.point) : null;
        return { handle: pick.handle, point };
      });
      return {
        ops: [{ op_id: nextId(), type: 'constraint_add', kind: kind as ConstraintKind, refs, expression }],
        command: 'CONSTRAIN',
      };
    }
    case 'PARAM': {
      const entry = texts[0] ?? '';
      const [name, expression] = entry.split('=');
      if (!name || expression === undefined) return { error: REFUSALS.notANumber };
      return {
        ops: [{ op_id: nextId(), type: 'parameter_set', name: name.trim(), expression: expression.trim() }],
        command: 'PARAM',
      };
    }
    case 'XBIND': {
      const name = texts[0];
      if (!store.model.xrefs.some((xref) => xref.name === name)) return { error: unknownXref(name) };
      return { ops: [{ op_id: nextId(), type: 'xref_bind', name }], command: 'XBIND' };
    }
    default:
      return null;
  }
}

const READ_ONLY_COMMANDS = ['DIST', 'AREA', 'FIND', 'ZOOMALL'];

export function createEngine(ctx: CommandContext): CommandEngine {
  let run: Run | null = null;
  let closed = false;
  let pending: { handle: string; point: Vec }[] = [];
  let lastCommand: string | null = null;
  let promptText: string = READY_PROMPT;

  const slotList = (): Slot[] => (run ? slotsFor(run) : []);
  const currentSlot = (): Slot | null => {
    if (!run) return null;
    return slotList()[run.values.length] ?? null;
  };

  const setPrompt = (text: string): void => {
    promptText = text;
    ctx.setPrompt(text);
  };

  const showStage = (): void => {
    const slot = currentSlot();
    setPrompt(slot ? slot.prompt : READY_PROMPT);
  };

  const endRun = (): void => {
    run = null;
    closed = false;
    pending = [];
  };

  const refuse = (message: string): void => {
    setPrompt(message);
    ctx.focusCommand();
  };

  const announceAdds = (ops: Operation[], handles: string[]): string | null => {
    const adds = ops.filter((operation) => operation.type === 'add');
    if (adds.length === 0) return null;
    if (adds.length === 1) {
      const add = adds[0];
      if (add.type !== 'add') return null;
      return announce.entityAdded(add.entity.type, handles[0] ?? '');
    }
    return announce.entitiesAdded(adds.length);
  };

  const send = async (finished: Finished): Promise<void> => {
    try {
      const results = await store.submit(finished.command, finished.ops);
      const handles = (results ?? []).flatMap((result) => result.handles);
      const text = finished.announcement ?? announceAdds(finished.ops, handles);
      if (text) ctx.announce(text);
    } catch (error) {
      if (error instanceof RequestFailed) {
        ctx.toast(error.body.message);
        setPrompt(error.body.message);
      }
    }
    ctx.render();
    ctx.focusCommand();
  };

  const finish = (): void => {
    if (!run) return;
    const active = run;
    if (active.command === 'XATTACH') {
      const texts = textsOf(active);
      const points = pointsOf(active);
      const numbers = numbersOf(active);
      endRun();
      void ctx
        .attachXref(texts[0], texts[1], points[0], numbers[0] ?? 1, numbers[1] ?? 0)
        .then(() => {
          showStage();
          ctx.focusCommand();
        });
      return;
    }
    const outcome = buildFinish(active, closed);
    if (outcome === null) {
      endRun();
      showStage();
      return;
    }
    if ('error' in outcome) {
      active.values.pop();
      refuse(outcome.error);
      return;
    }
    if ('result' in outcome && !('ops' in outcome)) {
      endRun();
      refuse(outcome.result);
      return;
    }
    const finished = outcome as Finished;
    endRun();
    setPrompt(READY_PROMPT);
    void send(finished);
  };

  const pushValue = (value: SlotValue): void => {
    if (!run) return;
    run.values.push(value);
    if (value.type === 'point') store.lastPoint = value.point;
    const slots = slotsFor(run);
    const slot = slots[run.values.length];
    if (!slot) {
      finish();
      return;
    }
    if (slot.type === 'picks') pending = [];
    showStage();
    ctx.render();
  };

  const acceptPickValue = (handle: string, point: Vec): void => {
    const slot = currentSlot();
    if (!slot || !run) return;
    if (slot.type === 'picks') {
      if (!pending.some((entry) => entry.handle === handle)) pending.push({ handle, point });
      store.selection.add(handle);
      ctx.render();
      return;
    }
    pushValue({ type: 'pick', handle, point });
  };

  const start = (name: string): void => {
    const resolved = resolveCommand(name);
    if (!resolved) {
      refuse(unknownCommand(name));
      return;
    }
    if (!READ_ONLY_COMMANDS.includes(resolved)) {
      if (store.layout === 'phone') {
        refuse('Drawing commands aren\u2019t available on a phone. Open this drawing on a desktop to edit.');
        return;
      }
      if (store.versionView || store.role === 'view' || store.role === 'markup') {
        refuse('You can view this drawing but not edit it.');
        return;
      }
    }
    lastCommand = resolved;
    if (resolved === 'LAYER') {
      ctx.openLayers();
      setPrompt(READY_PROMPT);
      return;
    }
    if (resolved === 'FIND') {
      ctx.openFind();
      setPrompt(READY_PROMPT);
      return;
    }
    if (resolved === 'ZOOMALL') {
      ctx.zoomAll();
      setPrompt(READY_PROMPT);
      return;
    }
    if (resolved === 'PURGE') {
      endRun();
      void send({ ops: [{ op_id: nextId(), type: 'purge' }], command: 'PURGE' });
      return;
    }
    if (resolved === 'ERASE' && store.selection.size > 0) {
      const handles = [...store.selection];
      store.selection.clear();
      void send({
        ops: [{ op_id: nextId(), type: 'delete', handles }],
        command: 'ERASE',
        announcement: announce.erased(handles.length),
      });
      setPrompt(READY_PROMPT);
      return;
    }
    run = { command: resolved, values: [] };
    closed = false;
    pending = [];
    showStage();
    ctx.focusCommand();
  };

  const stepBack = (): void => {
    if (!run) return;
    for (let index = run.values.length - 1; index >= 0; index -= 1) {
      if (run.values[index].type === 'point') {
        run.values.splice(index, 1);
        break;
      }
    }
    showStage();
    ctx.render();
  };

  const submitText = (text: string, viaSpace: boolean): void => {
    const raw = text.trim();
    if (!run) {
      if (raw === '') {
        if (lastCommand) start(lastCommand);
        return;
      }
      start(raw);
      return;
    }
    const slot = currentSlot();
    if (!slot) {
      finish();
      return;
    }
    if (viaSpace && TEXT_STAGES.includes(slot.prompt) && raw !== '') return;
    if (raw.toUpperCase() === 'U' && slot.type === 'point') {
      stepBack();
      return;
    }
    if (raw === '') {
      if (slot.type === 'picks') {
        pushValue({ type: 'picks', picks: [...pending] });
        return;
      }
      if (slot.type === 'text' && run.command === 'PARAM' && run.values.length === 0) {
        endRun();
        ctx.openParameters();
        setPrompt(READY_PROMPT);
        return;
      }
      if (slot.fallback !== undefined) {
        pushValue(
          typeof slot.fallback === 'number'
            ? { type: 'number', value: slot.fallback }
            : { type: 'text', text: String(slot.fallback) },
        );
        return;
      }
      if (slot.endsCommand) {
        finish();
        return;
      }
      return;
    }
    switch (slot.type) {
      case 'point': {
        if (raw.toUpperCase() === 'CL' && (run.command === 'LINE' || run.command === 'PLINE')) {
          if (pointsOf(run).length >= 3) {
            closed = true;
            finish();
            return;
          }
          refuse(REFUSALS.notAPoint);
          return;
        }
        const point = parsePoint(raw, store.lastPoint);
        if (!point) {
          refuse(REFUSALS.notAPoint);
          return;
        }
        pushValue({ type: 'point', point });
        return;
      }
      case 'number': {
        const value = parseNumber(raw);
        if (value === null) {
          if (run.command === 'CIRCLE') {
            const point = parsePoint(raw, store.lastPoint);
            if (point) {
              pushValue({ type: 'point', point });
              return;
            }
          }
          refuse(REFUSALS.notANumber);
          return;
        }
        if (slot.positive && value <= 0) {
          refuse(REFUSALS.notPositive);
          return;
        }
        pushValue({ type: 'number', value });
        return;
      }
      case 'pick':
      case 'picks': {
        const entity = findEntity(store.model, raw);
        if (entity) {
          acceptPickValue(entity.handle, pickPointFor(entity));
          return;
        }
        const point = parsePoint(raw, store.lastPoint);
        if (!point) {
          refuse(REFUSALS.nothingToPick);
          return;
        }
        const found = pickAt(point);
        if (!found) {
          refuse(REFUSALS.nothingToPick);
          return;
        }
        acceptPickValue(found.handle, point);
        return;
      }
      case 'yesno':
        pushValue({ type: 'text', text: raw.toUpperCase() });
        return;
      case 'text':
        pushValue({ type: 'text', text: text.trim() });
        return;
    }
  };

  const enterPoint = (point: Vec): void => {
    if (!run) return;
    const slot = currentSlot();
    if (!slot) return;
    if (slot.type === 'point') {
      pushValue({ type: 'point', point });
      return;
    }
    if (slot.type === 'pick' || slot.type === 'picks') {
      const found = pickAt(point);
      if (!found) {
        refuse(REFUSALS.nothingToPick);
        return;
      }
      acceptPickValue(found.handle, point);
    }
  };

  const escape = (): void => {
    endRun();
    setPrompt(CANCELLED_PROMPT);
    ctx.render();
    ctx.focusCommand();
  };

  return {
    prompt: () => promptText,
    running: () => run !== null,
    slot: currentSlot,
    run: () => run,
    submitText,
    enterPoint,
    escape,
    stepBack,
    start,
    previewFrom: () => {
      if (!run) return null;
      const points = pointsOf(run);
      return points.length > 0 ? points[points.length - 1] : null;
    },
  };
}
