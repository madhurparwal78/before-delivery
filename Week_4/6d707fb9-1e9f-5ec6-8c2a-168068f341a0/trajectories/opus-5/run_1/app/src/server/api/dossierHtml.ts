import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURE_NAMES, STAGE_NAMES } from '../domain/copy';
import { measuresOf } from '../store/read';
import type { LabelRow, ResultRow, StyleRowRecord } from '../store/rows';
import { escapeHtml } from '../views/html';

let inlineFont: string | null = null;

/**
 * The dossier carries its font inline, so every glyph — including the subscript
 * in CO₂e and the powers of ten — comes from one face and prints as one run.
 */
function fontFace(): string {
  if (inlineFont === null) {
    const file = join(__dirname, '..', 'public', 'fonts', 'noto-sans-regular.ttf');
    inlineFont = readFileSync(file).toString('base64');
  }
  return `@font-face { font-family: 'Dossier'; src: url(data:font/ttf;base64,${inlineFont}) format('truetype'); font-weight: 300 700; }`;
}

/** The dossier's own HTML, with its styles inline and no address for Gotenberg to fetch. */
export function dossierHtmlFor(style: StyleRowRecord, label: LabelRow, result: ResultRow): string {
  const measures = measuresOf(result);
  const stageHeads = measures[0]
    ? measures[0].stages.map((stage) => `<th scope="col">${escapeHtml(STAGE_NAMES[stage.stage])}</th>`).join('')
    : '';
  const rows = measures
    .map(
      (measure) =>
        `<tr><th scope="row">${escapeHtml(MEASURE_NAMES[measure.measure])}</th><td>${escapeHtml(
          measure.totalShown,
        )}</td>${measure.stages.map((stage) => `<td>${escapeHtml(stage.shown)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(style.name)}</title>
<style>
${fontFace()}
body {
  font-family: 'Dossier', sans-serif;
  color: #241c14;
  background: #f7f3ec;
  margin: 24px;
  /* no ligatures, so every published word prints as the characters it is made of */
  font-variant-ligatures: none;
  font-feature-settings: 'liga' 0, 'clig' 0;
}
h1 { font-weight: 300; font-size: 24px; }
p { font-size: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
caption { text-align: left; padding: 8px 0; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #d8cfc0; }
</style></head>
<body>
<h1>${escapeHtml(style.name)}</h1>
<p>Label ${escapeHtml(label.name)}</p>
<p>GTIN ${escapeHtml(style.gtin)}</p>
<p>Factor edition ${escapeHtml(result.edition)}</p>
<p>Data quality ${escapeHtml(result.data_quality_grade)} (${result.data_quality_percent}%)</p>
<table><caption>Footprint</caption>
<thead><tr><th scope="col">Measure</th><th scope="col">Total</th>${stageHeads}</tr></thead>
<tbody>${rows}</tbody></table>
<p>These figures are published sums. They are not a legal claim.</p>
</body></html>`;
}
