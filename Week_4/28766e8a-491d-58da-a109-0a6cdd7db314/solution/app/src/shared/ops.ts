// Applying operations to the document (brief: Operations over HTTP, Groups, Layers, Reordering,
// Rerouting, Undo, Restore). The server applies them authoritatively; the browser applies the same
// code optimistically. Routes are always derived here, never taken from a client.
import { inRange, PORTS } from "./geometry";
import { routePage } from "./router";
import { LIMITS } from "./text";
import type { Change, Connector, ConnectorEnd, DiagramDocument, FlatRecord, Group, Layer, Op, Page, Point, Shape, ShapeFields, ShapeKind, ShapeUpdate } from "./types";

type OpErrorCode = "missing" | "layer_locked" | "invalid";

/** A refusal found while applying; `missing` becomes 404 or 409 on the server once history is consulted. */
export class OpError extends Error {
  readonly code: OpErrorCode;
  readonly subject: string;

  constructor(code: OpErrorCode, subject: string, message = code) {
    super(message);
    this.code = code;
    this.subject = subject;
  }
}

export interface ApplyContext {
  /** A fresh id with the prefix; the browser derives a stable temporary id from the client ref. */
  newId: (prefix: string, clientRef: string) => string;
  /** The stored changes of an earlier operation, for undo. */
  changesOf: (seq: number) => Change[];
  /** The document of a version, for restore. */
  versionDocument: (versionId: string) => DiagramDocument;
}

export interface Committed {
  document: DiagramDocument;
  ids: Record<string, string>;
  changes: Change[];
  touched: string[];
  rerouted: string[];
  routes: Record<string, Point[]>;
}

const SHAPE_KINDS: readonly ShapeKind[] = ["rectangle", "ellipse", "diamond", "text"];

// ---------------------------------------------------------------- lookups

interface Found<T> {
  page: Page;
  item: T;
}

function findShape(doc: DiagramDocument, id: string): Found<Shape> {
  for (const page of doc.pages) {
    const item = page.shapes.find((s) => s.id === id);
    if (item) return { page, item };
  }
  throw new OpError("missing", id);
}

function findConnector(doc: DiagramDocument, id: string): Found<Connector> {
  for (const page of doc.pages) {
    const item = page.connectors.find((c) => c.id === id);
    if (item) return { page, item };
  }
  throw new OpError("missing", id);
}

function findLayer(doc: DiagramDocument, id: string): Found<Layer> {
  for (const page of doc.pages) {
    const item = page.layers.find((l) => l.id === id);
    if (item) return { page, item };
  }
  throw new OpError("missing", id);
}

function findGroup(doc: DiagramDocument, id: string): Found<Group> {
  for (const page of doc.pages) {
    const item = page.groups.find((g) => g.id === id);
    if (item) return { page, item };
  }
  throw new OpError("missing", id);
}

function findPage(doc: DiagramDocument, id: string): Page {
  const page = doc.pages.find((p) => p.id === id);
  if (!page) throw new OpError("missing", id);
  return page;
}

function layerOf(page: Page, id: string): Layer {
  const layer = page.layers.find((l) => l.id === id);
  if (!layer) throw new OpError("missing", id);
  return layer;
}

function requireUnlocked(page: Page, shape: Shape): void {
  const layer = layerOf(page, shape.layer);
  if (layer.locked) throw new OpError("layer_locked", layer.name);
}

/** Every object id an operation names, for the not-found check that precedes every other check. */
export function referencedIds(op: Op): string[] {
  switch (op.kind) {
    case "add_shape":
      return [op.page, op.layer];
    case "update_shape":
      return op.set.layer !== undefined ? [op.shape, op.set.layer] : [op.shape];
    case "update_shapes":
      return op.shapes.flatMap((entry) => (entry.set.layer !== undefined ? [entry.shape, entry.set.layer] : [entry.shape]));
    case "delete_shape":
    case "set_z":
      return [op.shape];
    case "add_connector":
      return [op.page, op.from.shape, op.to.shape];
    case "delete_connector":
      return [op.connector];
    case "update_page":
    case "move_page":
    case "delete_page":
      return [op.page];
    case "add_layer":
      return [op.page];
    case "update_layer":
    case "move_layer":
      return [op.layer];
    case "group":
      return op.shapes;
    case "ungroup":
      return [op.group];
    case "batch":
      return op.ops.flatMap(referencedIds);
    case "add_page":
    case "undo":
    case "restore":
      return [];
  }
}

// ---------------------------------------------------------------- validation

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function invalid(path: string): never {
  throw new OpError("invalid", path);
}

/** Integer coordinates and sizes inside the document limits; `path` is the object's dotted path. */
function checkGeometry(box: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }, path: string): void {
  for (const key of ["x", "y", "w", "h"] as const) if (box[key] !== undefined && !inRange(key, box[key])) invalid(`${path}.${key}`);
}

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isOpId(value: unknown): value is string {
  return typeof value === "string" && OP_ID.test(value);
}

/** Field errors keyed by the dotted path of the offending value from the request body's root. */
type FieldErrors = Record<string, string>;

const UNKNOWN_KEY = "This field is not accepted.";
export const BAD_VALUE = "Enter a valid value.";

/** The published keys of each operation kind and of the objects inside them (brief: Operations over HTTP). */
const PUBLISHED_KEYS = {
  body: ["opId", "baseSeq", "op"],
  add_shape: ["kind", "page", "layer", "shape", "clientRef"],
  update_shape: ["kind", "shape", "set"],
  update_shapes: ["kind", "shapes"],
  delete_shape: ["kind", "shape"],
  add_connector: ["kind", "page", "from", "to", "label", "clientRef"],
  delete_connector: ["kind", "connector"],
  add_page: ["kind", "name", "clientRef"],
  update_page: ["kind", "page", "name"],
  move_page: ["kind", "page", "index"],
  delete_page: ["kind", "page"],
  add_layer: ["kind", "page", "name", "clientRef"],
  update_layer: ["kind", "layer", "set"],
  move_layer: ["kind", "layer", "index"],
  group: ["kind", "shapes", "clientRef"],
  ungroup: ["kind", "group"],
  set_z: ["kind", "shape", "direction"],
  batch: ["kind", "ops"],
  undo: ["kind", "seq"],
  shape: ["kind", "x", "y", "w", "h", "label"],
  set: ["x", "y", "w", "h", "label", "layer"],
  entry: ["shape", "set"],
  end: ["shape", "port"],
  layerSet: ["name", "visible", "locked"],
} as const;

/** Operation kinds a client may send (restore comes only from the restore endpoint). */
const OP_KINDS: readonly string[] = ["add_shape", "update_shape", "update_shapes", "delete_shape", "add_connector", "delete_connector", "add_page",
  "update_page", "move_page", "delete_page", "add_layer", "update_layer", "move_layer", "group", "ungroup", "set_z", "batch", "undo"];

/** Operation kinds the HTTP endpoint accepts; the rest travel over the live socket only. */
const HTTP_KINDS: readonly string[] = ["add_shape", "update_shape", "update_shapes", "delete_shape", "add_connector", "delete_connector"];

type Raw = Record<string, unknown>;

/** The dotted path of `key` inside the object at `path` (the body's root is the empty path). */
function at(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collects field errors while reading an untrusted operation. */
class Reader {
  readonly fields: FieldErrors = {};

  object(value: unknown, path: string, keys: readonly string[]): Raw | null {
    if (!isRecord(value)) {
      this.fields[path || "body"] = BAD_VALUE;
      return null;
    }
    for (const key of Object.keys(value)) if (!keys.includes(key)) this.fields[at(path, key)] = UNKNOWN_KEY;
    return value;
  }

  string(o: Raw, key: string, path: string): string {
    const value = o[key];
    if (typeof value === "string") return value;
    this.fields[at(path, key)] = BAD_VALUE;
    return "";
  }

  number(o: Raw, key: string, path: string): number {
    const value = o[key];
    if (typeof value === "number") return value;
    this.fields[at(path, key)] = BAD_VALUE;
    return Number.NaN;
  }

  /** The published `set` keys; values are checked when the operation applies. */
  set(value: unknown, path: string): ShapeFields {
    const o = this.object(value, path, PUBLISHED_KEYS.set);
    if (!o) return {};
    const set: ShapeFields = {};
    for (const key of ["x", "y", "w", "h"] as const) if (o[key] !== undefined) set[key] = o[key] as number;
    if (o.label !== undefined) set.label = o.label as string;
    if (typeof o.layer === "string") set.layer = o.layer;
    else if (o.layer !== undefined) this.fields[at(path, "layer")] = BAD_VALUE;
    return set;
  }

  end(value: unknown, path: string): ConnectorEnd {
    const o = this.object(value, path, PUBLISHED_KEYS.end);
    if (!o) return { shape: "", port: "n" };
    const shape = this.string(o, "shape", path);
    if (!PORTS.includes(o.port as ConnectorEnd["port"])) this.fields[`${path}.port`] = BAD_VALUE;
    return { shape, port: o.port as ConnectorEnd["port"] };
  }
}

function readOp(r: Reader, value: unknown, path: string, socket: boolean): Op | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !OP_KINDS.includes(value.kind) || (!socket && !HTTP_KINDS.includes(value.kind))) {
    r.fields[isRecord(value) ? `${path}.kind` : path] = BAD_VALUE;
    return null;
  }
  const kind = value.kind as Exclude<keyof typeof PUBLISHED_KEYS, "body" | "shape" | "set" | "entry" | "end" | "layerSet">;
  const o = r.object(value, path, PUBLISHED_KEYS[kind]) as Raw;
  switch (kind) {
    case "add_shape": {
      const shape = r.object(o.shape, `${path}.shape`, PUBLISHED_KEYS.shape) ?? {};
      return { kind, page: r.string(o, "page", path), layer: r.string(o, "layer", path), clientRef: r.string(o, "clientRef", path),
        shape: { kind: shape.kind as ShapeKind, x: shape.x as number, y: shape.y as number, w: shape.w as number, h: shape.h as number, label: (shape.label ?? "") as string } };
    }
    case "update_shape":
      return { kind, shape: r.string(o, "shape", path), set: r.set(o.set, `${path}.set`) };
    case "update_shapes": {
      if (!Array.isArray(o.shapes)) {
        r.fields[`${path}.shapes`] = BAD_VALUE;
        return null;
      }
      const shapes = o.shapes.map((item: unknown, i: number) => {
        const at = `${path}.shapes.${i}`;
        const entry = r.object(item, at, PUBLISHED_KEYS.entry) ?? {};
        return { shape: r.string(entry, "shape", at), set: r.set(entry.set, `${at}.set`) };
      });
      return { kind, shapes };
    }
    case "delete_shape":
      return { kind, shape: r.string(o, "shape", path) };
    case "add_connector":
      return { kind, page: r.string(o, "page", path), from: r.end(o.from, `${path}.from`), to: r.end(o.to, `${path}.to`),
        label: (o.label ?? "") as string, clientRef: r.string(o, "clientRef", path) };
    case "delete_connector":
      return { kind, connector: r.string(o, "connector", path) };
    case "add_page":
      return { kind, name: r.string(o, "name", path), clientRef: r.string(o, "clientRef", path) };
    case "update_page":
      return { kind, page: r.string(o, "page", path), name: r.string(o, "name", path) };
    case "move_page":
      return { kind, page: r.string(o, "page", path), index: r.number(o, "index", path) };
    case "delete_page":
      return { kind, page: r.string(o, "page", path) };
    case "add_layer":
      return { kind, page: r.string(o, "page", path), name: r.string(o, "name", path), clientRef: r.string(o, "clientRef", path) };
    case "update_layer": {
      const set = r.object(o.set, `${path}.set`, PUBLISHED_KEYS.layerSet) ?? {};
      return { kind, layer: r.string(o, "layer", path), set: {
        ...(set.name !== undefined ? { name: set.name as string } : {}),
        ...(set.visible !== undefined ? { visible: set.visible as boolean } : {}),
        ...(set.locked !== undefined ? { locked: set.locked as boolean } : {}) } };
    }
    case "move_layer":
      return { kind, layer: r.string(o, "layer", path), index: r.number(o, "index", path) };
    case "group": {
      const shapes = Array.isArray(o.shapes) && o.shapes.every((s) => typeof s === "string") ? (o.shapes as string[]) : null;
      if (!shapes) r.fields[`${path}.shapes`] = BAD_VALUE;
      return { kind, shapes: shapes ?? [], clientRef: r.string(o, "clientRef", path) };
    }
    case "ungroup":
      return { kind, group: r.string(o, "group", path) };
    case "set_z":
      if (o.direction !== "forward" && o.direction !== "backward") r.fields[`${path}.direction`] = BAD_VALUE;
      return { kind, shape: r.string(o, "shape", path), direction: o.direction as "forward" | "backward" };
    case "batch": {
      const list = Array.isArray(o.ops) && o.ops.length ? o.ops : null;
      if (!list) {
        r.fields[`${path}.ops`] = BAD_VALUE;
        return null;
      }
      const ops = list.map((sub: unknown, i: number) => readOp(r, sub, `${path}.ops.${i}`, socket));
      if (!ops.every((sub): sub is Op => sub !== null && sub.kind !== "undo" && sub.kind !== "batch")) {
        r.fields[`${path}.ops`] = BAD_VALUE;
        return null;
      }
      return { kind, ops };
    }
    case "undo":
      return { kind, seq: r.number(o, "seq", path) };
    default:
      r.fields[`${path}.kind`] = BAD_VALUE;
      return null;
  }
}

export interface ParsedRequest {
  opId: string;
  baseSeq: number;
  /** The operation as far as it could be read; null when it has no usable shape at all. */
  op: Op | null;
  /** Unknown keys and malformed values, answered 422 after every higher-precedence check. */
  fields: FieldErrors;
  /** The `op` exactly as received, compared when an opId is repeated. */
  received: unknown;
}

/** Reads an operation request body: only `opId`, `baseSeq` and `op`, and only each kind's published keys. */
export function parseRequest(body: unknown, socket: boolean): ParsedRequest {
  const r = new Reader();
  const o = r.object(body, "", PUBLISHED_KEYS.body) ?? {};
  const opId = isOpId(o.opId) ? o.opId : "";
  if (!opId) r.fields.opId = BAD_VALUE;
  const baseSeq = Number.isInteger(o.baseSeq) ? (o.baseSeq as number) : -1;
  if (baseSeq < 0) r.fields.baseSeq = BAD_VALUE;
  const op = readOp(r, o.op, "op", socket);
  return { opId, baseSeq, op, fields: r.fields, received: o.op };
}

// ---------------------------------------------------------------- flat form and patches

/** The document as one record per object, without derived routes. */
function flatten(doc: DiagramDocument): Map<string, FlatRecord> {
  const flat = new Map<string, FlatRecord>();
  for (const page of doc.pages) {
    flat.set(`page:${page.id}`, { name: page.name, order: page.order });
    for (const l of page.layers) flat.set(`layer:${l.id}`, { page: page.id, name: l.name, order: l.order, visible: l.visible, locked: l.locked });
    for (const s of page.shapes) {
      flat.set(`shape:${s.id}`, { page: page.id, kind: s.kind, layer: s.layer, x: s.x, y: s.y, w: s.w, h: s.h, label: s.label, z: s.z, group: s.group });
    }
    for (const c of page.connectors) flat.set(`connector:${c.id}`, { page: page.id, layer: c.layer, from: c.from, to: c.to, label: c.label });
    for (const g of page.groups) flat.set(`group:${g.id}`, { page: page.id, members: [...g.members].sort() });
  }
  return flat;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Rebuilds a document from its flat form; routes come from `routes` (missing ones start empty). */
function unflatten(meta: { id: string; title: string; seq: number }, flat: Map<string, FlatRecord>, routes: Map<string, Point[]>): DiagramDocument {
  const pages = new Map<string, Page>();
  for (const [key, r] of flat) {
    const [type, id] = key.split(":") as [string, string];
    if (type === "page") pages.set(id, { id, name: r.name as string, order: r.order as number, layers: [], shapes: [], connectors: [], groups: [] });
  }
  for (const [key, r] of flat) {
    const [type, id] = key.split(":") as [string, string];
    const page = typeof r.page === "string" ? pages.get(r.page) : undefined;
    if (!page) continue;
    if (type === "layer") page.layers.push({ id, name: r.name as string, order: r.order as number, visible: r.visible as boolean, locked: r.locked as boolean });
    if (type === "shape") {
      page.shapes.push({ id, kind: r.kind as ShapeKind, layer: r.layer as string, x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number,
        label: r.label as string, z: r.z as number, group: r.group as string | null });
    }
    if (type === "connector") {
      page.connectors.push({ id, layer: r.layer as string, from: r.from as ConnectorEnd, to: r.to as ConnectorEnd, label: r.label as string, route: routes.get(id) ?? [] });
    }
    if (type === "group") page.groups.push({ id, members: [...(r.members as string[])] });
  }
  const list = [...pages.values()].sort((a, b) => a.order - b.order || byId(a, b));
  for (const page of list) {
    page.layers.sort((a, b) => a.order - b.order || byId(a, b));
    page.shapes.sort(byId);
    page.connectors.sort(byId);
    page.groups.sort(byId);
  }
  return { id: meta.id, title: meta.title, seq: meta.seq, pages: list };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Object-level changes between two flat forms, and the field keys they touch. */
function diff(before: Map<string, FlatRecord>, after: Map<string, FlatRecord>): { changes: Change[]; touched: string[] } {
  const changes: Change[] = [];
  const touched: string[] = [];
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const key of keys) {
    const a = before.get(key) ?? null;
    const b = after.get(key) ?? null;
    if (a && b && same(a, b)) continue;
    changes.push({ key, before: a, after: b });
    if (!a) touched.push(`${key}:created`);
    if (!b) touched.push(`${key}:deleted`);
    const fields = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const field of fields) if (!a || !b || !same(a[field], b[field])) touched.push(`${key}:${field}`);
  }
  return { changes, touched };
}

/** Field keys (not created/deleted markers) that undoing these changes would restore. */
export function restoredFields(touched: string[]): string[] {
  return touched.filter((key) => !key.endsWith(":created") && !key.endsWith(":deleted"));
}

/** Applies server changes forward onto a flat form (whole records). */
function applyForward(flat: Map<string, FlatRecord>, changes: Change[]): void {
  for (const change of changes) {
    if (change.after) flat.set(change.key, change.after);
    else flat.delete(change.key);
  }
}

/** Reverses changes field by field, leaving fields others changed untouched. */
function applyReverse(flat: Map<string, FlatRecord>, changes: Change[]): void {
  for (const change of changes) {
    const current = flat.get(change.key);
    if (!change.before) {
      flat.delete(change.key);
    } else if (!change.after || !current) {
      flat.set(change.key, { ...change.before });
    } else {
      const next = { ...current };
      for (const field of Object.keys(change.before)) {
        if (!same(change.before[field], change.after[field])) next[field] = change.before[field] as FlatRecord[string];
      }
      flat.set(change.key, next);
    }
  }
}

function routesOf(doc: DiagramDocument): Map<string, Point[]> {
  return new Map(doc.pages.flatMap((p) => p.connectors.map((c) => [c.id, c.route] as const)));
}

// ---------------------------------------------------------------- operations

function nextZ(page: Page, layer: string): number {
  return Math.max(-1, ...page.shapes.filter((s) => s.layer === layer).map((s) => s.z)) + 1;
}

function renumber<T extends { order: number }>(items: T[]): void {
  items.forEach((item, index) => {
    item.order = index;
  });
}

function removeShape(page: Page, shape: Shape): void {
  page.shapes = page.shapes.filter((s) => s.id !== shape.id);
  page.connectors = page.connectors.filter((c) => c.from.shape !== shape.id && c.to.shape !== shape.id);
  for (const g of page.groups) g.members = g.members.filter((m) => m !== shape.id);
}

/** Groups keep two or more members on one layer; connectors keep both ends. */
function normalise(doc: DiagramDocument): void {
  for (const page of doc.pages) {
    const shapes = new Map(page.shapes.map((s) => [s.id, s]));
    page.connectors = page.connectors.filter((c) => shapes.has(c.from.shape) && shapes.has(c.to.shape));
    const owner = new Map<string, string>();
    page.groups = page.groups.filter((g) => {
      g.members = g.members.filter((m) => shapes.has(m) && !owner.has(m));
      const layers = new Set(g.members.map((m) => shapes.get(m)?.layer));
      if (g.members.length < 2 || layers.size !== 1) return false;
      for (const m of g.members) owner.set(m, g.id);
      return true;
    });
    for (const s of page.shapes) s.group = owner.get(s.id) ?? null;
  }
}

/** Refuses an update of a shape on a locked layer, or one that moves it to a locked layer (409 before any 422). */
function requireUpdatable(doc: DiagramDocument, update: ShapeUpdate): Found<Shape> {
  const found = findShape(doc, update.shape);
  requireUnlocked(found.page, found.item);
  if (typeof update.set.layer === "string") {
    const target = findLayer(doc, update.set.layer).item;
    if (target.locked) throw new OpError("layer_locked", target.name);
  }
  return found;
}

/** Checks one `set` against the document limits, then applies it; a layer change moves the whole group. */
function applyUpdate(found: Found<Shape>, set: ShapeFields, path: string): void {
  const { page, item } = found;
  if (!Object.keys(set).length) invalid(path);
  checkGeometry(set, path);
  if (set.label !== undefined && !isText(set.label, 0, LIMITS.label)) invalid(`${path}.label`);
  const target = set.layer !== undefined ? page.layers.find((l) => l.id === set.layer) : null;
  if (target === undefined) invalid(`${path}.layer`);
  if (set.x !== undefined) item.x = set.x;
  if (set.y !== undefined) item.y = set.y;
  if (set.w !== undefined) item.w = set.w;
  if (set.h !== undefined) item.h = set.h;
  if (set.label !== undefined) item.label = set.label;
  if (target && target.id !== item.layer) {
    const moving = item.group ? page.shapes.filter((s) => s.group === item.group) : [item];
    let z = nextZ(page, target.id);
    for (const s of [...moving].sort((a, b) => a.z - b.z)) {
      s.layer = target.id;
      s.z = z++;
    }
  }
}

function applyOne(doc: DiagramDocument, op: Op, ctx: ApplyContext, ids: Record<string, string>, path: string): void {
  switch (op.kind) {
    case "add_shape": {
      const page = findPage(doc, op.page);
      const layer = layerOf(page, op.layer);
      if (layer.locked) throw new OpError("layer_locked", layer.name);
      if (!SHAPE_KINDS.includes(op.shape.kind)) invalid(`${path}.shape.kind`);
      for (const key of ["x", "y", "w", "h"] as const) if (op.shape[key] === undefined) invalid(`${path}.shape.${key}`);
      checkGeometry(op.shape, `${path}.shape`);
      if (!isText(op.shape.label, 0, LIMITS.label)) invalid(`${path}.shape.label`);
      if (page.shapes.length >= LIMITS.shapesPerPage) invalid(`${path}.page`);
      const id = ctx.newId("s_", op.clientRef);
      page.shapes.push({ id, kind: op.shape.kind, layer: layer.id, x: op.shape.x, y: op.shape.y, w: op.shape.w, h: op.shape.h, label: op.shape.label, z: nextZ(page, layer.id), group: null });
      ids[op.clientRef] = id;
      return;
    }
    case "update_shape":
      applyUpdate(requireUpdatable(doc, op), op.set, `${path}.set`);
      return;
    case "update_shapes": {
      // All or nothing, in list order: deleted and locked entries refuse the whole operation before any validation.
      const found = op.shapes.map((entry) => ({ entry, ...requireUpdatable(doc, entry) }));
      const first = found[0];
      if (!first || found.length > LIMITS.shapesPerPage) invalid(`${path}.shapes`);
      const seen = new Set<string>();
      found.forEach(({ entry, page }, i) => {
        if (seen.has(entry.shape) || page !== first.page) invalid(`${path}.shapes.${i}.shape`);
        seen.add(entry.shape);
      });
      found.forEach((f, i) => applyUpdate(f, f.entry.set, `${path}.shapes.${i}.set`));
      return;
    }
    case "delete_shape": {
      const { page, item } = findShape(doc, op.shape);
      requireUnlocked(page, item);
      removeShape(page, item);
      return;
    }
    case "add_connector": {
      const page = findPage(doc, op.page);
      const from = findShape(doc, op.from.shape);
      const to = findShape(doc, op.to.shape);
      for (const end of [from, to]) requireUnlocked(end.page, end.item);
      if (!PORTS.includes(op.from.port)) invalid(`${path}.from.port`);
      if (!PORTS.includes(op.to.port)) invalid(`${path}.to.port`);
      if (from.page.id !== page.id) invalid(`${path}.from.shape`);
      if (to.page.id !== page.id || from.item.id === to.item.id) invalid(`${path}.to.shape`);
      if (!isText(op.label, 0, LIMITS.label)) invalid(`${path}.label`);
      if (page.connectors.length >= LIMITS.connectorsPerPage) invalid(`${path}.page`);
      const id = ctx.newId("c_", op.clientRef);
      page.connectors.push({ id, layer: from.item.layer, from: { ...op.from }, to: { ...op.to }, label: op.label, route: [] });
      ids[op.clientRef] = id;
      return;
    }
    case "delete_connector": {
      const { page, item } = findConnector(doc, op.connector);
      const layer = layerOf(page, item.layer);
      if (layer.locked) throw new OpError("layer_locked", layer.name);
      for (const end of [item.from, item.to]) {
        const shape = page.shapes.find((s) => s.id === end.shape);
        if (shape) requireUnlocked(page, shape);
      }
      page.connectors = page.connectors.filter((c) => c.id !== item.id);
      return;
    }
    case "add_page": {
      if (!isText(op.name, 1, LIMITS.pageName)) invalid(`${path}.name`);
      if (doc.pages.length >= LIMITS.pagesPerDiagram) invalid(`${path}.pages`);
      const id = ctx.newId("p_", op.clientRef);
      const layerId = ctx.newId("l_", op.clientRef);
      doc.pages.push({ id, name: op.name, order: doc.pages.length, layers: [{ id: layerId, name: "Layer 1", order: 0, visible: true, locked: false }], shapes: [], connectors: [], groups: [] });
      ids[op.clientRef] = id;
      ids[`${op.clientRef}.layer`] = layerId;
      return;
    }
    case "update_page": {
      const page = findPage(doc, op.page);
      if (!isText(op.name, 1, LIMITS.pageName)) invalid(`${path}.name`);
      page.name = op.name;
      return;
    }
    case "move_page": {
      const page = findPage(doc, op.page);
      if (!isInt(op.index, 0, doc.pages.length - 1)) invalid(`${path}.index`);
      const rest = doc.pages.filter((p) => p.id !== page.id).sort((a, b) => a.order - b.order);
      rest.splice(op.index, 0, page);
      renumber(rest);
      return;
    }
    case "delete_page": {
      const page = findPage(doc, op.page);
      if (doc.pages.length <= 1) invalid(`${path}.page`);
      doc.pages = doc.pages.filter((p) => p.id !== page.id).sort((a, b) => a.order - b.order);
      renumber(doc.pages);
      return;
    }
    case "add_layer": {
      const page = findPage(doc, op.page);
      if (!isText(op.name, 1, LIMITS.layerName)) invalid(`${path}.name`);
      if (page.layers.length >= LIMITS.layersPerPage) invalid(`${path}.layers`);
      const id = ctx.newId("l_", op.clientRef);
      page.layers.push({ id, name: op.name, order: page.layers.length, visible: true, locked: false });
      ids[op.clientRef] = id;
      return;
    }
    case "update_layer": {
      const { item } = findLayer(doc, op.layer);
      if (op.set.name !== undefined && !isText(op.set.name, 1, LIMITS.layerName)) invalid(`${path}.name`);
      if (op.set.visible !== undefined && typeof op.set.visible !== "boolean") invalid(`${path}.visible`);
      if (op.set.locked !== undefined && typeof op.set.locked !== "boolean") invalid(`${path}.locked`);
      Object.assign(item, op.set);
      return;
    }
    case "move_layer": {
      const { page, item } = findLayer(doc, op.layer);
      if (!isInt(op.index, 0, page.layers.length - 1)) invalid(`${path}.index`);
      const rest = page.layers.filter((l) => l.id !== item.id).sort((a, b) => a.order - b.order);
      rest.splice(op.index, 0, item);
      renumber(rest);
      return;
    }
    case "group": {
      const found = [...new Set(op.shapes)].map((id) => findShape(doc, id));
      for (const f of found) requireUnlocked(f.page, f.item);
      const page = found[0]?.page;
      if (!page || found.length < 2 || found.some((f) => f.page.id !== page.id)) invalid(`${path}.shapes`);
      if (new Set(found.map((f) => f.item.layer)).size !== 1) invalid(`${path}.layer`);
      const members = found.map((f) => f.item.id);
      for (const g of page.groups) g.members = g.members.filter((m) => !members.includes(m));
      const id = ctx.newId("g_", op.clientRef);
      page.groups.push({ id, members });
      ids[op.clientRef] = id;
      return;
    }
    case "ungroup": {
      const { page, item } = findGroup(doc, op.group);
      for (const m of item.members) {
        const shape = page.shapes.find((s) => s.id === m);
        if (shape) requireUnlocked(page, shape);
      }
      page.groups = page.groups.filter((g) => g.id !== item.id);
      return;
    }
    case "set_z": {
      const { page, item } = findShape(doc, op.shape);
      requireUnlocked(page, item);
      const peers = page.shapes.filter((s) => s.layer === item.layer).sort((a, b) => a.z - b.z);
      const index = peers.indexOf(item);
      const other = peers[op.direction === "forward" ? index + 1 : index - 1];
      if (other) [item.z, other.z] = [other.z, item.z];
      return;
    }
    case "batch":
      op.ops.forEach((sub, i) => applyOne(doc, sub, ctx, ids, `${path}.ops.${i}`));
      return;
    case "undo":
    case "restore":
      return;
  }
}

/** Recomputes routes on the given pages and reports which stored routes changed. */
function reroute(doc: DiagramDocument, pages: Set<string>, before: Map<string, Point[]>): { rerouted: string[]; routes: Record<string, Point[]> } {
  const rerouted: string[] = [];
  const routes: Record<string, Point[]> = {};
  for (const page of doc.pages) {
    if (!pages.has(page.id)) continue;
    const results = routePage(page);
    for (const c of page.connectors) {
      const result = results.get(c.id);
      if (result) c.route = result.route;
      const old = before.get(c.id);
      if (!old || !same(old, c.route)) routes[c.id] = c.route;
      if (old && !same(old, c.route)) rerouted.push(c.id);
    }
  }
  return { rerouted: rerouted.sort(), routes };
}

function pagesTouched(changes: Change[]): Set<string> {
  const pages = new Set<string>();
  for (const c of changes) {
    const [type, id] = c.key.split(":") as [string, string];
    if (type === "page") pages.add(id);
    for (const record of [c.before, c.after]) if (record && typeof record.page === "string") pages.add(record.page);
  }
  return pages;
}

/** Applies one operation to a copy of the document: state, normalisation, routes and the patch. */
export function commit(doc: DiagramDocument, op: Op, ctx: ApplyContext): Committed {
  const before = flatten(doc);
  const routesBefore = routesOf(doc);
  const ids: Record<string, string> = {};
  let next: DiagramDocument;
  if (op.kind === "undo") {
    const flat = new Map(before);
    applyReverse(flat, ctx.changesOf(op.seq));
    next = unflatten(doc, flat, routesBefore);
  } else if (op.kind === "restore") {
    const version = ctx.versionDocument(op.version);
    next = unflatten(doc, flatten(version), routesOf(version));
  } else {
    next = structuredClone(doc);
    applyOne(next, op, ctx, ids, "op");
  }
  normalise(next);
  const settled = unflatten(doc, flatten(next), routesOf(next));
  const { changes, touched } = diff(before, flatten(settled));
  const { rerouted, routes } = reroute(settled, pagesTouched(changes), routesBefore);
  return { document: settled, ids, changes, touched, rerouted, routes };
}

/** Applies a broadcast patch and its routes to a document (the browser's confirmed copy). */
export function applyBroadcast(doc: DiagramDocument, changes: Change[], routes: Record<string, Point[]>, seq: number): DiagramDocument {
  const flat = flatten(doc);
  applyForward(flat, changes);
  const known = routesOf(doc);
  for (const [id, route] of Object.entries(routes)) known.set(id, route);
  return unflatten({ id: doc.id, title: doc.title, seq }, flat, known);
}

/** Ids of the shapes a set of changes touches, for notices. */
export function changedShapeIds(changes: Change[]): string[] {
  return changes.filter((c) => c.key.startsWith("shape:")).map((c) => c.key.slice(6));
}
