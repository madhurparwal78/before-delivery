import { CATEGORIES, type Category } from "../../shared/api";

// What the sky shows, independent of how it is drawn: stars placed per stored sign, halos per constellation.

const ANCHORS: Record<Category, { x: number; y: number }> = {
  inner_awareness: { x: 0.25, y: 0.27 },
  action: { x: 0.75, y: 0.27 },
  form: { x: 0.25, y: 0.64 },
  context: { x: 0.75, y: 0.64 },
};

interface SkyStar {
  id: string;
  category: Category;
}

/** A value that eases from `from` to `to` between two `performance.now()` times. */
export interface Tween {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface SkyScene {
  stars: readonly SkyStar[];
  halos: Record<Category, Tween>;
  /** Fade-in windows of stars that are still settling, by sign id. */
  arrivals: ReadonlyMap<string, Tween>;
  pan: { x: number; y: number };
  /** Width kept clear at the sky's right edge for the legend chip (the tablet band); 0 elsewhere. */
  clearRight: number;
}

/** What the logbook gives the sky; the sky adds its own pan and clear edge. */
export type SceneContent = Omit<SkyScene, "pan" | "clearRight">;

interface PlacedStar {
  id: string;
  category: Category;
  x: number;
  y: number;
  size: number;
  alpha: number;
}

const settle = (t: number): number => 1 - (1 - t) ** 3;

export function tweenAt(tween: Tween, now: number): number {
  if (now >= tween.end || tween.end <= tween.start) return now >= tween.start ? tween.to : tween.from;
  if (now <= tween.start) return tween.from;
  return tween.from + (tween.to - tween.from) * settle((now - tween.start) / (tween.end - tween.start));
}

export const still = (value: number): Tween => ({ from: value, to: value, start: 0, end: 0 });

function hash(text: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function skyScale(width: number, height: number): number {
  return Math.min(1.25, Math.max(0.16, Math.min(width, height * 1.4) / 680));
}

const STRIP_ANCHORS: Record<Category, number> = { inner_awareness: 0.14, action: 0.38, form: 0.62, context: 0.86 };
/** Across the part of a band left of the legend chip: the left constellations at a fifth, the right ones at two thirds. */
const BAND_ANCHORS = { left: 0.2, right: 0.66 };

/**
 * A constellation's anchor. On a wide horizon strip the four anchors spread out along it; with a clear right edge
 * (the tablet band) they sit in the part of the sky the legend chip leaves open.
 */
export function anchorPoint(category: Category, width: number, height: number, clearRight = 0): { x: number; y: number } {
  if (width > height * 3) return { x: STRIP_ANCHORS[category] * width, y: height * 0.5 };
  const { x, y } = ANCHORS[category];
  if (clearRight <= 0) return { x: x * width, y: y * height };
  return { x: (x < 0.5 ? BAND_ANCHORS.left : BAND_ANCHORS.right) * (width - clearRight), y: y * height };
}

/** Every star at the same place on every load: its position comes from its sign id alone. */
export function placeStars(scene: SkyScene, width: number, height: number, now: number): PlacedStar[] {
  const scale = skyScale(width, height);
  return scene.stars.map((star) => {
    const anchor = anchorPoint(star.category, width, height, scene.clearRight);
    const angle = hash(star.id, 1) * Math.PI * 2;
    const reach = (10 + hash(star.id, 2) * 44) * scale;
    const arrival = scene.arrivals.get(star.id);
    return {
      id: star.id,
      category: star.category,
      x: anchor.x + Math.cos(angle) * reach * 1.3,
      y: anchor.y + Math.sin(angle) * reach,
      size: (3.8 + hash(star.id, 3) * 2.6) * Math.max(0.6, scale),
      alpha: arrival ? tweenAt(arrival, now) : 1,
    };
  });
}

/** The hairlines of each constellation: from its anchor through its stars in order around it, so every star reads as its halo's. */
export function constellationLines(placed: readonly PlacedStar[], width: number, height: number, clearRight: number): [PlacedStar, PlacedStar][] {
  const lines: [PlacedStar, PlacedStar][] = [];
  for (const category of CATEGORIES) {
    const anchor = anchorPoint(category, width, height, clearRight);
    const own = placed
      .filter((star) => star.category === category && star.alpha > 0)
      .sort((a, b) => Math.atan2(a.y - anchor.y, a.x - anchor.x) - Math.atan2(b.y - anchor.y, b.x - anchor.x));
    const nearest = own.reduce<PlacedStar | null>((best, star) => (best && Math.hypot(best.x - anchor.x, best.y - anchor.y) <= Math.hypot(star.x - anchor.x, star.y - anchor.y) ? best : star), null);
    if (nearest) lines.push([{ ...nearest, id: category, x: anchor.x, y: anchor.y }, nearest]);
    for (let i = 1; i < own.length; i++) {
      const a = own[i - 1];
      const b = own[i];
      if (a && b) lines.push([a, b]);
    }
  }
  return lines;
}

export function busy(scene: SkyScene, now: number): boolean {
  return [...scene.arrivals.values(), ...CATEGORIES.map((c) => scene.halos[c])].some((tween) => now < tween.end);
}

export const TEAL: [number, number, number] = [0x6e / 255, 0xf0 / 255, 0xdc / 255];
