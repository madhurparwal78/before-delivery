// Drawing instructions for a pack's faces and sticker, in texture pixels. The same list is painted on a canvas (WebGL
// textures) and turned into SVG elements (the declaration panel), so both renderers state the same facts.
import type { PackFacts } from "../../shared/types";
import { FRONT_BOX, PANEL_GEOMETRY, panelLines, type PackSpec, type Point } from "./spec";

export type Font = "display" | "text";
export type Op =
  | { k: "poly"; pts: Point[]; fill: string }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { k: "text"; x: number; y: number; text: string; font: Font; size: number; fill: string; weight?: number; italic?: boolean; anchor?: "start" | "middle" }
  | { k: "lines"; x: number; y: number; lines: string[]; font: Font; size: number; leading: number; fill: string; anchor: "start" | "middle" }
  | { k: "clip"; x: number; y: number; w: number; h: number; ops: Op[] };

export const FONT_FAMILY: Record<Font, string> = {
  display: '"Bebas Neue", Impact, sans-serif',
  text: '"EB Garamond", Georgia, serif',
};

let measureCtx: CanvasRenderingContext2D | null = null;
export function measure(text: string, font: Font, size: number, weight = 400, italic = false): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.45;
  measureCtx.font = `${italic ? "italic " : ""}${weight} ${size}px ${FONT_FAMILY[font]}`;
  return measureCtx.measureText(text).width;
}

/** Wrap `text` into lines no wider than `maxW` at `size`; words longer than a line are cut by characters. */
function wrap(text: string, font: Font, size: number, maxW: number, weight = 400): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (word: string) => {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial, font, size, weight) <= maxW) {
      line = trial;
      return;
    }
    if (line) lines.push(line);
    line = "";
    if (measure(word, font, size, weight) <= maxW) {
      line = word;
      return;
    }
    let chunk = "";
    for (const ch of word) {
      if (measure(chunk + ch, font, size, weight) > maxW && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  };
  for (const word of text.split(/\s+/).filter(Boolean)) push(word);
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Largest font size, wrapped, so the whole block fits in w x h. */
function fitBlock(text: string, font: Font, w: number, h: number, maxSize: number, minSize = 8): { size: number; lines: string[]; leading: number } {
  for (let size = maxSize; size >= minSize; size -= 1) {
    const lines = wrap(text, font, size, w);
    const leading = size * (font === "display" ? 0.95 : 1.1);
    if (lines.length * leading <= h) return { size, lines, leading };
  }
  const lines = wrap(text, font, minSize, w);
  return { size: minSize, lines, leading: minSize * 1.05 };
}

const px = (spec: PackSpec, fx: number, fy: number): [number, number] => [fx * spec.texW, fy * spec.texH];

function silhouette(spec: PackSpec, fill: string): Op {
  return { k: "poly", pts: spec.outline.map(([u, v]) => [u * spec.texW, v * spec.texH] as Point), fill };
}

/** Front face: ground, the live drink name and variant inside the front box (clipped so no ink can leave it). */
export function frontOps(spec: PackSpec, facts: PackFacts): Op[] {
  const [bx, by] = px(spec, FRONT_BOX[0], FRONT_BOX[1]);
  const bw = FRONT_BOX[2] * spec.texW;
  const bh = FRONT_BOX[3] * spec.texH;
  const variant = facts.skuName.startsWith(facts.drinkName) ? facts.skuName.slice(facts.drinkName.length).trim() : facts.skuName;
  const nameH = bh * 0.7;
  const name = fitBlock(facts.drinkName, "display", bw - 24, nameH - 12, 120);
  const small = fitBlock(variant, "text", bw - 24, bh - nameH - 8, 40, 9);
  const nameTop = by + 8;
  const ops: Op[] = [
    silhouette(spec, spec.ground),
    { k: "rect", x: bx - 12, y: by - 10, w: bw + 24, h: bh + 20, fill: spec.box },
    {
      k: "clip", x: bx, y: by, w: bw, h: bh,
      ops: [
        { k: "lines", x: bx + bw / 2, y: nameTop + name.size * 0.85, lines: name.lines, font: "display", size: name.size, leading: name.leading, fill: "rgb(255,255,255)", anchor: "middle" },
        { k: "lines", x: bx + bw / 2, y: by + nameH + small.size * 0.9, lines: small.lines, font: "text", size: small.size, leading: small.leading, fill: "rgb(240,185,189)", anchor: "middle" },
      ],
    },
    { k: "text", x: spec.texW / 2, y: spec.texH * 0.7, text: "VASANT TALKIES", font: "display", size: spec.texW * 0.075, fill: spec.mark, anchor: "middle" },
    { k: "text", x: spec.texW / 2, y: spec.texH * 0.7 + spec.texW * 0.07, text: "INTERVAL SODA HOUSE", font: "text", size: spec.texW * 0.04, fill: spec.mark, anchor: "middle" },
  ];
  return ops;
}

/** Declaration panel: the printed MRP in its rectangle, the packed and best-before lines, unit price and wrapper. No accent colour. */
export function backOps(spec: PackSpec, facts: PackFacts): Op[] {
  const g = PANEL_GEOMETRY[spec.format];
  const l = panelLines(facts);
  const [mx, my] = px(spec, g.mrp[0], g.mrp[1]);
  const mw = g.mrp[2] * spec.texW;
  const mh = g.mrp[3] * spec.texH;
  const mrpSize = Math.min(mh * 0.62, mw / (l.mrp.length * 0.4));
  const left = spec.texW * 0.08;
  const lineSize = spec.texW * 0.052;
  let y = my + mh + spec.texH * 0.045;
  const gap = spec.texH * 0.05;
  const ops: Op[] = [
    silhouette(spec, spec.panelGround),
    { k: "text", x: left, y: spec.texH * 0.255, text: "DECLARATION", font: "display", size: spec.texW * 0.06, fill: "rgb(240,185,189)" },
    { k: "rect", x: mx, y: my, w: mw, h: mh, fill: "rgb(138,16,28)" },
    { k: "text", x: mx + mw / 2, y: my + mh * 0.72, text: l.mrp, font: "display", size: mrpSize, fill: "rgb(255,255,255)", anchor: "middle" },
  ];
  const rows = [l.packed, l.bestBefore, l.unit, l.oldWrapper ? "Old wrapper" : null].filter((x): x is string => x !== null);
  for (const row of rows) {
    ops.push({ k: "text", x: left, y, text: row, font: "text", size: lineSize, weight: 600, fill: "rgb(255,255,255)" });
    y += gap;
  }
  ops.push({ k: "text", x: spec.texW / 2, y: spec.texH * 0.965, text: "VASANT TALKIES", font: "display", size: spec.texW * 0.04, fill: "rgb(240,185,189)", anchor: "middle" });
  return ops;
}

interface StickerArt {
  w: number;
  h: number;
  ops: Op[];
  lines: string[];
}

/** The die-cut sticker, drawn flat in the accent colour with carmine lettering. Local pixels. */
export function stickerArt(spec: PackSpec, facts: PackFacts, scale = 2): StickerArt | null {
  if (facts.revisedMrpPaise === null) return null;
  const g = PANEL_GEOMETRY[spec.format].sticker;
  const w = Math.round(g[2] * spec.texW * scale);
  const h = Math.round(g[3] * spec.texH * scale);
  const cut = Math.min(w, h) * 0.14;
  const text = panelLines(facts).revised ?? "";
  const price = text.slice("Revised MRP ".length);
  const pad = w * 0.08;
  const label = fitBlock("REVISED MRP", "display", w - pad * 2, h * 0.28, h * 0.22, 10);
  const big = fitBlock(price, "display", w - pad * 2, h * 0.4, h * 0.38, 10);
  const ops: Op[] = [
    { k: "poly", pts: [[cut, 0], [w, 0], [w, h - cut], [w - cut, h], [0, h], [0, cut]], fill: "rgb(255,217,220)" },
    { k: "lines", x: w / 2, y: h * 0.34, lines: label.lines, font: "display", size: label.size, leading: label.leading, fill: "rgb(156,18,32)", anchor: "middle" },
    { k: "lines", x: w / 2, y: h * 0.78, lines: big.lines, font: "display", size: big.size, leading: big.leading, fill: "rgb(156,18,32)", anchor: "middle" },
  ];
  return { w, h, ops, lines: [text] };
}

// ---- painting on a canvas -----------------------------------------------------------------------------------------

export function paintOps(ctx: CanvasRenderingContext2D, ops: Op[]): void {
  for (const op of ops) {
    if (op.k === "poly") {
      ctx.fillStyle = op.fill;
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    } else if (op.k === "rect") {
      ctx.fillStyle = op.fill;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.k === "text" || op.k === "lines") {
      ctx.fillStyle = op.fill;
      ctx.textAlign = op.anchor === "middle" ? "center" : "left";
      ctx.textBaseline = "alphabetic";
      const weight = op.k === "text" ? (op.weight ?? 400) : 400;
      const italic = op.k === "text" && op.italic;
      ctx.font = `${italic ? "italic " : ""}${weight} ${op.size}px ${FONT_FAMILY[op.font]}`;
      if (op.k === "text") ctx.fillText(op.text, op.x, op.y);
      else op.lines.forEach((line, i) => ctx.fillText(line, op.x, op.y + i * op.leading));
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.x, op.y, op.w, op.h);
      ctx.clip();
      paintOps(ctx, op.ops);
      ctx.restore();
    }
  }
}

/** Fixed-seed monochrome grain, added to the whole face so the print looks printed. The grain strip stays text-free. */
export function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  let s = seed >>> 0 || 1;
  for (let i = 0; i < d.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = ((s >>> 24) / 255 - 0.5) * 44;
    if (d[i + 3] === 0) continue;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(image, 0, 0);
}

/** A soft hard-edged lamp pool laid over a face: lighter top-left, darker bottom-right. Only mixes carmine/charcoal/white. */
export function lampOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "rgba(255,255,255,0.07)");
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
