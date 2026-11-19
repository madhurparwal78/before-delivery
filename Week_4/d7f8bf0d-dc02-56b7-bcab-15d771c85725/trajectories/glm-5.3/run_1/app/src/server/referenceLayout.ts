import type { LayoutContent, Module, Piece, Point, Endplate, OpenEnd } from '../shared/domain';

/**
 * Reference layout. Modules run west to east, each with endplate A west and B east.
 * Mainline: 1 - T1 - 3 - 4 - 5 - T2 - 6 - T3 - 8 - 9 - 10 - T4 - 11, with loops
 * 2, 7 and 12 branching south at T1, T2 and T4. Every block's piece lengths sum
 * to its length; curves are radius 1067 at 15 degrees (279 mm) or 5 degrees
 * (93 mm), separated by at least 305 mm of straight when hands oppose.
 */

interface PieceSpec {
  id: string;
  kind: 'straight' | 'curve' | 'turnout';
  block: string;
  length_mm?: number;
  radius_mm?: number;
  angle_deg?: number;
  hand?: 'left' | 'right';
  frog_number?: number;
}

function headingTangent(deg: number): { dx: number; dy: number } {
  const r = (deg * Math.PI) / 180;
  return { dx: Math.cos(r), dy: Math.sin(r) };
}

function curveEnd(start: Point, radius: number, angle: number, hand: 'left' | 'right'): Point {
  const rad = (angle * Math.PI) / 180;
  const hRad = (start.heading_deg * Math.PI) / 180;
  const dir = hand === 'left' ? 1 : -1;
  const cx = start.x_mm - Math.sin(hRad) * radius * dir;
  const cy = start.y_mm + Math.cos(hRad) * radius * dir;
  const endRad = hRad + rad * dir;
  let heading = start.heading_deg + angle * dir;
  heading = ((heading % 360) + 360) % 360;
  return {
    x_mm: Math.round(cx + Math.sin(endRad) * radius * dir),
    y_mm: Math.round(cy - Math.cos(endRad) * radius * dir),
    elevation_mm: start.elevation_mm,
    heading_deg: heading,
  };
}

function buildPiece(spec: PieceSpec, start: Point): Piece {
  if (spec.kind === 'curve') {
    const radius = spec.radius_mm ?? 1067;
    const angle = spec.angle_deg ?? 15;
    const end = curveEnd(start, radius, angle, spec.hand ?? 'left');
    return {
      id: spec.id,
      kind: 'curve',
      length_mm: Math.round(radius * ((angle * Math.PI) / 180)),
      rise_mm: 0,
      mainline: true,
      block_id: spec.block,
      note: '',
      start,
      end,
      radius_mm: radius,
      angle_deg: angle,
      hand: spec.hand ?? 'left',
    };
  }
  const { dx, dy } = headingTangent(start.heading_deg);
  const length = spec.length_mm ?? 0;
  const piece: Piece = {
    id: spec.id,
    kind: spec.kind,
    length_mm: length,
    rise_mm: 0,
    mainline: true,
    block_id: spec.block,
    note: '',
    start,
    end: {
      x_mm: Math.round(start.x_mm + dx * length),
      y_mm: Math.round(start.y_mm + dy * length),
      elevation_mm: start.elevation_mm,
      heading_deg: start.heading_deg,
    },
  };
  if (spec.kind === 'turnout') {
    piece.frog_number = spec.frog_number ?? 6;
  }
  return piece;
}

function buildRun(specs: PieceSpec[], start: Point): { pieces: Piece[]; end: Point } {
  const pieces: Piece[] = [];
  let cur = start;
  for (const spec of specs) {
    const piece = buildPiece(spec, cur);
    pieces.push(piece);
    cur = piece.end;
  }
  return { pieces, end: cur };
}

const endplates = (): Endplate[] => [
  { end: 'A', width_mm: 610, track_offsets_mm: [0] },
  { end: 'B', width_mm: 610, track_offsets_mm: [0] },
];

/** A loop branch: diverge with a curve, run, curve back to parallel east heading. */
function loopBranch(idPrefix: string, block: string, start: Point, firstHand: 'left' | 'right'): { pieces: Piece[]; end: Point } {
  // From the turnout end heading east: curve R 15 (279), straight 610, curve L 15 (279)
  // brings heading back to 0 with a southward offset, then straight to the block length.
  // 279 + 610 + 279 = 1168; remainder split around the trailing straight.
  const specs: PieceSpec[] = [
    { id: `${idPrefix}-1`, kind: 'curve', block, radius_mm: 1067, angle_deg: 15, hand: firstHand },
    { id: `${idPrefix}-2`, kind: 'straight', block, length_mm: 610 },
    { id: `${idPrefix}-3`, kind: 'curve', block, radius_mm: 1067, angle_deg: 15, hand: firstHand === 'left' ? 'right' : 'left' },
    { id: `${idPrefix}-4`, kind: 'straight', block, length_mm: 1832 },
  ];
  return buildRun(specs, start);
}

export function buildReferenceContent(): LayoutContent {
  const modules: Module[] = [];

  // ---- mod-wren: blk-01 (3000), T1, blk-03 (1500), blk-02 branch (3000) ----
  {
    const a: Point = { x_mm: 0, y_mm: 0, elevation_mm: 0, heading_deg: 0 };
    const main1 = buildRun([
      { id: 'pc-wren-1', kind: 'straight', block: 'blk-01', length_mm: 1500 },
      { id: 'pc-wren-2', kind: 'curve', block: 'blk-01', radius_mm: 1067, angle_deg: 15, hand: 'left' },
      { id: 'pc-wren-3', kind: 'straight', block: 'blk-01', length_mm: 942 },
      { id: 'pc-wren-4', kind: 'curve', block: 'blk-01', radius_mm: 1067, angle_deg: 15, hand: 'right' },
    ], a);
    const t1 = buildPiece({ id: 'pc-wren-5', kind: 'turnout', block: 'blk-03', length_mm: 305, frog_number: 6 }, main1.end);
    const b3 = buildRun([{ id: 'pc-wren-6', kind: 'straight', block: 'blk-03', length_mm: 1195 }], t1.end);
    const branchStart: Point = { x_mm: t1.end.x_mm, y_mm: t1.end.y_mm, elevation_mm: 0, heading_deg: 0 };
    const branch = loopBranch('pc-wren-l', 'blk-02', branchStart, 'right');
    const pieces = [...main1.pieces, t1, ...b3.pieces, ...branch.pieces];
    const openEnds: OpenEnd[] = [
      { id: 'oe-wren-a', label: 'Wren Quay A', x_mm: 0, y_mm: 0, elevation_mm: 0, heading_deg: 180, parent_piece_id: 'pc-wren-1' },
      { id: 'oe-wren-b', label: 'Wren Quay B', x_mm: b3.end.x_mm, y_mm: b3.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-wren-6' },
      { id: 'oe-wren-loop', label: 'Wren Quay Loop end', x_mm: branch.end.x_mm, y_mm: branch.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-wren-l-4' },
    ];
    modules.push({ id: 'mod-wren', name: 'Wren Quay', endplates: endplates(), pieces, open_ends: openEnds, trashed: false, trashed_by: null, trashed_at: null });
  }

  // ---- mod-west: blk-04 (4000) ----
  {
    const a: Point = { x_mm: 4805, y_mm: 0, elevation_mm: 0, heading_deg: 0 };
    const run = buildRun([
      { id: 'pc-west-1', kind: 'straight', block: 'blk-04', length_mm: 1500 },
      { id: 'pc-west-2', kind: 'curve', block: 'blk-04', radius_mm: 1067, angle_deg: 15, hand: 'right' },
      { id: 'pc-west-3', kind: 'straight', block: 'blk-04', length_mm: 942 },
      { id: 'pc-west-4', kind: 'curve', block: 'blk-04', radius_mm: 1067, angle_deg: 15, hand: 'left' },
      { id: 'pc-west-5', kind: 'straight', block: 'blk-04', length_mm: 1000 },
    ], a);
    const openEnds: OpenEnd[] = [
      { id: 'oe-west-a', label: 'Single Line West A', x_mm: a.x_mm, y_mm: a.y_mm, elevation_mm: 0, heading_deg: 180, parent_piece_id: 'pc-west-1' },
      { id: 'oe-west-b', label: 'Single Line West B', x_mm: run.end.x_mm, y_mm: run.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-west-5' },
    ];
    modules.push({ id: 'mod-west', name: 'Single Line West', endplates: endplates(), pieces: run.pieces, open_ends: openEnds, trashed: false, trashed_by: null, trashed_at: null });
  }

  // ---- mod-fernhill: blk-05 (1500), T2, blk-06 (3000), blk-07 branch (3000), T3, blk-08 (1500) ----
  {
    const a: Point = { x_mm: 8805, y_mm: 0, elevation_mm: 0, heading_deg: 0 };
    const b5 = buildRun([
      { id: 'pc-fern-1', kind: 'straight', block: 'blk-05', length_mm: 500 },
      { id: 'pc-fern-2', kind: 'curve', block: 'blk-05', radius_mm: 1067, angle_deg: 15, hand: 'left' },
      { id: 'pc-fern-5', kind: 'turnout', block: 'blk-05', length_mm: 305, frog_number: 6 },
      { id: 'pc-fern-4', kind: 'curve', block: 'blk-05', radius_mm: 1067, angle_deg: 15, hand: 'right' },
      { id: 'pc-fern-3', kind: 'straight', block: 'blk-05', length_mm: 137 },
    ], a);
    const t2 = b5.pieces.find((p) => p.id === 'pc-fern-5');
    if (!t2) throw new Error('t2 missing');
    const b6 = buildRun([
      { id: 'pc-fern-6', kind: 'straight', block: 'blk-06', length_mm: 1500 },
      { id: 'pc-fern-7', kind: 'curve', block: 'blk-06', radius_mm: 1067, angle_deg: 15, hand: 'right' },
      { id: 'pc-fern-8', kind: 'straight', block: 'blk-06', length_mm: 942 },
      { id: 'pc-fern-9', kind: 'curve', block: 'blk-06', radius_mm: 1067, angle_deg: 15, hand: 'left' },
    ], b5.end);
    const branchStart: Point = { x_mm: t2.end.x_mm, y_mm: t2.end.y_mm, elevation_mm: 0, heading_deg: 0 };
    const b7 = loopBranch('pc-fern-l', 'blk-07', branchStart, 'right');
    const t3 = buildPiece({ id: 'pc-fern-10', kind: 'turnout', block: 'blk-08', length_mm: 305, frog_number: 6 }, b6.end);
    const b8 = buildRun([{ id: 'pc-fern-11', kind: 'straight', block: 'blk-08', length_mm: 1195 }], t3.end);
    const pieces = [...b5.pieces, ...b6.pieces, ...b7.pieces, t3, ...b8.pieces];
    const openEnds: OpenEnd[] = [
      { id: 'oe-fern-a', label: 'Fernhill A', x_mm: a.x_mm, y_mm: a.y_mm, elevation_mm: 0, heading_deg: 180, parent_piece_id: 'pc-fern-1' },
      { id: 'oe-fern-b', label: 'Fernhill B', x_mm: b8.end.x_mm, y_mm: b8.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-fern-11' },
      { id: 'oe-fern-loop', label: 'Fernhill Loop east end', x_mm: b7.end.x_mm, y_mm: b7.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-fern-l-4' },
    ];
    modules.push({ id: 'mod-fernhill', name: 'Fernhill', endplates: endplates(), pieces, open_ends: openEnds, trashed: false, trashed_by: null, trashed_at: null });
  }

  // ---- mod-east: blk-09 (4000) ----
  {
    const a: Point = { x_mm: 16415, y_mm: 0, elevation_mm: 0, heading_deg: 0 };
    const run = buildRun([
      { id: 'pc-east-1', kind: 'straight', block: 'blk-09', length_mm: 1500 },
      { id: 'pc-east-2', kind: 'curve', block: 'blk-09', radius_mm: 1067, angle_deg: 15, hand: 'left' },
      { id: 'pc-east-3', kind: 'straight', block: 'blk-09', length_mm: 942 },
      { id: 'pc-east-4', kind: 'curve', block: 'blk-09', radius_mm: 1067, angle_deg: 15, hand: 'right' },
      { id: 'pc-east-5', kind: 'straight', block: 'blk-09', length_mm: 1000 },
    ], a);
    const openEnds: OpenEnd[] = [
      { id: 'oe-east-a', label: 'Single Line East A', x_mm: a.x_mm, y_mm: a.y_mm, elevation_mm: 0, heading_deg: 180, parent_piece_id: 'pc-east-1' },
      { id: 'oe-east-b', label: 'Single Line East B', x_mm: run.end.x_mm, y_mm: run.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-east-5' },
    ];
    modules.push({ id: 'mod-east', name: 'Single Line East', endplates: endplates(), pieces: run.pieces, open_ends: openEnds, trashed: false, trashed_by: null, trashed_at: null });
  }

  // ---- mod-tarn: blk-10 (1500), T4, blk-11 (3000), blk-12 branch (3000) ----
  {
    const a: Point = { x_mm: 20415, y_mm: 0, elevation_mm: 0, heading_deg: 0 };
    const b10 = buildRun([
      { id: 'pc-tarn-1', kind: 'straight', block: 'blk-10', length_mm: 500 },
      { id: 'pc-tarn-2', kind: 'curve', block: 'blk-10', radius_mm: 1067, angle_deg: 15, hand: 'left' },
      { id: 'pc-tarn-3', kind: 'straight', block: 'blk-10', length_mm: 442 },
      { id: 'pc-tarn-4', kind: 'curve', block: 'blk-10', radius_mm: 1067, angle_deg: 15, hand: 'right' },
    ], a);
    const t4 = buildPiece({ id: 'pc-tarn-5', kind: 'turnout', block: 'blk-11', length_mm: 305, frog_number: 6 }, b10.end);
    const b11 = buildRun([{ id: 'pc-tarn-6', kind: 'straight', block: 'blk-11', length_mm: 2695 }], t4.end);
    const branchStart: Point = { x_mm: t4.end.x_mm, y_mm: t4.end.y_mm, elevation_mm: 0, heading_deg: 0 };
    const b12 = loopBranch('pc-tarn-l', 'blk-12', branchStart, 'right');
    const pieces = [...b10.pieces, t4, ...b11.pieces, ...b12.pieces];
    const openEnds: OpenEnd[] = [
      { id: 'oe-tarn-a', label: 'Tarn Head A', x_mm: a.x_mm, y_mm: a.y_mm, elevation_mm: 0, heading_deg: 180, parent_piece_id: 'pc-tarn-1' },
      { id: 'oe-tarn-b', label: 'Tarn Head B', x_mm: b11.end.x_mm, y_mm: b11.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-tarn-6' },
      { id: 'oe-tarn-loop', label: 'Tarn Head Loop end', x_mm: b12.end.x_mm, y_mm: b12.end.y_mm, elevation_mm: 0, heading_deg: 0, parent_piece_id: 'pc-tarn-l-4' },
    ];
    modules.push({ id: 'mod-tarn', name: 'Tarn Head', endplates: endplates(), pieces, open_ends: openEnds, trashed: false, trashed_by: null, trashed_at: null });
  }

  const blocks = [
    { id: 'blk-01', number: 1, name: 'Wren Quay Road', kind: 'plain' as const, length_mm: 3000 },
    { id: 'blk-02', number: 2, name: 'Wren Quay Loop', kind: 'loop' as const, length_mm: 3000 },
    { id: 'blk-03', number: 3, name: 'Wren Approach', kind: 'approach' as const, length_mm: 1500 },
    { id: 'blk-04', number: 4, name: 'Single Line West', kind: 'plain' as const, length_mm: 4000 },
    { id: 'blk-05', number: 5, name: 'Fernhill West Approach', kind: 'approach' as const, length_mm: 1500 },
    { id: 'blk-06', number: 6, name: 'Fernhill Main', kind: 'plain' as const, length_mm: 3000 },
    { id: 'blk-07', number: 7, name: 'Fernhill Loop', kind: 'loop' as const, length_mm: 3000 },
    { id: 'blk-08', number: 8, name: 'Fernhill East Approach', kind: 'approach' as const, length_mm: 1500 },
    { id: 'blk-09', number: 9, name: 'Single Line East', kind: 'plain' as const, length_mm: 4000 },
    { id: 'blk-10', number: 10, name: 'Tarn Approach', kind: 'approach' as const, length_mm: 1500 },
    { id: 'blk-11', number: 11, name: 'Tarn Head Road', kind: 'plain' as const, length_mm: 3000 },
    { id: 'blk-12', number: 12, name: 'Tarn Head Loop', kind: 'loop' as const, length_mm: 3000 },
  ];

  const stations = [
    { id: 'st-wren', name: 'Wren Quay', block_ids: ['blk-01', 'blk-02'] },
    { id: 'st-fernhill', name: 'Fernhill', block_ids: ['blk-06', 'blk-07'] },
    { id: 'st-tarn', name: 'Tarn Head', block_ids: ['blk-11', 'blk-12'] },
  ];

  const turnouts = [
    { id: 'T1', stem_block_id: 'blk-03', normal_block_id: 'blk-01', reverse_block_id: 'blk-02' },
    { id: 'T2', stem_block_id: 'blk-05', normal_block_id: 'blk-06', reverse_block_id: 'blk-07' },
    { id: 'T3', stem_block_id: 'blk-08', normal_block_id: 'blk-06', reverse_block_id: 'blk-07' },
    { id: 'T4', stem_block_id: 'blk-10', normal_block_id: 'blk-11', reverse_block_id: 'blk-12' },
  ];

  const trains = [
    { id: 't101', number: '101', name: 'Wren Quay Pickup', direction: 'east' as const, speed_mph: 40, length_mm: 1200, start_block_id: 'blk-01', head_offset_mm: 2800 },
    { id: 't202', number: '202', name: 'Tarn Head Mixed', direction: 'west' as const, speed_mph: 40, length_mm: 1200, start_block_id: 'blk-11', head_offset_mm: 2800 },
    { id: 't303', number: '303', name: 'Fernhill Shuttle', direction: 'east' as const, speed_mph: 25, length_mm: 900, start_block_id: 'blk-02', head_offset_mm: 2800 },
  ];

  const timetable = {
    version: 1,
    entries: [
      { id: 'tt-1', train_id: 't101', station_id: 'st-wren', depart_fast_seconds: 720 },
      { id: 'tt-2', train_id: 't101', station_id: 'st-fernhill', depart_fast_seconds: 1500 },
      { id: 'tt-3', train_id: 't101', station_id: 'st-tarn', depart_fast_seconds: 2400 },
      { id: 'tt-4', train_id: 't202', station_id: 'st-tarn', depart_fast_seconds: 720 },
      { id: 'tt-5', train_id: 't202', station_id: 'st-fernhill', depart_fast_seconds: 1500 },
      { id: 'tt-6', train_id: 't202', station_id: 'st-wren', depart_fast_seconds: 2400 },
      { id: 'tt-7', train_id: 't303', station_id: 'st-wren', depart_fast_seconds: 900 },
      { id: 'tt-8', train_id: 't303', station_id: 'st-fernhill', depart_fast_seconds: 1800 },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };

  // The single-line run west to east, including the loop branches at the turnouts.
  const block_sequence = [
    'blk-01', 'blk-03', 'blk-04', 'blk-05', 'blk-06', 'blk-08', 'blk-09', 'blk-10', 'blk-11',
  ];

  return { modules, blocks, stations, turnouts, trains, timetable, block_sequence };
}

/** Reference layout with a variant tt-1 depart value (versions 1 to 11). */
export function buildReferenceContentWithTt1(departFastSeconds: number): LayoutContent {
  const content = buildReferenceContent();
  const tt1 = content.timetable.entries.find((e) => e.id === 'tt-1');
  if (tt1) tt1.depart_fast_seconds = departFastSeconds;
  return content;
}
