import type { Finding, Module, Piece, Point, StandardsProfile } from './domain';
import { displayGrade, displayLength, roundHalfUp } from './scaleUnits';

export interface Placement {
  end: Point;
  length_mm: number;
}


function normalizeHeading(deg: number): number {
  let h = deg % 360;
  if (h < 0) h += 360;
  if (Math.abs(h - 360) < 1e-9) h = 0;
  return h;
}

export function headingTangent(heading_deg: number): { dx: number; dy: number } {
  const r = (heading_deg * Math.PI) / 180;
  return { dx: Math.cos(r), dy: Math.sin(r) };
}

/**
 * Compute the piece's end point from its start point. The single decision for
 * geometry: curves turn by their hand, turnouts run straight through on the
 * mainline, and rise applies along the piece.
 */
export function placePiece(kind: Piece['kind'], start: Point, piece: {
  length_mm: number;
  radius_mm?: number;
  angle_deg?: number;
  hand?: 'left' | 'right';
}): Placement {
  if (kind === 'curve') {
    const radius = piece.radius_mm ?? 0;
    const angle = piece.angle_deg ?? 0;
    const rad = (angle * Math.PI) / 180;
    const hRad = (start.heading_deg * Math.PI) / 180;
    const dir = piece.hand === 'left' ? 1 : -1;
    const cx = start.x_mm - Math.sin(hRad) * radius * dir;
    const cy = start.y_mm + Math.cos(hRad) * radius * dir;
    const endRad = hRad + rad * dir;
    const ex = cx + Math.sin(endRad) * radius * dir;
    const ey = cy - Math.cos(endRad) * radius * dir;
    return {
      end: {
        x_mm: Math.round(ex),
        y_mm: Math.round(ey),
        elevation_mm: start.elevation_mm,
        heading_deg: normalizeHeading(start.heading_deg + angle * dir),
      },
      length_mm: Math.round(radius * rad),
    };
  }
  const { dx, dy } = headingTangent(start.heading_deg);
  return {
    end: {
      x_mm: Math.round(start.x_mm + dx * piece.length_mm),
      y_mm: Math.round(start.y_mm + dy * piece.length_mm),
      elevation_mm: start.elevation_mm,
      heading_deg: start.heading_deg,
    },
    length_mm: piece.length_mm,
  };
}

export function endWithRise(start: Point, placement: Placement, rise_mm: number): Point {
  return { ...placement.end, elevation_mm: start.elevation_mm + rise_mm };
}

/** Curve arc length in millimetres. */
export function curveLength(radius_mm: number, angle_deg: number): number {
  return Math.round(radius_mm * ((angle_deg * Math.PI) / 180));
}

export interface PieceInput {
  kind: 'straight' | 'curve' | 'turnout';
  length_mm?: number;
  radius_mm?: number;
  angle_deg?: number;
  hand?: 'left' | 'right';
  frog_number?: number;
  rise_mm?: number;
  mainline?: boolean;
}

/** Piece rules checked on append and edit; failure means nothing is stored. */
export function checkPieceRules(
  profile: StandardsProfile,
  input: PieceInput,
  previousPiece: Piece | null,
  straightSinceReverse: number,
): Finding[] {
  const findings: Finding[] = [];
  const mainline = input.mainline ?? true;
  const rise = input.rise_mm ?? 0;
  if (input.kind === 'curve') {
    const radius = input.radius_mm ?? 0;
    const angle = input.angle_deg ?? 0;
    const length = curveLength(radius, angle);
    if (mainline && radius < profile.min_radius_mm) {
      findings.push({
        rule: 'min_radius',
        module_id: null,
        piece_id: null,
        measured_mm: radius,
        limit_mm: profile.min_radius_mm,
        message: `Curve radius ${displayLength(radius, profile.display_units)} is under the ${displayLength(profile.min_radius_mm, profile.display_units)} minimum.`,
      });
    }
    if (Math.abs(rise) * 1000 > profile.max_grade_tenths_percent * length) {
      const measured = roundHalfUp((Math.abs(rise) * 1000) / length);
      findings.push({
        rule: 'max_grade',
        module_id: null,
        piece_id: null,
        measured_mm: measured,
        limit_mm: profile.max_grade_tenths_percent,
        message: `Grade ${displayGrade(measured)} is over the ${displayGrade(profile.max_grade_tenths_percent)} maximum.`,
      });
    }
    if (previousPiece && previousPiece.kind === 'curve' && previousPiece.hand !== input.hand && straightSinceReverse < profile.reverse_curve_straight_mm) {
      findings.push({
        rule: 'reverse_curve',
        module_id: null,
        piece_id: null,
        measured_mm: straightSinceReverse,
        limit_mm: profile.reverse_curve_straight_mm,
        message: `Only ${displayLength(straightSinceReverse, profile.display_units)} of straight between reverse curves; ${displayLength(profile.reverse_curve_straight_mm, profile.display_units)} needed.`,
      });
    }
  } else {
    const length = input.kind === 'turnout' ? (input.length_mm ?? 0) : (input.length_mm ?? 0);
    if (input.kind === 'turnout') {
      const frog = input.frog_number ?? 0;
      if (frog < profile.min_frog_number) {
        findings.push({
          rule: 'min_turnout',
          module_id: null,
          piece_id: null,
          measured_mm: frog,
          limit_mm: profile.min_frog_number,
          message: `Turnout #${frog} is under the #${profile.min_frog_number} minimum.`,
        });
      }
    }
    if (Math.abs(rise) * 1000 > profile.max_grade_tenths_percent * length) {
      const measured = roundHalfUp((Math.abs(rise) * 1000) / Math.max(length, 1));
      findings.push({
        rule: 'max_grade',
        module_id: null,
        piece_id: null,
        measured_mm: measured,
        limit_mm: profile.max_grade_tenths_percent,
        message: `Grade ${displayGrade(measured)} is over the ${displayGrade(profile.max_grade_tenths_percent)} maximum.`,
      });
    }
  }
  return findings;
}

/** Module rules checked by Check layout and Validate. */
export function checkModuleRules(profile: StandardsProfile, module: Module): Finding[] {
  const findings: Finding[] = [];
  const units = profile.display_units;
  for (const ep of module.endplates) {
    const width = ep.width_mm;
    const isDouble = ep.track_offsets_mm.length === 2;
    const expectedWidth = isDouble ? profile.endplate_double_mm : profile.endplate_single_mm;
    if (width !== expectedWidth) {
      findings.push({
        rule: 'endplate_width',
        module_id: module.id,
        piece_id: null,
        measured_mm: width,
        limit_mm: expectedWidth,
        message: `Endplate ${ep.end} is ${displayLength(width, units)}; the standard is ${displayLength(expectedWidth, units)}.`,
      });
    }
    if (isDouble) {
      const [a, b] = [ep.track_offsets_mm[0] ?? 0, ep.track_offsets_mm[1] ?? 0];
      if (!(a === -profile.double_track_offset_mm && b === profile.double_track_offset_mm)) {
        const off = Math.abs(Math.round((a + b) / 2) - a) || Math.abs(a);
        findings.push({
          rule: 'track_centred',
          module_id: module.id,
          piece_id: null,
          measured_mm: off,
          limit_mm: 0,
          message: `Track at endplate ${ep.end} is off-centre by ${displayLength(off, units)}.`,
        });
      }
    } else {
      const off = ep.track_offsets_mm[0] ?? 0;
      if (off !== 0) {
        findings.push({
          rule: 'track_centred',
          module_id: module.id,
          piece_id: null,
          measured_mm: Math.abs(off),
          limit_mm: 0,
          message: `Track at endplate ${ep.end} is off-centre by ${displayLength(Math.abs(off), units)}.`,
        });
      }
    }
  }

  // End straight: first and last run must be straight and level for the profile distance.
  for (const end of ['A', 'B'] as const) {
    const pieces = module.pieces;
    const run = end === 'A' ? pieces.slice().reverse() : pieces;
    let straight = 0;
    for (const p of run) {
      if (p.kind !== 'straight' || p.rise_mm !== 0) break;
      straight += p.length_mm;
    }
    if (pieces.length > 0 && straight < profile.end_straight_mm) {
      findings.push({
        rule: 'end_straight',
        module_id: module.id,
        piece_id: null,
        measured_mm: straight,
        limit_mm: profile.end_straight_mm,
        message: `Only ${displayLength(straight, units)} straight and level at end ${end}; ${displayLength(profile.end_straight_mm, units)} needed.`,
      });
    }
  }

  // Elevation step: difference between first and last elevation.
  if (module.pieces.length > 0) {
    const first = module.pieces[0];
    const last = module.pieces[module.pieces.length - 1];
    if (first && last) {
      const change = last.end.elevation_mm - first.start.elevation_mm;
      const step = profile.elevation_step_hundredths_mm / 100;
      const remainder = Math.abs((change % step) + step) % step;
      if (change !== 0 && !(Math.min(remainder, Math.abs(step - remainder)) <= 1)) {
        findings.push({
          rule: 'elevation_step',
          module_id: module.id,
          piece_id: null,
          measured_mm: Math.round(change * 100),
          limit_mm: profile.elevation_step_hundredths_mm,
          message: `Elevation change ${displayLength(Math.round(Math.abs(change)), units)} is not a multiple of ${displayLength(step, units)}.`,
        });
      }
    }
  }

  for (const p of module.pieces) {
    if (!p.block_id) {
      findings.push({
        rule: 'unassigned_block',
        module_id: module.id,
        piece_id: p.id,
        measured_mm: 0,
        limit_mm: 0,
        message: `Piece ${p.id} has no block.`,
      });
    }
  }

  if (module.pieces.length === 0) {
    findings.push({
      rule: 'empty_module',
      module_id: module.id,
      piece_id: null,
      measured_mm: 0,
      limit_mm: 0,
      message: `Module ${module.name} has no track.`,
    });
  }
  return findings;
}

export function checkLayout(profile: StandardsProfile, modules: Module[]): Finding[] {
  const findings: Finding[] = [];
  for (const m of modules) {
    if (m.trashed) continue;
    findings.push(...checkModuleRules(profile, m));
  }
  return findings;
}

export function newOpenEndId(): string {
  return `oe-${randomId()}`;
}

export function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function labelForOpenEnd(moduleName: string, count: number): string {
  return `${moduleName} open end ${count + 1}`;
}
