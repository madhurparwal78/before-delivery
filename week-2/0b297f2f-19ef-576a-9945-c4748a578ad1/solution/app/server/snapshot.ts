// Frozen lender snapshots (brief: Business rules, Snapshots): only that lender's works, no insurance
// values, registrar notes or other lenders.
import { CENTRE_LINE_MM } from "./domain/hang.js";
import type { Placement, Wall } from "./model.js";
import { Raster, type Rgb } from "./png.js";

interface SnapshotWork {
  title: string;
  objectNumber: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
}

interface Snapshot {
  exhibition: { title: string; runStart: string; runEnd: string };
  lender: { name: string };
  publishedAt: string;
  publishedAtDisplay: string;
  walls: { id: string; name: string; lengthMm: number; heightMm: number }[];
  works: SnapshotWork[];
}

export function snapshotFor(
  exhibition: Snapshot["exhibition"],
  lenderName: string,
  publishedAt: Date,
  publishedAtDisplay: string,
  walls: Wall[],
  placements: Placement[],
): Snapshot {
  const order = walls.map((w) => w.id);
  const works = [...placements]
    .sort((a, b) => order.indexOf(a.wallId) - order.indexOf(b.wallId) || a.offsetMm - b.offsetMm)
    .map((p) => ({
      title: p.objectTitle,
      objectNumber: p.objectNumber,
      wallName: p.wallName,
      offsetMm: p.offsetMm,
      centreHeightMm: p.centreHeightMm,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
    }));
  return {
    exhibition,
    lender: { name: lenderName },
    publishedAt: publishedAt.toISOString(),
    publishedAtDisplay,
    walls: walls.map((w) => ({ id: w.id, name: w.name, lengthMm: w.lengthMm, heightMm: w.heightMm })),
    works,
  };
}

const PLASTER: Rgb = [243, 240, 232];
const STONE: Rgb = [184, 176, 162];
const INK: Rgb = [28, 27, 24];
const ACCENT: Rgb = [181, 80, 28];
const FRAME_FILL: Rgb = [236, 231, 220];

/** Flat elevation drawing: each wall a warm grey band to scale, works ink-outlined, 145 cm in accent. */
export function snapshotPng(snapshot: Snapshot): Buffer {
  const scale = 1 / 20; // 1 px per 20 mm
  const margin = 24;
  const gap = 28;
  const longest = Math.max(...snapshot.walls.map((w) => w.lengthMm));
  const width = Math.round(longest * scale) + margin * 2;
  const height = margin * 2 + snapshot.walls.reduce((sum, w) => sum + Math.round(w.heightMm * scale) + gap, -gap);
  const raster = new Raster(width, height, PLASTER);
  let top = margin;
  for (const wall of snapshot.walls) {
    const bandH = Math.round(wall.heightMm * scale);
    const bandW = Math.round(wall.lengthMm * scale);
    raster.fill(margin, top, bandW, bandH, STONE);
    raster.fill(margin, top + bandH - Math.round(CENTRE_LINE_MM * scale), bandW, 1, ACCENT);
    for (const work of snapshot.works.filter((w) => w.wallName === wall.name)) {
      const x = margin + (work.offsetMm - work.widthMm / 2) * scale;
      const y = top + bandH - (work.centreHeightMm + work.heightMm / 2) * scale;
      const w = Math.max(2, work.widthMm * scale);
      const h = Math.max(2, work.heightMm * scale);
      raster.fill(x, y, w, h, FRAME_FILL);
      raster.outline(x, y, w, h, INK, 2);
    }
    raster.fill(margin, top + bandH, bandW, 2, INK);
    top += bandH + gap;
  }
  return raster.png();
}
