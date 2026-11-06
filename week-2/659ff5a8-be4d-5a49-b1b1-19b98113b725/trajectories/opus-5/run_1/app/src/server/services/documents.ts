import type { StandingsView } from '../../shared/api';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BASE_STYLE = `
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 12pt; }
  h2 { font-size: 14pt; margin: 0 0 8pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 3pt 6pt; border-bottom: 0.5pt solid #999; font-size: 10pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  dl { margin: 0; }
  dt { font-weight: bold; margin-top: 6pt; }
  section { break-before: page; }
  section:first-of-type { break-before: avoid; }
`;

export interface WaiverDocument {
  clubName: string;
  eventName: string;
  eventDate: string;
  driverName: string;
  carNumber: number;
  classCode: string;
  signature: string;
  signedAtUtc: string;
}

export function waiverHtml(doc: WaiverDocument): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Event waiver</title>
<style>${BASE_STYLE}</style></head>
<body>
<h1>Event waiver</h1>
<dl>
  <dt>Club</dt><dd>${escapeHtml(doc.clubName)}</dd>
  <dt>Event</dt><dd>${escapeHtml(doc.eventName)} on ${escapeHtml(doc.eventDate)}</dd>
  <dt>Driver</dt><dd>${escapeHtml(doc.driverName)}</dd>
  <dt>Car</dt><dd>Car ${doc.carNumber} ${escapeHtml(doc.classCode)}</dd>
</dl>
<p>The driver accepts the risks of motorsport, agrees to follow the course workers' instructions
and releases the club and the venue from claims arising from taking part in this event.</p>
<p>Signed by ${escapeHtml(doc.signature)} at ${escapeHtml(doc.signedAtUtc)}</p>
</body></html>`;
}

export interface ResultsRow {
  position: number | null;
  carNumber: number;
  classCode: string;
  driverName: string;
  time: string | null;
  factor: string | null;
}

export interface ResultsDocument {
  eventName: string;
  eventDate: string;
  venue: string;
  clubName: string;
  sections: { view: StandingsView; heading: string; rows: ResultsRow[] }[];
}

function sectionHtml(heading: string, rows: ResultsRow[], withFactor: boolean): string {
  const header = `<tr><th class="num">Pos</th><th class="num">Car</th><th>Class</th><th>Driver</th><th class="num">${
    withFactor ? 'Indexed' : 'Adjusted'
  }</th>${withFactor ? '<th class="num">Factor</th>' : ''}</tr>`;
  const body = rows
    .map(
      (row) =>
        `<tr><td class="num">${row.position === null ? 'No time' : `P${row.position}`}</td>` +
        `<td class="num">${row.carNumber}</td>` +
        `<td>${escapeHtml(row.classCode)}</td>` +
        `<td>${escapeHtml(row.driverName)}</td>` +
        `<td class="num">${row.time === null ? '' : row.time}</td>` +
        (withFactor ? `<td class="num">${row.factor ?? ''}</td>` : '') +
        '</tr>',
    )
    .join('');
  return `<section><h2>${escapeHtml(heading)}</h2><table>${header}${body}</table></section>`;
}

export function resultsHtml(doc: ResultsDocument): string {
  const sections = doc.sections
    .map((section) => sectionHtml(section.heading, section.rows, section.view === 'indexed'))
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(doc.eventName)} final results</title>
<style>${BASE_STYLE}</style></head>
<body>
<p>${escapeHtml(doc.clubName)} &middot; ${escapeHtml(doc.venue)} &middot; ${escapeHtml(doc.eventDate)}</p>
${sections}
</body></html>`;
}

export function resultsHeaderHtml(eventName: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 9pt; margin: 0; width: 100%; }
  p { margin: 0; padding: 0 0.4in; text-align: left; }
</style></head>
<body><p>${escapeHtml(eventName)} final results</p></body></html>`;
}
