import type { SeedDrawingView } from './seedrun.ts';
import { mm2ToFt2, mm2ToM2, mmToInch2, screenFt2, screenM2, screenMm } from '../domain/units.ts';

/** The cut-sheet line set, shared by the preview and the stored object. */
export function cutSheetLines(view: SeedDrawingView): string[] {
  const lines: string[] = [];
  const sailName = view.sail === 'mainsail' ? 'Mainsail' : 'Headsail';
  lines.push(`Cut sheet ${view.code} · ${view.boatName} · ${sailName} · ${view.ownerName}`);
  lines.push(`Cloth ${view.clothCode} ${view.clothName} · usable width ${view.usableWidth} mm (${mmToInch2(view.usableWidth)} in) · catalogue width ${view.catalogueWidth} mm (${mmToInch2(view.catalogueWidth)} in), tolerance ±${view.tolerance} mm · rule set v${view.rulesetVersion}`);
  for (const d of view.dims) {
    lines.push(`${d.key} ${d.value_mm} mm (${mmToInch2(d.value_mm)} in) · tape, tolerance ±${view.tolerance} mm · rule set v${view.rulesetVersion}`);
  }
  const roachText = (view.roach / 1000).toFixed(3);
  const formula = view.sail === 'mainsail' ? `P × E / 2 × ${roachText}` : `LP × LL / 2`;
  lines.push(`Sail area ${mm2ToM2(view.areaMm2)} m² (${mm2ToFt2(view.areaMm2)} ft²) · ${formula} · tolerance ±${view.tolerance} mm · rule set v${view.rulesetVersion}`);
  for (const p of view.panels) {
    lines.push(`Panel ${p.number} · ${p.length_mm} mm (${mmToInch2(p.length_mm)} in) × ${p.width_mm} mm (${mmToInch2(p.width_mm)} in) · ${mm2ToM2(p.area_mm2)} m² (${mm2ToFt2(p.area_mm2)} ft²) · crosscut perpendicular to leech, seam overlap ${view.seamOverlap} mm · tolerance ±${view.tolerance} mm · rule set v${view.rulesetVersion}`);
  }
  for (const nest of view.nests) {
    lines.push(`Nest on ${nest.stock} · ${nest.used} mm (${mmToInch2(nest.used)} in) of ${nest.width} mm (${mmToInch2(nest.width)} in) cloth · thread along the roll · lot ${nest.lot} · tolerance ±${view.tolerance} mm · rule set v${view.rulesetVersion}`);
  }
  if (view.predecessor) lines.push(`Supersedes ${view.predecessor}`);
  return lines;
}

/** Render the sheet as SVG. Byte-identical for the same drawing, because no clock value enters it. */
export function renderCutSheet(view: SeedDrawingView): string {
  const lines = cutSheetLines(view);
  const width = 1240;
  const lineHeight = 34;
  const height = 90 + lines.length * lineHeight + 60;
  const sailName = view.sail === 'mainsail' ? 'Mainsail' : 'Headsail';
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">`);
  parts.push(`<title id="title">Cut sheet ${view.code}</title>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#faf6f1"/>`);
  parts.push(`<rect x="0" y="0" width="${width}" height="64" fill="#0033a0"/>`);
  parts.push(`<text x="48" y="42" font-family="Red Hat Display, sans-serif" font-size="26" font-weight="700" fill="#ffffff">Cut sheet ${view.code} · ${view.boatName} · ${sailName}</text>`);
  lines.forEach((line, i) => {
    parts.push(`<text x="48" y="${100 + i * lineHeight}" font-family="Red Hat Text, sans-serif" font-size="17" fill="#181512">${escapeXml(line)}</text>`);
  });
  parts.push(`<text x="48" y="${height - 24}" font-family="Red Hat Text, sans-serif" font-size="15" fill="#5a5148">Boltrope · ${screenMm(view.areaMm2)} mm² · ${screenM2(view.areaMm2)} m² (${screenFt2(view.areaMm2)} ft²)</text>`);
  parts.push(`</svg>`);
  return parts.join('\n');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
