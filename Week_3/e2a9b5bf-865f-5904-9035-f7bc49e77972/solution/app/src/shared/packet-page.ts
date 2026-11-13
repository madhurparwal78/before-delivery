import { apertureLabel } from "./optics";
import { measuredPair } from "./pair";
import { skyToView } from "./projection";
import type { Derived, ObjectKind, Pair, Point, StrokeFile } from "./types";

/**
 * The packet's page layout, decided once. The server wraps these pages in a document for the
 * PDF renderer; the browser puts the same markup in each Paper preview article. Every page is
 * an element with class `lp-page` holding the string a builder returns, and all lengths are in
 * points scaled by the page's own width, so the identical markup fits any page width.
 */

interface CoverInfo {
  number: number;
  programName: string;
  observerName: string;
  observerEmail: string;
  rowCount: number;
  coordinatorName: string;
}

export interface PageObservation {
  designation: string;
  objectName: string;
  kind: ObjectKind;
  /** ISO 8601 UTC, or null when the observation has no time. */
  observedAt: string | null;
  localTime: string | null;
  localOffset: string | null;
  timeZone: string;
  siteName: string;
  seeing: number | null;
  transparencyNelm: number | null;
  telescopeName: string;
  eyepieceName: string;
  barlowName: string | null;
  /** The observation's own stored optics values, train included. */
  derived: Derived;
  /** The number of the rule edition the observation was judged by. */
  edition: number;
  concentrationClass: string | null;
  pair: Pair | null;
  description: string;
  /** The cited stroke file, or null when the row has none. */
  strokes: StrokeFile | null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const line = (text: string) => `<div>${escapeHtml(text)}</div>`;

const GRAPHITE = "#34343b";
const RING = 100;

function viewPoint(p: Point, d: Derived): [number, number] {
  const [x, y] = skyToView(p[0], p[1], d.orientation);
  const scale = RING / (d.true_field_arcmin / 2);
  return [Math.round(x * scale * 100) / 100, Math.round(-y * scale * 100) / 100];
}

const STROKE_WIDTH = { fine: 0.9, medium: 1.6, broad: 2.8 } as const;
const STAR_RADIUS = [1.4, 2.1, 3, 4.1, 5.4] as const;

/** The sketch in graphite on white inside its circle, in the observation's own projection. */
function sketchSvg(obs: PageObservation): string {
  const d = obs.derived;
  const parts: string[] = [];
  for (const stroke of obs.strokes?.strokes ?? []) {
    const points = stroke.points.map((p) => viewPoint(p, d).join(",")).join(" ");
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${GRAPHITE}" stroke-width="${STROKE_WIDTH[stroke.width]}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  for (const star of obs.strokes?.stars ?? []) {
    const [x, y] = viewPoint(star.at, d);
    parts.push(`<circle cx="${x}" cy="${y}" r="${STAR_RADIUS[star.brightness - 1] ?? 3}" fill="${GRAPHITE}"/>`);
  }
  if (obs.pair) {
    const [ax, ay] = viewPoint(obs.pair.primary, d);
    const [bx, by] = viewPoint(obs.pair.secondary, d);
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${GRAPHITE}" stroke-width="0.8"/>`,
      `<circle cx="${ax}" cy="${ay}" r="3.4" fill="#fff" stroke="${GRAPHITE}" stroke-width="0.9"/>`,
      `<circle cx="${bx}" cy="${by}" r="3.4" fill="#fff" stroke="${GRAPHITE}" stroke-width="0.9"/>`,
    );
  }
  const outside = "M-102,-102 H102 V102 H-102 Z M100,0 A100,100 0 1,0 -100,0 A100,100 0 1,0 100,0 Z";
  return (
    `<svg viewBox="-102 -102 204 204" role="img" aria-label="Sketch of ${escapeHtml(obs.designation)}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle r="${RING}" fill="#fff"/>${parts.join("")}` +
    `<path d="${outside}" fill="#fff" fill-rule="evenodd"/>` +
    `<circle r="${RING}" fill="none" stroke="${GRAPHITE}" stroke-width="1.2"/></svg>`
  );
}

/** Letters are drawn as paths so the page carries no stray text beside the lines. */
const GLYPH = {
  N: "M-2.6,3.2 V-3.2 L2.6,3.2 V-3.2",
  E: "M2.4,-3.2 H-2.4 V3.2 H2.4 M-2.4,0 H1.6",
} as const;

function compassSvg(d: Derived): string {
  const arrow = (letter: "N" | "E", sky: Point) => {
    const [x, y] = skyToView(sky[0], sky[1], d.orientation);
    const tip = [22 + x * 15, 22 - y * 15];
    const label = [22 + x * 21, 22 - y * 21];
    const angle = Math.atan2(-y, x);
    const head = [-1, 1].map((s) => `${tip[0]! - Math.cos(angle + s * 0.45) * 4},${tip[1]! - Math.sin(angle + s * 0.45) * 4}`);
    return (
      `<line x1="22" y1="22" x2="${tip[0]}" y2="${tip[1]}" stroke="${GRAPHITE}" stroke-width="1"/>` +
      `<polyline points="${head[0]} ${tip[0]},${tip[1]} ${head[1]}" fill="none" stroke="${GRAPHITE}" stroke-width="1"/>` +
      `<path d="${GLYPH[letter]}" transform="translate(${label[0]} ${label[1]})" fill="none" stroke="${GRAPHITE}" stroke-width="1"/>`
    );
  };
  return `<svg viewBox="-6 -6 56 56" role="img" aria-label="North and east" xmlns="http://www.w3.org/2000/svg">${arrow("N", [0, 1])}${arrow("E", [1, 0])}</svg>`;
}

function descriptionSize(length: number): number {
  if (length <= 800) return 10;
  if (length <= 1600) return 8.5;
  if (length <= 2400) return 7.5;
  if (length <= 3200) return 6.5;
  return 5.5;
}

export function coverPage(info: CoverInfo): string {
  return (
    `<div class="lp-body lp-cover">` +
    `<div class="lp-kicker">Lowlamp Field Log</div>` +
    `<div class="lp-cover-title">${escapeHtml(`Observing log packet ${info.number}`)}</div>` +
    line(info.programName) +
    `<div class="lp-gap"></div>` +
    line(`Observer: ${info.observerName} (${info.observerEmail})`) +
    line(`Objects: ${info.rowCount}`) +
    line(`Coordinator: ${info.coordinatorName}`) +
    `</div>`
  );
}

export function rowPage(obs: PageObservation): string {
  const d = obs.derived;
  const ut = obs.observedAt
    ? `UT: ${obs.observedAt.slice(0, 10)} ${obs.observedAt.slice(11, 16)} UT (${obs.localTime} local, UTC${obs.localOffset}, ${obs.timeZone})`
    : "UT: not recorded";
  const lines = [
    ut,
    `Site: ${obs.siteName}`,
    `Seeing: ${obs.seeing ?? "not recorded"}/10`,
    `Transparency: NELM ${obs.transparencyNelm === null ? "not recorded" : obs.transparencyNelm.toFixed(1)}`,
    `Telescope: ${obs.telescopeName}, ${apertureLabel(d.aperture_mm)} mm aperture`,
    `Eyepiece: ${obs.eyepieceName}${obs.barlowName ? `, ${obs.barlowName}` : ""} at ${d.magnification}×`,
    `True field: ${d.true_field_arcmin}′ · Exit pupil: ${d.exit_pupil_mm.toFixed(1)} mm`,
    `Orientation: ${d.orientation.sentence}`,
    `Program rules: edition ${obs.edition}`,
  ];
  if (obs.kind === "globular") {
    lines.push(obs.concentrationClass ? `Concentration: class ${obs.concentrationClass}` : "Concentration: not recorded");
  }
  if (obs.kind === "double_star") {
    if (obs.pair) {
      const m = measuredPair(obs.pair.primary, obs.pair.secondary);
      lines.push(`Pair: ${m.separation_arcmin.toFixed(1)}′ at ${m.position_angle_deg}°`);
    } else {
      lines.push("Pair: not measured");
    }
  }
  const size = descriptionSize(obs.description.length);
  return (
    `<div class="lp-body">` +
    `<div class="lp-title">${escapeHtml(`${obs.designation} — ${obs.objectName}`)}</div>` +
    `<div class="lp-grid"><div class="lp-lines">${lines.map(line).join("")}</div>` +
    `<div class="lp-art">${sketchSvg(obs)}${compassSvg(d)}</div></div>` +
    `<div class="lp-desc" style="font-size:calc(${size} * var(--pt))">Description: ${escapeHtml(obs.description)}</div>` +
    `</div>`
  );
}

const INK = "#17141c";

export const PAGE_CSS = `
.lp-page{container-type:inline-size;position:relative;box-sizing:border-box;width:100%;aspect-ratio:8.5/11;background:#fff;color:${INK};overflow:hidden;font-family:Sora,system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:left}
.lp-body{--pt:calc(100cqw / 612);position:absolute;inset:0;box-sizing:border-box;padding:calc(40 * var(--pt));display:flex;flex-direction:column;gap:calc(10 * var(--pt));font-size:calc(10 * var(--pt));line-height:1.4;overflow:hidden}
.lp-body div{min-width:0}
.lp-title{font-size:calc(16 * var(--pt));font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.lp-grid{display:flex;gap:calc(16 * var(--pt));align-items:flex-start}
.lp-lines{flex:1 1 0;min-width:0}
.lp-lines div{overflow-wrap:anywhere}
.lp-art{flex:0 0 calc(200 * var(--pt));width:calc(200 * var(--pt));display:flex;flex-direction:column;gap:calc(6 * var(--pt))}
.lp-art svg{display:block;width:100%;height:auto}
.lp-art svg + svg{width:calc(56 * var(--pt))}
.lp-desc{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.3;min-width:0}
.lp-cover{justify-content:center;gap:calc(8 * var(--pt))}
.lp-cover div{overflow-wrap:anywhere}
.lp-kicker{font-size:calc(10 * var(--pt));letter-spacing:.14em;text-transform:uppercase;color:#5b5964}
.lp-cover-title{font-size:calc(30 * var(--pt));font-weight:600;line-height:1.15}
.lp-gap{height:calc(18 * var(--pt))}
`;

const FACES = [
  {
    file: "sora-latin-wght-normal.woff2",
    range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    file: "sora-latin-ext-wght-normal.woff2",
    range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  },
] as const;

export const SORA_FILES: readonly string[] = FACES.map((f) => f.file);

function soraFaces(base: string): string {
  return FACES.map(
    (f) => `@font-face{font-family:Sora;font-weight:100 800;font-style:normal;src:url(${base}${f.file}) format("woff2");unicode-range:${f.range}}`,
  ).join("");
}

/** The whole document the renderer prints: page 1 the cover, then one page per row. */
export function packetDocument(pages: string[], fontBase: string): string {
  const body = pages.map((inner) => `<section class="lp-page">${inner}</section>`).join("");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Observing log packet</title><style>` +
    `${soraFaces(fontBase)}${PAGE_CSS}` +
    `@page{size:8.5in 11in;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `.lp-page{width:8.5in;height:11in;aspect-ratio:auto;break-after:page;page-break-after:always}` +
    `.lp-page:last-child{break-after:auto;page-break-after:auto}` +
    `</style></head><body>${body}</body></html>`
  );
}
