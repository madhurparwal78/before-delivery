import { copy } from "../shared/copy.js";
import { round } from "../shared/format.js";
import type { Point } from "../shared/types.js";
import { bad, validation } from "./errors.js";
import { db } from "./db.js";
import { publishDrawingChange } from "./live.js";
import type { DrawingSnapshot, StoredObject } from "./command-state.js";
import { HandleAllocator,
  handlesArg,
  newOutcome,
  numberArg,
  pointArg,
  pointsArg,
  positiveArg,
} from "./command-state.js";
import { translateObject, rotateObject, scaleObject, mirrorObject, offsetObject } from "./domain/transforms.js";
import { trimObject, extendObject, filletLines, dimensionMeasure } from "./domain/edits.js";
import { distance } from "../shared/format.js";

export interface CommandOutcome {
  created: StoredObject[];
  modified: StoredObject[];
  erased: string[];
  locked: string[];
  history: string | null;
  announcement: string | null;
  layerChanged: boolean;
  layoutChanged: boolean;
  xrefChanged: boolean;
  modelChanged: { units?: "mm" | "m"; plot_style?: string } | null;
  /** UNDO and REDO restore stored state; the change is not in the object lists. */
  restored?: boolean;
}

export function freshOutcome(): CommandOutcome {
  return {
    created: [],
    modified: [],
    erased: [],
    locked: [],
    history: null,
    announcement: null,
    layerChanged: false,
    layoutChanged: false,
    xrefChanged: false,
    modelChanged: null,
  };
}

interface SnapshotObject extends StoredObject {
  props: Record<string, unknown>;
}

interface LayerRow {
  name: string;
  color: string;
  linetype: string;
  lineweight: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  position: number;
}

const layerNamePattern = /^[\w $-]{1,64}$/;

export function validLayerName(name: string): boolean {
  return layerNamePattern.test(name) && name.trim().length >= 1;
}

export interface CommandEnv {
  snapshot: DrawingSnapshot;
  outcome: CommandOutcome;
  currentLayer: string;
  lockedLayers: Set<string>;
  allocator: HandleAllocator;
}

export function makeEnv(snapshot: DrawingSnapshot): CommandEnv {
  const allocator = new HandleAllocator(snapshot.drawing.max_handle_used, snapshot.drawing.next_handle);
  const locked = new Set(snapshot.layers.filter((l) => l.locked).map((l) => l.name));
  const current = snapshot.layers.find((l) => l.current)?.name ?? "0";
  return { snapshot, outcome: freshOutcome(), currentLayer: current, lockedLayers: locked, allocator };
}

function objectByHandle(env: CommandEnv, handle: string): StoredObject | undefined {
  return env.snapshot.objects.find((o) => o.handle === handle);
}

function create(env: CommandEnv, type: string, geometry: Record<string, unknown>, layer: string): StoredObject {
  const handle = env.allocator.alloc();
  const obj: StoredObject = { handle, type, layer, geometry };
  env.outcome.created.push(obj);
  return obj;
}

function modify(env: CommandEnv, obj: StoredObject, geometry: Record<string, unknown>): void {
  env.outcome.modified.push({ ...obj, geometry });
}

function erase(env: CommandEnv, obj: StoredObject): void {
  env.outcome.erased.push(obj.handle);
}

/** Objects on locked layers are left out; the command says so. */
function guardLocked(env: CommandEnv, obj: StoredObject): boolean {
  if (env.lockedLayers.has(obj.layer)) {
    env.outcome.locked.push(obj.handle);
    return true;
  }
  return false;
}

function requireObjects(env: CommandEnv, handles: string[]): StoredObject[] {
  const found = handles
    .map((h) => objectByHandle(env, h))
    .filter((o): o is StoredObject => o !== undefined);
  if (found.length === 0) throw validation({ handles: "No object found." });
  return found;
}

export function applyCommand(env: CommandEnv, command: string, args: Record<string, unknown>): void {
  const { outcome, snapshot, currentLayer } = env;
  switch (command) {
    case "LINE": {
      const points = pointsArg(args.points, "points");
      const seq = args.close === true ? [...points, points[0]] : points;
      if (seq.length < 2) throw validation({ args: "Invalid point." });
      for (let i = 0; i + 1 < seq.length; i++) {
        create(env, "line", { start: seq[i], end: seq[i + 1] }, currentLayer);
      }
      break;
    }
    case "PLINE": {
      const points = pointsArg(args.points, "points");
      if (points.length < 2) throw validation({ args: "Invalid point." });
      create(env, "polyline", { vertices: points, closed: args.closed === true }, currentLayer);
      break;
    }
    case "RECTANG": {
      const first = pointArg(args.first, "first");
      const other = pointArg(args.other, "other");
      const vertices: Point[] = [first, [other[0], first[1]], other, [first[0], other[1]]];
      create(env, "polyline", { vertices, closed: true }, currentLayer);
      break;
    }
    case "CIRCLE": {
      const center = pointArg(args.center, "center");
      const radius = positiveArg(args.radius, "radius");
      create(env, "circle", { center, radius }, currentLayer);
      break;
    }
    case "ARC": {
      const center = pointArg(args.center, "center");
      const radius = positiveArg(args.radius, "radius");
      const startAngle = numberArg(args.start_angle, "start_angle");
      const endAngle = numberArg(args.end_angle, "end_angle");
      create(env, "arc", { center, radius, start_angle: startAngle, end_angle: endAngle }, currentLayer);
      break;
    }
    case "POLYGON": {
      const center = pointArg(args.center, "center");
      const sides = Math.round(positiveArg(args.sides, "sides"));
      if (sides < 3) throw validation({ sides: "Requires a positive number." });
      const radius = positiveArg(args.radius, "radius");
      const vertices: Point[] = [];
      for (let i = 0; i < sides; i++) {
        const rad = (i * 360) / sides * (Math.PI / 180);
        vertices.push([round(center[0] + radius * Math.cos(rad), 6), round(center[1] + radius * Math.sin(rad), 6)]);
      }
      create(env, "polyline", { vertices, closed: true }, currentLayer);
      break;
    }
    case "SPLINE": {
      const points = pointsArg(args.fit_points, "fit_points");
      if (points.length < 2) throw validation({ args: "Invalid point." });
      create(env, "spline", { fit_points: points }, currentLayer);
      break;
    }
    case "MTEXT": {
      const position = pointArg(args.position, "position");
      const width = positiveArg(args.width, "width");
      const height = positiveArg(args.height, "height");
      if (typeof args.contents !== "string" || args.contents.trim() === "") throw validation({ contents: "Enter text." });
      create(env, "mtext", { position, width, height, contents: args.contents }, currentLayer);
      break;
    }
    case "INSERT": {
      const position = pointArg(args.position, "position");
      const scale = positiveArg(args.scale, "scale");
      const rotation = numberArg(args.rotation, "rotation");
      if (typeof args.block !== "string" || args.block === "") throw validation({ block: "Choose a block." });
      create(env, "insert", { block: args.block, position, scale, rotation }, currentLayer);
      break;
    }
    case "DIMLINEAR":
    case "DIMALIGNED":
    case "DIMRADIUS":
    case "DIMANGULAR": {
      const dim = dimensionMeasure(command, args, env.snapshot.objects);
      const kindMap: Record<string, string> = {
        DIMLINEAR: "linear",
        DIMALIGNED: "aligned",
        DIMRADIUS: "radius",
        DIMANGULAR: "angular",
      };
      if (command === "DIMRADIUS" || command === "DIMANGULAR") {
        const needed = command === "DIMRADIUS" ? args.handle : args.first_handle;
        if (typeof needed !== "string" || !objectByHandle(env, needed)) throw validation({ handles: "No object found." });
      }
      create(env, "dimension", {
        kind: kindMap[command],
        points: dim.points,
        location: dim.location,
        measurement: dim.measurement,
        text_override: null,
      }, currentLayer);
      break;
    }
    case "MOVE":
    case "COPY": {
      const objects = requireObjects(env, handlesArg(args));
      const from = pointArg(args.from, "from");
      const to = pointArg(args.to, "to");
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      for (const obj of objects) {
        if (guardLocked(env, obj)) continue;
        const geometry = translateObject(obj, dx, dy);
        if (command === "COPY") create(env, obj.type, geometry, obj.layer);
        else modify(env, obj, geometry);
      }
      break;
    }
    case "ROTATE": {
      const objects = requireObjects(env, handlesArg(args));
      const base = pointArg(args.base, "base");
      const angle = numberArg(args.angle, "angle");
      for (const obj of objects) {
        if (guardLocked(env, obj)) continue;
        modify(env, obj, rotateObject(obj, base, angle));
      }
      break;
    }
    case "SCALE": {
      const objects = requireObjects(env, handlesArg(args));
      const base = pointArg(args.base, "base");
      const factor = positiveArg(args.factor, "factor");
      for (const obj of objects) {
        if (guardLocked(env, obj)) continue;
        modify(env, obj, scaleObject(obj, base, factor));
      }
      break;
    }
    case "MIRROR": {
      const objects = requireObjects(env, handlesArg(args));
      const first = pointArg(args.first, "first");
      const second = pointArg(args.second, "second");
      const eraseSource = args.erase_source !== false;
      for (const obj of objects) {
        if (guardLocked(env, obj)) continue;
        const geometry = mirrorObject(obj, first, second);
        create(env, obj.type, geometry, obj.layer);
        if (eraseSource) erase(env, obj);
        else modify(env, obj, geometry);
      }
      break;
    }
    case "ERASE": {
      const objects = requireObjects(env, handlesArg(args));
      for (const obj of objects) {
        if (guardLocked(env, obj)) continue;
        erase(env, obj);
      }
      break;
    }
    case "OFFSET": {
      const handle = args.handle;
      if (typeof handle !== "string") throw validation({ handles: "No object found." });
      const obj = objectByHandle(env, handle);
      if (!obj) throw validation({ handles: "No object found." });
      if (guardLocked(env, obj)) break;
      const dist = positiveArg(args.distance, "distance");
      const side = pointArg(args.side, "side");
      const geometry = offsetObject(obj, dist, side);
      if (!geometry) throw validation({ args: "No object found." });
      create(env, obj.type, geometry, obj.layer);
      break;
    }
    case "TRIM": {
      const handle = args.handle;
      if (typeof handle !== "string") throw validation({ handles: "No object found." });
      const obj = objectByHandle(env, handle);
      if (!obj) throw validation({ handles: "No object found." });
      if (guardLocked(env, obj)) break;
      const pick = pointArg(args.pick, "pick");
      const result = trimObject(obj, pick, env.snapshot.objects);
      if (result.kind === "none") {
        outcome.history = copy.noCuttingEdge;
        break;
      }
      if (result.kind === "split" && result.extra) {
        modify(env, obj, result.kept!);
        create(env, obj.type, result.extra, obj.layer);
      } else if (result.kept) {
        modify(env, obj, result.kept);
      }
      break;
    }
    case "EXTEND": {
      const handle = args.handle;
      if (typeof handle !== "string") throw validation({ handles: "No object found." });
      const obj = objectByHandle(env, handle);
      if (!obj) throw validation({ handles: "No object found." });
      if (guardLocked(env, obj)) break;
      const pick = pointArg(args.pick, "pick");
      const others = env.snapshot.objects.filter((o) => o.handle !== obj.handle);
      const result = extendObject(obj, pick, others);
      if (!result.geometry) {
        outcome.history = copy.noCuttingEdge;
        break;
      }
      modify(env, obj, result.geometry);
      break;
    }
    case "FILLET": {
      const handles = handlesArg(args);
      if (handles.length !== 2) throw validation({ handles: "Select two objects." });
      const radius = numberArg(args.radius, "radius");
      if (radius !== 0) throw validation({ radius: "Requires a positive number." });
      const a = objectByHandle(env, handles[0]);
      const b = objectByHandle(env, handles[1]);
      if (!a || !b) throw validation({ handles: "No object found." });
      if (guardLocked(env, a) || guardLocked(env, b)) break;
      const result = filletLines(a, b);
      if (!result.a || !result.b) {
        outcome.history = copy.noCuttingEdge;
        break;
      }
      modify(env, a, result.a);
      modify(env, b, result.b);
      break;
    }
    case "PROPERTIES": {
      applyProperties(env, args);
      break;
    }
    default:
      throw validation({ command: "Unknown command." });
  }
  if (outcome.locked.length > 0) {
    outcome.history = copy.lockedOut(outcome.locked.length);
  }
}

const propertyFields = [
  "layer",
  "color",
  "linetype",
  "linetype_scale",
  "lineweight",
  "dimension_style",
  "text_style",
  "multileader_style",
];

const propertyGeometryFields = [
  "start",
  "end",
  "center",
  "radius",
  "vertices",
  "position",
  "width",
  "height",
  "contents",
  "scale",
  "rotation",
  "text_override",
  "first",
  "opposite",
  "closed",
];

function applyProperties(env: CommandEnv, args: Record<string, unknown>): void {
  if (args.model) {
    const model = args.model as Record<string, unknown>;
    if (model.units !== undefined && model.units !== "mm" && model.units !== "m") throw validation({ units: "Choose a unit." });
    if (
      model.plot_style !== undefined &&
      !["Monochrome", "Color", "Grayscale"].includes(model.plot_style as string)
    ) {
      throw validation({ plot_style: "Choose a plot style." });
    }
    env.outcome.modelChanged = {
      ...(model.units !== undefined ? { units: model.units as "mm" | "m" } : {}),
      ...(model.plot_style !== undefined ? { plot_style: model.plot_style as string } : {}),
    };
    return;
  }
  const handles = handlesArg(args);
  const set = args.set;
  if (!set || typeof set !== "object") throw validation({ args: "Nothing to set." });
  const entries = Object.entries(set as Record<string, unknown>);
  if (entries.length === 0) throw validation({ args: "Nothing to set." });
  const objects = requireObjects(env, handles) as SnapshotObject[];
  const layerNames = new Set(env.snapshot.layers.map((l) => l.name));
  for (const obj of objects) {
    if (guardLocked(env, obj)) continue;
    const geometry: Record<string, unknown> = { ...obj.geometry };
    const props: Record<string, unknown> = { ...(obj.props ?? defaultPropsRecord()) };
    for (const [field, value] of entries) {
      if (field === "layer") {
        if (typeof value !== "string" || !layerNames.has(value)) throw validation({ layer: "No layer." });
        geometry.layer = value;
      } else if (propertyFields.includes(field)) {
        props[field] = value;
      } else if (propertyGeometryFields.includes(field)) {
        geometry[field] = value;
      } else {
        throw validation({ [field]: "Enter a number." });
      }
    }
    env.outcome.modified.push({ handle: obj.handle, type: obj.type, layer: geometry.layer as string, geometry, props } as unknown as StoredObject);
  }
}

export interface LayerOpOutcome {
  layerChanged: boolean;
  layersAfter: DrawingSnapshot["layers"] | null;
  announcement: string | null;
  errorCode?: string;
}

/** LAYER command: new, rename, set, current, delete. */
export function applyLayerOp(
  layers: LayerRow[],
  op: string,
  args: Record<string, unknown>,
  objectCountByLayer: Map<string, number>,
): LayerOpOutcome {
  const outcome: LayerOpOutcome = { layerChanged: true, layersAfter: null, announcement: null };
  const find = (name: string): LayerRow | undefined => layers.find((l) => l.name.toLowerCase() === name.toLowerCase());
  switch (op) {
    case "new": {
      const taken = new Set(layers.map((l) => l.name.toLowerCase()));
      let n = 1;
      while (taken.has(`layer${n}`)) n += 1;
      const name = `Layer${n}`;
      layers.push({
        name,
        color: "White",
        linetype: "Continuous",
        lineweight: "0.25 mm",
        on: true,
        frozen: false,
        locked: false,
        current: false,
        position: layers.length,
      });
      outcome.announcement = copy.layerCreated(name);
      outcome.layersAfter = layers;
      return outcome;
    }
    case "rename": {
      const name = args.name as string;
      const newName = args.new_name as string;
      const target = find(name);
      if (!target) throw validation({ name: copy.layerInvalidName });
      if (target.name === "0") throw bad("layer_zero");
      if (typeof newName !== "string" || !validLayerName(newName)) throw validation({ new_name: copy.layerInvalidName });
      if (layers.some((l) => l !== target && l.name.toLowerCase() === newName.toLowerCase())) {
        throw validation({ new_name: copy.layerNameTaken(newName) });
      }
      target.name = newName;
      outcome.announcement = copy.layerRenamed(name, newName);
      outcome.layersAfter = layers;
      return outcome;
    }
    case "set": {
      const name = args.name as string;
      const target = find(name);
      if (!target) throw validation({ name: copy.layerInvalidName });
      if (args.on !== undefined) {
        target.on = args.on === true;
        outcome.announcement = target.on ? copy.layerOn(target.name) : copy.layerOff(target.name);
      }
      if (args.frozen !== undefined) {
        if (args.frozen === true && target.current) throw bad("layer_current");
        target.frozen = args.frozen === true;
        outcome.announcement = target.frozen ? copy.layerFrozen(target.name) : copy.layerThawed(target.name);
      }
      if (args.locked !== undefined) {
        target.locked = args.locked === true;
        outcome.announcement = target.locked ? copy.layerLocked(target.name) : copy.layerUnlocked(target.name);
      }
      if (args.color !== undefined) {
        target.color = String(args.color);
        outcome.announcement = copy.layerColor(target.name, target.color);
      }
      if (args.linetype !== undefined) {
        target.linetype = String(args.linetype);
        outcome.announcement = copy.layerLinetype(target.name, target.linetype);
      }
      if (args.lineweight !== undefined) {
        target.lineweight = String(args.lineweight);
        outcome.announcement = copy.layerLineweight(target.name, target.lineweight);
      }
      outcome.layersAfter = layers;
      return outcome;
    }
    case "current": {
      const name = args.name as string;
      const target = find(name);
      if (!target) throw validation({ name: copy.layerInvalidName });
      for (const layer of layers) layer.current = layer === target;
      outcome.announcement = copy.layerCurrent(target.name);
      outcome.layersAfter = layers;
      return outcome;
    }
    case "delete": {
      const name = args.name as string;
      const target = find(name);
      if (!target) throw validation({ name: copy.layerInvalidName });
      if (target.name === "0") throw bad("layer_zero");
      if (target.current) throw bad("layer_current");
      if (target.locked) throw bad("layer_locked");
      const count = objectCountByLayer.get(target.name) ?? 0;
      if (count > 0) throw bad("layer_in_use", { objects: count });
      layers.splice(layers.indexOf(target), 1);
      outcome.announcement = copy.layerDeleted(target.name);
      outcome.layersAfter = layers;
      return outcome;
    }
    default:
      throw validation({ op: "Unknown layer operation." });
  }
}

export function objectCountByLayer(objects: Array<{ layer: string }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of objects) map.set(o.layer, (map.get(o.layer) ?? 0) + 1);
  return map;
}

export function distanceBetween(a: Point, b: Point): number {
  return distance(a, b);
}

function defaultPropsRecord(): Record<string, unknown> {
  return {
    color: "ByLayer",
    linetype: "ByLayer",
    linetype_scale: 1,
    lineweight: "ByLayer",
    dimension_style: "Standard",
    text_style: "Standard",
    multileader_style: "Standard",
  };
}
