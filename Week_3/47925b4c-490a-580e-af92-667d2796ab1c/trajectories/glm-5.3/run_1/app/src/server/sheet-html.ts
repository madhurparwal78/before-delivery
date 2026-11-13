// The rig sheet HTML the press renders: the published facts and never a hire price.

export interface SheetPlacement {
  bodySerial: string;
  lensSerial: string;
  aimAcross: string;
  aimDown: string;
  standoff: string;
  ratio: string;
  shiftAcross: string;
  shiftDown: string;
}

export interface SheetCircuit {
  name: string;
  kind: string;
  loadWatts: number;
  capacityWatts: number;
}

export interface SheetFacts {
  siteName: string;
  layoutName: string;
  version: number;
  showTimeLocal: string; // YYYY-MM-DD HH:mm Brussels wall-clock
  lowestContrast: string | null; // '<contrast> to 1' or null when no covered cell has a reading
  scaleDenominator: number;
  wallWidthMetres: string;
  wallHeightMetres: string;
  placements: SheetPlacement[];
  circuits: SheetCircuit[];
}

export function renderSheetHtml(facts: SheetFacts): string {
  const rows = facts.placements
    .map(
      (p) => `<tr>
        <td>${escapeHtml(p.bodySerial)}</td>
        <td>${escapeHtml(p.lensSerial)}</td>
        <td>Aim ${escapeHtml(p.aimAcross)} / ${escapeHtml(p.aimDown)} m</td>
        <td>Standoff ${escapeHtml(p.standoff)} m</td>
        <td>Ratio ${escapeHtml(p.ratio)} to 1</td>
        <td>Shift ${escapeHtml(p.shiftAcross)}% / ${escapeHtml(p.shiftDown)}%</td>
      </tr>`,
    )
    .join('');
  const circuits = facts.circuits
    .map(
      (c) =>
        `<li>${escapeHtml(c.name)} — ${escapeHtml(c.kind)} — ${c.loadWatts} W of ${c.capacityWatts} W</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rig sheet</title>
<style>
  body { font-family: sans-serif; margin: 24px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  td, th { border: 1px solid #999; padding: 6px 10px; text-align: left; }
  .elevation { border: 1px solid #000; margin-top: 12px; }
</style>
</head>
<body>
<h1>Rig sheet</h1>
<p>${escapeHtml(facts.siteName)}</p>
<p>${escapeHtml(facts.layoutName)}</p>
<p>Sheet version ${facts.version}</p>
<p>Show time ${escapeHtml(facts.showTimeLocal)}</p>
<p>${facts.lowestContrast === null ? 'Lowest reading none' : `Lowest reading ${escapeHtml(facts.lowestContrast)} to 1`}</p>
<div class="elevation">
  <p>Scale 1:${facts.scaleDenominator}</p>
  <svg width="${Math.round(Number(facts.wallWidthMetres) * 1000)}" height="${Math.round(Number(facts.wallHeightMetres) * 1000)}" viewBox="0 0 ${Math.round(Number(facts.wallWidthMetres) * 1000)} ${Math.round(Number(facts.wallHeightMetres) * 1000)}">
    <rect x="0" y="0" width="${Math.round(Number(facts.wallWidthMetres) * 1000)}" height="${Math.round(Number(facts.wallHeightMetres) * 1000)}" fill="none" stroke="black"/>
  </svg>
</div>
<table>
  <thead>
    <tr><th>Body</th><th>Lens</th><th>Aim</th><th>Standoff</th><th>Ratio</th><th>Shift</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<ul>${circuits}</ul>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// <n> is the smallest of 20, 25, 50, 100, 200, 250, 500, 1000 at which the wall fits
// 0.27 m by 0.15 m on paper.
export function scaleDenominator(widthMetres: number, heightMetres: number): number {
  const candidates = [20, 25, 50, 100, 200, 250, 500, 1000];
  for (const n of candidates) {
    if (widthMetres * 1000 <= n * 270 && heightMetres * 1000 <= n * 150) return n;
  }
  return 1000;
}

// Show time in Brussels wall-clock: YYYY-MM-DD HH:mm.
export function brusselsWallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
