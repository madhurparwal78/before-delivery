import { GRADE_STROKES, Grade } from '../shared/constants';
import { Unit, formatLength } from '../shared/units';
import { svg } from './dom';
import { DefectZone, FitPiece, Piece } from './types';

export const HATCH_ID = 'kerfwell-defect-hatch';

/** One shared hatch pattern, referenced by every strip and elevation in the document. */
export function installSharedDefs(): void {
  if (document.getElementById(HATCH_ID) !== null) return;
  const holder = svg('svg', { width: '0', height: '0', 'aria-hidden': 'true', class: 'shared-defs' }, [
    svg('defs', {}, [
      svg(
        'pattern',
        { id: HATCH_ID, width: '6', height: '6', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        [
          svg('rect', { width: '6', height: '6', fill: 'var(--defect-wash)' }),
          svg('line', { x1: '0', y1: '0', x2: '0', y2: '6', stroke: 'var(--defect)', 'stroke-width': '2' })
        ]
      )
    ])
  ]);
  document.body.appendChild(holder);
}

function defectBand(zone: DefectZone, scale: number, y: number, height: number, withLabel: boolean): SVGElement[] {
  const x = zone.start_mm * scale;
  const width = Math.max((zone.end_mm - zone.start_mm) * scale, 1);
  const parts: SVGElement[] = [
    svg('rect', {
      x: String(x),
      y: String(y),
      width: String(width),
      height: String(height),
      fill: `url(#${HATCH_ID})`,
      stroke: 'var(--defect)',
      'stroke-width': '1',
      'data-defect': zone.kind
    })
  ];
  if (withLabel) {
    parts.push(
      svg('text', { x: String(x + width + 3), y: String(y + height + 11), class: 'zone-label' }, [zone.kind])
    );
  }
  return parts;
}

export interface RackStripInput {
  tag: string;
  widthPx: number;
  lengthMm: number;
  scaleLengthMm: number;
  defects: DefectZone[];
  grade: string | null;
}

const RACK_STRIP_HEIGHT = 46;

export function drawRackStrip(input: RackStripInput): SVGElement {
  const scale = input.widthPx / Math.max(input.scaleLengthMm, 1);
  const boardWidth = Math.max(input.lengthMm * scale, 2);
  const children: SVGElement[] = [
    svg('rect', {
      x: '0',
      y: '6',
      width: String(boardWidth),
      height: String(RACK_STRIP_HEIGHT - 12),
      class: 'board-face'
    })
  ];
  for (const zone of input.defects) children.push(...defectBand(zone, scale, 6, RACK_STRIP_HEIGHT - 12, false));
  const strokes = input.grade === null ? 0 : (GRADE_STROKES[input.grade as Grade] ?? 0);
  if (strokes > 0) {
    const tally = svg('g', { 'data-tally': String(strokes), class: 'tally' });
    for (let at = 0; at < strokes; at += 1) {
      tally.appendChild(
        svg('line', {
          x1: String(4 + at * 5),
          y1: '10',
          x2: String(4 + at * 5),
          y2: String(RACK_STRIP_HEIGHT - 10),
          'stroke-width': '2'
        })
      );
    }
    children.push(tally);
  }
  return svg(
    'svg',
    {
      width: String(input.widthPx),
      height: String(RACK_STRIP_HEIGHT),
      role: 'img',
      'aria-label': `Board ${input.tag}`,
      'data-scale': String(scale),
      class: 'strip'
    },
    children
  );
}

export interface IntakeStripInput {
  widthPx: number;
  lengthMm: number | null;
  defects: DefectZone[];
}

const INTAKE_STRIP_HEIGHT = 74;

export function drawIntakeStrip(input: IntakeStripInput): SVGElement {
  const children: SVGElement[] = [];
  const valid = input.lengthMm !== null && input.lengthMm > 0;
  const scale = valid && input.lengthMm !== null ? input.widthPx / input.lengthMm : 0;
  if (valid) {
    children.push(
      svg('rect', { x: '0', y: '10', width: String(input.widthPx), height: String(INTAKE_STRIP_HEIGHT - 32), class: 'board-face' })
    );
    for (const zone of input.defects) children.push(...defectBand(zone, scale, 10, INTAKE_STRIP_HEIGHT - 32, false));
  }
  return svg(
    'svg',
    {
      width: String(input.widthPx),
      height: String(INTAKE_STRIP_HEIGHT),
      role: 'img',
      'aria-label': 'Intake strip',
      'data-scale': String(scale),
      class: 'strip intake-strip',
      'touch-action': 'none'
    },
    children
  );
}

export interface ElevationInput {
  tag: string;
  widthPx: number;
  lengthMm: number;
  defects: DefectZone[];
  pieces: Array<Piece | FitPiece>;
  cuts: number[];
  offcut: { start_mm: number; length_mm: number } | null;
  unit: Unit;
}

const ELEVATION_HEIGHT = 136;
const FACE_TOP = 14;
const FACE_HEIGHT = 74;

function rulerTicks(lengthMm: number, scale: number): SVGElement[] {
  const parts: SVGElement[] = [
    svg('line', {
      x1: '0',
      y1: String(FACE_TOP + FACE_HEIGHT + 10),
      x2: String(lengthMm * scale),
      y2: String(FACE_TOP + FACE_HEIGHT + 10),
      class: 'ruler-line'
    })
  ];
  const step = lengthMm > 3000 ? 500 : 250;
  for (let at = 0; at <= lengthMm; at += step) {
    const x = at * scale;
    parts.push(
      svg('line', {
        x1: String(x),
        y1: String(FACE_TOP + FACE_HEIGHT + 10),
        x2: String(x),
        y2: String(FACE_TOP + FACE_HEIGHT + 16),
        class: 'ruler-line'
      })
    );
  }
  return parts;
}

export function drawElevation(input: ElevationInput): SVGElement {
  const scale = input.widthPx / Math.max(input.lengthMm, 1);
  const children: SVGElement[] = [
    svg('rect', {
      x: '0',
      y: String(FACE_TOP),
      width: String(input.lengthMm * scale),
      height: String(FACE_HEIGHT),
      class: 'board-face'
    })
  ];
  for (const zone of input.defects) children.push(...defectBand(zone, scale, FACE_TOP, FACE_HEIGHT, true));

  input.pieces.forEach((piece, index) => {
    const status = 'status' in piece ? piece.status : null;
    const overDefect = status === 'over defect';
    children.push(
      svg('rect', {
        x: String(piece.start_mm * scale),
        y: String(FACE_TOP + 8),
        width: String(Math.max(piece.length_mm * scale, 2)),
        height: String(FACE_HEIGHT - 16),
        class: `piece-band${overDefect ? ' over-defect' : ''}`,
        'data-piece': String(index)
      })
    );
    children.push(
      svg('text', { x: String(piece.start_mm * scale + 4), y: String(FACE_TOP + 24), class: 'piece-label' }, [piece.label])
    );
  });

  for (const cut of input.cuts) {
    children.push(
      svg('rect', {
        x: String(cut * scale),
        y: String(FACE_TOP),
        width: '2',
        height: String(FACE_HEIGHT),
        class: 'kerf-line',
        'data-kerf': String(cut)
      })
    );
  }

  if (input.offcut !== null) {
    const group = svg('g', { class: 'offcut-group' });
    group.appendChild(
      svg('rect', {
        x: String(input.offcut.start_mm * scale),
        y: String(FACE_TOP),
        width: String(Math.max(input.offcut.length_mm * scale, 2)),
        height: String(FACE_HEIGHT),
        class: 'offcut-band',
        'data-offcut': String(input.offcut.length_mm)
      })
    );
    group.appendChild(
      svg(
        'text',
        {
          x: String(input.offcut.start_mm * scale + 4),
          y: String(FACE_TOP + FACE_HEIGHT - 8),
          class: 'offcut-label'
        },
        [`offcut ${formatLength(input.offcut.length_mm, input.unit)}`]
      )
    );
    children.push(group);
  }

  children.push(...rulerTicks(input.lengthMm, scale));

  return svg(
    'svg',
    {
      width: String(input.widthPx),
      height: String(ELEVATION_HEIGHT),
      role: 'img',
      'aria-label': `Board elevation ${input.tag}`,
      'data-scale': String(scale),
      class: 'elevation'
    },
    children
  );
}
