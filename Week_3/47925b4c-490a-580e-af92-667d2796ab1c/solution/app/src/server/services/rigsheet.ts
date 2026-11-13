import { brusselsWallClockText } from '../domain/brussels.js';
import { oneDecimal, wholeNumber } from '../domain/format.js';
import type { CircuitLoad, PlacementView } from '../data/layouts.js';

const SCALES = [20, 25, 50, 100, 200, 250, 500, 1000];
const PAPER_WIDTH_METRES = 0.27;
const PAPER_HEIGHT_METRES = 0.15;

function scaleFor(widthMetres: number, heightMetres: number): number {
  for (const scale of SCALES) {
    if (widthMetres / scale <= PAPER_WIDTH_METRES && heightMetres / scale <= PAPER_HEIGHT_METRES) return scale;
  }
  return SCALES[SCALES.length - 1] as number;
}

interface RigSheetFacts {
  readonly siteName: string;
  readonly layoutName: string;
  readonly version: number;
  readonly showAt: Date;
  readonly lowestContrast: number | null;
  readonly widthMetres: number;
  readonly heightMetres: number;
  readonly placements: readonly PlacementView[];
  readonly circuits: readonly CircuitLoad[];
}

function escape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** The rig sheet, carrying the published facts and never a hire price. */
export function rigSheetHtml(facts: RigSheetFacts): string {
  const scale = scaleFor(facts.widthMetres, facts.heightMetres);
  const drawingWidthMm = (facts.widthMetres / scale) * 1000;
  const drawingHeightMm = (facts.heightMetres / scale) * 1000;
  const lowest =
    facts.lowestContrast === null ? 'Lowest reading none' : `Lowest reading ${oneDecimal(facts.lowestContrast)} to 1`;
  const markers = facts.placements
    .map((placement) => {
      const left = (Number(placement.aimAcross) / facts.widthMetres) * 100;
      const top = (Number(placement.aimDown) / facts.heightMetres) * 100;
      return `<circle cx="${left}%" cy="${top}%" r="1.2mm" fill="#2b1430" /><text x="${left}%" y="${top}%" dx="2mm" dy="1mm" font-size="2.4mm">${escape(placement.bodySerial ?? '')}</text>`;
    })
    .join('');
  const rows = facts.placements
    .map(
      (placement) => `<tr>
        <td>${escape(placement.bodySerial ?? '')}</td>
        <td>${escape(placement.lensSerial)}</td>
        <td>Aim ${oneDecimal(Number(placement.aimAcross))} / ${oneDecimal(Number(placement.aimDown))} m</td>
        <td>Standoff ${oneDecimal(Number(placement.standoff))} m</td>
        <td>Ratio ${oneDecimal(Number(placement.ratio))} to 1</td>
        <td>Shift ${oneDecimal(Number(placement.shiftAcrossPercent))}% / ${oneDecimal(Number(placement.shiftDownPercent))}%</td>
      </tr>`,
    )
    .join('');
  const circuits = facts.circuits
    .map(
      (circuit) => `<tr>
        <td>${escape(circuit.name)}</td>
        <td>${escape(circuit.kind)}</td>
        <td>${wholeNumber(circuit.loadWatts)} W of ${wholeNumber(circuit.capacityWatts)} W</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rig sheet</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: #2b1430; font-size: 10pt; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  h2 { font-size: 12pt; margin: 6mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 1.2mm 2mm; }
  tbody tr:nth-child(odd) { background: #f6e9ec; }
  .elevation { border: 0.3mm solid #2b1430; width: ${drawingWidthMm}mm; height: ${drawingHeightMm}mm; }
  .facts p { margin: 0 0 1.5mm; }
</style>
</head>
<body>
<h1>Rig sheet</h1>
<div class="facts">
  <p>${escape(facts.siteName)}</p>
  <p>${escape(facts.layoutName)}</p>
  <p>Sheet version ${facts.version}</p>
  <p>Show time ${brusselsWallClockText(facts.showAt.getTime())}</p>
  <p>${lowest}</p>
</div>
<h2>Scale 1:${scale}</h2>
<svg class="elevation" viewBox="0 0 ${drawingWidthMm} ${drawingHeightMm}" width="${drawingWidthMm}mm" height="${drawingHeightMm}mm">${markers}</svg>
<h2>Placements</h2>
<table><tbody>${rows}</tbody></table>
<h2>Circuits</h2>
<table><tbody>${circuits}</tbody></table>
</body>
</html>`;
}
