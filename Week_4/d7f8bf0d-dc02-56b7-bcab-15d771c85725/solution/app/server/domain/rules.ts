import type { Finding, LayoutContent, LayoutModule, Piece, PieceBody, StandardsProfile } from '../../shared/domain'
import { standardEndplate } from '../../shared/endplates'
import { pieceLengthMm } from '../../shared/geometry'
import { formatHundredthsLength, formatLength } from './units'

// Piece rules and module rules: the only place where the club standard is applied to geometry.

function finding(rule: string, moduleId: string, pieceId: string | null, measured: number, limit: number, message: string): Finding {
  return { rule, module_id: moduleId, piece_id: pieceId, measured_mm: measured, limit_mm: limit, message }
}

function straightSince(module: LayoutModule, afterPieceId: string | null): { curve: Piece | null; straight_mm: number } {
  let straight = 0
  let cursor = afterPieceId === null ? undefined : module.pieces.find(p => p.id === afterPieceId)
  while (cursor !== undefined) {
    if (cursor.kind === 'curve') return { curve: cursor, straight_mm: straight }
    straight += cursor.length_mm
    cursor = cursor.after_piece_id === null ? undefined : module.pieces.find(p => p.id === cursor?.after_piece_id)
  }
  return { curve: null, straight_mm: straight }
}

export function pieceFindings(
  module: LayoutModule,
  afterPieceId: string | null,
  body: PieceBody,
  pieceId: string | null,
  standards: StandardsProfile,
): Finding[] {
  const found: Finding[] = []
  const units = standards.display_units
  if (body.kind === 'curve' && body.mainline && body.radius_mm < standards.min_radius_mm) {
    found.push(finding('min_radius', module.id, pieceId, body.radius_mm, standards.min_radius_mm,
      `Curve radius ${formatLength(body.radius_mm, units)} is under the ${formatLength(standards.min_radius_mm, units)} minimum.`))
  }
  const length = pieceLengthMm(body)
  if (Math.abs(body.rise_mm) * 1000 > standards.max_grade_tenths_percent * length) {
    const measured = Math.round((Math.abs(body.rise_mm) * 1000) / length)
    found.push(finding('max_grade', module.id, pieceId, measured, standards.max_grade_tenths_percent,
      `Grade ${(measured / 10).toFixed(1)}% is over the ${(standards.max_grade_tenths_percent / 10).toFixed(1)}% maximum.`))
  }
  if (body.kind === 'turnout' && body.frog_number < standards.min_frog_number) {
    found.push(finding('min_turnout', module.id, pieceId, body.frog_number, standards.min_frog_number,
      `Turnout #${body.frog_number} is under the #${standards.min_frog_number} minimum.`))
  }
  if (body.kind === 'curve') {
    const before = straightSince(module, afterPieceId)
    if (before.curve !== null && before.curve.kind === 'curve' && before.curve.hand !== body.hand
      && before.straight_mm < standards.reverse_curve_straight_mm) {
      found.push(finding('reverse_curve', module.id, pieceId, before.straight_mm, standards.reverse_curve_straight_mm,
        `Only ${formatLength(before.straight_mm, units)} of straight between reverse curves; ${formatLength(standards.reverse_curve_straight_mm, units)} needed.`))
    }
  }
  return found
}

function runLength(pieces: Piece[]): number {
  return pieces.reduce((sum, piece) => sum + piece.length_mm, 0)
}

function leadingRun(module: LayoutModule): number {
  const run: Piece[] = []
  for (const piece of module.pieces) {
    const linked = run.length === 0 ? piece.after_piece_id === null : piece.after_piece_id === run[run.length - 1].id
    if (!linked || piece.kind !== 'straight' || piece.rise_mm !== 0) break
    run.push(piece)
  }
  return runLength(run)
}

function trailingRun(module: LayoutModule): number {
  const run: Piece[] = []
  let cursor: Piece | undefined = module.pieces[module.pieces.length - 1]
  while (cursor !== undefined && cursor.kind === 'straight' && cursor.rise_mm === 0) {
    run.push(cursor)
    const parent: string | null = cursor.after_piece_id
    cursor = parent === null ? undefined : module.pieces.find(p => p.id === parent)
  }
  return runLength(run)
}

function moduleFindings(module: LayoutModule, standards: StandardsProfile): Finding[] {
  const found: Finding[] = []
  const units = standards.display_units
  for (const plate of module.endplates) {
    const expected = standardEndplate(plate.track_offsets_mm.length === 2 ? 'double' : 'single', standards)
    if (plate.width_mm !== expected.width_mm) {
      found.push(finding('endplate_width', module.id, null, plate.width_mm, expected.width_mm,
        `Endplate ${plate.end} is ${formatLength(plate.width_mm, units)}; the standard is ${formatLength(expected.width_mm, units)}.`))
    }
    const off = Math.max(...plate.track_offsets_mm.map((offset, i) => Math.abs(offset - (expected.track_offsets_mm[i] ?? 0))))
    if (off > 0) {
      found.push(finding('track_centred', module.id, null, off, 0, `Track at endplate ${plate.end} is off-centre by ${formatLength(off, units)}.`))
    }
  }
  if (module.pieces.length === 0) {
    found.push(finding('empty_module', module.id, null, 0, 0, `Module ${module.name} has no track.`))
    return found
  }
  const straights: Array<[string, number]> = [['A', leadingRun(module)], ['B', trailingRun(module)]]
  for (const [end, run] of straights) {
    if (run < standards.end_straight_mm) {
      found.push(finding('end_straight', module.id, null, run, standards.end_straight_mm,
        `Only ${formatLength(run, units)} straight and level at end ${end}; ${formatLength(standards.end_straight_mm, units)} needed.`))
    }
  }
  const change = Math.abs(module.pieces[module.pieces.length - 1].end.elevation_mm - module.pieces[0].start.elevation_mm) * 100
  const step = standards.elevation_step_hundredths_mm
  if (Math.abs(change - Math.round(change / step) * step) > 100) {
    found.push(finding('elevation_step', module.id, null, change, step,
      `Elevation change ${formatHundredthsLength(change, units)} is not a multiple of ${formatHundredthsLength(step, units)}.`))
  }
  for (const piece of module.pieces) {
    if (piece.block_id === null) {
      found.push(finding('unassigned_block', module.id, piece.id, 0, 0, `Piece ${piece.id} has no block.`))
    }
  }
  return found
}

export function checkLayout(content: LayoutContent, standards: StandardsProfile): Finding[] {
  return content.modules.flatMap(module => [
    ...module.pieces.flatMap(piece => pieceFindings(module, piece.after_piece_id, piece, piece.id, standards)),
    ...moduleFindings(module, standards),
  ])
}
