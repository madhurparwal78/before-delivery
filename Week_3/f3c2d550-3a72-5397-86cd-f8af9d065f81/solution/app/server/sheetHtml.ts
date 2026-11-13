import type { Paper, SheetStop } from "../shared/api.js";
import { makerYearLine } from "../shared/words.js";
import type { PaperSize } from "./printing.js";

const STOPS_PER_PAGE = 6;
const MARGIN_MM = { top: 12, bottom: 20, side: 14 };

interface PaperLayout {
  size: PaperSize;
  heightMm: number;
  margins: { top: string; bottom: string; side: string };
}

const inches = (mm: number): string => (mm / 25.4).toFixed(4);

const PAPERS: Record<Paper, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
};

export function paperLayout(paper: Paper): PaperLayout {
  const { widthMm, heightMm } = PAPERS[paper];
  return {
    size: { widthInches: inches(widthMm), heightInches: inches(heightMm) },
    heightMm: heightMm - MARGIN_MM.top - MARGIN_MM.bottom,
    margins: { top: inches(MARGIN_MM.top), bottom: inches(MARGIN_MM.bottom), side: inches(MARGIN_MM.side) },
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface SheetStopWithPhoto {
  stop: SheetStop;
  /** The display crop as JPEG bytes; absent when the reference was purged before rendering. */
  photo: Buffer | null;
}

function stopHtml({ stop, photo }: SheetStopWithPhoto): string {
  const picture = photo
    ? `<img class="photo" alt="" src="data:image/jpeg;base64,${photo.toString("base64")}">`
    : `<div class="photo" style="background:${stop.swatch}"></div>`;
  const makerYear = makerYearLine(stop);
  return `<article class="stop">${picture}<div class="text">
<p class="name">${stop.position}. ${escapeHtml(stop.title)}</p>
${makerYear ? `<p>${escapeHtml(makerYear)}</p>` : ""}
<p>${escapeHtml(stop.size_text)}</p>
<p class="swatch"><span class="chip" style="background:${stop.swatch}"></span><span>Swatch ${stop.swatch}</span></p>
</div></article>`;
}

/** One self-contained page: the photographs are embedded and nothing private is on it. */
export function sheetHtml(reelName: string, stops: readonly SheetStopWithPhoto[], layout: PaperLayout): string {
  const pages: SheetStopWithPhoto[][] = [];
  for (let at = 0; at < stops.length; at += STOPS_PER_PAGE) pages.push(stops.slice(at, at + STOPS_PER_PAGE));
  const body = pages
    .map(
      (page, index) => `<section class="page">
${index === 0 ? `<header><h1>${escapeHtml(reelName)}</h1><p>${stops.length} references</p></header>` : ""}
<div class="grid">${page.map(stopHtml).join("")}</div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(reelName)}</title><style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Helvetica Neue", Arial, sans-serif; color: #14080f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { height: ${layout.heightMm - 3}mm; overflow: hidden; display: flex; flex-direction: column; break-after: page; }
.page:last-child { break-after: auto; }
header { height: 20mm; flex: none; }
h1 { margin: 0 0 1mm; font-size: 20pt; }
header p { margin: 0; font-size: 10pt; color: #4a5168; }
.grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 5mm 8mm; min-height: 0; }
.stop { display: flex; gap: 4mm; align-items: flex-start; min-width: 0; }
.photo { width: 44mm; height: 44mm; flex: none; object-fit: cover; display: block; }
.text { min-width: 0; font-size: 9pt; line-height: 1.4; }
.text p { margin: 0 0 1mm; overflow-wrap: anywhere; }
.name { font-weight: 700; font-size: 10pt; }
.swatch { display: flex; align-items: center; gap: 2mm; }
.chip { width: 8mm; height: 8mm; display: inline-block; flex: none; }
</style></head><body>
${body}
</body></html>`;
}

export function footerHtml(reelName: string): string {
  return `<html><head><style>
html, body { margin: 0; width: 100%; }
body { font-family: Arial, sans-serif; font-size: 10px; text-align: center; color: #4a5168; }
div { white-space: pre; }
</style></head><body><div>Stowdeck · ${escapeHtml(reelName)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div></body></html>`;
}
