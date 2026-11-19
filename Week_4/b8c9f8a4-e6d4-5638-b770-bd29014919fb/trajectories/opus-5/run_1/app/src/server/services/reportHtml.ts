import { ODOMETER_FLAG, SEVERITY_WORD } from '../../shared/copy';
import { formatDateTime, formatOdometer, formatPounds } from '../../shared/format';
import { panelDiagramSvg } from '../../shared/diagram';
import { PANELS } from '../../shared/panels';
import type { FindingDto, PanelDto, RecordDto } from '../../shared/types';

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
  @page { size: A4; }
  body { font-family: 'Outfit', 'Helvetica Neue', Arial, sans-serif; color: #231a4d; margin: 0; }
  h1 { font-size: 26pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #cfc7e4; padding-bottom: 3pt; }
  .lead { color: #4a4270; font-size: 11pt; margin: 0 0 2pt; }
  .reg { font-variant-numeric: tabular-nums; letter-spacing: 0.12em; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { text-align: left; padding: 3pt 5pt; border-bottom: 1px solid #e3def1; vertical-align: top; }
  th { color: #4a4270; font-weight: 600; }
  .figures { font-variant-numeric: tabular-nums; }
  .finding { break-inside: avoid; margin: 0 0 9pt; padding: 7pt 9pt; background: #f6f4fc; border-radius: 8pt; }
  .finding h3 { margin: 0 0 3pt; font-size: 11.5pt; color: #2457c5; }
  .meta { font-size: 9pt; color: #4a4270; margin: 0 0 4pt; }
  .wording { margin: 0; font-size: 10pt; }
  .diagram { width: 46%; }
  .panel-diagram { width: 100%; height: auto; }
  .diagram-ground { fill: #efecf8; }
  .diagram-panel { fill: #d8d2ee; stroke: #b7aede; stroke-width: 0.6; }
  .diagram-plastic { fill: #e7e3f3; }
  .diagram-pin { fill: #2457c5; stroke: #ffffff; stroke-width: 1; }
  .tally { font-weight: 600; margin-top: 6pt; }
`;

export interface ConditionReportInput {
  carName: string;
  version: number;
  maskedRegistration: string;
  findings: readonly FindingDto[];
  panels: readonly PanelDto[];
  record: RecordDto | null;
}

const diagramBlock = (findings: readonly FindingDto[]): string =>
  `<div class="diagram">${panelDiagramSvg({
    pins: findings.map((finding) => ({
      panelId: finding.panelId,
      u: finding.u,
      v: finding.v,
      label: finding.title,
      kind: 'finding' as const,
    })),
    activePanelId: null,
    interactive: false,
  })}</div>`;

const readingsTable = (panels: readonly PanelDto[]): string => {
  const rows = PANELS.map((panel) => {
    const dto = panels.find((candidate) => candidate.id === panel.id);
    const microns = dto?.owner === null || dto?.owner === undefined ? '' : `${dto.owner.microns} microns`;
    const band = dto?.owner?.band ?? (panel.substrate === 'plastic' ? 'Not gauged' : 'No reading');
    return `<tr><td>${escape(panel.label)}</td><td class="figures">${microns}</td><td>${escape(band)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Panel</th><th>Owner reading</th><th>Band</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const tapeTable = (record: RecordDto | null): string => {
  if (record === null) return '';
  const rows = record.tape
    .map(
      (step) =>
        `<tr><td class="figures">${escape(step.completedDate.slice(0, 10))}</td><td>${escape(step.testResult)}</td><td class="figures">${escape(formatOdometer(step.odometerValue, step.odometerUnit))}</td><td class="figures">${step.normalisedKm === null ? '' : step.normalisedKm.toFixed(1)}</td><td>${step.flag === null ? '' : escape(ODOMETER_FLAG[step.flag])}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Test date</th><th>Result</th><th>Odometer</th><th>Normalised km</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const advisoriesTable = (record: RecordDto | null): string => {
  if (record === null) return '';
  const rows = record.advisories
    .map(
      (advisory) =>
        `<tr><td>${escape(advisory.text)}</td><td>${escape(advisory.stance ?? '')}</td><td>${escape(advisory.note ?? '')}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Advisory</th><th>Stance</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="tally">Open advisories: ${record.openAdvisories}</p>`;
};

/** The condition report holds the version's findings, diagram, readings, tape and advisories, and none of the private fields. */
export const conditionReportHtml = (input: ConditionReportInput): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><title>Condition report</title><style>${STYLE}</style></head>
<body>
  <h1>Condition report</h1>
  <p class="lead">${escape(input.carName)}</p>
  <p class="lead">Version ${input.version}</p>
  <p class="lead reg">${escape(input.maskedRegistration)}</p>
  <h2>Findings on the car</h2>
  ${diagramBlock(input.findings)}
  ${input.findings
    .map(
      (finding) => `<div class="finding"><h3>${finding.position}. ${escape(finding.title)}</h3>
      <p class="meta">${escape(finding.panelLabel)} &middot; ${escape(SEVERITY_WORD[finding.severity])} &middot; ${escape(finding.band)}</p>
      <p class="wording">${escape(finding.wording)}</p></div>`,
    )
    .join('')}
  <h2>Paint gauge readings</h2>
  ${readingsTable(input.panels)}
  <h2>Odometer tape</h2>
  ${tapeTable(input.record)}
  <h2>Advisories</h2>
  ${advisoriesTable(input.record)}
</body></html>`;

export interface HandoverInput {
  carName: string;
  version: number;
  maskedRegistration: string;
  amountPounds: number;
  buyerName: string;
  seenRecords: readonly { title: string; seenAt: string }[];
}

/** The handover record, carrying the winning buyer's own name and their seen records. */
export const handoverRecordHtml = (input: HandoverInput): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><title>Handover record</title><style>${STYLE}</style></head>
<body>
  <h1>Handover record</h1>
  <p class="lead">${escape(input.carName)}</p>
  <p class="lead">Version ${input.version}</p>
  <p class="lead reg">${escape(input.maskedRegistration)}</p>
  <p class="lead">Agreed price: ${formatPounds(input.amountPounds)}</p>
  <p class="lead">${escape(input.buyerName)}</p>
  <h2>What the buyer was shown</h2>
  <table><thead><tr><th>Finding</th><th>Seen</th></tr></thead><tbody>
  ${input.seenRecords
    .map((record) => `<tr><td>${escape(record.title)}</td><td>${escape(formatDateTime(record.seenAt))}</td></tr>`)
    .join('')}
  </tbody></table>
</body></html>`;
