import { Canvas, COLOURS } from './png.js';
import type { PlacementRow, WallRow, ExhibitionRow, LenderRow } from './store.js';
import { display } from './dates.js';

export interface SnapshotWork {
  title: string;
  objectNumber: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
}

export interface Snapshot {
  exhibition: { title: string; runStart: string; runEnd: string };
  lender: { name: string };
  publishedAt: string;
  publishedAtDisplay: string;
  walls: { id: string; name: string; lengthMm: number; heightMm: number }[];
  works: SnapshotWork[];
}

export function snapshotJsonBytes(snapshot: Snapshot): Buffer {
  return Buffer.from(JSON.stringify(snapshot), 'utf8');
}

export function snapshotPngBytes(snapshot: Snapshot): Buffer {
  const width = 1200;
  const wallHeightPx = 220;
  const gap = 40;
  const height = snapshot.walls.length * (wallHeightPx + gap) + gap;
  const canvas = new Canvas(width, height, COLOURS.plaster);
  let y = gap;
  for (const wall of snapshot.walls) {
    const wallWorks = snapshot.works.filter((w) => w.wallName === wall.name);
    canvas.fillRect(0, y, width, wallHeightPx, COLOURS.stone);
    const scale = width / wall.lengthMm;
    for (const work of wallWorks) {
      const w = work.widthMm * scale;
      const h = work.heightMm * scale * (wallHeightPx / wall.heightMm);
      const x = (work.offsetMm - work.widthMm / 2) * scale;
      const centreY = y + wallHeightPx - (work.centreHeightMm / wall.heightMm) * wallHeightPx;
      canvas.strokeRect(x, centreY - h / 2, w, h, 3, COLOURS.ink);
    }
    const hangLineY = y + wallHeightPx - (1450 / wall.heightMm) * wallHeightPx;
    canvas.fillRect(0, hangLineY, width, 2, COLOURS.accent);
    y += wallHeightPx + gap;
  }
  return canvas.png();
}
