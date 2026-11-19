// The condition report and the handover record. Both are written here as HTML and rendered by
// Gotenberg. Neither carries a private field: no full registration, no home address, no invoice.

import { diagramSvg, escapeText, pinAt } from '../../shared/diagram.js';
import { formatDate } from '../../shared/london.js';
import { money } from '../../shared/measures.js';
import { ODOMETER_FLAG } from '../../shared/copy.js';
import type { ConditionRecord } from '../domain/record.js';
import type { Finding } from '../domain/findings.js';

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1A0B54; margin: 0; font-size: 11pt; }
  h1 { font-size: 24pt; margin: 0 0 4pt; font-weight: 600; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; font-weight: 600; }
  .lede { color: #4A4080; margin: 0 0 12pt; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 1px solid #D8D5EC; vertical-align: top; }
  th { background: #F5F7FF; font-weight: 600; }
  .layout { display: flex; gap: 16pt; align-items: flex-start; }
  .layout svg { width: 170pt; }
  .finding { border: 1px solid #D8D5EC; border-radius: 8pt; padding: 8pt 10pt; margin-bottom: 8pt; }
  .finding h3 { margin: 0 0 3pt; font-size: 11.5pt; }
  .meta { color: #4A4080; font-size: 9.5pt; margin: 0 0 4pt; }
  .tally { font-weight: 600; margin-top: 8pt; }
`;

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeText(title)}</title>` +
    `<style>${STYLE}</style></head><body>${inner}</body></html>`;
}

interface ReportInput {
  carName: string;
  maskedRegistration: string;
  version: number;
  publishedAt: Date;
  findings: Finding[];
  readings: { label: string; microns: number | null; band: string }[];
  record: ConditionRecord;
}

export function conditionReportHtml(input: ReportInput): string {
  const pins = input.findings
    .map((finding) => {
      const at = pinAt(finding.panelId, finding.u, finding.v);
      return at ? { x: at.x, y: at.y, label: `${finding.position}. ${finding.title}` } : null;
    })
    .filter((pin): pin is { x: number; y: number; label: string } => pin !== null);

  const findings = input.findings
    .map(
      (finding) =>
        `<div class="finding"><h3>${finding.position}. ${escapeText(finding.title)}</h3>` +
        `<p class="meta">${escapeText(finding.panelLabel)} &middot; ${escapeText(finding.severity)} &middot; ${escapeText(finding.band)}</p>` +
        `<p>${escapeText(finding.wording)}</p></div>`,
    )
    .join('');

  const readings = input.readings
    .map(
      (row) =>
        `<tr><td>${escapeText(row.label)}</td><td>${row.microns === null ? 'Not gauged' : `${row.microns} microns`}</td>` +
        `<td>${escapeText(row.band)}</td></tr>`,
    )
    .join('');

  const tape = input.record.tape
    .map(
      (step) =>
        `<tr><td>${escapeText(step.completedDate.slice(0, 10))}</td><td>${escapeText(step.motTestNumber)}</td>` +
        `<td>${step.odometerValue === null ? '&mdash;' : `${Number(step.odometerValue).toLocaleString('en-GB')} ${escapeText(step.odometerUnit ?? '')}`}</td>` +
        `<td>${step.normalisedKm === null ? '&mdash;' : `${step.normalisedKm.toLocaleString('en-GB')} km`}</td>` +
        `<td>${step.flag ? escapeText(ODOMETER_FLAG[step.flag]) : escapeText(step.testResult)}</td></tr>`,
    )
    .join('');

  const advisories = input.record.advisories
    .map(
      (advisory) =>
        `<tr><td>${escapeText(advisory.text)}</td><td>${escapeText(advisory.stance ?? 'Not answered')}</td>` +
        `<td>${escapeText(advisory.note ?? '')}</td></tr>`,
    )
    .join('');

  return page(
    'Condition report',
    `<h1>Condition report</h1>
     <p class="lede">${escapeText(input.carName)} &middot; ${escapeText(input.maskedRegistration)} &middot; Version ${input.version}
       &middot; ${escapeText(formatDate(input.publishedAt))}</p>
     <h2>Findings on the car</h2>
     <div class="layout"><div>${diagramSvg({ pins, title: 'Panel diagram' })}</div><div>${findings || '<p>No findings.</p>'}</div></div>
     <h2>Paint gauge readings</h2>
     <table><thead><tr><th>Panel</th><th>Reading</th><th>Band</th></tr></thead><tbody>${readings}</tbody></table>
     <h2>Odometer tape</h2>
     <table><thead><tr><th>Tested</th><th>Test number</th><th>Odometer</th><th>Normalised</th><th>Note</th></tr></thead>
       <tbody>${tape}</tbody></table>
     <h2>Advisories</h2>
     <table><thead><tr><th>Advisory</th><th>Stance</th><th>Note</th></tr></thead><tbody>${advisories}</tbody></table>
     <p class="tally">Open advisories: ${input.record.openAdvisories}</p>`,
  );
}

interface HandoverInput {
  carName: string;
  maskedRegistration: string;
  version: number;
  agreedPounds: number;
  buyerName: string;
  seen: { title: string; seenAt: Date }[];
}

export function handoverHtml(input: HandoverInput): string {
  const rows = input.seen
    .map((item) => `<tr><td>${escapeText(item.title)}</td><td>${escapeText(formatDate(item.seenAt))}</td></tr>`)
    .join('');
  return page(
    'Handover record',
    `<h1>Handover record</h1>
     <p class="lede">${escapeText(input.carName)} &middot; ${escapeText(input.maskedRegistration)} &middot; Version ${input.version}</p>
     <h2>Agreed sale</h2>
     <p>Agreed price: ${money(input.agreedPounds)}</p>
     <p>Buyer: ${escapeText(input.buyerName)}</p>
     <h2>What the buyer was shown</h2>
     <table><thead><tr><th>Finding</th><th>Read on</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}
