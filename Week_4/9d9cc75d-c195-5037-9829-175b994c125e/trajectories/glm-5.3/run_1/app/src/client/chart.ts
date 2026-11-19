/** The browser SVG chart: one element per mark, per the published chart grammar. */

import { valueTicks, scaleFraction } from "../../src/shared/chart.js";
import { displayNumber } from "../../src/shared/display.js";
import { esc } from "./api.js";
import type { QueryAnswer } from "./view.js";
import { markColor, markPattern } from "./view.js";

export interface TickScaleValue {
  ticks: number[];
  step: number;
}

export interface MarkDatum {
  key: string;
  dimTexts: string[];
  values: (number | null)[];
}

export interface ChartSpec {
  chart: string;
  dims: string[];
  measures: string[];
  marks: MarkDatum[];
  colorDimension: boolean;
  colorMeasure: string | null;
  total: (number | null)[] | null;
  refLines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
  sheetName: string;
}

const W = 900;
const H = 520;
const PADL = 80;
const PADR = 30;
const PADT = 24;
const PADB = 64;

interface Shape {
  shape: "bar" | "point" | "cell" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One SVG string for the whole chart. */
export function renderChart(spec: ChartSpec): string {
  const axisValues = spec.marks.map((m) => m.values[0]).filter((v): v is number => v !== null && v !== undefined);
  const ticks = valueTicks(axisValues);
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;
  const parts: string[] = [];
  parts.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="chart">`);

  const dimsOnRows = spec.dims.length;
  void dimsOnRows;

  const shapes: (Shape & { mark: MarkDatum; index: number; color: string; pattern: string })[] = [];
  const seqValues = spec.colorMeasure ? spec.marks.map((m) => m.values.find((v, i) => i >= spec.dims.length && v !== null) ?? null) : [];
  let seqMin = Infinity;
  let seqMax = -Infinity;
  for (const v of seqValues) {
    if (v !== null) {
      seqMin = Math.min(seqMin, v);
      seqMax = Math.max(seqMax, v);
    }
  }
  const isSeq = spec.colorMeasure !== null && spec.marks.length > 0;

  if (spec.chart === "bar" || spec.chart === "heat_map" || spec.chart === "text_table" || spec.chart === "none") {
    const bandW = plotW / Math.max(1, spec.marks.length);
    spec.marks.forEach((m, i) => {
      const v = m.values[0];
      const frac = v === null ? 0 : Math.max(0, Math.min(1, scaleFraction(v, ticks.ticks)));
      const x = PADL + i * bandW + bandW * 0.18;
      const w = bandW * 0.64;
      const h = Math.max(1, frac * plotH);
      const y = PADT + plotH - h;
      shapes.push({
        shape: spec.chart === "bar" ? "bar" : "cell",
        x,
        y,
        w,
        h,
        mark: m,
        index: i,
        color: markColor(i, isSeq ? (seqValues[i] as number | null) : null, seqMin, seqMax, isSeq),
        pattern: markPattern(i, isSeq),
      });
    });
  } else if (spec.chart === "line" || spec.chart === "scatter") {
    const step = spec.marks.length > 1 ? plotW / (spec.marks.length - 1) : plotW;
    spec.marks.forEach((m, i) => {
      const v = m.values[0];
      const frac = v === null ? 0.5 : scaleFraction(v, ticks.ticks);
      const x = PADL + i * step;
      const y = PADT + plotH - frac * plotH;
      shapes.push({
        shape: "point",
        x: x - 8,
        y: y - 8,
        w: 16,
        h: 16,
        mark: m,
        index: i,
        color: markColor(i, null, 0, 0, false),
        pattern: markPattern(i, false),
      });
    });
  }

  // The plot rectangle carries data-plot.
  parts.push(
    `<rect data-plot="true" x="${PADL}" y="${PADT}" width="${plotW}" height="${plotH}" fill="rgba(253,241,247,0.5)" stroke="#1a0a14" stroke-width="1"></rect>`,
  );

  // Axis ticks with data-tick.
  const first = ticks.ticks[0] ?? 0;
  const last = ticks.ticks[ticks.ticks.length - 1] ?? 1;
  const span = last - first || 1;
  for (const t of ticks.ticks) {
    const frac = (t - first) / span;
    const y = PADT + plotH - frac * plotH;
    parts.push(`<line x1="${PADL}" y1="${y}" x2="${PADL + plotW}" y2="${y}" stroke="#ea9fcf" stroke-width="1"></line>`);
    parts.push(
      `<text class="tick" data-tick="${esc(displayNumber(t))}" x="${PADL - 10}" y="${y + 4}" text-anchor="end" font-size="13">${esc(displayNumber(t))}</text>`,
    );
  }

  // Dimension labels under the bands.
  if (spec.chart === "bar" || spec.chart === "heat_map" || spec.chart === "text_table") {
    const bandW = plotW / Math.max(1, spec.marks.length);
    spec.marks.forEach((m, i) => {
      const x = PADL + i * bandW + bandW / 2;
      parts.push(
        `<text x="${x}" y="${PADT + plotH + 20}" text-anchor="middle" font-size="13">${esc(m.dimTexts[0] ?? "")}</text>`,
      );
    });
  }

  // The marks. Every mark is a focusable SVG element with the published
  // attributes. A transparent hit rectangle inside makes the group clickable
  // and gives a 44px tap area on phones.
  for (const s of shapes) {
    const measureCaption = spec.measures[0] ?? "Value";
    const displayVal = s.mark.values[0] === null ? "(null)" : displayNumber(s.mark.values[0] as number);
    const label = `${s.mark.dimTexts.join(", ")}, ${measureCaption} ${displayVal}, ${s.shape} ${s.index + 1} of ${spec.marks.length}`;
    parts.push(
      `<g class="mark" role="button" tabindex="-1" data-mark="${esc(s.mark.key)}" data-dims="${esc(s.mark.dimTexts.join(" | "))}" data-measure="${esc(measureCaption)}" data-value="${s.mark.values[0] === null ? "" : String(s.mark.values[0])}" aria-pressed="false" aria-label="${esc(label)}" data-color="${s.color}" data-pattern="${s.pattern}">${markHit(s)}${markShape(s)}</g>`,
    );
  }

  // Reference lines carry data-ref.
  for (const r of spec.refLines) {
    if (r.value === null) continue;
    const frac = scaleFraction(r.value, ticks.ticks);
    const y = PADT + plotH - frac * plotH;
    parts.push(
      `<line data-ref="${esc(r.type)}" x1="${PADL}" y1="${y}" x2="${PADL + plotW}" y2="${y}" stroke="#1a0a14" stroke-dasharray="8 6" stroke-width="2"></line>`,
      `<text x="${PADL + 6}" y="${y - 6}" font-size="13">${esc(displayNumber(r.value))}</text>`,
    );
  }

  // The trend line.
  if (spec.trend) {
    const x0 = 0;
    const x1 = spec.marks.length - 1;
    const y0 = spec.trend.slope * x0 + spec.trend.intercept;
    const y1 = spec.trend.slope * x1 + spec.trend.intercept;
    const fy = (v: number): number => PADT + plotH - scaleFraction(v, ticks.ticks) * plotH;
    parts.push(
      `<line x1="${PADL}" y1="${fy(y0)}" x2="${PADL + plotW}" y2="${fy(y1)}" stroke="#1a0a14" stroke-width="2" stroke-dasharray="4 4"></line>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function markShape(s: { shape: string; x: number; y: number; w: number; h: number; color: string; pattern: string; mark: MarkDatum }): string {
  const stroke = `stroke="#1a0a14" stroke-width="2"`;
  const fill = `fill="rgba(${s.color},1)"`;
  const defs: string[] = [];
  let body = "";
  if (s.shape === "bar") {
    body = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" ${fill} ${stroke}></rect>`;
    if (s.pattern !== "solid") body += patternOverlay(s);
  } else if (s.shape === "cell") {
    body = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" ${fill} ${stroke}></rect>`;
    if (s.pattern !== "solid") body += patternOverlay(s);
    body += `<text x="${s.x + s.w / 2}" y="${PADT + (H - PADT - PADB) - 8}" text-anchor="middle" font-size="13">${esc(s.mark.values[0] === null ? "(null)" : displayNumber(s.mark.values[0] as number))}</text>`;
  } else if (s.shape === "point") {
    body = `<circle cx="${s.x + 8}" cy="${s.y + 8}" r="8" ${fill} ${stroke}></circle>`;
    if (s.pattern !== "solid") body += `<circle cx="${s.x + 8}" cy="${s.y + 8}" r="8" fill="url(#pat-${s.pattern})" opacity="0.5"></circle>`;
  } else {
    body = `<text x="${s.x}" y="${s.y + 14}" font-size="14">${esc(s.mark.values[0] === null ? "(null)" : displayNumber(s.mark.values[0] as number))}</text>`;
  }
  return defs.join("") + body;
}

/** A transparent hit area that makes the group clickable and tappable. */
function markHit(s: { x: number; y: number; w: number; h: number }): string {
  const pad = 4;
  const hx = s.x - pad;
  const hy = s.y - pad;
  const hw = s.w + pad * 2;
  const hh = Math.max(44, s.h + pad * 2);
  return `<rect x="${hx}" y="${Math.min(hy, s.y + s.h - hh)}" width="${hw}" height="${hh}" fill="transparent"></rect>`;
}

function patternOverlay(s: { x: number; y: number; w: number; h: number; pattern: string }): string {
  if (s.pattern === "dots") {
    return `<circle cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" r="3" fill="#1a0a14"></circle>`;
  }
  if (s.pattern === "stripes") {
    return `<line x1="${s.x + 6}" y1="${s.y}" x2="${s.x + 6}" y2="${s.y + s.h}" stroke="#1a0a14" stroke-width="3"></line>`;
  }
  if (s.pattern === "checks") {
    return `<rect x="${s.x + s.w / 2 - 6}" y="${s.y + s.h / 2 - 6}" width="12" height="12" fill="none" stroke="#1a0a14" stroke-width="2"></rect>`;
  }
  if (s.pattern === "rings") {
    return `<circle cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" r="5" fill="none" stroke="#1a0a14" stroke-width="2"></circle>`;
  }
  return "";
}

export { W, H, PADL, PADT, PADB };
