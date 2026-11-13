import { formatDayMonthYear, kolkataDate } from '../domain/dates.js';
import { formatRupees } from '../domain/money.js';
import type { PublishedVersion } from '../domain/price.js';

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function noticePdfTitle(version: PublishedVersion): string {
  return `Notice ${version.number}, version ${version.version}`;
}

/**
 * The print HTML of one notice version, from that version's own stored wording.
 * It references no outside resource: both fonts travel with the render request.
 */
export function noticeHtml(version: PublishedVersion): string {
  const title = noticePdfTitle(version);
  const lines = [
    'Vasant Talkies Drinks',
    title,
    `Effective ${formatDayMonthYear(version.effectiveDate)}`,
    `Published ${formatDayMonthYear(kolkataDate(new Date(version.publishedAt)))}`,
    ...version.rows.map(
      (row) => `${row.name} Rs ${formatRupees(row.oldMrpPaise)} to Rs ${formatRupees(row.revisedMrpPaise)}`,
    ),
    'The original MRP stays readable on every stickered pack.',
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
<style>
@font-face { font-family: "Bebas Neue"; src: url("bebas-neue.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "EB Garamond"; src: url("eb-garamond.woff2") format("woff2"); font-weight: 400; }
html, body { margin: 0; padding: 0; }
body { font-family: "EB Garamond", serif; font-size: 11pt; line-height: 1.5; color: #2a2a2a; }
h1 { font-family: "Bebas Neue", sans-serif; font-size: 34pt; letter-spacing: 0.04em; margin: 0 0 18pt 0; font-weight: 400; }
p { margin: 0 0 6pt 0; white-space: nowrap; overflow: hidden; }
</style>
</head>
<body>
<h1>PRICE NOTICE</h1>
${lines.map((line) => `<p>${escapeText(line)}</p>`).join('\n')}
</body>
</html>`;
}
