import { makerYearLine } from '../../shared/copy.js';
import type { SheetStopJson } from '../../shared/types.js';

/**
 * The self-contained page sent to the printing service. It carries only what a contact-sheet
 * recipient may see: never a reference's notes, source link or where-found note.
 */

const STOPS_PER_PAGE = 6;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function stopMarkup(stop: SheetStopJson, photo: Buffer | null): string {
  const photoMarkup = photo
    ? `<img class="photo" alt="" src="data:image/jpeg;base64,${photo.toString('base64')}">`
    : '<div class="photo photo-missing"></div>';
  const makerYear = makerYearLine(stop.maker, stop.year);
  return `<article class="stop">
  ${photoMarkup}
  <div class="facts">
    <p class="name">${escapeHtml(`${stop.position}. ${stop.title}`)}</p>
    ${makerYear ? `<p class="maker">${escapeHtml(makerYear)}</p>` : ''}
    <p class="size">${escapeHtml(stop.size_text)}</p>
    <p class="swatch-line"><span class="swatch-block" style="background:${escapeHtml(stop.swatch)}"></span>${escapeHtml(`Swatch ${stop.swatch}`)}</p>
  </div>
</article>`;
}

export function buildSheetPage(
  reelName: string,
  stops: SheetStopJson[],
  photos: Map<string, Buffer | null>,
): string {
  const pages: string[] = [];
  for (let start = 0; start < stops.length; start += STOPS_PER_PAGE) {
    const slice = stops.slice(start, start + STOPS_PER_PAGE);
    const heading =
      start === 0
        ? `<header class="sheet-head">
    <h1>${escapeHtml(reelName)}</h1>
    <p>${escapeHtml(`${stops.length} references`)}</p>
  </header>`
        : '';
    pages.push(`<section class="sheet-page">
  ${heading}
  <div class="grid">
    ${slice.map((stop) => stopMarkup(stop, photos.get(stop.reference_id) ?? null)).join('\n    ')}
  </div>
</section>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(reelName)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #15131a;
    background: #ffffff;
    font-size: 9.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet-page { height: 236mm; overflow: hidden; break-after: page; page-break-after: always; }
  .sheet-page:last-of-type { break-after: auto; page-break-after: auto; }
  .sheet-head { margin: 0 0 6mm; }
  .sheet-head h1 { margin: 0; font-size: 19pt; font-weight: 600; letter-spacing: -0.01em; }
  .sheet-head p { margin: 1.5mm 0 0; font-size: 10pt; color: #5d5668; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 62mm; gap: 5mm; }
  .stop { display: flex; gap: 5mm; align-items: flex-start; }
  .photo { width: 52mm; height: 52mm; object-fit: cover; border-radius: 2mm; display: block; }
  .photo-missing { background: #e7e3ec; }
  .facts { flex: 1; min-width: 0; }
  .facts p { margin: 0 0 1.6mm; }
  .name { font-size: 11pt; font-weight: 600; }
  .maker { color: #4a4452; }
  .size { font-variant-numeric: tabular-nums; }
  .swatch-line { display: flex; align-items: center; gap: 2mm; font-variant-numeric: tabular-nums; color: #4a4452; }
  .swatch-block { width: 9mm; height: 9mm; border-radius: 1mm; border: 0.3mm solid rgba(0,0,0,0.18); display: inline-block; }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}

/** The footer uses the printing service's own page-number and page-count fields. */
export function buildSheetFooter(reelName: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 8pt;
    color: #4a4452;
    width: 100%;
  }
  .footer { width: 100%; text-align: center; padding: 0 12mm; }
</style>
</head>
<body>
  <div class="footer">Stowdeck · ${escapeHtml(reelName)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
</body>
</html>`;
}
