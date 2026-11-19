import type {
  Finding,
  LayoutContent,
  ModuleContent,
  StandardsProfile,
  StoredPiece,
} from '../../shared/protocol.js';
import { formatGradeTenths, formatLength } from '../../shared/units.js';
import { chainAncestors } from './layout.js';

/** Measured grade in tenths of a percent, halves up. */
function gradeTenths(riseMm: number, lengthMm: number): number {
  if (lengthMm === 0) return 0;
  return Math.floor((Math.abs(riseMm) * 1000) / lengthMm + 0.5);
}

function isSeparator(piece: StoredPiece): boolean {
  return piece.kind !== 'curve';
}

/**
 * The rules checked when a piece is appended or edited. `preceding` is the chain
 * of pieces before this one, oldest first.
 */
export function checkPiece(
  piece: StoredPiece,
  preceding: StoredPiece[],
  moduleId: string,
  profile: StandardsProfile,
): Finding[] {
  const findings: Finding[] = [];
  const units = profile.display_units;

  if (piece.kind === 'curve' && piece.mainline) {
    const radius = piece.radius_mm ?? 0;
    if (radius < profile.min_radius_mm) {
      findings.push({
        rule: 'min_radius',
        module_id: moduleId,
        piece_id: piece.id,
        measured_mm: radius,
        limit_mm: profile.min_radius_mm,
        message: `Curve radius ${formatLength(radius, units)} is under the ${formatLength(
          profile.min_radius_mm,
          units,
        )} minimum.`,
      });
    }
  }

  const measuredGrade = gradeTenths(piece.rise_mm, piece.length_mm);
  if (Math.abs(piece.rise_mm) * 1000 > profile.max_grade_tenths_percent * piece.length_mm) {
    findings.push({
      rule: 'max_grade',
      module_id: moduleId,
      piece_id: piece.id,
      measured_mm: measuredGrade,
      limit_mm: profile.max_grade_tenths_percent,
      message: `Grade ${formatGradeTenths(measuredGrade)}% is over the ${formatGradeTenths(
        profile.max_grade_tenths_percent,
      )}% maximum.`,
    });
  }

  if (piece.kind === 'turnout') {
    const frog = piece.frog_number ?? 0;
    if (frog < profile.min_frog_number) {
      findings.push({
        rule: 'min_turnout',
        module_id: moduleId,
        piece_id: piece.id,
        measured_mm: frog,
        limit_mm: profile.min_frog_number,
        message: `Turnout #${frog} is under the #${profile.min_frog_number} minimum.`,
      });
    }
  }

  if (piece.kind === 'curve') {
    let straight = 0;
    for (let index = preceding.length - 1; index >= 0; index -= 1) {
      const earlier = preceding[index];
      if (isSeparator(earlier)) {
        straight += earlier.length_mm;
        continue;
      }
      if (earlier.hand !== piece.hand && straight < profile.reverse_curve_straight_mm) {
        findings.push({
          rule: 'reverse_curve',
          module_id: moduleId,
          piece_id: piece.id,
          measured_mm: straight,
          limit_mm: profile.reverse_curve_straight_mm,
          message: `Only ${formatLength(straight, units)} of straight between reverse curves; ${formatLength(
            profile.reverse_curve_straight_mm,
            units,
          )} needed.`,
        });
      }
      break;
    }
  }

  return findings;
}

function straightLevelRun(pieces: StoredPiece[]): number {
  let total = 0;
  for (const piece of pieces) {
    if (piece.kind !== 'straight' || piece.rise_mm !== 0) break;
    total += piece.length_mm;
  }
  return total;
}

function checkModule(module: ModuleContent, profile: StandardsProfile): Finding[] {
  const findings: Finding[] = [];
  const units = profile.display_units;

  for (const endplate of module.endplates) {
    const isDouble = endplate.track_offsets_mm.length > 1;
    const expectedWidth = isDouble ? profile.endplate_double_mm : profile.endplate_single_mm;
    if (endplate.width_mm !== expectedWidth) {
      findings.push({
        rule: 'endplate_width',
        module_id: module.id,
        piece_id: null,
        measured_mm: endplate.width_mm,
        limit_mm: expectedWidth,
        message: `Endplate ${endplate.end} is ${formatLength(
          endplate.width_mm,
          units,
        )}; the standard is ${formatLength(expectedWidth, units)}.`,
      });
    }

    const offsets = endplate.track_offsets_mm;
    const expected = isDouble
      ? [-profile.double_track_offset_mm, profile.double_track_offset_mm]
      : [0];
    const offBy = Math.max(
      ...offsets.map((offset, index) => Math.abs(offset - (expected[index] ?? 0))),
      offsets.length === expected.length ? 0 : Number.POSITIVE_INFINITY,
    );
    if (offBy !== 0) {
      const measured = Number.isFinite(offBy) ? offBy : 0;
      findings.push({
        rule: 'track_centred',
        module_id: module.id,
        piece_id: null,
        measured_mm: measured,
        limit_mm: 0,
        message: `Track at endplate ${endplate.end} is off-centre by ${formatLength(measured, units)}.`,
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
    return findings;
  }

  const ends: { label: string; run: number }[] = [
    {
      label: module.endplates[0]?.end ?? 'A',
      run: straightLevelRun(module.pieces),
    },
    {
      label: module.endplates[module.endplates.length - 1]?.end ?? 'B',
      run: straightLevelRun([...module.pieces].reverse()),
    },
  ];
  for (const end of ends) {
    if (end.run < profile.end_straight_mm) {
      findings.push({
        rule: 'end_straight',
        module_id: module.id,
        piece_id: null,
        measured_mm: end.run,
        limit_mm: profile.end_straight_mm,
        message: `Only ${formatLength(end.run, units)} straight and level at end ${
          end.label
        }; ${formatLength(profile.end_straight_mm, units)} needed.`,
      });
    }
  }

  const first = module.pieces[0];
  const last = module.pieces[module.pieces.length - 1];
  const changeHundredths = Math.round(
    Math.abs(last.end.elevation_mm - first.start.elevation_mm) * 100,
  );
  const step = profile.elevation_step_hundredths_mm;
  const nearestMultiple = Math.round(changeHundredths / step) * step;
  if (Math.abs(changeHundredths - nearestMultiple) > 100) {
    findings.push({
      rule: 'elevation_step',
      module_id: module.id,
      piece_id: null,
      measured_mm: changeHundredths,
      limit_mm: step,
      message: `Elevation change ${formatLength(
        Math.round(changeHundredths / 100),
        units,
      )} is not a multiple of ${formatLength(Math.round(step / 100), units)}.`,
    });
  }

  for (const piece of module.pieces) {
    if (piece.block_id === null) {
      findings.push({
        rule: 'unassigned_block',
        module_id: module.id,
        piece_id: piece.id,
        measured_mm: 0,
        limit_mm: 0,
        message: `Piece ${piece.id} has no block.`,
      });
    }
  }

  return findings;
}

/** Every piece and module rule finding for a whole layout content. */
export function checkContent(content: LayoutContent, profile: StandardsProfile): Finding[] {
  const findings: Finding[] = [];
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      findings.push(
        ...checkPiece(piece, chainAncestors(module.pieces, piece), module.id, profile),
      );
    }
    findings.push(...checkModule(module, profile));
  }
  return findings;
}
