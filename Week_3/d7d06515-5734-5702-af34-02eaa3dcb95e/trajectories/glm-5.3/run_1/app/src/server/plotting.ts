import { loadSnapshot } from "./command-state.js";
import { buildPdf, greyFor, textWidthOf, type PdfPage, type PdfPath, type PdfText } from "./pdf.js";
import { objectSegments } from "./domain/geometry.js";
import type { DrawingAccessInfo } from "./api/drawings.js";
import type { Point } from "../shared/types.js";

interface LayerInfo {
  name: string;
  color: string;
  linetype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  position: number;
}

const pageWidth = 420;
const pageHeight = 297;
const margin = 10;

/** A3 landscape vector sheet: viewport content plus the title block. */
export async function buildPage(input: {
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
  info: DrawingAccessInfo;
  layout: string;
  visibleLayers: Set<string>;
  layerByName: Map<string, LayerInfo>;
  titleBlock: { letter: string; footerNote: string; issued: string; scale: string; drawingName: string };
}): Promise<PdfPage> {
  const { snapshot, info, visibleLayers, layerByName, titleBlock } = input;
  const paths: PdfPath[] = [];
  const texts: PdfText[] = [];
  const objects = snapshot.objects.filter((o) => visibleLayers.has(o.layer));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    for (const seg of objectSegments(obj.geometry, obj.type)) {
      for (const p of [seg.a, seg.b]) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 10000;
    maxY = 7000;
  }
  const isModel = input.layout === "Model";
  const layoutRow = snapshot.layouts.find((l) => l.name === input.layout);
  const scaleValue = layoutRow?.viewport_scale;
  const ratio = scaleValue ? Number.parseInt(scaleValue.split(":")[1] ?? "50", 10) : null;
  const drawArea = {
    x: margin,
    y: margin,
    w: pageWidth - margin * 2,
    h: pageHeight - margin * 2 - 40,
  };
  let scale: number;
  if (!isModel && ratio) {
    scale = 1 / ratio;
  } else {
    const sx = drawArea.w / Math.max(1, maxX - minX);
    const sy = drawArea.h / Math.max(1, maxY - minY);
    scale = Math.min(sx, sy);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const map = (p: Point): [number, number] => {
    const px = drawArea.x + drawArea.w / 2 + (p[0] - cx) * scale;
    const py = drawArea.y + drawArea.h / 2 - (p[1] - cy) * scale;
    return [round2(px), round2(py)];
  };
  for (const obj of objects) {
    const layer = layerByName.get(obj.layer);
    const colour = String(obj.props.color === "ByLayer" ? (layer?.color ?? "White") : obj.props.color);
    const grey = greyFor(colour, info.plotStyle);
    const segs = objectSegments(obj.geometry, obj.type);
    if (obj.type === "polyline" || obj.type === "spline") {
      const pts = obj.type === "polyline" ? (obj.geometry.vertices as Point[]) : (obj.geometry.fit_points as Point[]);
      const mapped = pts.map(map);
      paths.push({ points: mapped, closed: obj.geometry.closed === true, width: 0.25, grey });
      continue;
    }
    for (const seg of segs) {
      paths.push({ points: [map(seg.a), map(seg.b)], closed: false, width: 0.25, grey });
    }
    if (obj.type === "mtext") {
      const position = map(obj.geometry.position as Point);
      texts.push({ x: position[0], y: position[1], text: String(obj.geometry.contents ?? ""), size: 4, grey: greyFor(colour, info.plotStyle) });
    }
    if (obj.type === "dimension") {
      const location = map(obj.geometry.location as Point);
      texts.push({ x: location[0], y: location[1], text: String(obj.geometry.text ?? ""), size: 4, grey: greyFor(colour, info.plotStyle) });
    }
  }
  // Sheet border and title block in the lower right.
  paths.push({ points: [[margin, margin], [pageWidth - margin, margin], [pageWidth - margin, pageHeight - margin], [margin, pageHeight - margin]], closed: true, width: 0.5, grey: "0 0 0" });
  const blockX = pageWidth - 110;
  const blockY = margin;
  paths.push({ points: [[blockX, blockY], [pageWidth - margin, blockY], [pageWidth - margin, blockY + 50], [blockX, blockY + 50]], closed: true, width: 0.5, grey: "0 0 0" });
  const lines: Array<[string, number]> = [
    [`TITLE ${titleBlock.drawingName}`, 40],
    ["SHEET A-101", 33],
    [`SCALE ${titleBlock.scale}`, 26],
    [`ISSUED ${titleBlock.issued}`, 19],
    [`REVISION ${titleBlock.letter}`, 12],
    [`NOTE ${titleBlock.footerNote}`, 5],
  ];
  for (const [text, offset] of lines) {
    texts.push({ x: blockX + 4, y: blockY + offset, text, size: 5, grey: "0 0 0" });
  }
  void textWidthOf;
  return { width: pageWidth, height: pageHeight, paths, texts };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { buildPdf };
