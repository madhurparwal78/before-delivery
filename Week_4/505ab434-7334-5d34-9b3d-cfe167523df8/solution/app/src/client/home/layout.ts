// The rulebook assembly as one pure function: every block's rectangle and opacity at a scroll progress
// (brief: Motion and effects / Rulebook assembly). Nothing here reads the DOM or a clock.

/** Scroll distance, in pixels, over which the home stage stays pinned. */
export const STAGE_SCROLL = 2700;

export const TILE_IDS = ["logo", "voice", "colour", "typography", "iconography", "motion", "library", "rules"] as const;
export type TileId = (typeof TILE_IDS)[number];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed extends Rect {
  opacity: number;
  /** 0..1: how much of a not-yet-introduced block is revealed from its centre. */
  reveal: number;
}

export interface Line {
  axis: "x" | "y";
  at: number;
  opacity: number;
}

interface StageLayout {
  hero: Placed;
  card: Placed;
  /** Opacity of the card's statement; its mark stays. */
  statement: number;
  tiles: Record<TileId, Placed>;
  /** Outer corner radius of the mosaic (8px at the end). */
  radius: number;
  lines: Line[];
}

const MARGIN = 10;
const GUTTER = 10;
const MARK_TILE = 90;
const COLUMNS = [1, 1.75, 1.4, 1] as const;

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
const segment = (p: number, from: number, to: number): number => clamp((p - from) / (to - from));

/** Final mosaic slots for a viewport: four columns of unequal width, three rows, thin gutters and margin. */
function mosaicSlots(width: number, height: number): { tiles: Record<TileId, Rect>; mark: Rect } {
  const free = width - 2 * MARGIN - 3 * GUTTER;
  const total = COLUMNS.reduce((a, b) => a + b, 0);
  const colW = COLUMNS.map((c) => (free * c) / total);
  const colX = colW.map((_, i) => MARGIN + colW.slice(0, i).reduce((a, b) => a + b + GUTTER, 0));
  const rowH = [(height - 2 * MARGIN - 2 * GUTTER - MARK_TILE) / 2, MARK_TILE, (height - 2 * MARGIN - 2 * GUTTER - MARK_TILE) / 2];
  const rowY = rowH.map((_, i) => MARGIN + rowH.slice(0, i).reduce((a, b) => a + b + GUTTER, 0));
  const cell = (col: number, row: number, rows = 1): Rect => ({
    x: colX[col],
    y: rowY[row],
    w: colW[col],
    h: rowH.slice(row, row + rows).reduce((a, b) => a + b, 0) + GUTTER * (rows - 1),
  });
  return {
    tiles: {
      logo: cell(0, 0, 2),
      voice: cell(1, 0),
      colour: cell(2, 0, 2),
      typography: cell(3, 0),
      iconography: cell(0, 2),
      motion: cell(1, 2),
      library: cell(2, 2),
      rules: cell(3, 1, 2),
    },
    mark: { x: colX[1], y: rowY[1], w: MARK_TILE, h: MARK_TILE },
  };
}

function edges(blocks: { rect: Rect; opacity: number }[], width: number, height: number): Line[] {
  const found = new Map<string, Line>();
  const note = (axis: "x" | "y", at: number, opacity: number): void => {
    const limit = axis === "x" ? width : height;
    if (opacity <= 0.001 || at < 0 || at > limit) return;
    const key = `${axis}${Math.round(at)}`;
    const seen = found.get(key);
    if (!seen || seen.opacity < opacity) found.set(key, { axis, at: Math.round(at), opacity });
  };
  for (const { rect, opacity } of blocks) {
    note("x", rect.x, opacity);
    note("x", rect.x + rect.w, opacity);
    note("y", rect.y, opacity);
    note("y", rect.y + rect.h, opacity);
  }
  return [...found.values()];
}

/** Rectangles and opacities of every block at progress `p` (0 at the top of the pinned stage, 1 after 2,700px). */
export function stageLayout(width: number, height: number, p: number): StageLayout {
  const k = Math.min(width / 1280, height / 800);
  const card0 = 500 * k;
  const card1 = 416 * k;
  const centre = (size: number): Rect => ({ x: (width - size) / 2, y: (height - size) / 2, w: size, h: size });
  const slots = mosaicSlots(width, height);

  const heroW = Math.min(800, width - 32);
  const hero: Placed = { x: (width - heroW) / 2, y: 50, w: heroW, h: height - 100, opacity: 1 - segment(p, 0, 0.12), reveal: 1 };

  const t3 = segment(p, 0.5, 0.75);
  const t4 = segment(p, 0.75, 0.95);
  const cardSize = p < 0.2 ? card0 * (0.7 + 0.3 * segment(p, 0, 0.2)) : p < 0.5 ? card0 : lerp(card0, card1, t3);
  const card: Placed = {
    ...(t4 > 0 ? lerpRect(centre(card1), slots.mark, t4) : centre(cardSize)),
    opacity: segment(p, 0.1, 0.2),
    reveal: 1,
  };
  const statement = 1 - segment(p, 0.5, 0.65);

  const visible = p < 0.2 ? 70 * k * segment(p, 0.12, 0.2) : p < 0.5 ? lerp(70 * k, 195 * k, segment(p, 0.2, 0.5)) : lerp(195 * k, 394 * k, t3);
  // The field's box reaches 70px past the viewport edge so its glyph shows cropped there.
  const boxW = visible + 70 * k;
  const peek = lerp(0, 0.14 * height, t3);
  const onStage: Record<"colour" | "logo" | "voice" | "rules", Rect> = {
    colour: { x: visible - boxW, y: 0.42 * height, w: boxW, h: 0.58 * height },
    logo: { x: width - visible, y: 0, w: boxW, h: 0.58 * height },
    voice: { x: 0.045 * width, y: peek - 0.42 * height, w: 0.5 * width, h: 0.42 * height },
    rules: { x: 0.455 * width, y: height - peek, w: 0.5 * width, h: 0.42 * height },
  };
  const tiles = {} as Record<TileId, Placed>;
  // Fields cross on their way to their slots, so each block moves in its own stretch of progress.
  const travel: Record<"colour" | "logo" | "voice" | "rules", number> = {
    voice: segment(p, 0.75, 0.88),
    rules: segment(p, 0.75, 0.88),
    colour: segment(p, 0.78, 0.95),
    logo: segment(p, 0.78, 0.95),
  };
  const arrival = segment(p, 0.93, 1);
  for (const id of TILE_IDS) {
    const staged = id === "colour" || id === "logo" || id === "voice" || id === "rules";
    const rect = staged ? lerpRect(onStage[id], slots.tiles[id], travel[id]) : slots.tiles[id];
    tiles[id] = { ...rect, opacity: staged ? 1 : clamp(arrival * 3), reveal: staged ? 1 : arrival };
  }

  const blocks = [
    { rect: hero, opacity: hero.opacity },
    { rect: card, opacity: card.opacity },
    ...TILE_IDS.map((id) => ({ rect: tiles[id], opacity: tiles[id].opacity * (tiles[id].reveal > 0 ? 1 : 0) })),
  ];
  return { hero, card, statement, tiles, radius: 8 * segment(p, 0.9, 1), lines: edges(blocks, width, height) };
}
