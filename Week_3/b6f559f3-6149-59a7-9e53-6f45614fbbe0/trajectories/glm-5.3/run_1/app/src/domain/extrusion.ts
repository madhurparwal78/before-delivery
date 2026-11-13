// Extrusion geometry: outlines, bounds, triangle counts, sample points.
import { cellsForChar, textWidth, totalFilledCells, polygonTriangles, GLYPHS, glyphForChar } from './font';

export interface OutlinePoint {
  x: number;
  y: number;
}

export interface ExtrusionGeom {
  outlines: OutlinePoint[][]; // in unit space (100 SVG units = 1 unit), y up
  bounds: { w: number; h: number; d: number };
  triangles: number;
  frontZ: number; // z of the front face
  bevel: number;
  depth: number;
}

// Text extrusion: each filled cell is its own square outline, extruded on its
// own. Neighbouring cells are never merged.
export function textExtrusion(
  text: string,
  letterHeight: number,
  depth: number,
  bevelSize: number,
  bevelSegments: number,
): ExtrusionGeom | null {
  // Refuse unsupported characters
  for (const ch of text) {
    if (ch !== ' ' && !glyphForChar(ch)) return null;
  }
  const cells = totalFilledCells(text);
  const grow = bevelSize > 0 ? 2 * bevelSize : 0;
  const bounds = {
    w: textWidth(text, letterHeight) + grow,
    h: letterHeight + grow,
    d: depth + grow,
  };
  const outlines: OutlinePoint[][] = [];
  for (let i = 0; i < text.length; i++) {
    for (const cell of cellsForChar(text, i, letterHeight)) {
      outlines.push([
        { x: cell.x0, y: cell.y0 },
        { x: cell.x0 + cell.size, y: cell.y0 },
        { x: cell.x0 + cell.size, y: cell.y0 + cell.size },
        { x: cell.x0, y: cell.y0 + cell.size },
      ]);
    }
  }
  return {
    outlines,
    bounds,
    triangles: cells * (bevelSize > 0 ? 12 + 16 * bevelSegments : 12),
    frontZ: depth / 2 + bevelSize,
    bevel: bevelSize,
    depth,
  };
}

// Parse a one-path straight-line SVG into outline points (unit space, y up).
// Returns the first refusal reason, or the outline.
export type SvgParseResult =
  | { ok: true; points: OutlinePoint[]; width: number; height: number }
  | { ok: false; error: 'not_svg' | 'path_count' | 'commands' | 'crosses'; pathCount?: number };

export function parseSvgPath(svgText: string): SvgParseResult {
  if (!/<svg[\s>]/i.test(svgText)) return { ok: false, error: 'not_svg' };
  const pathMatches = svgText.match(/<path\b[^>]*>/gi) ?? [];
  if (pathMatches.length !== 1) {
    return { ok: false, error: 'path_count', pathCount: pathMatches.length };
  }
  const dMatch = pathMatches[0].match(/\bd\s*=\s*"([^"]*)"/i) ?? pathMatches[0].match(/\bd\s*=\s*'([^']*)'/i);
  if (!dMatch) return { ok: false, error: 'commands' };
  const d = dMatch[1];
  // Tokenise
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let cmd = '';
  const pts: { x: number; y: number }[] = [];
  const started = { x: 0, y: 0 };
  let hasStarted = false;
  const nextNum = (): number => {
    const t = tokens[i++];
    return parseFloat(t);
  };
  const commandsSeen: string[] = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MmLlHhVvZz]$/.test(t)) {
      cmd = t;
      i++;
      commandsSeen.push(cmd);
      if (cmd === 'Z' || cmd === 'z') continue;
    } else if (cmd === '') {
      return { ok: false, error: 'commands' };
    }
    switch (cmd) {
      case 'M':
      case 'L': {
        const x = nextNum();
        const y = nextNum();
        cx = x; cy = y;
        break;
      }
      case 'm':
      case 'l': {
        const dx = nextNum();
        const dy = nextNum();
        cx += dx; cy += dy;
        break;
      }
      case 'H': {
        cx = nextNum();
        break;
      }
      case 'h': {
        cx += nextNum();
        break;
      }
      case 'V': {
        cy = nextNum();
        break;
      }
      case 'v': {
        cy += nextNum();
        break;
      }
      default:
        break;
    }
    if (cmd === 'M' || cmd === 'm') {
      if (hasStarted) return { ok: false, error: 'commands' };
      started.x = cx; started.y = cy;
      hasStarted = true;
      pts.push({ x: cx, y: cy });
    } else if (cmd !== 'Z' && cmd !== 'z') {
      pts.push({ x: cx, y: cy });
    }
  }
  // Only M, L, H, V, Z are allowed; the tokeniser accepted them, but a command
  // letter outside the set would have been parsed as a number and failed.
  if (!hasStarted || pts.length < 3) return { ok: false, error: 'crosses' };
  if (segmentsIntersectAnywhere(pts)) return { ok: false, error: 'crosses' };
  // 100 SVG units = 1 unit, y flipped
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const scale = 1 / 100;
  const points = pts.map((p) => ({ x: p.x * scale, y: -p.y * scale }));
  return {
    ok: true,
    points,
    width: (maxX - minX) * scale,
    height: (maxY - minY) * scale,
  };
}

function segIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const d = (p: any, a: any, b: any) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d1 = d(a1, b1, b2);
  const d2 = d(a2, b1, b2);
  const d3 = d(b1, a1, a2);
  const d4 = d(b2, a1, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentsIntersectAnywhere(pts: { x: number; y: number }[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function svgExtrusion(
  points: OutlinePoint[],
  depth: number,
  bevelSize: number,
  bevelSegments: number,
  width: number,
  height: number,
): ExtrusionGeom {
  const grow = bevelSize > 0 ? 2 * bevelSize : 0;
  return {
    outlines: [points],
    bounds: { w: width + grow, h: height + grow, d: depth + grow },
    triangles: polygonTriangles(points.length, bevelSegments),
    frontZ: depth / 2 + bevelSize,
    bevel: bevelSize,
    depth,
  };
}

// Cell corners for particle formation targets on the front face.
export function textCellFrontPoints(
  text: string,
  letterHeight: number,
  frontZ: number,
): { charIndex: number; points: OutlinePoint[] }[] {
  const out: { charIndex: number; points: OutlinePoint[] }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') continue;
    const cells = cellsForChar(text, i, letterHeight);
    // One target point per filled cell, top-left, top-right, bottom-right,
    // bottom-left of the glyph cell (not of each square). The glyph cell spans
    // the full 0.6-wide, 1.0-tall cell.
    const totalW = textWidth(text, letterHeight);
    const left = -totalW / 2 + i * 0.7 * letterHeight;
    const top = letterHeight / 2;
    void cells;
    out.push({
      charIndex: i,
      points: [
        { x: left, y: top, z: frontZ },
        { x: left + 0.6 * letterHeight, y: top, z: frontZ },
        { x: left + 0.6 * letterHeight, y: top - letterHeight, z: frontZ },
        { x: left, y: top - letterHeight, z: frontZ },
      ] as never,
    });
  }
  return out;
}

export const GLYPH_LIST = GLYPHS;
