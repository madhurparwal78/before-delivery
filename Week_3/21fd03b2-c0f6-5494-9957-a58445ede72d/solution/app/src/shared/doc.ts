import { canonicalJson, compareIds } from "./canonical";
import { COPY } from "./copy";
import {
  GRAVITY_DEF,
  ID_PATTERN,
  KIND_LABEL,
  defaultParams,
  inRange,
  isRigKind,
  paramDefs,
  rangeError,
  transformValid,
  validName,
  type ObjectKind,
  type RigKind,
  type Vec3,
  type Vec4,
} from "./params";

export interface SceneObject {
  assetId: string | null;
  id: string;
  kind: ObjectKind;
  name: string;
  params: Record<string, number>;
  position: Vec3;
  rotation: Vec4;
  scale: Vec3;
}

export interface SceneDocument {
  gravity: number;
  name: string;
  objects: SceneObject[];
  solver: { iterations: 4; step: "1/120" };
}

export type Op =
  | { op: "add"; object: SceneObject }
  | { op: "set"; objectId: string; fence: number; field: string; value: unknown }
  | { op: "remove"; objectId: string; fence: number }
  | { op: "scene"; field: "name" | "gravity"; value: unknown };

export type Template = "blank" | RigKind;
export const TEMPLATES: readonly Template[] = ["blank", "ramp", "pendulum", "launcher"];
export const SOLVER = { iterations: 4, step: "1/120" } as const;
const IDENTITY_ROTATION: Vec4 = [0, 0, 0, 1];

export function canonicalDocument(doc: SceneDocument): string {
  const objects = [...doc.objects].sort((a, b) => compareIds(a.id, b.id));
  return canonicalJson({ ...doc, objects });
}

export function newObject(kind: RigKind, id: string, name: string, position: Vec3 = [0, 0, 0]): SceneObject {
  return { assetId: null, id, kind, name, params: defaultParams(kind), position, rotation: [...IDENTITY_ROTATION], scale: [1, 1, 1] };
}

export function templateDocument(template: Template, name: string): SceneDocument {
  const objects = template === "blank" ? [] : [newObject(template, `${template}-1`, `${KIND_LABEL[template]} 1`)];
  return { gravity: GRAVITY_DEF.default, name, objects, solver: { ...SOLVER } };
}

/** Every field key a revision can change on an object: name, transform and each parameter. */
function objectFieldKeys(object: Pick<SceneObject, "id" | "params">): string[] {
  return [`${object.id}.name`, `${object.id}.position`, `${object.id}.rotation`, `${object.id}.scale`, ...Object.keys(object.params).map((key) => `${object.id}.params.${key}`)];
}

export function nextName(objects: readonly SceneObject[], base: string): string {
  const taken = new Set(objects.map((o) => o.name));
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

export function findObject(doc: SceneDocument, id: string): SceneObject | undefined {
  return doc.objects.find((o) => o.id === id);
}

/** Field keys a PATCH sets or removes, judged against the current revision (adds never conflict). */
export function touchedKeys(doc: SceneDocument, ops: readonly Op[]): string[] {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.op === "set") keys.add(`${op.objectId}.${op.field}`);
    else if (op.op === "scene") keys.add(`scene.${op.field}`);
    else if (op.op === "remove") {
      const existing = findObject(doc, op.objectId);
      if (existing) objectFieldKeys(existing).forEach((k) => keys.add(k));
    }
  }
  return [...keys];
}

/** Every key a PATCH sets, removes or adds, for the restore barrier. */
export function allOpKeys(doc: SceneDocument, ops: readonly Op[]): string[] {
  const keys = new Set(touchedKeys(doc, ops));
  for (const op of ops) if (op.op === "add") objectFieldKeys(op.object).forEach((k) => keys.add(k));
  return [...keys];
}

/** The keys one PATCH changes, as stored on its revision, and the ids it removed. */
export function changedKeys(before: SceneDocument, ops: readonly Op[]): { keys: string[]; removed: string[] } {
  const keys = new Set<string>();
  const removed: string[] = [];
  for (const op of ops) {
    if (op.op === "set") keys.add(`${op.objectId}.${op.field}`);
    else if (op.op === "scene") keys.add(`scene.${op.field}`);
    else if (op.op === "add") objectFieldKeys(op.object).forEach((k) => keys.add(k));
    else {
      const existing = findObject(before, op.objectId);
      if (existing) objectFieldKeys(existing).forEach((k) => keys.add(k));
      removed.push(op.objectId);
    }
  }
  return { keys: [...keys], removed };
}

export type FieldErrors = Record<string, string>;

function validateParam(kind: ObjectKind, key: string, value: unknown): string | null {
  const def = paramDefs(kind).find((d) => d.key === key);
  if (!def) return "unknown";
  return typeof value === "number" && inRange(value, def) ? null : rangeError(def);
}

/** Validates the value of one `set` field; returns the field-error copy or null. */
export function validateSetValue(object: SceneObject, field: string, value: unknown): string | null {
  if (field === "name") return validName(value) ? null : COPY.names;
  if (field === "position" || field === "rotation" || field === "scale") return transformValid(field, value) ? null : COPY.transform;
  if (field.startsWith("params.")) return validateParam(object.kind, field.slice(7), value);
  return "unknown";
}

export function validateSceneValue(field: string, value: unknown): string | null {
  if (field === "name") return validName(value) ? null : COPY.names;
  if (field === "gravity") return typeof value === "number" && inRange(value, GRAVITY_DEF) ? null : rangeError(GRAVITY_DEF);
  return "unknown";
}

/** Validates an object being added. `modelAsset` says whether the asset id is a model asset of the project. */
export function validateNewObject(object: SceneObject, taken: ReadonlySet<string>, modelAsset: (id: string) => boolean): FieldErrors {
  const errors: FieldErrors = {};
  const key = typeof object?.id === "string" ? object.id : "object";
  if (typeof object?.id !== "string" || !ID_PATTERN.test(object.id) || taken.has(object.id)) errors[`${key}.id`] = "Use a new id of 1 to 40 lowercase letters, digits and hyphens.";
  if (!validName(object?.name)) errors[`${key}.name`] = COPY.names;
  for (const field of ["position", "rotation", "scale"] as const) if (!transformValid(field, object?.[field])) errors[`${key}.${field}`] = COPY.transform;
  const kind = object?.kind;
  if (kind !== "model" && !(typeof kind === "string" && isRigKind(kind))) {
    errors[`${key}.kind`] = "Use ramp, pendulum, launcher, crate or model.";
    return errors;
  }
  const params = object.params ?? {};
  if (kind === "model") {
    if (typeof object.assetId !== "string" || !modelAsset(object.assetId)) errors[`${key}.assetId`] = "Use a model asset of this project.";
    if (Object.keys(params).length > 0) errors[`${key}.params`] = "Models have no parameters.";
  } else {
    if (object.assetId !== null) errors[`${key}.assetId`] = "Only models name an asset.";
    const defs = paramDefs(kind);
    if (Object.keys(params).length !== defs.length) errors[`${key}.params`] = "Give every parameter of this kind.";
    for (const def of defs) {
      const error = validateParam(kind, def.key, params[def.key]);
      if (error) errors[`${key}.params.${def.key}`] = error === "unknown" ? "Give every parameter of this kind." : error;
    }
  }
  return errors;
}

/** Applies one op to a document without validating it (callers validate first). */
export function applyOp(doc: SceneDocument, op: Op): SceneDocument {
  switch (op.op) {
    case "add":
      return doc.objects.some((o) => o.id === op.object.id) ? doc : { ...doc, objects: [...doc.objects, op.object] };
    case "remove":
      return { ...doc, objects: doc.objects.filter((o) => o.id !== op.objectId) };
    case "scene":
      return op.field === "name" ? { ...doc, name: op.value as string } : { ...doc, gravity: op.value as number };
    case "set":
      return {
        ...doc,
        objects: doc.objects.map((o) => {
          if (o.id !== op.objectId) return o;
          if (op.field.startsWith("params.")) return { ...o, params: { ...o.params, [op.field.slice(7)]: op.value as number } };
          return { ...o, [op.field]: op.value };
        }),
      };
  }
}

export function applyOps(doc: SceneDocument, ops: readonly Op[]): SceneDocument {
  return ops.reduce(applyOp, doc);
}
