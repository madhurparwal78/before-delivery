import type { Model } from "./model.js";

export const COLOURS = ["slate", "blue", "violet", "green", "amber", "red"] as const;
export type Colour = (typeof COLOURS)[number];

export const DEFAULT_ENTITY_COLOUR: Colour = "slate";
export const DEFAULT_GROUP_COLOUR: Colour = "blue";
export const GRID_MAX = 500;
export const GRID_STEP_PX = 20;
export const CELL_WIDTH = 14;
export const CELL_HEIGHT = 12;
const CELLS_PER_ROW = 8;

export interface EntityLayout {
  x: number;
  y: number;
  color: Colour;
}

export interface Layout {
  entities: Record<string, EntityLayout>;
  groups: Record<string, { color: Colour }>;
}

export function emptyLayout(): Layout {
  return { entities: {}, groups: {} };
}

export function isColour(value: unknown): value is Colour {
  return typeof value === "string" && (COLOURS as readonly string[]).includes(value);
}

export function isGridPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= GRID_MAX;
}

export function cell(k: number): { x: number; y: number } {
  return { x: CELL_WIDTH * (k % CELLS_PER_ROW), y: Math.min(GRID_MAX, CELL_HEIGHT * Math.floor(k / CELLS_PER_ROW)) };
}

/**
 * Brings a layout in step with a valid parse: drops entries for entities and groups that are gone,
 * and places new entities, in text order, each in the first unoccupied cell.
 */
export function syncLayout(layout: Layout, model: Model): Layout {
  const entities: Record<string, EntityLayout> = {};
  for (const entity of model.entities) {
    const existing = layout.entities[entity.name];
    if (existing) entities[entity.name] = { ...existing };
  }
  const occupied = new Set(Object.values(entities).map((p) => `${p.x},${p.y}`));
  // Once rows clamp at the bound only eight distinct cells remain per row, so the search is bounded.
  const lastCell = CELLS_PER_ROW * (Math.floor(GRID_MAX / CELL_HEIGHT) + 2);
  let k = 0;
  for (const entity of model.entities) {
    if (entities[entity.name]) continue;
    while (k < lastCell && occupied.has(`${cell(k).x},${cell(k).y}`)) k++;
    const position = cell(k);
    entities[entity.name] = { ...position, color: DEFAULT_ENTITY_COLOUR };
    occupied.add(`${position.x},${position.y}`);
  }
  const groups: Record<string, { color: Colour }> = {};
  for (const group of model.groups) {
    groups[group.name] = { color: layout.groups[group.name]?.color ?? DEFAULT_GROUP_COLOUR };
  }
  return { entities, groups };
}

export function arrangeLayout(layout: Layout, model: Model): Layout {
  const entities: Record<string, EntityLayout> = {};
  model.entities.forEach((entity, k) => {
    entities[entity.name] = { ...cell(k), color: layout.entities[entity.name]?.color ?? DEFAULT_ENTITY_COLOUR };
  });
  return { entities, groups: { ...layout.groups } };
}

export function layoutsEqual(a: Layout, b: Layout): boolean {
  return JSON.stringify(sortLayout(a)) === JSON.stringify(sortLayout(b));
}

function sortLayout(layout: Layout): Layout {
  const entities: Record<string, EntityLayout> = {};
  for (const name of Object.keys(layout.entities).sort()) {
    const e = layout.entities[name]!;
    entities[name] = { x: e.x, y: e.y, color: e.color };
  }
  const groups: Record<string, { color: Colour }> = {};
  for (const name of Object.keys(layout.groups).sort()) groups[name] = { color: layout.groups[name]!.color };
  return { entities, groups };
}
