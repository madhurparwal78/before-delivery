import { anyZonesTouch, portPoint } from "../shared/geometry.ts";
import { isSystemKind, isZoneKind, LIMITS, type Connector, type PageDoc, type Point, type PortSide, type Shape, type Zone } from "../shared/model.ts";
import { ApiError } from "./http.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
// C0 controls, DEL and C1 controls.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** A plain-text field: 1 to `max` characters after trimming, no control character. Returns the trimmed value or null. */
export function plainText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || Array.from(trimmed).length > max || CONTROL.test(trimmed)) return null;
  return trimmed;
}

export function hasControl(value: string): boolean {
  return CONTROL.test(value);
}

const coordinate = (v: unknown) => isInt(v) && Math.abs(v) <= LIMITS.coordinate;
const sized = (v: unknown, range: { min: number; max: number }) => isInt(v) && v >= range.min && v <= range.max;
const isPort = (v: unknown): v is PortSide => v === "n" || v === "e" || v === "s" || v === "w";

/** Collects field problems; the first problem per path is kept. */
class Problems {
  readonly fields: Record<string, string> = {};
  add(path: string, problem: string): void {
    if (!(path in this.fields)) this.fields[path] = problem;
  }
  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }
}

const list = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

function point(v: unknown): Point | null {
  return Array.isArray(v) && v.length === 2 && coordinate(v[0]) && coordinate(v[1]) ? [v[0], v[1]] : null;
}

function zoneOf(z: unknown, path: string, p: Problems): Zone | null {
  if (!isObj(z)) return p.add(path, "invalid"), null;
  const { id, kind, note, x, y, width, height } = z;
  const name = plainText(z.name, 80);
  let ok = true;
  const fail = (key: string) => {
    p.add(`${path}.${key}`, "invalid");
    ok = false;
  };
  if (typeof id !== "string") fail("id");
  if (!isZoneKind(kind)) fail("kind");
  if (name === null || name !== z.name) fail("name");
  if (typeof note !== "string" || Array.from(note).length > LIMITS.note) fail("note");
  if (!coordinate(x)) fail("x");
  if (!coordinate(y)) fail("y");
  if (!sized(width, LIMITS.zoneSize)) fail("width");
  if (!sized(height, LIMITS.zoneSize)) fail("height");
  return ok ? { id: id as string, kind: kind as Zone["kind"], name: name!, note: note as string, x: x as number, y: y as number, width: width as number, height: height as number } : null;
}

function shapeOf(sh: unknown, path: string, p: Problems): Shape | null {
  if (!isObj(sh)) return p.add(path, "invalid"), null;
  const { id, kind, label, x, y, width, height, z, groupId } = sh;
  let ok = true;
  const fail = (key: string) => {
    p.add(`${path}.${key}`, "invalid");
    ok = false;
  };
  if (typeof id !== "string") fail("id");
  if (!isSystemKind(kind)) fail("kind");
  if (typeof label !== "string" || Array.from(label).length > LIMITS.label) fail("label");
  if (!coordinate(x)) fail("x");
  if (!coordinate(y)) fail("y");
  if (!sized(width, LIMITS.shapeSize)) fail("width");
  if (!sized(height, LIMITS.shapeSize)) fail("height");
  if (!isInt(z)) fail("z");
  if (groupId !== null && (typeof groupId !== "string" || groupId.length === 0 || groupId.length > 64)) fail("groupId");
  return ok
    ? { id: id as string, kind: kind as Shape["kind"], label: label as string, x: x as number, y: y as number, width: width as number, height: height as number, z: z as number, groupId: groupId as string | null }
    : null;
}

function connectorOf(c: unknown, path: string, p: Problems): Connector | null {
  if (!isObj(c)) return p.add(path, "invalid"), null;
  let ok = true;
  const fail = (key: string) => {
    p.add(`${path}.${key}`, "invalid");
    ok = false;
  };
  const end = (key: "from" | "to") => {
    const e = c[key];
    if (isObj(e) && typeof e.shapeId === "string" && isPort(e.port)) return { shapeId: e.shapeId, port: e.port };
    fail(key);
    return null;
  };
  if (typeof c.id !== "string") fail("id");
  if (typeof c.label !== "string" || Array.from(c.label).length > LIMITS.label) fail("label");
  const from = end("from"), to = end("to");
  const raw = list(c.points);
  const points = raw && raw.length >= 2 ? raw.map(point) : null;
  if (!points || points.some((q) => q === null)) fail("points");
  return ok && from && to && points ? { id: c.id as string, label: c.label as string, from, to, points: points as Point[] } : null;
}

/** Page validation: 422 `validation` for field problems, then 422 `dangling_connector` for connectors off their shapes' ports. */
export function validatePage(body: unknown): PageDoc {
  const p = new Problems();
  if (!isObj(body)) throw new ApiError(422, "validation", "The page document is not valid.", { page: "invalid" });
  const name = plainText(body.name, 80);
  if (name === null) p.add("name", "invalid");
  if (!isInt(body.version)) p.add("version", "invalid");
  const zonesIn = list(body.zones) ?? (p.add("zones", "invalid"), []);
  const shapesIn = list(body.shapes) ?? (p.add("shapes", "invalid"), []);
  const connectorsIn = list(body.connectors) ?? (p.add("connectors", "invalid"), []);
  if (zonesIn.length > LIMITS.zones) p.add("zones", "too_many");
  if (shapesIn.length > LIMITS.shapes) p.add("shapes", "too_many");
  if (connectorsIn.length > LIMITS.connectors) p.add("connectors", "too_many");

  const zones = zonesIn.map((z, i) => zoneOf(z, `zones[${i}]`, p));
  const shapes = shapesIn.map((s, i) => shapeOf(s, `shapes[${i}]`, p));
  const connectors = connectorsIn.map((c, i) => connectorOf(c, `connectors[${i}]`, p));

  const ids = new Set<string>();
  const zs = new Set<number>();
  const groups = new Map<string, number>();
  [...zones.map((z, i) => [z, `zones[${i}]`] as const), ...shapes.map((s, i) => [s, `shapes[${i}]`] as const), ...connectors.map((c, i) => [c, `connectors[${i}]`] as const)]
    .forEach(([item, path]) => {
      if (!item) return;
      if (!ID.test(item.id)) p.add(`${path}.id`, "invalid");
      else if (ids.has(item.id)) p.add(`${path}.id`, "duplicate");
      else ids.add(item.id);
    });
  shapes.forEach((s, i) => {
    if (!s) return;
    if (zs.has(s.z)) p.add(`shapes[${i}].z`, "duplicate");
    zs.add(s.z);
    if (s.groupId) groups.set(s.groupId, (groups.get(s.groupId) ?? 0) + 1);
  });
  shapes.forEach((s, i) => {
    if (s?.groupId && (groups.get(s.groupId) ?? 0) < 2) p.add(`shapes[${i}].groupId`, "single_member");
  });
  const okZones = zones.filter((z): z is Zone => z !== null);
  if (!p.any && anyZonesTouch(okZones)) p.add("zones", "overlap");
  if (p.any) throw new ApiError(422, "validation", "The page document is not valid.", p.fields);

  const okShapes = shapes.filter((s): s is Shape => s !== null);
  const okConnectors = connectors.filter((c): c is Connector => c !== null);
  const byId = new Map(okShapes.map((s) => [s.id, s]));
  const dangling: Record<string, string> = {};
  const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
  for (const c of okConnectors) {
    const a = byId.get(c.from.shapeId), b = byId.get(c.to.shapeId);
    const pts = c.points;
    if (!a || !b) dangling[c.id] = "missing_shape";
    else if (!same(pts[0]!, portPoint(a, c.from.port)) || !same(pts[pts.length - 1]!, portPoint(b, c.to.port))) dangling[c.id] = "off_port";
    else if (pts.some((q, k) => k > 0 && q[0] !== pts[k - 1]![0] && q[1] !== pts[k - 1]![1])) dangling[c.id] = "diagonal";
  }
  if (Object.keys(dangling).length) throw new ApiError(422, "dangling_connector", "Every connector must start and end on its shapes' ports.", dangling);

  return { id: String(body.id), name: name!, version: body.version as number, zones: okZones, shapes: okShapes, connectors: okConnectors };
}
