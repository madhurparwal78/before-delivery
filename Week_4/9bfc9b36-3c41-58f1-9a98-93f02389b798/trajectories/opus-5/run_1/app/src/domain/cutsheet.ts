import { group, pairedArea, pairedLength, squareFeet, squareMetres } from '../shared/units';
import { basisFormula } from './areas';
import type { Point } from './panels';

/**
 * The one place that renders a cut sheet. It reads only values recorded at Draw
 * and the nest of each Cut claim, so the same drawing always renders the same
 * bytes, before and after any rename.
 */

export interface CutSheetPanel {
  readonly number: number;
  readonly length_mm: number;
  readonly width_mm: number;
  readonly area_mm2: number;
  readonly outline: readonly Point[];
}

export interface CutSheetNest {
  readonly stock_code: string;
  readonly used_mm: number;
  readonly width_mm: number;
  readonly lot: string;
  readonly outlines: readonly { readonly panel_number: number; readonly outline: readonly Point[] }[];
}

export interface CutSheetInput {
  readonly drawing_code: string;
  readonly boat_name: string;
  readonly sail: 'mainsail' | 'headsail';
  readonly owner_display_name: string;
  readonly cloth_code: string;
  readonly cloth_name: string;
  readonly usable_width_mm: number;
  readonly dimensions: readonly { readonly key: string; readonly value_mm: number }[];
  readonly area_mm2: number;
  readonly area_basis: string;
  readonly seam_overlap_mm: number;
  readonly tolerance_mm: number;
  readonly ruleset_version: number;
  readonly panels: readonly CutSheetPanel[];
  readonly nests: readonly CutSheetNest[];
  readonly predecessor: string | null;
}

const SAIL_LABEL = { mainsail: 'Mainsail', headsail: 'Headsail' } as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The published line list of the cut sheet, in order. */
export function cutSheetLines(input: CutSheetInput): string[] {
  const suffix = `tolerance ±${input.tolerance_mm} mm · rule set v${input.ruleset_version}`;
  const lines: string[] = [];
  lines.push(
    `Cut sheet ${input.drawing_code} · ${input.boat_name} · ${SAIL_LABEL[input.sail]} · ${input.owner_display_name}`,
  );
  lines.push(
    `Cloth ${input.cloth_code} ${input.cloth_name} · usable width ${pairedLength(input.usable_width_mm)} · catalogue width, ${suffix}`,
  );
  for (const dimension of input.dimensions) {
    lines.push(`${dimension.key} ${pairedLength(dimension.value_mm)} · tape, ${suffix}`);
  }
  lines.push(
    `Sail area ${group(squareMetres(input.area_mm2))} m² (${group(squareFeet(input.area_mm2))} ft²) · ${basisFormula(input.area_basis)} · ${suffix}`,
  );
  for (const panel of input.panels) {
    lines.push(
      `Panel ${panel.number} · ${pairedLength(panel.length_mm)} × ${pairedLength(panel.width_mm)} · ${pairedArea(panel.area_mm2)} · crosscut perpendicular to leech, seam overlap ${input.seam_overlap_mm} mm · ${suffix}`,
    );
  }
  for (const nest of input.nests) {
    lines.push(
      `Nest on ${nest.stock_code} · ${pairedLength(nest.used_mm)} of ${pairedLength(nest.width_mm)} cloth · thread along the roll · lot ${nest.lot} · ${suffix}`,
    );
  }
  if (input.predecessor !== null) lines.push(`Supersedes ${input.predecessor}`);
  return lines;
}

const SHEET_WIDTH = 1240;
const LINE_HEIGHT = 18;
const TOP = 56;
const LEFT = 40;
const NEST_HEIGHT = 120;

function polygonPoints(outline: readonly Point[]): string {
  return outline.map((point) => `${point[0]},${point[1]}`).join(' ');
}

/** Renders the cut sheet. Nothing here depends on the clock. */
export function renderCutSheet(input: CutSheetInput): Buffer {
  const lines = cutSheetLines(input);
  const drawingTop = TOP + lines.length * LINE_HEIGHT + 24;
  const drawingHeight = 420;
  const nestTop = drawingTop + drawingHeight + 24;
  const height = nestTop + input.nests.length * NEST_HEIGHT + 40;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${height}" viewBox="0 0 ${SHEET_WIDTH} ${height}">`,
  );
  parts.push(`<title>Cut sheet ${escapeXml(input.drawing_code)}</title>`);
  parts.push(`<rect x="0" y="0" width="${SHEET_WIDTH}" height="${height}" fill="#faf7f2"/>`);
  parts.push('<g font-family="Red Hat Text, sans-serif" font-size="13" fill="#151310">');
  lines.forEach((line, index) => {
    parts.push(`<text x="${LEFT}" y="${TOP + index * LINE_HEIGHT}">${escapeXml(line)}</text>`);
  });
  parts.push('</g>');

  // The panels, laid out side by side at a fixed scale on the cobalt field.
  parts.push(`<rect x="0" y="${drawingTop}" width="${SHEET_WIDTH}" height="${drawingHeight}" fill="#1b3bd1"/>`);
  parts.push(`<g fill="none" stroke="#ffffff" stroke-width="40">`);
  let offset = 0;
  for (const panel of input.panels) {
    parts.push(
      `<g transform="translate(${LEFT + offset},${drawingTop + 20}) scale(0.02)"><polygon points="${polygonPoints(panel.outline)}"/></g>`,
    );
    offset += Math.max(24, Math.round(panel.width_mm / 50) + 8);
  }
  parts.push('</g>');

  // One strip per Cut claim, with its panel outlines in the claim frame.
  input.nests.forEach((nest, index) => {
    const top = nestTop + index * NEST_HEIGHT;
    parts.push(`<rect x="0" y="${top}" width="${SHEET_WIDTH}" height="${NEST_HEIGHT - 8}" fill="#151310"/>`);
    parts.push(
      `<text x="${LEFT}" y="${top + 20}" font-family="Red Hat Text, sans-serif" font-size="12" fill="#faf7f2">${escapeXml(nest.stock_code)}</text>`,
    );
    const scale = scaleFor(nest.used_mm);
    parts.push('<g fill="none" stroke="#faf7f2" stroke-width="120">');
    for (const laid of nest.outlines) {
      parts.push(
        `<g transform="translate(${LEFT},${top + 28}) scale(${scale})"><polygon points="${polygonPoints(laid.outline)}"/></g>`,
      );
    }
    parts.push('</g>');
  });

  parts.push('</svg>');
  return Buffer.from(parts.join('\n'), 'utf8');
}

/** A fixed decimal scale, chosen from the claim length alone so it never varies. */
function scaleFor(usedMm: number): string {
  if (usedMm <= 2000) return '0.500';
  if (usedMm <= 6000) return '0.160';
  if (usedMm <= 12000) return '0.080';
  if (usedMm <= 24000) return '0.040';
  return '0.020';
}
