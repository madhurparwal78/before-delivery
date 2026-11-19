// The single place creature positions are decided.

import { Config } from "./config";
import { Heading, Tile } from "./world";

export type Presence = "always" | "dusk" | "rain";

export interface CreatureSpec {
  readonly id: string;
  readonly name: string;
  readonly island: number;
  readonly size: number;
  readonly presence: Presence;
  readonly route:
    | { kind: "stay"; tile: Tile; heading: Heading }
    | { kind: "patrol"; a: Tile; b: Tile; ticksPerTile: number };
}

export const CREATURES: readonly CreatureSpec[] = [
  { id: "mossback-newt", name: "Mossback newt", island: 1, size: 1, presence: "always", route: { kind: "stay", tile: [12, 6], heading: "S" } },
  { id: "reedpipe-heron", name: "Reedpipe heron", island: 1, size: 2, presence: "always", route: { kind: "patrol", a: [6, 16], b: [10, 16], ticksPerTile: 10 } },
  { id: "gloamfin-moth", name: "Gloamfin moth", island: 1, size: 1, presence: "dusk", route: { kind: "stay", tile: [18, 12], heading: "W" } },
  { id: "puddle-lark", name: "Puddle lark", island: 1, size: 1, presence: "rain", route: { kind: "patrol", a: [4, 4], b: [4, 9], ticksPerTile: 5 } },
  { id: "bracken-hare", name: "Bracken hare", island: 2, size: 1, presence: "always", route: { kind: "patrol", a: [8, 8], b: [14, 8], ticksPerTile: 6 } },
  { id: "mossfern-stag", name: "Mossfern stag", island: 2, size: 3, presence: "always", route: { kind: "patrol", a: [12, 13], b: [12, 18], ticksPerTile: 8 } },
  { id: "lantern-toad", name: "Lantern toad", island: 2, size: 1, presence: "dusk", route: { kind: "stay", tile: [16, 12], heading: "W" } },
  { id: "drizzle-snail", name: "Drizzle snail", island: 2, size: 1, presence: "rain", route: { kind: "stay", tile: [20, 6], heading: "S" } },
  { id: "glasswing-crab", name: "Glasswing crab", island: 3, size: 1, presence: "always", route: { kind: "patrol", a: [3, 6], b: [9, 6], ticksPerTile: 6 } },
  { id: "tidewhistle-otter", name: "Tidewhistle otter", island: 3, size: 2, presence: "always", route: { kind: "patrol", a: [15, 16], b: [20, 16], ticksPerTile: 8 } },
  { id: "duskshell-snipe", name: "Duskshell snipe", island: 3, size: 1, presence: "dusk", route: { kind: "stay", tile: [6, 12], heading: "E" } },
  { id: "rainbead-gecko", name: "Rainbead gecko", island: 3, size: 1, presence: "rain", route: { kind: "patrol", a: [15, 3], b: [15, 8], ticksPerTile: 5 } },
  { id: "cragtail-goat", name: "Cragtail goat", island: 4, size: 2, presence: "always", route: { kind: "patrol", a: [8, 14], b: [8, 20], ticksPerTile: 10 } },
  { id: "fell-mouse", name: "Fell mouse", island: 4, size: 1, presence: "always", route: { kind: "patrol", a: [15, 4], b: [20, 4], ticksPerTile: 4 } },
  { id: "mistcrown-owl", name: "Mistcrown owl", island: 4, size: 2, presence: "dusk", route: { kind: "stay", tile: [14, 8], heading: "S" } },
  { id: "cloudpuff-vole", name: "Cloudpuff vole", island: 4, size: 1, presence: "rain", route: { kind: "stay", tile: [6, 4], heading: "E" } },
  { id: "beacon-gull", name: "Beacon gull", island: 5, size: 2, presence: "always", route: { kind: "patrol", a: [12, 20], b: [18, 20], ticksPerTile: 6 } },
  { id: "shingle-plover", name: "Shingle plover", island: 5, size: 1, presence: "always", route: { kind: "patrol", a: [4, 12], b: [4, 18], ticksPerTile: 5 } },
  { id: "wickwing-bat", name: "Wickwing bat", island: 5, size: 1, presence: "dusk", route: { kind: "stay", tile: [8, 8], heading: "S" } },
  { id: "sleetfoot-fox", name: "Sleetfoot fox", island: 5, size: 2, presence: "rain", route: { kind: "patrol", a: [13, 4], b: [13, 10], ticksPerTile: 8 } }
];

export function creatureById(id: string): CreatureSpec | undefined {
  return CREATURES.find(c => c.id === id);
}

export function creaturesOfIsland(island: number): CreatureSpec[] {
  return CREATURES.filter(c => c.island === island);
}

export function isPresent(c: CreatureSpec, hour: number, weather: "clear" | "rain"): boolean {
  if (c.presence === "always") return true;
  if (c.presence === "dusk") return isDuskHour(hour);
  return weather === "rain";
}

function isDuskHour(hour: number): boolean {
  return hour >= duskBounds.start && hour < duskBounds.end;
}

// Dusk bounds are injected from config by the server bootstrap (setDuskBounds).
let duskBounds = { start: 18, end: 20 };
let rainBounds = { start: 6, end: 9 };

export function setPresenceBounds(dusk: { start: number; end: number }, rain: { start: number; end: number }): void {
  duskBounds = dusk;
  rainBounds = rain;
}

export function rainHours(): { start: number; end: number } {
  return rainBounds;
}

export function isRainHour(hour: number): boolean {
  return hour >= rainBounds.start && hour < rainBounds.end;
}

/**
 * The route rule. A patrol from A to B covers L tiles at p ticks per tile.
 * With k = floor(tick / p) mod 2L: for k < L the creature stands k tiles from A
 * towards B facing towards B; otherwise it stands (k - L) tiles from B towards A
 * facing towards A. A staying creature never moves.
 */
export function creatureAt(spec: CreatureSpec, tick: number): { x: number; y: number; heading: Heading } {
  const r = spec.route;
  if (r.kind === "stay") return { x: r.tile[0], y: r.tile[1], heading: r.heading };
  const [ax, ay] = r.a;
  const [bx, by] = r.b;
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  const L = Math.abs(bx - ax) + Math.abs(by - ay);
  const p = r.ticksPerTile;
  const k = Math.floor(tick / p) % (2 * L);
  if (k < L) {
    return { x: ax + dx * k, y: ay + dy * k, heading: headingOf(dx, dy) };
  }
  const back = k - L;
  return { x: bx - dx * back, y: by - dy * back, heading: headingOf(-dx, -dy) };
}

function headingOf(dx: number, dy: number): Heading {
  if (dx === 1) return "E";
  if (dx === -1) return "W";
  if (dy === 1) return "S";
  return "N";
}

/** Weather is decided here: rain falls within the rain hours of the world day. */
export function weatherAt(tick: number, config: Config): "clear" | "rain" {
  const hour = hourOfTick(tick, config.worldDayTicks);
  return hour >= config.rainStartHour && hour < config.rainEndHour ? "rain" : "clear";
}

export function isDusk(tick: number, config: Config): boolean {
  const hour = hourOfTick(tick, config.worldDayTicks);
  return hour >= config.duskStartHour && hour < config.duskEndHour;
}

export function hourOfTick(tick: number, dayTicks: number): number {
  return Math.floor(((tick % dayTicks) + dayTicks) % dayTicks * 24 / dayTicks);
}

export function minuteOfTick(tick: number, dayTicks: number): number {
  const perHour = dayTicks / 24;
  return Math.floor((((tick % dayTicks) + dayTicks) % dayTicks % perHour) * 60 / perHour);
}

export function timeOfTick(tick: number, dayTicks: number): string {
  const h = hourOfTick(tick, dayTicks);
  const m = minuteOfTick(tick, dayTicks);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface CreatureState {
  readonly id: string;
  readonly name: string;
  readonly island: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly heading: Heading;
}

/** Every creature present on all islands at a tick, sorted by id. */
export function presentCreatures(tick: number, config: Config): CreatureState[] {
  const weather = weatherAt(tick, config);
  const hour = hourOfTick(tick, config.worldDayTicks);
  const out: CreatureState[] = [];
  for (const c of CREATURES) {
    if (!isPresent(c, hour, weather)) continue;
    const p = creatureAt(c, tick);
    out.push({ id: c.id, name: c.name, island: c.island, size: c.size, x: p.x, y: p.y, heading: p.heading });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The `data-creatures` hook value for one island. */
export function creatureListForIsland(states: readonly CreatureState[], island: number): string {
  return states
    .filter(c => c.island === island)
    .map(c => `${c.id}@${c.x},${c.y},${c.heading}`)
    .join(";");
}
