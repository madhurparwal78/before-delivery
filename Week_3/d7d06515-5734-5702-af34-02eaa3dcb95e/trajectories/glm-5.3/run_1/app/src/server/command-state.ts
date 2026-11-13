import { db } from "./db.js";
import { bad, validation } from "./errors.js";
import { round } from "../shared/format.js";
import { derive, objectSnaps } from "./domain/objects.js";
export interface DrawingRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  name_lower: string;
  units: string;
  plot_style: string;
  version: number;
  next_handle: string;
  max_handle_used: number;
  trace_counter: number;
  export_count: number;
  modified_epoch: string;
  created_epoch: string;
  sample: boolean;
}
import type { Point } from "../shared/types.js";

export interface CommandOutcome {
  created: Map<string, StoredObject>;
  modified: Map<string, StoredObject>;
  erased: Set<string>;
  locked: Set<string>;
  history: string | null;
  /** Layer changes carry their own announcement instead of object activity. */
  layerActivity: { command: string; announcement: string | null } | null;
}

export interface StoredObject {
  handle: string;
  type: string;
  layer: string;
  geometry: Record<string, unknown>;
}

export function newOutcome(): CommandOutcome {
  return {
    created: new Map(),
    modified: new Map(),
    erased: new Set(),
    locked: new Set(),
    history: null,
    layerActivity: null,
  };
}

export interface DrawingSnapshot {
  drawing: DrawingRow;
  objects: Array<StoredObject & { props: Record<string, unknown> }>;
  layers: Array<{
    name: string;
    color: string;
    linetype: string;
    lineweight: string;
    on: boolean;
    frozen: boolean;
    locked: boolean;
    current: boolean;
    position: number;
  }>;
  layouts: Array<{ name: string; viewport_scale: string; position: number }>;
  xrefs: Array<{ id: string; source_drawing_id: string; name: string; status: string }>;
  modelUnits: "mm" | "m";
  plotStyle: string;
}

export async function loadSnapshot(drawingId: string): Promise<DrawingSnapshot> {
  const drawing = await db.one<DrawingRow>(`select * from drawings where id = $1`, [drawingId]);
  if (!drawing) throw bad("not_found");
  const objects = await db.all<{
    handle: string;
    type: string;
    layer: string;
    color: string;
    linetype: string;
    linetype_scale: string;
    lineweight: string;
    dimension_style: string;
    text_style: string;
    multileader_style: string;
    geometry: Record<string, unknown>;
  }>(`select * from objects where drawing_id = $1 order by created_epoch, handle`, [drawingId]);
  const layers = await db.all<{
    name: string;
    color: string;
    linetype: string;
    lineweight: string;
    on: boolean;
    frozen: boolean;
    locked: boolean;
    current: boolean;
    position: number;
  }>(`select name, color, linetype, lineweight, is_on as "on", frozen, locked, current, position from layers where drawing_id = $1 order by position`, [drawingId]);
  const layouts = await db.all<{ name: string; viewport_scale: string; position: number }>(
    `select name, viewport_scale, position from layouts where drawing_id = $1 order by position`,
    [drawingId],
  );
  const xrefs = await db.all<{ id: string; source_drawing_id: string; name: string; status: string }>(
    `select id, source_drawing_id, name, status from xrefs where drawing_id = $1 order by id`,
    [drawingId],
  );
  return {
    drawing,
    objects: objects.map((o) => ({
      handle: o.handle,
      type: o.type,
      layer: o.layer,
      geometry: o.geometry,
      props: {
        color: o.color,
        linetype: o.linetype,
        linetype_scale: Number(o.linetype_scale),
        lineweight: o.lineweight,
        dimension_style: o.dimension_style,
        text_style: o.text_style,
        multileader_style: o.multileader_style,
      },
    })),
    layers,
    layouts,
    xrefs,
    modelUnits: drawing.units as "mm" | "m",
    plotStyle: drawing.plot_style,
  };
}

export function isDrawingCommand(command: string): boolean {
  return [
    "LINE",
    "PLINE",
    "RECTANG",
    "CIRCLE",
    "ARC",
    "POLYGON",
    "SPLINE",
    "MTEXT",
    "INSERT",
    "DIMLINEAR",
    "DIMALIGNED",
    "DIMRADIUS",
    "DIMANGULAR",
    "MOVE",
    "COPY",
    "ROTATE",
    "SCALE",
    "MIRROR",
    "ERASE",
    "OFFSET",
    "TRIM",
    "EXTEND",
    "FILLET",
    "PROPERTIES",
  ].includes(command);
}

export function pointArg(value: unknown, field: string): Point {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    throw validation({ [field]: "Invalid point." });
  }
  return [round(value[0], 6), round(value[1], 6)];
}

export function numberArg(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validation({ [field]: "Enter a number." });
  }
  return value;
}

export function positiveArg(value: unknown, field: string): number {
  const n = numberArg(value, field);
  if (n <= 0) throw validation({ [field]: "Requires a positive number." });
  return n;
}

export function handlesArg(args: Record<string, unknown>): string[] {
  const value = args.handles;
  if (!Array.isArray(value)) throw validation({ handles: "No object found." });
  const handles = value.filter((h): h is string => typeof h === "string" && h !== "");
  if (handles.length === 0) throw validation({ handles: "No object found." });
  return handles;
}

export function pointsArg(value: unknown, field: string): Point[] {
  if (!Array.isArray(value)) throw validation({ [field]: "Invalid point." });
  return value.map((p, i) => pointArg(p, `${field}[${i}]`));
}

export interface NewHandle {
  handle: string;
}

/** Handles: next after the largest used since the last full replacement, never reused. */
export class HandleAllocator {
  private next: number;

  constructor(maxUsed: number, nextStored: string) {
    const stored = Number.parseInt(nextStored, 16);
    this.next = Math.max(Number.isFinite(stored) ? stored : 16, 16, maxUsed + 1);
  }

  alloc(): string {
    const handle = this.next.toString(16).toUpperCase();
    this.next += 1;
    return handle;
  }

  get used(): number {
    return this.next - 1;
  }
}

export function objectPublic(
  o: StoredObject & { props: Record<string, unknown> },
  units: "mm" | "m",
): Record<string, unknown> {
  const snaps = objectSnaps(o.geometry, o.type);
  const derived = derive(o.type, o.geometry);
  return {
    handle: o.handle,
    type: o.type,
    layer: o.layer,
    ...o.props,
    ...o.geometry,
    ...derived,
    snaps,
  };
}

export function objectTable(o: StoredObject, props: Record<string, unknown>): Record<string, unknown> {
  return { handle: o.handle, type: o.type, layer: o.layer, ...props, geometry: o.geometry };
}
