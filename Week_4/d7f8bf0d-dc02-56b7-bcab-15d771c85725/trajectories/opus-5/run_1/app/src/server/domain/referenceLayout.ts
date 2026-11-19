import type {
  BlockContent,
  Hand,
  LayoutContent,
  ModuleContent,
  OpenEnd,
  PieceInput,
  Pose,
  StoredPiece,
} from '../../shared/protocol.js';
import { branchPose } from '../../shared/geometry.js';
import { buildPiece, makeOpenEnd, nextEndLabel, recomputeBlockLengths } from './layout.js';

const CURVE_RADIUS_MM = 1067;
const CURVE_ANGLE_DEG = 15;
const CURVE_LENGTH_MM = 279;
const LEAD_STRAIGHT_MM = 152;
const SEPARATING_STRAIGHT_MM = 305;
const TURNOUT_LENGTH_MM = 305;

/**
 * A run of track of an exact length: a level lead-in straight, gentle curves of
 * alternating hand separated by the standard straight, then the remainder.
 */
function run(totalMm: number, hands: Hand[]): PieceInput[] {
  const pieces: PieceInput[] = [{ kind: 'straight', length_mm: LEAD_STRAIGHT_MM }];
  let remaining = totalMm - LEAD_STRAIGHT_MM;
  for (const hand of hands) {
    const needed = CURVE_LENGTH_MM + SEPARATING_STRAIGHT_MM + LEAD_STRAIGHT_MM;
    if (remaining < needed) break;
    pieces.push({
      kind: 'curve',
      radius_mm: CURVE_RADIUS_MM,
      angle_deg: CURVE_ANGLE_DEG,
      hand,
    });
    pieces.push({ kind: 'straight', length_mm: SEPARATING_STRAIGHT_MM });
    remaining -= CURVE_LENGTH_MM + SEPARATING_STRAIGHT_MM;
  }
  pieces.push({ kind: 'straight', length_mm: remaining });
  return pieces;
}

class ModuleBuilder {
  readonly pieces: StoredPiece[] = [];
  readonly openEnds: OpenEnd[] = [];
  private cursor: Pose;
  private from: { piece_id: string | null; exit: 'end' | 'branch' } = {
    piece_id: null,
    exit: 'end',
  };

  constructor(private readonly origin: Pose) {
    this.cursor = { ...origin };
  }

  add(input: PieceInput, blockId: string): StoredPiece {
    const piece = buildPiece(input, this.cursor, blockId, 'Founder Fishplate', this.from);
    this.pieces.push(piece);
    this.cursor = piece.end;
    this.from = { piece_id: piece.id, exit: 'end' };
    return piece;
  }

  addRun(totalMm: number, hands: Hand[], blockId: string): void {
    for (const input of run(totalMm, hands)) this.add(input, blockId);
  }

  addTurnout(hand: Hand, blockId: string): { piece_id: string; pose: Pose } {
    const piece = this.add(
      { kind: 'turnout', frog_number: 6, hand, length_mm: TURNOUT_LENGTH_MM },
      blockId,
    );
    return { piece_id: piece.id, pose: branchPose(piece.start, piece) };
  }

  closeEnd(): void {
    this.openEnds.push(
      makeOpenEnd(nextEndLabel(this.openEnds.map((end) => end.label)), this.cursor),
    );
  }

  goToBranch(branch: { piece_id: string; pose: Pose }): void {
    this.cursor = { ...branch.pose };
    this.from = { piece_id: branch.piece_id, exit: 'branch' };
  }

  build(id: string, name: string): ModuleContent {
    return {
      id,
      name,
      endplates: [
        { end: 'A', width_mm: 610, track_offsets_mm: [0] },
        { end: 'B', width_mm: 610, track_offsets_mm: [0] },
      ],
      pieces: this.pieces,
      open_ends: this.openEnds,
      origin: this.origin,
    };
  }
}

function pose(x: number, heading: number): Pose {
  return { x_mm: x, y_mm: 0, elevation_mm: 0, heading_deg: heading };
}

function block(
  id: string,
  number: number,
  name: string,
  kind: BlockContent['kind'],
  moduleId: string,
  stationId: string | null,
  west: string[],
  east: string[],
): BlockContent {
  return {
    id,
    number,
    name,
    kind,
    length_mm: 0,
    module_id: moduleId,
    station_id: stationId,
    west_neighbour_ids: west,
    east_neighbour_ids: east,
  };
}

/** The club's reference layout: five modules, twelve blocks, four turnouts, three trains. */
export function referenceContent(timetableVersion: number): LayoutContent {
  const wren = new ModuleBuilder(pose(0, 180));
  wren.addRun(1195, ['left'], 'blk-03');
  const wrenLoopBranch = wren.addTurnout('left', 'blk-03');
  wren.addRun(3000, ['left', 'right'], 'blk-01');
  wren.closeEnd();
  wren.goToBranch(wrenLoopBranch);
  wren.addRun(3000, ['right', 'left'], 'blk-02');
  wren.closeEnd();

  const west = new ModuleBuilder(pose(0, 0));
  west.addRun(4000, ['left', 'right'], 'blk-04');
  west.closeEnd();

  const fernhill = new ModuleBuilder(pose(4000, 0));
  fernhill.addRun(1195, ['left'], 'blk-05');
  const fernhillLoopBranch = fernhill.addTurnout('right', 'blk-05');
  fernhill.addRun(3000, ['left', 'right'], 'blk-06');
  const fernhillEastBranch = fernhill.addTurnout('right', 'blk-08');
  fernhill.addRun(1195, ['left'], 'blk-08');
  fernhill.closeEnd();
  fernhill.goToBranch(fernhillEastBranch);
  fernhill.closeEnd();
  fernhill.goToBranch(fernhillLoopBranch);
  fernhill.addRun(3000, ['right', 'left'], 'blk-07');
  fernhill.closeEnd();

  const east = new ModuleBuilder(pose(10000, 0));
  east.addRun(4000, ['right', 'left'], 'blk-09');
  east.closeEnd();

  const tarn = new ModuleBuilder(pose(14000, 0));
  tarn.addRun(1195, ['right'], 'blk-10');
  const tarnLoopBranch = tarn.addTurnout('right', 'blk-10');
  tarn.addRun(3000, ['left', 'right'], 'blk-11');
  tarn.closeEnd();
  tarn.goToBranch(tarnLoopBranch);
  tarn.addRun(3000, ['right', 'left'], 'blk-12');
  tarn.closeEnd();

  const content: LayoutContent = {
    modules: [
      wren.build('mod-wren', 'Wren Quay'),
      west.build('mod-west', 'Single Line West'),
      fernhill.build('mod-fernhill', 'Fernhill'),
      east.build('mod-east', 'Single Line East'),
      tarn.build('mod-tarn', 'Tarn Head'),
    ],
    blocks: [
      block('blk-01', 1, 'Wren Quay Road', 'plain', 'mod-wren', 'st-wren', [], ['blk-03']),
      block('blk-02', 2, 'Wren Quay Loop', 'loop', 'mod-wren', 'st-wren', [], ['blk-03']),
      block('blk-03', 3, 'Wren Approach', 'approach', 'mod-wren', null, ['blk-01', 'blk-02'], ['blk-04']),
      block('blk-04', 4, 'Single Line West', 'plain', 'mod-west', null, ['blk-03'], ['blk-05']),
      block('blk-05', 5, 'Fernhill West Approach', 'approach', 'mod-fernhill', null, ['blk-04'], ['blk-06', 'blk-07']),
      block('blk-06', 6, 'Fernhill Main', 'plain', 'mod-fernhill', 'st-fernhill', ['blk-05'], ['blk-08']),
      block('blk-07', 7, 'Fernhill Loop', 'loop', 'mod-fernhill', 'st-fernhill', ['blk-05'], ['blk-08']),
      block('blk-08', 8, 'Fernhill East Approach', 'approach', 'mod-fernhill', null, ['blk-06', 'blk-07'], ['blk-09']),
      block('blk-09', 9, 'Single Line East', 'plain', 'mod-east', null, ['blk-08'], ['blk-10']),
      block('blk-10', 10, 'Tarn Approach', 'approach', 'mod-tarn', null, ['blk-09'], ['blk-11', 'blk-12']),
      block('blk-11', 11, 'Tarn Head Road', 'plain', 'mod-tarn', 'st-tarn', ['blk-10'], []),
      block('blk-12', 12, 'Tarn Head Loop', 'loop', 'mod-tarn', 'st-tarn', ['blk-10'], []),
    ],
    stations: [
      { id: 'st-wren', name: 'Wren Quay', block_ids: ['blk-01', 'blk-02'] },
      { id: 'st-fernhill', name: 'Fernhill', block_ids: ['blk-06', 'blk-07'] },
      { id: 'st-tarn', name: 'Tarn Head', block_ids: ['blk-11', 'blk-12'] },
    ],
    turnouts: [
      { id: 'T1', stem_block_id: 'blk-03', normal_block_id: 'blk-01', reverse_block_id: 'blk-02' },
      { id: 'T2', stem_block_id: 'blk-05', normal_block_id: 'blk-06', reverse_block_id: 'blk-07' },
      { id: 'T3', stem_block_id: 'blk-08', normal_block_id: 'blk-06', reverse_block_id: 'blk-07' },
      { id: 'T4', stem_block_id: 'blk-10', normal_block_id: 'blk-11', reverse_block_id: 'blk-12' },
    ],
    trains: [
      {
        id: 't101',
        number: '101',
        name: 'Wren Quay Pickup',
        direction: 'east',
        speed_mph: 40,
        length_mm: 1200,
        start_block_id: 'blk-01',
        start_head_offset_mm: 2800,
      },
      {
        id: 't202',
        number: '202',
        name: 'Tarn Head Mixed',
        direction: 'west',
        speed_mph: 40,
        length_mm: 1200,
        start_block_id: 'blk-11',
        start_head_offset_mm: 2800,
      },
      {
        id: 't303',
        number: '303',
        name: 'Fernhill Shuttle',
        direction: 'east',
        speed_mph: 25,
        length_mm: 900,
        start_block_id: 'blk-02',
        start_head_offset_mm: 2800,
      },
    ],
    timetable: {
      version: timetableVersion,
      entries: [
        { id: 'tt-1', train_id: 't101', station_id: 'st-wren', depart_fast_seconds: 720 },
        { id: 'tt-2', train_id: 't101', station_id: 'st-fernhill', depart_fast_seconds: 1500 },
        { id: 'tt-3', train_id: 't101', station_id: 'st-tarn', depart_fast_seconds: 2400 },
        { id: 'tt-4', train_id: 't202', station_id: 'st-tarn', depart_fast_seconds: 720 },
        { id: 'tt-5', train_id: 't202', station_id: 'st-fernhill', depart_fast_seconds: 1500 },
        { id: 'tt-6', train_id: 't202', station_id: 'st-wren', depart_fast_seconds: 2400 },
        { id: 'tt-7', train_id: 't303', station_id: 'st-wren', depart_fast_seconds: 900 },
        { id: 'tt-8', train_id: 't303', station_id: 'st-fernhill', depart_fast_seconds: 1800 },
      ],
    },
  };

  recomputeBlockLengths(content);
  return content;
}
