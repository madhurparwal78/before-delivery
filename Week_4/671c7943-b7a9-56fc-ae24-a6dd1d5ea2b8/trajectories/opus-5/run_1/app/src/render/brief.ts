import { budgetName, projectTypeName } from '../shared/copy.js';
import type { StoredEnquiry } from '../shared/types.js';
import { escapeHtml } from './html.js';

const FRAME_HEIGHT_PX = 700;
const CONTENT_WIDTH_PX = 640;
const LINE_RATIO = 1.3;
const LARGEST_FONT_PX = 10;
const SMALLEST_FONT_PX = 0.2;
/** Advance of a monospace character, taken wide so the measure never overruns. */
const ADVANCE = 0.65;

interface DescriptionFit {
  fontPx: number;
  columns: number;
}

/**
 * Picks the largest text size at which the whole description, broken at any
 * character, still fits the one page. The measure is set in `ch`, so the
 * characters that fit a line do not depend on the font Chromium picks.
 */
function fitDescription(description: string): DescriptionFit {
  const paragraphs = description.split('\n').map((line) => [...line].length);
  for (let fontPx = LARGEST_FONT_PX; fontPx > SMALLEST_FONT_PX; fontPx -= 0.05) {
    const columns = Math.max(20, Math.floor(CONTENT_WIDTH_PX / (ADVANCE * fontPx)));
    const packed = Math.floor(columns * 0.9);
    const lines = paragraphs.reduce(
      (total, length) => total + Math.max(1, Math.ceil(length / packed)),
      0,
    );
    if (lines * fontPx * LINE_RATIO <= FRAME_HEIGHT_PX) {
      return { fontPx: Math.round(fontPx * 100) / 100, columns };
    }
  }
  return { fontPx: SMALLEST_FONT_PX, columns: Math.floor(CONTENT_WIDTH_PX / (ADVANCE * SMALLEST_FONT_PX)) };
}

export function briefHtml(enquiry: StoredEnquiry): string {
  const fields: [string, string][] = [
    ['Reference', enquiry.reference],
    ['Name', enquiry.name],
    ['Email', enquiry.email],
    ['Project type', projectTypeName(enquiry.projectType)],
    ['Budget range', budgetName(enquiry.budget)],
  ];
  const fit = fitDescription(enquiry.description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Project brief ${escapeHtml(enquiry.reference)}</title>
<style>
@page { size: A4; margin: 20mm; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #1a1a17;
  background: #ffffff;
}
.page { height: 971px; display: flex; flex-direction: column; }
h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 30px;
  line-height: 1.1;
  font-weight: 400;
  margin: 0 0 6px;
}
.studio { font-size: 13px; letter-spacing: 0.12em; color: #6d675d; }
hr { border: 0; border-top: 1px solid #d8d2c4; margin: 18px 0; }
dl { margin: 0; font-size: 13px; line-height: 1.7; }
.field { display: flex; gap: 6px; }
dt, dd { margin: 0; }
dt { font-weight: 600; }
h2 { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
.frame { flex: 1 1 auto; }
.description {
  font-family: "Courier New", monospace;
  font-size: ${fit.fontPx}px;
  line-height: ${LINE_RATIO};
  width: ${fit.columns}ch;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}
</style>
</head>
<body>
<div class="page">
  <header>
    <p class="studio">Sollis Studio</p>
    <h1>Project brief ${escapeHtml(enquiry.reference)}</h1>
  </header>
  <hr>
  <dl>
    ${fields
      .map(
        ([label, value]) =>
          `<div class="field"><dt>${escapeHtml(label)}:</dt><dd>${escapeHtml(value)}</dd></div>`,
      )
      .join('\n    ')}
  </dl>
  <h2>Project description:</h2>
  <div class="frame"><div class="description">${escapeHtml(enquiry.description)}</div></div>
</div>
</body>
</html>`;
}
