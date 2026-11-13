import { canonicalJson, type Json } from './canonical.js';
import { fieldCopy } from './copy.js';
import { roundToMillionth } from './dmath.js';
import {
  GRAVITY_SPEC,
  POSITION_LIMIT,
  SCALE_MAX,
  SCALE_MIN,
  defaultParams,
  findSpec,
  inRange,
  rangeMessage,
  specsFor,
  type ObjectKind,
  type RigKind,
} from './params.js';
import { sha256HexOfText } from './sha256.js';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface SceneObject {
  assetId: string | null;
  id: string;
  kind: ObjectKind;
  name: string;
  params: Record<string, number>;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export interface SceneDocument {
  gravity: number;
  name: string;
  objects: SceneObject[];
  solver: { iterations: 4; step: '1/120' };
}

export const SOLVER = { iterations: 4, step: '1/120' } as const;
export const SCENE_TEMPLATES = ['blank', 'ramp', 'pendulum', 'launcher'] as const;
export type SceneTemplate = (typeof SCENE_TEMPLATES)[number];

export const OBJECT_KINDS: readonly ObjectKind[] = ['ramp', 'pendulum', 'launcher', 'crate', 'model'];
export const RIG_KINDS: readonly RigKind[] = ['ramp', 'pendulum', 'launcher', 'crate'];

export const RIG_LABELS: Record<RigKind, string> = {
  ramp: 'Ramp',
  pendulum: 'Pendulum',
  launcher: 'Launcher',
  crate: 'Crate',
};

export function makeObject(
  id: string,
  kind: ObjectKind,
  name: string,
  overrides: Partial<Pick<SceneObject, 'assetId' | 'params' | 'position' | 'rotation' | 'scale'>> = {},
): SceneObject {
  return {
    assetId: overrides.assetId ?? null,
    id,
    kind,
    name,
    params: overrides.params ?? defaultParams(kind),
    position: overrides.position ?? [0, 0, 0],
    rotation: overrides.rotation ?? [0, 0, 0, 1],
    scale: overrides.scale ?? [1, 1, 1],
  };
}

export function templateDocument(name: string, template: SceneTemplate): SceneDocument {
  const objects: SceneObject[] = [];
  if (template !== 'blank') {
    const index = 1;
    objects.push(
      makeObject(`${template}-${index}`, template, `${RIG_LABELS[template]} ${index}`),
    );
  }
  return { gravity: GRAVITY_SPEC.def, name, objects, solver: SOLVER };
}

export function sortObjects(objects: SceneObject[]): SceneObject[] {
  return [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function documentToJson(document: SceneDocument): Json {
  return {
    gravity: document.gravity,
    name: document.name,
    objects: sortObjects(document.objects).map((object) => ({
      assetId: object.assetId,
      id: object.id,
      kind: object.kind,
      name: object.name,
      params: { ...object.params } as Record<string, Json>,
      position: [...object.position],
      rotation: [...object.rotation],
      scale: [...object.scale],
    })),
    solver: { iterations: SOLVER.iterations, step: SOLVER.step },
  } as Json;
}

export function canonicalDocument(document: SceneDocument): string {
  return canonicalJson(documentToJson(document));
}

export function documentSha256(document: SceneDocument): string {
  return sha256HexOfText(canonicalDocument(document));
}

export function cloneDocument(document: SceneDocument): SceneDocument {
  return JSON.parse(JSON.stringify(document)) as SceneDocument;
}

export function parseDocument(text: string): SceneDocument {
  return JSON.parse(text) as SceneDocument;
}

/* ---------------------------------------------------------------- ops ---- */

export type SetField = 'name' | 'position' | 'rotation' | 'scale' | `params.${string}`;

export type Op =
  | { op: 'add'; object: SceneObject }
  | { op: 'set'; objectId: string; fence: number; field: SetField; value: Json }
  | { op: 'remove'; objectId: string; fence: number }
  | { op: 'scene'; field: 'name' | 'gravity'; value: Json };

export function objectFieldKeys(object: SceneObject): string[] {
  const keys = [
    `${object.id}.name`,
    `${object.id}.position`,
    `${object.id}.rotation`,
    `${object.id}.scale`,
  ];
  for (const key of Object.keys(object.params)) keys.push(`${object.id}.params.${key}`);
  return keys;
}

/** The field keys a list of ops sets, removes or adds. */
export function keysTouchedByOps(ops: readonly Op[], before: SceneDocument): string[] {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.op === 'scene') keys.add(`scene.${op.field}`);
    else if (op.op === 'set') keys.add(`${op.objectId}.${op.field}`);
    else if (op.op === 'add') for (const key of objectFieldKeys(op.object)) keys.add(key);
    else {
      const existing = before.objects.find((object) => object.id === op.objectId);
      const target =
        existing ?? makeObject(op.objectId, 'crate', op.objectId, { params: {} });
      for (const key of objectFieldKeys(target)) keys.add(key);
    }
  }
  return [...keys];
}

/** The field keys a revision's ops changed, used for the conflict comparison. */
export function keysChangedByRevision(ops: readonly Op[], documentAfter: SceneDocument): string[] {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.op === 'scene') keys.add(`scene.${op.field}`);
    else if (op.op === 'set') keys.add(`${op.objectId}.${op.field}`);
    else if (op.op === 'add') for (const key of objectFieldKeys(op.object)) keys.add(key);
    else {
      const sample =
        documentAfter.objects.find((object) => object.id === op.objectId) ??
        makeObject(op.objectId, 'crate', op.objectId, { params: {} });
      for (const key of objectFieldKeys(sample)) keys.add(key);
      keys.add(`${op.objectId}.name`);
    }
  }
  return [...keys];
}

export type ApplyFailure =
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'missing_object'; objectId: string };

export type ApplyResult =
  | { ok: true; document: SceneDocument }
  | { ok: false; failure: ApplyFailure };

const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

function validName(name: unknown): name is string {
  return typeof name === 'string' && [...name].length >= 1 && [...name].length <= 60;
}

function validVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

function validQuat(value: unknown): value is Quat {
  if (!Array.isArray(value) || value.length !== 4) return false;
  if (!value.every((part) => typeof part === 'number' && Number.isFinite(part))) return false;
  const [x, y, z, w] = value as Quat;
  const norm = Math.sqrt(x * x + y * y + z * z + w * w);
  return Math.abs(norm - 1) <= 1e-6;
}

function positionInBounds(position: Vec3): boolean {
  return position.every((part) => Math.abs(part) <= POSITION_LIMIT);
}

function scaleInBounds(scale: Vec3): boolean {
  return scale.every((part) => part >= SCALE_MIN && part <= SCALE_MAX);
}

function roundVec3(value: Vec3): Vec3 {
  return [roundToMillionth(value[0]), roundToMillionth(value[1]), roundToMillionth(value[2])];
}

/** Applies every op or none, validating each one against the domain rules. */
export function applyOps(document: SceneDocument, ops: readonly Op[]): ApplyResult {
  const next = cloneDocument(document);
  const fields: Record<string, string> = {};

  for (const op of ops) {
    if (op.op === 'scene') {
      if (op.field === 'name') {
        if (!validName(op.value)) fields['scene.name'] = fieldCopy.name;
        else next.name = op.value;
      } else if (typeof op.value !== 'number' || !inRange(GRAVITY_SPEC, op.value)) {
        fields['scene.gravity'] = rangeMessage(GRAVITY_SPEC);
      } else {
        next.gravity = op.value;
      }
      continue;
    }

    if (op.op === 'add') {
      const object = op.object;
      if (!ID_PATTERN.test(object.id) || next.objects.some((other) => other.id === object.id)) {
        fields[`${object.id}.id`] = fieldCopy.name;
        continue;
      }
      if (!validName(object.name)) {
        fields[`${object.id}.name`] = fieldCopy.name;
        continue;
      }
      if (!OBJECT_KINDS.includes(object.kind)) {
        fields[`${object.id}.kind`] = fieldCopy.name;
        continue;
      }
      if (!validVec3(object.position) || !positionInBounds(object.position)) {
        fields[`${object.id}.position`] = fieldCopy.transform;
        continue;
      }
      if (!validVec3(object.scale) || !scaleInBounds(object.scale)) {
        fields[`${object.id}.scale`] = fieldCopy.transform;
        continue;
      }
      if (!validQuat(object.rotation)) {
        fields[`${object.id}.rotation`] = fieldCopy.transform;
        continue;
      }
      const params: Record<string, number> = {};
      let paramsOk = true;
      for (const spec of specsFor(object.kind)) {
        const value = object.params[spec.key];
        if (typeof value !== 'number' || !inRange(spec, value)) {
          fields[`${object.id}.params.${spec.key}`] = rangeMessage(spec);
          paramsOk = false;
        } else {
          params[spec.key] = value;
        }
      }
      if (!paramsOk) continue;
      next.objects.push({
        assetId: object.kind === 'model' ? object.assetId : null,
        id: object.id,
        kind: object.kind,
        name: object.name,
        params,
        position: roundVec3(object.position),
        rotation: object.rotation,
        scale: roundVec3(object.scale),
      });
      continue;
    }

    const index = next.objects.findIndex((object) => object.id === op.objectId);
    if (index < 0) return { ok: false, failure: { kind: 'missing_object', objectId: op.objectId } };

    if (op.op === 'remove') {
      next.objects.splice(index, 1);
      continue;
    }

    const target = next.objects[index];
    if (op.field === 'name') {
      if (!validName(op.value)) fields[`${target.id}.name`] = fieldCopy.name;
      else target.name = op.value;
    } else if (op.field === 'position') {
      if (!validVec3(op.value) || !positionInBounds(op.value))
        fields[`${target.id}.position`] = fieldCopy.transform;
      else target.position = roundVec3(op.value);
    } else if (op.field === 'rotation') {
      if (!validQuat(op.value)) fields[`${target.id}.rotation`] = fieldCopy.transform;
      else target.rotation = op.value;
    } else if (op.field === 'scale') {
      if (!validVec3(op.value) || !scaleInBounds(op.value))
        fields[`${target.id}.scale`] = fieldCopy.transform;
      else target.scale = roundVec3(op.value);
    } else {
      const paramKey = op.field.slice('params.'.length);
      const spec = findSpec(target.kind, paramKey);
      if (!spec) {
        fields[`${target.id}.params.${paramKey}`] = fieldCopy.name;
      } else if (typeof op.value !== 'number' || !inRange(spec, op.value)) {
        fields[`${target.id}.params.${paramKey}`] = rangeMessage(spec);
      } else {
        target.params[paramKey] = op.value;
      }
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, failure: { kind: 'validation', fields } };
  next.objects = sortObjects(next.objects);
  return { ok: true, document: next };
}

/** `Ramp 2`, `Crate 3`, and so on: the next free name of that kind. */
export function nextObjectName(document: SceneDocument, kind: RigKind): string {
  const label = RIG_LABELS[kind];
  const used = new Set(document.objects.map((object) => object.name));
  let index = 1;
  while (used.has(`${label} ${index}`)) index += 1;
  return `${label} ${index}`;
}

export function nextObjectId(document: SceneDocument, kind: ObjectKind, suffix: string): string {
  let candidate = `${kind}-${suffix}`;
  let counter = 1;
  while (document.objects.some((object) => object.id === candidate)) {
    candidate = `${kind}-${suffix}${counter}`;
    counter += 1;
  }
  return candidate;
}
