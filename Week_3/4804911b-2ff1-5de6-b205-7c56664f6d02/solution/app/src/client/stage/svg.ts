// The SVG declaration panel: the same pack, projected with the same maths, drawn as vector shapes and real text.
import { FONT_FAMILY, backOps, frontOps, stickerArt, type Op } from "./paint";
import { depthOf, facing, projectFace, projectModel, stickerPose, stickerQuad, type Face, type View } from "./project";
import { specFor, type PackSpec, type Point } from "./spec";
import type { DrawItem } from "./webgl";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
const n = (v: number): string => (Math.round(v * 100) / 100).toString();
const points = (pts: Point[]): string => pts.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
const family = (font: "display" | "text"): string => FONT_FAMILY[font].replace(/"/g, "'");

let uid = 0;

function opMarkup(op: Op): string {
  if (op.k === "poly") return `<polygon points="${points(op.pts)}" fill="${op.fill}"/>`;
  if (op.k === "rect") return `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${op.fill}"/>`;
  if (op.k === "text") {
    const weight = op.weight ?? 400;
    return `<text x="${n(op.x)}" y="${n(op.y)}" font-family="${family(op.font)}" font-size="${n(op.size)}" font-weight="${weight}"${op.italic ? ' font-style="italic"' : ""} fill="${op.fill}" text-anchor="${op.anchor === "middle" ? "middle" : "start"}">${esc(op.text)}</text>`;
  }
  if (op.k === "lines") {
    const spans = op.lines.map((line, i) => `<tspan x="${n(op.x)}" y="${n(op.y + i * op.leading)}">${esc(line)}</tspan>`).join("");
    return `<text font-family="${family(op.font)}" font-size="${n(op.size)}" fill="${op.fill}" text-anchor="${op.anchor === "middle" ? "middle" : "start"}">${spans}</text>`;
  }
  const id = `clip${uid++}`;
  return `<clipPath id="${id}"><rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"/></clipPath><g clip-path="url(#${id})">${op.ops.map(opMarkup).join("")}</g>`;
}

const matrix = (o: Point, ex: Point, ey: Point, w: number, h: number): string =>
  `matrix(${n((ex[0] - o[0]) / w)} ${n((ex[1] - o[1]) / w)} ${n((ey[0] - o[0]) / h)} ${n((ey[1] - o[1]) / h)} ${n(o[0])} ${n(o[1])})`;

const LAMP = (() => {
  const l = Math.hypot(0.4, 0.5, 0.8);
  return [-0.4 / l, 0.5 / l, 0.8 / l] as const;
})();
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lit = (nx: number, ny: number, nz: number): number => 0.4 + 0.6 * smooth(0, 0.78, Math.max(nx * LAMP[0] + ny * LAMP[1] + nz * LAMP[2], 0));
const rotateY = (x: number, z: number, deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180;
  return [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
};

function sidesMarkup(spec: PackSpec, view: View): string {
  const pts = spec.outline.map(([u, v]) => [(u - 0.5) * spec.width, (0.5 - v) * spec.height] as Point);
  let area = 0;
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    area += x * y2 - x2 * y;
  });
  const quads: Array<{ depth: number; markup: string }> = [];
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const dx = x2 - x;
    const dy = y2 - y;
    const len = Math.hypot(dx, dy) || 1;
    const [nx, ny] = area > 0 ? [dy / len, -dx / len] : [-dy / len, dx / len];
    const [wx, wz] = rotateY(nx, 0, view.yawDeg);
    const [mx, mz] = rotateY((x + x2) / 2, 0, view.yawDeg);
    const toCamX = -mx;
    const toCamY = -(y + y2) / 2;
    const toCamZ = view.camZ - mz;
    if (wx * toCamX + ny * toCamY + wz * toCamZ <= 0) return;
    const d = spec.depth / 2;
    const quad = [projectModel(view, x, y, d), projectModel(view, x2, y2, d), projectModel(view, x2, y2, -d), projectModel(view, x, y, -d)];
    const k = lit(wx, ny, wz);
    const fill = `rgb(${Math.round(110 * k)},${Math.round(12 * k)},${Math.round(22 * k)})`;
    quads.push({ depth: depthOf(view, (x + x2) / 2, 0), markup: `<polygon points="${points(quad)}" fill="${fill}"/>` });
  });
  return quads.sort((a, b) => b.depth - a.depth).map((q) => q.markup).join("");
}

function capMarkup(spec: PackSpec, view: View, face: Face, ops: Op[]): string {
  const outline = spec.outline.map(([u, v]) => projectFace(view, spec, face, u, v));
  const o = projectFace(view, spec, face, 0, 0);
  const ex = projectFace(view, spec, face, 1, 0);
  const ey = projectFace(view, spec, face, 0, 1);
  const normalZ = face === "front" ? Math.cos((view.yawDeg * Math.PI) / 180) : -Math.cos((view.yawDeg * Math.PI) / 180);
  const nx = (face === "front" ? 1 : -1) * Math.sin((view.yawDeg * Math.PI) / 180);
  const k = lit(nx, 0, normalZ);
  return (
    `<polygon points="${points(outline)}" fill="${spec.ground}"/>` +
    `<g transform="${matrix(o, ex, ey, spec.texW, spec.texH)}">${ops.map(opMarkup).join("")}</g>` +
    `<polygon points="${points(outline)}" fill="black" fill-opacity="${n(1 - k)}"/>`
  );
}

export function svgMarkup(items: DrawItem[]): string {
  uid = 0;
  let out = "";
  for (const item of items) {
    for (const layer of item.layers) {
      const facts = layer.facts;
      const spec = specFor(facts.format);
      const view = item.view;
      let body = sidesMarkup(spec, view);
      const side = facing(view.yawDeg);
      if (side) body += capMarkup(spec, view, side, side === "front" ? frontOps(spec, facts) : backOps(spec, facts));
      const art = side === "back" && item.sticker ? stickerArt(spec, facts, 1) : null;
      if (art) {
        const q = stickerQuad(view, spec, stickerPose(spec, facts.format, item.progress));
        body += `<g transform="${matrix(q[0]!, q[1]!, q[3]!, art.w, art.h)}">${art.ops.map(opMarkup).join("")}</g>`;
      }
      out += `<g opacity="${n(layer.opacity)}">${body}</g>`;
    }
  }
  return out;
}
