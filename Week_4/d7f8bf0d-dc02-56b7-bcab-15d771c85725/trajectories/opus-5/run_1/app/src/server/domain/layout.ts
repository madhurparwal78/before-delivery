import type {
  BlockContent,
  LayoutContent,
  LayoutCounts,
  ModuleContent,
  OpenEnd,
  PieceExit,
  PieceInput,
  Pose,
  StoredPiece,
} from '../../shared/protocol.js';
import { branchPose, endPose, pieceLengthMm } from '../../shared/geometry.js';
import { canonicalHash, newId } from './hash.js';

export function emptyContent(): LayoutContent {
  return {
    modules: [],
    blocks: [],
    stations: [],
    turnouts: [],
    trains: [],
    timetable: { version: 0, entries: [] },
  };
}

function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Every array but `pieces` is sorted by id. */
export function sortContent(content: LayoutContent): LayoutContent {
  return {
    modules: byId(content.modules).map((module) => ({
      ...module,
      open_ends: byId(module.open_ends),
    })),
    blocks: byId(content.blocks),
    stations: byId(content.stations),
    turnouts: byId(content.turnouts),
    trains: byId(content.trains),
    timetable: { version: content.timetable.version, entries: byId(content.timetable.entries) },
  };
}

export function contentHash(content: LayoutContent): string {
  return canonicalHash(sortContent(content));
}

export function countsOf(content: LayoutContent, trashSize: number): LayoutCounts {
  return {
    modules: content.modules.length,
    pieces: content.modules.reduce((total, module) => total + module.pieces.length, 0),
    blocks: content.blocks.length,
    trash: trashSize,
  };
}

function poseKey(pose: Pose): string {
  return `${pose.x_mm},${pose.y_mm},${pose.elevation_mm},${pose.heading_deg}`;
}

export function exitPose(piece: StoredPiece, exit: PieceExit): Pose {
  return exit === 'branch' ? branchPose(piece.start, piece) : piece.end;
}

export function parentOf(pieces: StoredPiece[], piece: StoredPiece): StoredPiece | null {
  if (!piece.from_piece_id) return null;
  return pieces.find((candidate) => candidate.id === piece.from_piece_id) ?? null;
}

/** Chain ancestors of a piece, oldest first. */
export function chainAncestors(pieces: StoredPiece[], piece: StoredPiece): StoredPiece[] {
  const ancestors: StoredPiece[] = [];
  let current = piece;
  for (let guard = 0; guard < pieces.length; guard += 1) {
    const parent = parentOf(pieces, current);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export function hasFollowers(pieces: StoredPiece[], piece: StoredPiece): boolean {
  return pieces.some((other) => other.from_piece_id === piece.id);
}

/** Which exit of which piece each open end sits on, read from the current poses. */
export function openEndExits(
  module: ModuleContent,
): Map<string, { pieceId: string; exit: PieceExit } | null> {
  const places = new Map<string, { pieceId: string; exit: PieceExit }>();
  for (const piece of module.pieces) {
    places.set(poseKey(piece.end), { pieceId: piece.id, exit: 'end' });
    if (piece.kind === 'turnout') {
      places.set(poseKey(exitPose(piece, 'branch')), { pieceId: piece.id, exit: 'branch' });
    }
  }
  return new Map(
    module.open_ends.map((end) => [
      end.id,
      places.get(poseKey({ ...end })) ?? null,
    ]),
  );
}

/** Lays a module's chains out again after a geometry edit, keeping open end ids. */
export function relayoutModule(module: ModuleContent): void {
  const attachments = openEndExits(module);
  const byId = new Map(module.pieces.map((piece) => [piece.id, piece]));
  for (const piece of module.pieces) {
    const parent = piece.from_piece_id ? byId.get(piece.from_piece_id) : undefined;
    if (parent) piece.start = exitPose(parent, piece.from_exit);
    piece.end = endPose(piece.start, piece);
  }
  for (const end of module.open_ends) {
    const place = attachments.get(end.id);
    if (!place) continue;
    const piece = byId.get(place.pieceId);
    if (!piece) continue;
    const pose = exitPose(piece, place.exit);
    end.x_mm = pose.x_mm;
    end.y_mm = pose.y_mm;
    end.elevation_mm = pose.elevation_mm;
    end.heading_deg = pose.heading_deg;
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function nextEndLabel(used: Iterable<string>): string {
  const taken = new Set(used);
  for (let index = 0; ; index += 1) {
    const label =
      index < LETTERS.length
        ? LETTERS[index]
        : `${LETTERS[Math.floor(index / LETTERS.length) - 1]}${LETTERS[index % LETTERS.length]}`;
    if (!taken.has(label)) return label;
  }
}

export function makeOpenEnd(label: string, pose: Pose): OpenEnd {
  return { id: newId('end'), label, ...pose };
}

export function buildPiece(
  input: PieceInput,
  start: Pose,
  blockId: string | null,
  addedBy: string,
  from: { piece_id: string | null; exit: PieceExit } = { piece_id: null, exit: 'end' },
  id = newId('pc'),
): StoredPiece {
  const base: StoredPiece = {
    id,
    kind: input.kind,
    length_mm: pieceLengthMm(input),
    rise_mm: input.rise_mm ?? 0,
    mainline: input.mainline ?? true,
    block_id: blockId,
    note: '',
    added_by: addedBy,
    from_piece_id: from.piece_id,
    from_exit: from.exit,
    start,
    end: start,
  };
  if (input.kind === 'curve') {
    base.radius_mm = input.radius_mm;
    base.angle_deg = input.angle_deg;
    base.hand = input.hand;
  }
  if (input.kind === 'turnout') {
    base.frog_number = input.frog_number;
    base.hand = input.hand;
  }
  base.end = endPose(start, base);
  return base;
}

/** Block lengths always equal the pieces assigned to them. */
export function recomputeBlockLengths(content: LayoutContent): void {
  const totals = new Map<string, number>();
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      if (!piece.block_id) continue;
      totals.set(piece.block_id, (totals.get(piece.block_id) ?? 0) + piece.length_mm);
    }
  }
  for (const block of content.blocks) {
    block.length_mm = totals.get(block.id) ?? 0;
  }
}

function addNeighbour(block: BlockContent, side: 'east' | 'west', otherId: string): void {
  const list = side === 'east' ? block.east_neighbour_ids : block.west_neighbour_ids;
  if (!list.includes(otherId)) list.push(otherId);
}

/**
 * A piece joint between two different blocks makes those blocks neighbours, with
 * the side taken from the heading at the joint.
 */
export function applyJointAdjacency(content: LayoutContent): void {
  const blocks = new Map(content.blocks.map((block) => [block.id, block]));
  for (const module of content.modules) {
    for (const child of module.pieces) {
      const parent = parentOf(module.pieces, child);
      if (!parent || !parent.block_id || !child.block_id) continue;
      if (parent.block_id === child.block_id) continue;
      const parentBlock = blocks.get(parent.block_id);
      const childBlock = blocks.get(child.block_id);
      if (!parentBlock || !childBlock) continue;
      const eastward = Math.cos((child.start.heading_deg * Math.PI) / 180) >= 0;
      addNeighbour(parentBlock, eastward ? 'east' : 'west', childBlock.id);
      addNeighbour(childBlock, eastward ? 'west' : 'east', parentBlock.id);
    }
  }
}

export function moduleOrigin(content: LayoutContent): Pose {
  return { x_mm: 0, y_mm: -1800 * (content.modules.length + 1), elevation_mm: 0, heading_deg: 0 };
}

export function makeModule(
  name: string,
  endplates: ModuleContent['endplates'],
  origin: Pose,
): ModuleContent {
  const entry = endplates[0];
  const offsets = entry.track_offsets_mm;
  const openEnds = offsets.map((offset, index) =>
    makeOpenEnd(offsets.length > 1 ? `${entry.end}${index + 1}` : entry.end, {
      x_mm: origin.x_mm,
      y_mm: origin.y_mm + offset,
      elevation_mm: origin.elevation_mm,
      heading_deg: origin.heading_deg,
    }),
  );
  return {
    id: newId('mod'),
    name,
    endplates,
    pieces: [],
    open_ends: openEnds,
    origin,
  };
}

export function nextBlockNumber(content: LayoutContent): number {
  return content.blocks.reduce((highest, block) => Math.max(highest, block.number), 0) + 1;
}

export function findModule(content: LayoutContent, moduleId: string): ModuleContent | undefined {
  return content.modules.find((module) => module.id === moduleId);
}

export function searchBlocks(content: LayoutContent, query: string): BlockContent[] {
  const needle = query.trim().toLowerCase();
  const matches = content.blocks.filter(
    (block) =>
      needle === '' ||
      block.name.toLowerCase().includes(needle) ||
      String(block.number).includes(needle),
  );
  return [...matches].sort((a, b) => a.number - b.number);
}
