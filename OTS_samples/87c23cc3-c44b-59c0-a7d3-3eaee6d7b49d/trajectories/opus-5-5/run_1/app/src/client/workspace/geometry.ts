import { GRID_STEP_PX, type Layout } from "../../shared/layout.js";
import type { Entity, Link, Model } from "../../shared/model.js";

export const ENTITY_WIDTH = 240;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 24;
export const BOX_PADDING = 6;

export interface Point {
  x: number;
  y: number;
}

export type Positions = Record<string, Point>;

/** Pixel positions of every entity at 100 percent zoom. */
export function positionsOf(layout: Layout, model: Model): Positions {
  const positions: Positions = {};
  for (const entity of model.entities) {
    const at = layout.entities[entity.name];
    positions[entity.name] = { x: (at?.x ?? 0) * GRID_STEP_PX, y: (at?.y ?? 0) * GRID_STEP_PX };
  }
  return positions;
}

export function boxHeight(entity: Entity): number {
  return HEADER_HEIGHT + entity.columns.length * ROW_HEIGHT + BOX_PADDING;
}

export function rowCenter(entity: Entity, column: string, at: Point): number {
  const index = Math.max(
    0,
    entity.columns.findIndex((c) => c.name === column),
  );
  return at.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export interface Connector {
  d: string;
  start: Point;
  end: Point;
}

/** An orthogonal connector between two column rows. */
export function linkPath(model: Model, link: Link, positions: Positions): Connector {
  const fromEntity = model.entities.find((e) => e.name === link.from.entity)!;
  const toEntity = model.entities.find((e) => e.name === link.to.entity)!;
  const a = positions[fromEntity.name]!;
  const b = positions[toEntity.name]!;
  const ay = rowCenter(fromEntity, link.from.column, a);
  const by = rowCenter(toEntity, link.to.column, b);
  if (a.x + ENTITY_WIDTH + 24 <= b.x) {
    const ax = a.x + ENTITY_WIDTH;
    const mid = Math.round((ax + b.x) / 2);
    return { d: `M ${ax} ${ay} H ${mid} V ${by} H ${b.x}`, start: { x: ax, y: ay }, end: { x: b.x, y: by } };
  }
  if (b.x + ENTITY_WIDTH + 24 <= a.x) {
    const bx = b.x + ENTITY_WIDTH;
    const mid = Math.round((a.x + bx) / 2);
    return { d: `M ${a.x} ${ay} H ${mid} V ${by} H ${bx}`, start: { x: a.x, y: ay }, end: { x: bx, y: by } };
  }
  const out = Math.max(a.x, b.x) + ENTITY_WIDTH + 28;
  return {
    d: `M ${a.x + ENTITY_WIDTH} ${ay} H ${out} V ${by} H ${b.x + ENTITY_WIDTH}`,
    start: { x: a.x + ENTITY_WIDTH, y: ay },
    end: { x: b.x + ENTITY_WIDTH, y: by },
  };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function groupBounds(model: Model, names: string[], positions: Positions): Bounds | null {
  const boxes = names
    .map((name) => {
      const entity = model.entities.find((e) => e.name === name);
      const at = positions[name];
      return entity && at ? { x: at.x, y: at.y, width: ENTITY_WIDTH, height: boxHeight(entity) } : null;
    })
    .filter((b): b is Bounds => b !== null);
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x)) - 16;
  const top = Math.min(...boxes.map((b) => b.y)) - 40;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 16;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 16;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function linkKey(link: Link): string {
  return `${link.from.entity}.${link.from.column}->${link.to.entity}.${link.to.column}`;
}
