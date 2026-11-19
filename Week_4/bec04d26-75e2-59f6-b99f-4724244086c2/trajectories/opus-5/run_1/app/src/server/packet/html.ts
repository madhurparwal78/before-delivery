import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReturnRecord } from '../../shared/types';
import { foldedReturnSvg, TILE_FILL, TILE_INK, tileColour } from '../../shared/specimen';
import { longDateString } from '../../shared/dates';
import { carriedFromLine } from '../domain/duedates';
import { PRACTICE_ZONE, clockLabel } from '../domain/zones';

const FONT_DIR = join(__dirname, '..', 'assets', 'fonts');

function fontFace(family: string, file: string, weight: string): string {
  const bytes = readFileSync(join(FONT_DIR, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${bytes}) format('woff2');}`;
}

let embeddedFonts: string | null = null;

function fonts(): string {
  if (embeddedFonts === null) {
    embeddedFonts = [
      fontFace('Tilt Warp', 'tilt-warp-latin.woff2', '400'),
      fontFace('Plus Jakarta Sans', 'plus-jakarta-sans-latin.woff2', '200 800'),
    ].join('');
  }
  return embeddedFonts;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function amount(value: string | null): string {
  return value ?? '0.00';
}

function periodStamp(record: ReturnRecord): string {
  return record.frequency === 'yearly' ? record.period : record.period.replace('-', ' ');
}

export function packetHtml(record: ReturnRecord, revision: number): string {
  const colour = tileColour(record.state_index);
  const approval = record.approvals.find((entry) => entry.action === 'approved');
  const facts: string[] = [
    `<p class="fact">${escape(record.client.name)}</p>`,
    `<p class="fact">${escape(`${record.state_name} (${record.state})`)}</p>`,
    `<p class="fact">${escape(record.period_label)}</p>`,
    `<p class="fact">${escape(record.due_line)}</p>`,
  ];
  if (record.carried_from) {
    facts.push(`<p class="fact">${escape(carriedFromLine(record.carried_from))}</p>`);
  }
  facts.push(
    `<p class="fact">Rule edition effective ${escape(record.edition.effective_date)}</p>`,
    `<p class="fact">Due day ${record.edition.due_day}</p>`,
    `<p class="fact">Reference rate ${escape(record.edition.rate)}%</p>`,
    `<p class="fact">Gross sales ${escape(amount(record.gross_sales))}</p>`,
    `<p class="fact">Tax due ${escape(amount(record.tax_due))}</p>`,
  );
  if (approval) {
    const at = Date.parse(approval.at);
    const day = new Date(at);
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: PRACTICE_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(day);
    facts.push(
      `<p class="fact">Approved by ${escape(approval.by)} on ${escape(longDateString(localDate))}, ${escape(clockLabel(PRACTICE_ZONE, at))} Central</p>`,
    );
  }
  if (record.extension) {
    facts.push(`<p class="fact">Extended to ${escape(longDateString(record.due_date))}</p>`);
  }
  for (const amendment of record.amendments) {
    facts.push(
      `<p class="fact">Amended: gross sales ${escape(amendment.original.gross_sales)} to ${escape(amendment.amended.gross_sales)}, tax due ${escape(amendment.original.tax_due)} to ${escape(amendment.amended.tax_due)}</p>`,
    );
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Duefield filing packet</title>
<style>
${fonts()}
@page { size: A4; margin: 16mm; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #111111; }
body { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11pt; line-height: 1.55; }
.wordmark { font-family: 'Tilt Warp', sans-serif; font-size: 30pt; margin: 0 0 2mm; }
h1 { font-size: 16pt; font-weight: 700; margin: 0 0 6mm; }
.deadline { font-family: 'Tilt Warp', sans-serif; font-size: 18pt; margin: 0 0 6mm; }
.layout { display: flex; gap: 10mm; align-items: flex-start; }
.tile { width: 58mm; height: 58mm; border-radius: 6mm; background: ${TILE_FILL[colour]}; color: ${TILE_INK[colour]};
        display: flex; align-items: center; justify-content: center; flex: none; }
.specimen-sheet { width: 44mm; height: 50mm; }
.facts { flex: 1; }
.fact { margin: 0 0 2.4mm; }
.revision { font-size: 10pt; color: #585858; margin: 0 0 4mm; }
</style>
</head>
<body>
<p class="wordmark">Duefield</p>
<h1>Duefield filing packet</h1>
<p class="revision">Packet revision ${revision}</p>
<p class="deadline">${escape(`${record.state} ${longDateString(record.due_date)}`)}</p>
<div class="layout">
  <div class="tile">${foldedReturnSvg(record.state, periodStamp(record), colour)}</div>
  <div class="facts">
${facts.join('\n')}
  </div>
</div>
</body>
</html>`;
}
