import { DIRECTIONS, EARSHOT_REACH, type Direction, type Layout } from "../shared/protocol.js";

/** Where a person stands, as kept in the session's positions hash. */
export interface Stance {
  x: number;
  y: number;
  facing: Direction;
  seated: boolean;
  from: { x: number; y: number } | null;
  at: number;
}

export const tileKey = (x: number, y: number): string => `${x},${y}`;

const DELTAS: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export const stanceRecord = (stance: Stance): string =>
  JSON.stringify({ x: stance.x, y: stance.y, facing: stance.facing, seated: stance.seated, from: stance.from, at: stance.at });

export const readStance = (record: string): Stance => JSON.parse(record) as Stance;

/** Chebyshev distance: the larger of the two gaps. */
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const withinReach = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => distance(a, b) <= EARSHOT_REACH;

type Plan =
  | { kind: "refused"; text: string }
  | { kind: "turn" }
  | { kind: "move"; x: number; y: number }
  | { kind: "exit"; x: number; y: number };

const insideGrid = (layout: Layout, x: number, y: number): boolean => x >= 0 && y >= 0 && x < layout.width && y < layout.height;
const isWall = (layout: Layout, x: number, y: number): boolean => layout.walls.some((wall) => wall.x === x && wall.y === y);
const seatAt = (layout: Layout, x: number, y: number): Layout["seats"][number] | undefined => layout.seats.find((seat) => seat.x === x && seat.y === y);
const exitAt = (layout: Layout, x: number, y: number): Layout["exits"][number] | undefined => layout.exits.find((exit) => exit.x === x && exit.y === y);

/** What a direction press does for someone standing, by the layout of their own room version. */
export function planStep(layout: Layout, stance: Stance, direction: Direction, occupied: (x: number, y: number) => boolean): Plan {
  if (stance.seated) return { kind: "refused", text: "Stand up to move." };
  if (stance.facing !== direction) return { kind: "turn" };
  const x = stance.x + DELTAS[direction].x;
  const y = stance.y + DELTAS[direction].y;
  if (!insideGrid(layout, x, y) || isWall(layout, x, y)) return { kind: "refused", text: "A wall blocks that way." };
  if (seatAt(layout, x, y)) return { kind: "refused", text: "A seat blocks that way." };
  if (exitAt(layout, x, y)) return { kind: "exit", x, y };
  if (occupied(x, y)) return { kind: "refused", text: "Someone is standing there." };
  return { kind: "move", x, y };
}

type Sit = { kind: "refused"; text: string } | { kind: "sit"; x: number; y: number };

export function planSit(layout: Layout, stance: Stance, occupied: (x: number, y: number) => boolean): Sit {
  if (stance.seated) return { kind: "refused", text: "You are already seated." };
  const seat = seatAt(layout, stance.x + DELTAS[stance.facing].x, stance.y + DELTAS[stance.facing].y);
  if (!seat) return { kind: "refused", text: "No seat in front of you." };
  if (occupied(seat.x, seat.y)) return { kind: "refused", text: "That seat is taken." };
  return { kind: "sit", x: seat.x, y: seat.y };
}

type Stand = { kind: "refused"; text: string } | { kind: "stand"; x: number; y: number };

const standable = (layout: Layout, x: number, y: number, occupied: (x: number, y: number) => boolean): boolean =>
  insideGrid(layout, x, y) && !isWall(layout, x, y) && !seatAt(layout, x, y) && !exitAt(layout, x, y) && !occupied(x, y);

/** Back to the tile sat from, else the first free neighbour of the seat in north, east, south, west order. */
export function planStand(layout: Layout, stance: Stance, occupied: (x: number, y: number) => boolean): Stand {
  if (!stance.seated || !stance.from) return { kind: "refused", text: "You are not seated." };
  if (standable(layout, stance.from.x, stance.from.y, occupied)) return { kind: "stand", x: stance.from.x, y: stance.from.y };
  for (const direction of DIRECTIONS) {
    const x = stance.x + DELTAS[direction].x;
    const y = stance.y + DELTAS[direction].y;
    if (standable(layout, x, y, occupied)) return { kind: "stand", x, y };
  }
  return { kind: "refused", text: "No space to stand." };
}

/** Free spawn tiles in list order, then every other free tile from the north row, west to east. */
export function spawnCandidates(layout: Layout, occupied: (x: number, y: number) => boolean): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = layout.spawn.filter((tile) => !occupied(tile.x, tile.y));
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      if (standable(layout, x, y, occupied) && !found.some((tile) => tile.x === x && tile.y === y)) found.push({ x, y });
    }
  }
  return found;
}

const isCount = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;

function tiles(value: unknown, layout: { width: number; height: number }, withId: boolean): { x: number; y: number; id?: string }[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const found: { x: number; y: number; id?: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { x, y, id } = item as { x?: unknown; y?: unknown; id?: unknown };
    if (!isCount(x, 0, layout.width - 1) || !isCount(y, 0, layout.height - 1)) return null;
    if (withId) {
      if (typeof id !== "string" || id === "") return null;
      found.push({ id, x, y });
    } else found.push({ x, y });
  }
  return found;
}

/** A layout as the brief shapes it, or null when it breaks a rule. */
export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isCount(raw.width, 4, 40) || !isCount(raw.height, 4, 40)) return null;
  const size = { width: raw.width, height: raw.height };
  const spawn = tiles(raw.spawn, size, false);
  const walls = tiles(raw.walls, size, false);
  const seats = tiles(raw.seats, size, true);
  const exits = tiles(raw.exits, size, true);
  if (!spawn || spawn.length === 0 || !walls || !seats || !exits) return null;
  const all = [...spawn, ...walls, ...seats, ...exits];
  if (new Set(all.map((tile) => tileKey(tile.x, tile.y))).size !== all.length) return null;
  const ids = [...seats, ...exits].map((tile) => tile.id);
  if (new Set(ids).size !== ids.length) return null;
  return {
    ...size,
    spawn: spawn.map(({ x, y }) => ({ x, y })),
    walls: walls.map(({ x, y }) => ({ x, y })),
    seats: seats.map(({ id, x, y }) => ({ id: id ?? "", x, y })),
    exits: exits.map(({ id, x, y }) => ({ id: id ?? "", x, y })),
  };
}
