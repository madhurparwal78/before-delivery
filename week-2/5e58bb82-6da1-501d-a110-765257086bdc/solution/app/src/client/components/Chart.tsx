// The procedural survey chart: drawn on a canvas from mission data, with the holiday lens on the console.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Coverage, Holiday, Position, Track, Units } from "../api";
import { useReducedMotion } from "../hooks";
import { area as formatArea, position as formatPosition } from "../units";

export interface ChartLine {
  id: string;
  label: string;
  kind: "planned" | "crossline" | "infill";
  status: string;
  start: Position;
  end: Position;
}

interface Marker {
  id: string;
  name: string;
  position: Position;
  heading: number;
  replay?: boolean;
}

export interface ChartData {
  areas: { id: string; area: Position[]; fence: Position[] }[];
  lines?: ChartLine[];
  tracks?: Track[];
  coverage?: Coverage | null;
  holidays?: Holiday[];
  markers?: Marker[];
}

interface Props {
  data: ChartData;
  units: Units;
  /** The console's holiday lens; without it the arrow keys pan the chart. */
  lens?: boolean;
  onQueue?: (holiday: Holiday) => void;
  onNoHoliday?: () => void;
  /** Lens readout lines for the table view, which shares the readout. */
  readoutOverride?: { at: Position; holidays: Holiday[] } | null;
  /** Refit whenever the drawn bounds change, until the user pans or zooms (the planner preview). */
  followBounds?: boolean;
  children?: React.ReactNode;
}

const COLORS = {
  paper: "#f5f1e6", ink: "#1b1a17", rule: "#c9c0ae", sea: "#1e4d78", shallow: [199, 219, 236], deep: [61, 110, 156],
  bands: ["#b4c6d6", "#7e98b1", "#4c6a88"], signal: "#b83e0b", muted: "#57534a",
};
const LENS_PX = 84;
const CELL = 5;
const STEP_DM = 100;
const SHIFT_STEP_DM = 500;

interface View {
  cx: number;
  cy: number;
  scale: number;
}

const dm = (metres: number) => Math.round(metres * 10);

/** Swath tint from a fix's depth: lighter where shallow, darker where deep. */
function depthRgb(depth: number): number[] {
  const k = Math.max(0, Math.min(1, (depth - 2) / 28));
  const [a, b] = [COLORS.shallow, COLORS.deep];
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}

const BAND_RGB = [[180, 198, 214], [126, 152, 177], [76, 106, 136]];

interface Layers {
  swaths: HTMLCanvasElement;
  bands: HTMLCanvasElement;
}

/**
 * The coverage grid as two small images, one pixel per 5 m cell (row 0, the south row, at the bottom):
 * swaths tinted by the depth of the fixes that crossed each covered cell, and the lens's overlap bands.
 * Drawing them scaled keeps the chart cheap to paint even with software rendering.
 */
function coverageLayers(cov: Coverage, tracks: Track[]): Layers {
  const { cols, rows, origin, overlap } = cov;
  const depth = new Float64Array(cols * rows).fill(NaN);
  for (const track of tracks) {
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1];
      const b = track.points[i];
      const seg = Math.hypot(b.easting - a.easting, b.northing - a.northing);
      if (!seg) continue;
      const ux = (b.easting - a.easting) / seg;
      const uy = (b.northing - a.northing) / seg;
      const half = b.swath_m / 2;
      const c0 = Math.max(0, Math.floor((Math.min(a.easting, b.easting) - half - origin.easting) / CELL));
      const c1 = Math.min(cols - 1, Math.ceil((Math.max(a.easting, b.easting) + half - origin.easting) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(a.northing, b.northing) - half - origin.northing) / CELL));
      const r1 = Math.min(rows - 1, Math.ceil((Math.max(a.northing, b.northing) + half - origin.northing) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ce = origin.easting + CELL * c + 2.5 - a.easting;
          const cn = origin.northing + CELL * r + 2.5 - a.northing;
          const along = ce * ux + cn * uy;
          if (along >= 0 && along <= seg && Math.abs(cn * ux - ce * uy) <= half) depth[r * cols + c] = b.depth_m;
        }
      }
    }
  }
  const make = (paint: (o: number, i: number) => number[] | null) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cols);
    canvas.height = Math.max(1, rows);
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rgb = paint(overlap[r][c], r * cols + c);
        if (!rgb) continue;
        const at = ((rows - 1 - r) * cols + c) * 4;
        image.data.set([...rgb, 230], at);
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  };
  return {
    swaths: make((o, i) => (o > 0 ? depthRgb(Number.isNaN(depth[i]) ? 10 : depth[i]) : null)),
    bands: make((o) => (o > 0 ? BAND_RGB[Math.min(3, o) - 1] : null)),
  };
}

/** Orange diagonal strokes covering about half of each holiday cell. */
function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 8;
  const t = tile.getContext("2d")!;
  t.strokeStyle = COLORS.signal;
  t.lineWidth = 3;
  t.beginPath();
  for (const k of [-8, 0, 8]) {
    t.moveTo(k, 8);
    t.lineTo(k + 8, 0);
  }
  t.stroke();
  return ctx.createPattern(tile, "repeat");
}

function bounds(data: ChartData): [number, number, number, number] | null {
  const shapes = data.areas.flatMap((a) => [...a.area, ...a.fence]);
  if (!shapes.length) return null;
  const pts = [...shapes, ...(data.markers ?? []).map((m) => m.position)];
  const es = pts.map((p) => p.easting);
  const ns = pts.map((p) => p.northing);
  return [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)];
}

/** Grid ruling every 50 m, coarser when 50 m would crowd the chart. */
function gridStep(scale: number): number {
  for (const step of [50, 100, 250, 500, 1000, 2500, 5000]) if (step * scale >= 36) return step;
  return 10000;
}

/** Chart text sits on a paper plate (2 px padding) so line work never runs through it. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const m = ctx.measureText(text);
  const ink = ctx.fillStyle;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(x - 2, y - m.actualBoundingBoxAscent - 2, m.width + 4, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 4);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

export function Chart({ data, units, lens = false, onQueue, onNoHoliday, readoutOverride, followBounds = false, children }: Props) {
  const reduced = useReducedMotion();
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const dataRef = useRef(data);
  dataRef.current = data;
  const [viewVersion, setViewVersion] = useState(0);
  const layersRef = useRef<Layers | null>(null);
  const layerKey = useRef<unknown[]>([]);
  if (layerKey.current[0] !== data.coverage || layerKey.current[1] !== data.tracks) {
    layerKey.current = [data.coverage, data.tracks];
    layersRef.current = data.coverage ? coverageLayers(data.coverage, data.tracks ?? []) : null;
  }

  // Lens: a ground position in decimetres; the drawn centre trails it on screen.
  const target = useRef<{ e: number; n: number } | null>(null);
  const shown = useRef<{ x: number; y: number } | null>(null);
  const tween = useRef<{ from: { x: number; y: number }; start: number } | null>(null);
  const [lensOpen, setLensOpen] = useState(false);
  const [lensMounted, setLensMounted] = useState(false);
  const [readout, setReadout] = useState<{ e: number; n: number } | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  const pointerOver = useRef(false);
  const focusInside = useRef(false);
  const markerShown = useRef(new Map<string, { x: number; y: number; from?: { x: number; y: number }; start?: number }>());
  const frame = useRef<number | null>(null);

  const toScreen = useCallback((e: number, n: number) => {
    const v = view.current!;
    return { x: (e - v.cx) * v.scale + size.current.w / 2, y: size.current.h / 2 - (n - v.cy) * v.scale };
  }, []);
  const toWorld = (x: number, y: number) => {
    const v = view.current!;
    return { e: v.cx + (x - size.current.w / 2) / v.scale, n: v.cy - (y - size.current.h / 2) / v.scale };
  };

  const fit = useCallback(() => {
    const b = bounds(dataRef.current);
    const { w, h } = size.current;
    if (!b || !w || !h) return;
    const dx = Math.max(b[2] - b[0], 10);
    const dy = Math.max(b[3] - b[1], 10);
    view.current = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: Math.min(w / (dx * 1.15), h / (dy * 1.15)) };
    setViewVersion((n) => n + 1);
  }, []);

  const draw = useCallback(() => {
    const el = canvas.current;
    const v = view.current;
    if (!el || !v || !Number.isFinite(v.scale) || v.scale <= 0) return;
    const ctx = el.getContext("2d")!;
    const { w, h } = size.current;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    const d = dataRef.current;
    const S = (p: Position) => toScreen(p.easting, p.northing);

    // 50 m grid with mono edge labels
    const step = gridStep(v.scale);
    const tl = toWorld(0, 0);
    const br = toWorld(w, h);
    ctx.strokeStyle = COLORS.rule;
    ctx.lineWidth = 1;
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillStyle = COLORS.muted;
    const eastings: number[] = [];
    const northings: number[] = [];
    for (let e = Math.ceil(tl.e / step) * step; e <= br.e && eastings.length < 400; e += step) eastings.push(e);
    for (let n = Math.ceil(br.n / step) * step; n <= tl.n && northings.length < 400; n += step) northings.push(n);
    ctx.beginPath();
    for (const e of eastings) {
      const x = Math.round(toScreen(e, 0).x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (const n of northings) {
      const y = Math.round(toScreen(0, n).y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    // Edge labels go on last, and only where the whole label fits inside the plot.
    const drawGridLabels = () => {
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.muted;
      for (const e of eastings) {
        const text = `${Math.round(e)}`;
        const x = Math.round(toScreen(e, 0).x) + 3;
        if (x + ctx.measureText(text).width + 2 <= w) haloText(ctx, text, x, h - 6);
      }
      for (const n of northings) {
        const y = Math.round(toScreen(0, n).y) - 4;
        if (y - 13 >= 0 && y < h - 22) haloText(ctx, `${Math.round(n)}`, 4, y);
      }
    };

    const cov = d.coverage;
    const cellPath = (grid: Coverage, c: number, r: number) => {
      const a = toScreen(grid.origin.easting + CELL * c, grid.origin.northing + CELL * (r + 1));
      return [a.x, a.y, CELL * v.scale, CELL * v.scale] as const;
    };
    const drawLayer = (grid: Coverage, layer: HTMLCanvasElement) => {
      const corner = toScreen(grid.origin.easting, grid.origin.northing + CELL * grid.rows);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layer, corner.x, corner.y, CELL * grid.cols * v.scale, CELL * grid.rows * v.scale);
    };

    // swaths: the covered cells, tinted by the depth of the fixes that crossed them
    const layers = layersRef.current;
    if (cov && layers) drawLayer(cov, layers.swaths);

    for (const a of d.areas) {
      const path = (pts: Position[]) => {
        ctx.beginPath();
        pts.forEach((p, k) => {
          const s = S(p);
          if (k) ctx.lineTo(s.x, s.y);
          else ctx.moveTo(s.x, s.y);
        });
        ctx.closePath();
      };
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.25;
      path(a.fence);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1.75;
      path(a.area);
      ctx.stroke();
    }

    const holidayCells = new Map<string, Holiday>();
    for (const hol of d.holidays ?? []) for (const [c, r] of hol.cells) holidayCells.set(`${c},${r}`, hol);

    // holiday outlines (outside the lens)
    if (cov && holidayCells.size) {
      ctx.strokeStyle = COLORS.signal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [key, hol] of holidayCells) {
        const [c, r] = key.split(",").map(Number);
        const [x, y, s] = cellPath(cov, c, r);
        const same = (dc: number, dr: number) => holidayCells.get(`${c + dc},${r + dr}`) === hol;
        if (!same(0, 1)) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
        if (!same(0, -1)) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
        if (!same(-1, 0)) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
        if (!same(1, 0)) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
      }
      ctx.stroke();
    }

    const drawLines = () => {
      for (const line of d.lines ?? []) {
        if (line.kind === "infill" || line.status === "Superseded") continue;
        const a = S(line.start);
        const b = S(line.end);
        ctx.lineCap = "round";
        ctx.strokeStyle = COLORS.paper;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = COLORS.sea;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        if (line.kind === "crossline") {
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          ctx.beginPath();
          for (let t = 12; t < len; t += 24) {
            const x = a.x + ux * t;
            const y = a.y + uy * t;
            ctx.moveTo(x - uy * 4, y + ux * 4);
            ctx.lineTo(x + uy * 4, y - ux * 4);
          }
          ctx.stroke();
        }
      }
    };
    const drawMarkers = () => {
      ctx.font = "500 12px 'IBM Plex Mono', monospace";
      const placed: { x: number; y: number; w: number }[] = [];
      for (const m of d.markers ?? []) {
        const at = markerShown.current.get(m.id) ?? S(m.position);
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate((m.heading * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6, 6);
        ctx.lineTo(0, 2.5);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = COLORS.paper;
        ctx.stroke();
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = COLORS.ink;
        // Labels that would collide move down a line at a time.
        const text = m.replay ? `${m.name} · Replay` : m.name;
        const w = ctx.measureText(text).width;
        // right of the chevron, or left of it when the right side would run off the plot
        const lx = at.x + 10 + w + 2 > size.current.w ? at.x - 10 - w : at.x + 10;
        let y = at.y - 8;
        while (placed.some((p) => Math.abs(p.y - y) < 14 && lx < p.x + p.w + 4 && p.x < lx + w + 4)) y += 14;
        placed.push({ x: lx, y, w });
        haloText(ctx, text, lx, y);
      }
    };
    drawLines();
    drawMarkers();
    drawGridLabels();

    // inside the lens: overlap bands, hatched holidays with their areas, specks plain
    const centre = shown.current;
    if (lensMounted && centre && cov) {
      const radius = LENS_PX;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
      if (layers) drawLayer(cov, layers.bands);
      const hatch = hatchPattern(ctx);
      if (hatch) {
        ctx.fillStyle = hatch;
        for (const [key] of holidayCells) {
          const [c, r] = key.split(",").map(Number);
          ctx.fillRect(...cellPath(cov, c, r));
        }
      }
      drawLines();
      drawMarkers();
      ctx.font = "500 12px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.ink;
      // Area labels sit beside their holiday, never on a hatched cell or another label: right of the
      // holiday's cells, else left, above or below, moving outward a line at a time.
      type Box = { x: number; y: number; w: number; h: number };
      const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const legendY = centre.y + radius - 34;
      const blocked: Box[] = [{ x: centre.x - 48, y: legendY - 3, w: 100, h: 16 }];
      for (const [key] of holidayCells) {
        const [c, r] = key.split(",").map(Number);
        const [x, y, cs] = cellPath(cov, c, r);
        blocked.push({ x, y, w: cs, h: cs });
      }
      for (const hol of d.holidays ?? []) {
        const cells = hol.cells.map(([c, r]) => cellPath(cov, c, r));
        const left = Math.min(...cells.map((b) => b[0]));
        const right = Math.max(...cells.map((b) => b[0] + b[2]));
        const top = Math.min(...cells.map((b) => b[1]));
        const bottom = Math.max(...cells.map((b) => b[1] + b[3]));
        const text = formatArea(hol.area_m2, units);
        const tw = ctx.measureText(text).width;
        const th = 16;
        const mid = (top + bottom) / 2 - th / 2;
        const tries: Box[] = [];
        for (let k = 0; k < 8; k++) {
          tries.push({ x: right + 4, y: mid + k * th, w: tw + 4, h: th }, { x: left - tw - 8, y: mid + k * th, w: tw + 4, h: th },
            { x: (left + right) / 2 - tw / 2, y: top - th - 2 - k * th, w: tw + 4, h: th }, { x: (left + right) / 2 - tw / 2, y: bottom + 2 + k * th, w: tw + 4, h: th });
        }
        const inLens = (b: Box) => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
          .every(([x, y]) => Math.hypot(x - centre.x, y - centre.y) <= radius - 4);
        const free = tries.filter((b) => !blocked.some((o) => hits(b, o)));
        const spot = free.find(inLens) ?? free[0] ?? tries[0];
        blocked.push(spot);
        haloText(ctx, text, spot.x + 2, spot.y + 12);
      }
      // band legend on its own paper strip, drawn over the line work
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(centre.x - 48, legendY - 3, 100, 16);
      ctx.globalAlpha = 1;
      ["1×", "2×", "3×+"].forEach((label, k) => {
        const x = centre.x - 44 + k * 30;
        ctx.fillStyle = COLORS.bands[k];
        ctx.fillRect(x, legendY, 10, 10);
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(label, x + 13, legendY + 9);
      });
      ctx.restore();
    }
  }, [lensMounted, toScreen, units]);

  // canvas size follows its box (the table view has no canvas)
  const hasCanvas = !children;
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el || !canvas.current) return;
    size.current = { w: 0, h: 0 };
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (rect.width === size.current.w && rect.height === size.current.h) return;
      size.current = { w: rect.width, h: rect.height };
      canvas.current!.width = Math.round(rect.width * ratio);
      canvas.current!.height = Math.round(rect.height * ratio);
      if (!view.current) fit();
      else setViewVersion((n) => n + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fit, hasCanvas]);

  const fitted = useRef<string | null>(null);
  const userMoved = useRef(false);
  useLayoutEffect(() => {
    const b = bounds(data);
    if (!b) return;
    const key = b.join(",");
    if (fitted.current === null || (followBounds && !userMoved.current && fitted.current !== key)) {
      fitted.current = key;
      fit();
    }
  }, [data, fit, followBounds]);

  // Animation frames run only while something moves: the trailing lens and gliding markers.
  const animate = useCallback(() => {
    if (frame.current !== null) return;
    const tick = (now: number) => {
      frame.current = null;
      let moving = false;
      if (target.current && view.current) {
        const goal = toScreen(target.current.e / 10, target.current.n / 10);
        const tw = tween.current;
        if (tw && !reduced) {
          const k = Math.min(1, (now - tw.start) / 125);
          const eased = 1 - (1 - k) ** 3;
          shown.current = { x: tw.from.x + (goal.x - tw.from.x) * eased, y: tw.from.y + (goal.y - tw.from.y) * eased };
          if (k < 1) moving = true;
          else tween.current = null;
        } else shown.current = goal;
        if (ring.current && shown.current) ring.current.style.transform = `translate(${shown.current.x}px, ${shown.current.y}px)`;
      }
      for (const m of dataRef.current.markers ?? []) {
        const goal = toScreen(m.position.easting, m.position.northing);
        const state = markerShown.current.get(m.id);
        if (!state || reduced || state.start === undefined) {
          markerShown.current.set(m.id, goal);
          continue;
        }
        const k = Math.min(1, (now - state.start) / 320);
        const eased = 1 - (1 - k) ** 3;
        const from = state.from!;
        markerShown.current.set(m.id, k < 1 ? { x: from.x + (goal.x - from.x) * eased, y: from.y + (goal.y - from.y) * eased, from, start: state.start } : goal);
        if (k < 1) moving = true;
      }
      draw();
      if (moving) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw, reduced, toScreen]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Markers glide to new fixes; everything else redraws at once.
  const lastPositions = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    let glide = false;
    for (const m of data.markers ?? []) {
      const key = `${m.position.easting},${m.position.northing}`;
      const before = lastPositions.current.get(m.id);
      lastPositions.current.set(m.id, key);
      const state = markerShown.current.get(m.id);
      if (before && before !== key && state && !reduced && view.current) {
        markerShown.current.set(m.id, { x: state.x, y: state.y, from: { x: state.x, y: state.y }, start: performance.now() });
        glide = true;
      } else if (view.current) markerShown.current.set(m.id, toScreen(m.position.easting, m.position.northing));
    }
    draw();
    if (glide) animate();
  }, [data, viewVersion, draw, animate, reduced, toScreen]);

  useLayoutEffect(() => {
    if (target.current && view.current && !tween.current) {
      shown.current = toScreen(target.current.e / 10, target.current.n / 10);
      if (ring.current) ring.current.style.transform = `translate(${shown.current.x}px, ${shown.current.y}px)`;
    }
    draw();
  }, [viewVersion, draw, toScreen]);

  // --- lens ---
  /** Moves the lens to a ground position given in decimetres. */
  const moveLens = useCallback((e: number, n: number, trail: boolean) => {
    const next = { e: Math.round(e), n: Math.round(n) };
    const from = shown.current;
    target.current = next;
    setReadout(next);
    if (trail && from && !reduced) tween.current = { from: { ...from }, start: performance.now() };
    else {
      tween.current = null;
      shown.current = view.current ? toScreen(next.e / 10, next.n / 10) : null;
    }
    animate();
  }, [animate, reduced, toScreen]);

  const openLens = useCallback(() => {
    if (!lens) return;
    if (!target.current && view.current) moveLens(Math.round(view.current.cx) * 10, Math.round(view.current.cy) * 10, false);
    setLensOpen(true);
  }, [lens, moveLens]);

  const maybeClose = useCallback(() => {
    if (!pointerOver.current && !focusInside.current) setLensOpen(false);
  }, []);

  const shrink = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = ring.current;
    if (lensOpen) {
      shrink.current?.cancel();
      shrink.current = null;
      setLensMounted(true);
      return;
    }
    if (!el || reduced) {
      setLensMounted(false);
      return;
    }
    const animation = el.animate([{ scale: "1", opacity: 1 }, { scale: "0.6", opacity: 0 }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
    shrink.current = animation;
    animation.finished.then(() => {
      if (shrink.current === animation) {
        shrink.current = null;
        setLensMounted(false);
      }
    }, () => undefined);
  }, [lensOpen, reduced]);

  useLayoutEffect(() => {
    const el = ring.current;
    if (!lensMounted || !el) return;
    if (shown.current) el.style.transform = `translate(${shown.current.x}px, ${shown.current.y}px)`;
    if (!reduced && !shrink.current) el.animate([{ scale: "0.6", opacity: 0.4 }, { scale: "1", opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    draw();
  }, [lensMounted, reduced, draw]);

  const radiusMetres = () => (view.current ? LENS_PX / view.current.scale : 0);

  const holidaysInLens = (at: { e: number; n: number } | null): Holiday[] => {
    const cov = dataRef.current.coverage;
    if (!at || !cov) return [];
    const r = radiusMetres();
    return (dataRef.current.holidays ?? []).filter((hol) => hol.cells.some(([c, row]) => {
      const ce = cov.origin.easting + CELL * c + 2.5;
      const cn = cov.origin.northing + CELL * row + 2.5;
      return Math.hypot(ce - at.e / 10, cn - at.n / 10) <= r;
    }));
  };

  /** Enter: the holiday under the lens centre, else the one with most cells inside the lens; specks never. */
  const queueUnderLens = (at: { e: number; n: number }) => {
    const d = dataRef.current;
    const cov = d.coverage;
    if (!cov) return onNoHoliday?.();
    const c = Math.floor((at.e / 10 - cov.origin.easting) / CELL);
    const r = Math.floor((at.n / 10 - cov.origin.northing) / CELL);
    const under = (d.holidays ?? []).find((hol) => hol.cells.some(([hc, hr]) => hc === c && hr === r));
    if (under) return onQueue?.(under);
    const radius = radiusMetres();
    let best: Holiday | null = null;
    let most = 0;
    for (const hol of d.holidays ?? []) {
      const inside = hol.cells.filter(([hc, hr]) => Math.hypot(cov.origin.easting + CELL * hc + 2.5 - at.e / 10, cov.origin.northing + CELL * hr + 2.5 - at.n / 10) <= radius).length;
      if (inside > most) {
        most = inside;
        best = hol;
      }
    }
    if (best) onQueue?.(best);
    else onNoHoliday?.();
  };

  const keepInView = (at: { e: number; n: number }) => {
    const v = view.current;
    if (!v) return;
    const p = toScreen(at.e / 10, at.n / 10);
    const margin = LENS_PX;
    const { w, h } = size.current;
    let moved = false;
    if (p.x < margin || p.x > w - margin) {
      v.cx = at.e / 10;
      moved = true;
    }
    if (p.y < margin || p.y > h - margin) {
      v.cy = at.n / 10;
      moved = true;
    }
    if (moved) setViewVersion((n) => n + 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const arrows: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const dir = arrows[e.key];
    if (dir && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (lens) {
        if (!target.current) openLens();
        setLensOpen(true);
        const step = e.shiftKey ? SHIFT_STEP_DM : STEP_DM;
        const next = { e: target.current!.e + dir[0] * step, n: target.current!.n + dir[1] * step };
        moveLens(next.e, next.n, true);
        keepInView(next);
      } else if (view.current) {
        const v = view.current;
        const by = (e.shiftKey ? 0.4 : 0.1) * size.current.w / v.scale;
        v.cx += dir[0] * by;
        v.cy += dir[1] * by;
        setViewVersion((n) => n + 1);
      }
      return;
    }
    if (e.key === "Enter" && lens && e.target === surface.current && target.current) {
      e.preventDefault();
      queueUnderLens(target.current);
    }
  };

  // --- pointer and touch ---
  const pointers = useRef(new Map<number, { x: number; y: number; startX: number; startY: number; type: string }>());
  const moved = useRef(false);
  const pinch = useRef<number | null>(null);
  const local = (e: React.PointerEvent) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, startX: p.x, startY: p.y, type: e.pointerType });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    surface.current!.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const tracked = pointers.current.get(e.pointerId);
    const v = view.current;
    if (!v) return;
    if (tracked) {
      if (pointers.current.size === 2 && pinch.current) {
        tracked.x = p.x;
        tracked.y = p.y;
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        v.scale = Math.max(0.01, Math.min(200, v.scale * (distance / pinch.current)));
        pinch.current = distance;
        moved.current = true;
        setViewVersion((n) => n + 1);
        return;
      }
      const dx = p.x - tracked.x;
      const dy = p.y - tracked.y;
      if (moved.current || Math.hypot(p.x - tracked.startX, p.y - tracked.startY) > 5) {
        moved.current = true;
        userMoved.current = true;
        v.cx -= dx / v.scale;
        v.cy += dy / v.scale;
        setViewVersion((n) => n + 1);
      }
      tracked.x = p.x;
      tracked.y = p.y;
      if (e.pointerType !== "mouse") return;
    }
    if (lens && e.pointerType === "mouse") {
      pointerOver.current = true;
      const w = toWorld(p.x, p.y);
      setLensOpen(true);
      moveLens(dm(w.e), dm(w.n), true);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const tracked = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!tracked || moved.current || !lens || !view.current) return;
    const p = local(e);
    const w = toWorld(p.x, p.y);
    if (e.pointerType === "mouse") {
      const at = { e: dm(w.e), n: dm(w.n) };
      const cov = dataRef.current.coverage;
      if (!cov) return;
      const c = Math.floor((at.e / 10 - cov.origin.easting) / CELL);
      const r = Math.floor((at.n / 10 - cov.origin.northing) / CELL);
      const hol = (dataRef.current.holidays ?? []).find((h) => h.cells.some(([hc, hr]) => hc === c && hr === r));
      if (hol) onQueue?.(hol);
    } else {
      setLensOpen(true);
      pointerOver.current = true;
      moveLens(dm(w.e), dm(w.n), false);
    }
  };

  const zoom = (factor: number) => {
    if (!view.current) return;
    userMoved.current = true;
    view.current.scale *= factor;
    setViewVersion((n) => n + 1);
  };

  const at = readoutOverride ? { e: dm(readoutOverride.at.easting), n: dm(readoutOverride.at.northing) } : readout;
  const inside = readoutOverride ? readoutOverride.holidays : holidaysInLens(readout);
  const anyHoliday = (data.holidays ?? []).length > 0;

  return (
    <section
      className="chart-region"
      aria-labelledby="chart-heading"
      onKeyDown={readoutOverride ? undefined : onKeyDown}
      onFocus={(e) => {
        focusInside.current = true;
        if (e.target === surface.current) openLens();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          focusInside.current = false;
          maybeClose();
        }
      }}
    >
      <h2 id="chart-heading" className="sr-only">Survey chart</h2>
      {!children && (
        <div className="chart-tools">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.5)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>−</button>
          <button type="button" className="fit" onClick={() => {
            userMoved.current = false;
            fit();
          }}>Fit survey area</button>
        </div>
      )}
      {children ?? (
        <div
          ref={surface}
          className="chart-surface"
          role="application"
          aria-label="Coverage chart"
          aria-roledescription="survey chart"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") {
              pointerOver.current = false;
              maybeClose();
            }
          }}
        >
          <canvas ref={canvas} aria-hidden="true" />
          <InfillOverlay lines={data.lines ?? []} toScreen={toScreen} ready={!!view.current} version={viewVersion} reduced={reduced} />
          {lensMounted && <div ref={ring} className="lens" role="img" aria-label="Holiday lens" />}
        </div>
      )}
      {(lens || readoutOverride) && (
        <div className="readout num" role="group" aria-label="Lens readout">
          {at ? <span>{formatPosition({ easting: at.e / 10, northing: at.n / 10 }, units)}</span> : <span className="readout-prompt">Move the lens over the chart</span>}
          {!anyHoliday && <span>No holidays — coverage is continuous</span>}
          {inside.map((hol) => <span key={hol.id} className="holiday-line">{hol.label} · {formatArea(hol.area_m2, units)}</span>)}
        </div>
      )}
    </section>
  );
}

/** Dashed infill lines as images; a newly confirmed one draws itself from start to end. */
function InfillOverlay({ lines, toScreen, ready, version, reduced }: { lines: ChartLine[]; toScreen: (e: number, n: number) => { x: number; y: number }; ready: boolean; version: number; reduced: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const open = lines.filter((l) => l.kind === "infill" && (l.status === "Assigned" || l.status === "Running"));
  useLayoutEffect(() => {
    if (!ready) return;
    const first = seen.current === null;
    const known = seen.current ?? new Set<string>();
    for (const l of open) {
      if (known.has(l.id)) continue;
      known.add(l.id);
      if (first || reduced) continue;
      const mask = svg.current?.querySelector<SVGLineElement>(`[data-draw="${l.id}"]`);
      const length = mask ? Number(mask.dataset.length) : 0;
      mask?.animate([{ strokeDashoffset: `${length}` }, { strokeDashoffset: "0" }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    seen.current = known;
  });
  if (!ready) return null;
  void version;
  return (
    <svg ref={svg} className="overlay" aria-hidden={open.length ? undefined : true}>
      {open.map((l) => {
        const a = toScreen(l.start.easting, l.start.northing);
        const b = toScreen(l.end.easting, l.end.northing);
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = length ? (b.x - a.x) / length : 0;
        const uy = length ? (b.y - a.y) / length : 0;
        const halo = [[a.x - uy * 6, a.y + ux * 6], [b.x - uy * 6, b.y + ux * 6], [b.x + uy * 6, b.y - ux * 6], [a.x + uy * 6, a.y - ux * 6]].map((p) => p.join(",")).join(" ");
        return (
          <g key={l.id} role="img" aria-label={`Infill ${l.label}`}>
            <defs>
              <mask id={`draw-${l.id}`} maskUnits="userSpaceOnUse">
                <line data-draw={l.id} data-length={length} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth="8" strokeDasharray={`${length} ${length}`} />
              </mask>
            </defs>
            <polygon points={halo} fill="transparent" />
            <g mask={`url(#draw-${l.id})`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f5f1e6" strokeWidth="4.5" strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1e4d78" strokeWidth="2" strokeDasharray="7 5" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
