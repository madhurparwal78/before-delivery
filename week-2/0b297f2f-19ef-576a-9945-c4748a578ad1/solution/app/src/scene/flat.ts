// The still flat drawing shown without WebGL: the plan as a top-down outline of walls and works,
// Wall and Light as an elevation of the faced wall. Markers lie over the drawn works.
import type { Frame, Rect, SceneRenderer, WallLabelSpot } from "./director";
import { EYE_CM } from "./director";
import { frameWalls, luxColour, roomSize, uprightAngle, type WallFrame } from "./room";

const NS = "http://www.w3.org/2000/svg";
const MARGIN_MM = 700;
const DEPTH_MM = 160;
/** How far outside its wall a wall name sits in the plan. */
const LABEL_OUT_MM = 420;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export class FlatRenderer implements SceneRenderer {
  readonly kind = "flat" as const;
  readonly element: SVGSVGElement;
  private rects = new Map<string, SVGRectElement>();
  private frames: WallFrame[] = [];
  private mode: { kind: "plan" } | { kind: "elevation"; wall: WallFrame } = { kind: "plan" };

  constructor() {
    this.element = el("svg", { class: "scene-flat", role: "img", "aria-label": "Flat drawing of the gallery" });
    this.element.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  resize(): void {
    // the SVG scales with its box through its viewBox
  }

  captureForDissolve(): void {
    // a still drawing has no dissolve
  }

  draw(frame: Frame): void {
    this.frames = frameWalls(frame.walls);
    const svg = this.element;
    svg.replaceChildren();
    this.rects.clear();
    const defs = el("defs", {});
    const pattern = el("pattern", { id: "flat-hatch", width: 120, height: 120, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.append(el("rect", { width: 120, height: 120, fill: "#FBFAF6" }), el("rect", { width: 40, height: 120, fill: "#8C2A1C" }));
    defs.append(pattern);
    svg.append(defs);
    const light = frame.view === "light";
    const facing = this.frames.find((f) => f.spec.id === frame.camera.facingWallId) ?? this.frames[0];
    if (frame.camera.eye >= 0.5 && facing) this.drawElevation(frame, facing, light);
    else this.drawPlan(frame, light);
  }

  private workStyle(over: boolean, light: boolean, selected: boolean) {
    return {
      fill: light && over ? "url(#flat-hatch)" : "#F1ECE1",
      stroke: light && over ? "#8C2A1C" : "#1C1B18",
      "stroke-width": selected || (light && over) ? 3 : 1.5,
      "vector-effect": "non-scaling-stroke",
    };
  }

  private addWork(id: string, attrs: Record<string, string | number>): void {
    const rect = el("rect", attrs);
    rect.setAttribute("data-work", id);
    this.element.append(rect);
    this.rects.set(id, rect);
  }

  private drawPlan(frame: Frame, light: boolean): void {
    this.mode = { kind: "plan" };
    const size = roomSize(frame.walls);
    const w = size.width * 1000;
    const d = size.depth * 1000;
    this.element.setAttribute("viewBox", `${-w / 2 - MARGIN_MM} ${-d / 2 - MARGIN_MM} ${w + MARGIN_MM * 2} ${d + MARGIN_MM * 2}`);
    this.element.append(el("rect", { x: -w / 2, y: -d / 2, width: w, height: d, fill: "#D8D1C3" }));
    for (const f of this.frames) {
      const [r, g, b] = luxColour(f.spec.plannedLux);
      const x1 = f.start[0] * 1000;
      const y1 = f.start[1] * 1000;
      const x2 = x1 + f.dir[0] * f.spec.lengthMm;
      const y2 = y1 + f.dir[1] * f.spec.lengthMm;
      this.element.append(
        el("line", { x1, y1, x2, y2, stroke: light ? `rgb(${r},${g},${b})` : "#B8B0A2", "stroke-width": 220, "stroke-linecap": "square" }),
      );
      this.element.append(el("line", { x1, y1, x2, y2, stroke: "#1C1B18", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));
    }
    for (const work of frame.works) {
      const f = this.frames.find((x) => x.spec.id === work.wallId);
      if (!f) continue;
      const cx = f.start[0] * 1000 + f.dir[0] * work.offsetMm + f.normal[0] * (DEPTH_MM / 2 + 110);
      const cy = f.start[1] * 1000 + f.dir[1] * work.offsetMm + f.normal[1] * (DEPTH_MM / 2 + 110);
      const along = Math.abs(f.dir[0]) > 0;
      const width = along ? work.widthMm : DEPTH_MM;
      const height = along ? DEPTH_MM : work.widthMm;
      this.addWork(work.id, {
        x: cx - width / 2,
        y: cy - height / 2,
        width,
        height,
        ...this.workStyle(work.luxStatus === "over", light, work.id === frame.selectedId),
      });
    }
  }

  private drawElevation(frame: Frame, wall: WallFrame, light: boolean): void {
    this.mode = { kind: "elevation", wall };
    const L = wall.spec.lengthMm;
    const H = wall.spec.heightMm;
    this.element.setAttribute("viewBox", `${-MARGIN_MM} ${-MARGIN_MM} ${L + MARGIN_MM * 2} ${H + MARGIN_MM * 2}`);
    const [r, g, b] = luxColour(wall.spec.plannedLux);
    this.element.append(el("rect", { x: 0, y: 0, width: L, height: H, fill: light ? `rgb(${r},${g},${b})` : "#B8B0A2" }));
    this.element.append(el("line", { x1: -MARGIN_MM / 2, y1: H, x2: L + MARGIN_MM / 2, y2: H, stroke: "#1C1B18", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
    if (frame.hangOpacity > 0) {
      const y = H - EYE_CM * 10;
      this.element.append(el("line", { x1: 0, y1: y, x2: L, y2: y, stroke: "#B5501C", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
    }
    for (const work of frame.works.filter((w) => w.wallId === wall.spec.id)) {
      this.addWork(work.id, {
        x: work.offsetMm - work.widthMm / 2,
        y: H - work.centreHeightMm - work.liftMm - work.heightMm / 2,
        width: work.widthMm,
        height: work.heightMm,
        ...this.workStyle(work.luxStatus === "over", light, work.id === frame.selectedId),
      });
    }
  }

  workRect(id: string): Rect | null {
    const rect = this.rects.get(id);
    if (!rect) return null;
    const box = this.element.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
  }

  wallLabelSpot(wallId: string): WallLabelSpot | null {
    const matrix = this.element.getScreenCTM();
    const f = this.frames.find((w) => w.spec.id === wallId);
    if (this.mode.kind !== "plan" || !matrix || !f) return null;
    const box = this.element.getBoundingClientRect();
    const screen = (offsetMm: number) => {
      const p = new DOMPoint(
        f.start[0] * 1000 + f.dir[0] * offsetMm - f.normal[0] * LABEL_OUT_MM,
        f.start[1] * 1000 + f.dir[1] * offsetMm - f.normal[1] * LABEL_OUT_MM,
      ).matrixTransform(matrix);
      return { x: p.x - box.left, y: p.y - box.top };
    };
    const mid = screen(f.spec.lengthMm / 2);
    return { ...mid, angleDeg: uprightAngle(screen(0), screen(f.spec.lengthMm)) };
  }

  pointerOffset(wallId: string, x: number, y: number): number | null {
    const matrix = this.element.getScreenCTM();
    const f = this.frames.find((w) => w.spec.id === wallId);
    if (!matrix || !f) return null;
    const box = this.element.getBoundingClientRect();
    const p = new DOMPoint(x + box.left, y + box.top).matrixTransform(matrix.inverse());
    if (this.mode.kind === "elevation") return this.mode.wall.spec.id === wallId ? p.x : null;
    return (p.x - f.start[0] * 1000) * f.dir[0] + (p.y - f.start[1] * 1000) * f.dir[1];
  }

  dispose(): void {
    this.element.remove();
  }
}
