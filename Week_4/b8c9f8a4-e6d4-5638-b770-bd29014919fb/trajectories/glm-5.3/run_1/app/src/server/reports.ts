import type { PanelId } from './panels.js';
import { PANELS, PANEL_FRAMES } from './panels.js';

/**
 * Condition report HTML for Gotenberg. Holds the findings, diagram, readings, tape and
 * advisories, and none of the private fields.
 */
export function conditionReportHtml(car: { name: string; maskedRegistration: string; version: number }, body: ReportBody): string {
  const rows = body.findings.map(f => `
    <tr><td>${esc(f.title)}</td><td>${esc(f.wording)}</td><td>${esc(f.severity)}</td><td>${esc(f.panelLabel)}</td><td>${esc(f.band)}</td></tr>`).join('');
  const readings = body.readings.map(r => `<tr><td>${esc(r.panel)}</td><td>${esc(r.microns)}</td><td>${esc(r.band)}</td></tr>`).join('');
  const tape = body.tape.map(t => `
    <tr><td>${esc(t.date)}</td><td>${esc(t.result)}</td><td>${esc(t.value)}</td><td>${esc(t.unit)}</td><td>${esc(t.flag)}</td></tr>`).join('');
  const advisories = body.advisories.map(a => `
    <tr><td>${esc(a.text)}</td><td>${esc(a.stance)}</td><td>${esc(a.note)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#181830;font-size:11pt;margin:32px}
    h1{font-size:22pt} h2{font-size:14pt;margin-top:24pt}
    table{width:100%;border-collapse:collapse;margin-top:8pt} th,td{border:1px solid #bbb;padding:6pt;text-align:left;font-size:9pt}
    th{background:#efecf7}
  </style></head><body>
  <h1>Condition report</h1>
  <p>${esc(car.name)} &middot; Version ${car.version} &middot; ${esc(car.maskedRegistration)}</p>
  ${body.diagramSvg}
  <h2>Findings</h2>
  <table><tr><th>Title</th><th>Wording</th><th>Severity</th><th>Panel</th><th>Band</th></tr>${rows}</table>
  <h2>Owner readings in microns</h2>
  <table><tr><th>Panel</th><th>Microns</th><th>Band</th></tr>${readings}</table>
  <h2>Odometer tape</h2>
  <table><tr><th>Date</th><th>Result</th><th>Odometer</th><th>Unit</th><th>Flag</th></tr>${tape}</table>
  <h2>Advisories</h2>
  <table><tr><th>Advisory</th><th>Stance</th><th>Note</th></tr>${advisories}</table>
  <p>Open advisories: ${body.openAdvisories}</p>
  </body></html>`;
}

export interface ReportBody {
  diagramSvg: string;
  findings: { title: string; wording: string; severity: string; panelLabel: string; band: string }[];
  readings: { panel: string; microns: string; band: string }[];
  tape: { date: string; result: string; value: string; unit: string; flag: string }[];
  advisories: { text: string; stance: string; note: string }[];
  openAdvisories: number;
}

/** Handover record HTML. */
export function handoverHtml(car: { name: string; maskedRegistration: string; version: number }, details: { price: number; buyerName: string; seen: { title: string; date: string }[] }): string {
  const seen = details.seen.map(s => `<li>${esc(s.title)} &mdash; ${esc(s.date)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#181830;font-size:11pt;margin:32px}
    h1{font-size:22pt} h2{font-size:14pt;margin-top:24pt} li{margin:4pt 0}
  </style></head><body>
  <h1>Handover record</h1>
  <p>${esc(car.name)} &middot; Version ${car.version} &middot; ${esc(car.maskedRegistration)}</p>
  <p>Agreed price: £${details.price.toLocaleString('en-GB')}</p>
  <p>Buyer: ${esc(details.buyerName)}</p>
  <h2>Shown to the buyer</h2>
  <ul>${seen}</ul>
  </body></html>`;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/** Top-down diagram of the car in the xz plane with each finding's pin at its stored anchor. */
export function diagramSvg(findings: { panelId: PanelId; u: number; v: number; title: string }[], size = 420): { svg: string; rects: { panelId: PanelId; x: number; y: number; w: number; h: number }[] } {
  const bounds = { minX: -2.3, maxX: 2.3, minZ: -2.6, maxZ: 2.8 };
  const scale = size / (bounds.maxX - bounds.minX);
  const px = (x: number) => (x - bounds.minX) * scale + 10;
  const py = (z: number) => (z - bounds.minZ) * scale + 10;
  const rects = PANELS.map(p => {
    const f = PANEL_FRAMES[p.id];
    const xs = [f.origin[0], f.origin[0] + f.U[0], f.origin[0] + f.U[0] + f.V[0], f.origin[0] + f.V[0]].map(v => px(v));
    const zs = [f.origin[2], f.origin[2] + f.U[2], f.origin[2] + f.U[2] + f.V[2], f.origin[2] + f.V[2]].map(v => py(v));
    return { panelId: p.id, x: Math.min(...xs), y: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) };
  });
  const shapes = rects.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#7a74a8" stroke-width="1"/>`).join('');
  const pins = findings.map(f => {
    const f2 = PANEL_FRAMES[f.panelId];
    const wx = f2.origin[0] + f.u * f2.U[0] + f.v * f2.V[0];
    const wz = f2.origin[2] + f.u * f2.U[2] + f.v * f2.V[2];
    return `<circle cx="${px(wx)}" cy="${py(wz)}" r="4" fill="#c04a4a"/>`;
  }).join('');
  const svg = `<svg width="${size + 20}" height="${(bounds.maxZ - bounds.minZ) * scale + 20}" style="margin:12pt 0">${shapes}${pins}</svg>`;
  return { svg, rects };
}
