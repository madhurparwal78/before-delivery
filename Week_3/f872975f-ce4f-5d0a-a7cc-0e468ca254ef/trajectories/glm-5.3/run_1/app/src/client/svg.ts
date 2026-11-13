/** Shared SVG drawings for board strips, elevations and intake strips. */

export interface Zone {
  kind: string;
  start_mm: number;
  end_mm: number;
}

export interface DrawnPiece {
  index: number;
  label: string;
  start_mm: number;
  length_mm: number;
  width_mm: number;
  status: string;
}

const HATCH_ID_PREFIX = 'hatch-';

export function hatchDefs(id: string): string {
  return `<defs><pattern id="${HATCH_ID_PREFIX}${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="7" height="7" fill="rgba(109,91,70,0.16)"></rect>
    <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(109,91,70,0.85)" stroke-width="1.4"></line>
  </pattern></defs>`;
}

function hatchFill(id: string): string {
  return `url(#${HATCH_ID_PREFIX}${id})`;
}

function tallyGroup(strokes: number, x: number, y: number): string {
  let out = `<g data-tally="${strokes}">`;
  for (let i = 0; i < strokes; i += 1) {
    const cx = x + i * 5;
    out += `<line class="tally" x1="${cx}" y1="${y - 6}" x2="${cx + 3}" y2="${y + 6}"></line>`;
  }
  return `${out}</g>`;
}

/** A rack strip: board outline, defects, tally marks. */
export function rackStripSvg(
  tag: string,
  lengthMm: number,
  zones: Zone[],
  gradeStrokes: number,
  drawnWidth: number,
  height: number,
): string {
  const scale = drawnWidth / lengthMm;
  const uid = `r-${tag}`;
  let zonesSvg = '';
  for (const zone of zones) {
    const x = zone.start_mm * scale;
    const width = (zone.end_mm - zone.start_mm) * scale;
    zonesSvg += `<rect class="defect" data-defect="${zone.kind}" x="${x.toFixed(2)}" y="0" width="${Math.max(0.5, width).toFixed(2)}" height="${height}" fill="${hatchFill(uid)}"></rect>`;
  }
  const tally = gradeStrokes > 0 ? tallyGroup(gradeStrokes, 3, height / 2) : '';
  return `<svg class="strip-svg rack-strip" viewBox="0 0 ${drawnWidth.toFixed(2)} ${height}" preserveAspectRatio="none" data-scale="${scale}" role="img" aria-label="Board ${tag}" style="height:${height}px">
    ${hatchDefs(uid)}
    <rect class="board-fill" x="0" y="0" width="${drawnWidth.toFixed(2)}" height="${height}"></rect>
    ${zonesSvg}
    ${tally}
  </svg>`;
}

/** The board elevation: pieces, defects, kerf lines, offcut and ruler. */
export function elevationSvg(
  tag: string,
  lengthMm: number,
  widthMm: number,
  zones: Zone[],
  pieces: DrawnPiece[],
  kerfs: number[],
  offcut: { startMm: number; lengthMm: number } | null,
  offcutLabel: string | null,
  drawnWidth: number,
): string {
  const scale = drawnWidth / lengthMm;
  const height = 92;
  const uid = `e-${tag}`;
  let content = '';
  for (const zone of zones) {
    const x = zone.start_mm * scale;
    const width = (zone.end_mm - zone.start_mm) * scale;
    content += `<rect class="defect" data-defect="${zone.kind}" x="${x.toFixed(2)}" y="0" width="${Math.max(0.5, width).toFixed(2)}" height="${height}" fill="${hatchFill(uid)}"></rect>`;
    const labelX = Math.min(drawnWidth - 46, Math.max(2, x + 2));
    content += `<text x="${labelX.toFixed(2)}" y="${height + 11}">${zone.kind}</text>`;
  }
  for (const piece of pieces) {
    const x = piece.start_mm * scale;
    const drawnHeight = Math.min(height, Math.max(8, (piece.width_mm / widthMm) * height));
    const y = (height - drawnHeight) / 2;
    const w = piece.length_mm * scale;
    const broken = piece.status === 'over defect' || piece.status === 'off board' || piece.status === 'too wide' || piece.status === 'overlap';
    content += `<rect class="piece-rect${broken ? ' broken' : ''}" data-piece="${piece.index}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${drawnHeight.toFixed(2)}"></rect>`;
  }
  for (const kerf of kerfs) {
    const x = kerf * scale;
    content += `<line class="kerf-line" data-kerf="${kerf}" x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="${height}"></line>`;
  }
  if (offcut !== null) {
    const x = offcut.startMm * scale;
    const width = offcut.lengthMm * scale;
    content += `<rect class="offcut-seg" data-offcut x="${x.toFixed(2)}" y="0" width="${Math.max(0.5, width).toFixed(2)}" height="${height}"></rect>`;
    if (offcutLabel !== null) {
      content += `<text x="${Math.max(2, x + 2).toFixed(2)}" y="${height + 26}">${offcutLabel}</text>`;
    }
  }
  // Ruler ticks every 500 mm
  let ruler = `<line class="ruler" x1="0" y1="${height + 30}" x2="${drawnWidth.toFixed(2)}" y2="${height + 30}" stroke-width="1"></line>`;
  for (let mm = 0; mm <= lengthMm; mm += 500) {
    const x = mm * scale;
    ruler += `<line class="ruler" x1="${x.toFixed(2)}" y1="${height + 30}" x2="${x.toFixed(2)}" y2="${height + 36}" stroke-width="1"></line>`;
    if (mm > 0 || drawnWidth > 380) {
      ruler += `<text x="${Math.max(2, x - 12).toFixed(2)}" y="${height + 47}">${mm}</text>`;
    }
  }
  return `<svg class="strip-svg" viewBox="0 0 ${drawnWidth.toFixed(2)} ${height + 50}" data-scale="${scale}" role="img" aria-label="Board elevation ${tag}" style="max-width:${drawnWidth}px">
    ${hatchDefs(uid)}
    ${content}
    ${ruler}
  </svg>`;
}

/** The intake strip drawn at the length typed so far. */
export function intakeStripSvg(lengthMm: number, zones: Zone[], drawnWidth: number, height: number): string {
  const scale = drawnWidth / lengthMm;
  const uid = 'intake';
  let zonesSvg = '';
  for (const zone of zones) {
    const x = zone.start_mm * scale;
    const width = (zone.end_mm - zone.start_mm) * scale;
    zonesSvg += `<rect class="defect" data-defect="${zone.kind}" x="${x.toFixed(2)}" y="0" width="${Math.max(0.5, width).toFixed(2)}" height="${height}" fill="${hatchFill(uid)}"></rect>`;
  }
  return `<svg class="strip-svg intake-strip" id="intake-strip" viewBox="0 0 ${drawnWidth.toFixed(2)} ${height}" preserveAspectRatio="none" data-scale="${scale}" role="img" aria-label="Intake strip" style="height:${height}px">
    ${hatchDefs(uid)}
    <rect class="board-fill" x="0" y="0" width="${drawnWidth.toFixed(2)}" height="${height}"></rect>
    ${zonesSvg}
  </svg>`;
}

export function tallyStrokesForGrade(grade: string | null): number {
  if (grade === 'Select') return 1;
  if (grade === 'Character') return 2;
  if (grade === 'Rustic') return 3;
  return 0;
}
