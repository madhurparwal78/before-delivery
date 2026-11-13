import { DefectZone, boardLongestClearRun } from '../../shared/geometry';
import { boardFeet, priceCents, volumeMm3 } from '../../shared/money';
import { Queryable, rows } from '../db/pool';
import { RateBook } from './rates';

export type BoardStatus = 'tagged' | 'graded' | 'available' | 'held' | 'sold-whole' | 'cut';

export const OPEN_STATUSES: BoardStatus[] = ['tagged', 'graded', 'available', 'held'];
export const PUBLIC_STATUSES: BoardStatus[] = ['available', 'held'];

export function isOpen(status: BoardStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isRetired(status: BoardStatus): boolean {
  return status === 'cut' || status === 'sold-whole';
}

export function isPubliclyVisible(status: BoardStatus): boolean {
  return PUBLIC_STATUSES.includes(status);
}

export interface BoardRow {
  tag: string;
  species: string;
  grade: string | null;
  status: BoardStatus;
  lot_id: string;
  lot_name: string;
  lot_origin: string;
  lot_built_year: number;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  defects: DefectZone[];
  parent_tag: string | null;
  from_cut: boolean;
  cut_ticket_id: string | null;
  created_at: Date;
}

const BOARD_COLUMNS = `
  b.tag, b.species, b.grade, b.status, b.lot_id, b.length_mm, b.width_mm, b.thickness_mm,
  b.defects, b.parent_tag, b.from_cut, b.cut_ticket_id, b.created_at,
  l.name AS lot_name, l.origin AS lot_origin, l.built_year AS lot_built_year
`;

export async function loadBoard(client: Queryable, tag: string): Promise<BoardRow | null> {
  const found = await rows<BoardRow>(
    client,
    `SELECT ${BOARD_COLUMNS} FROM boards b JOIN lots l ON l.id = b.lot_id WHERE b.tag = $1`,
    [tag]
  );
  return found[0] ?? null;
}

export async function loadAllBoards(client: Queryable): Promise<BoardRow[]> {
  return rows<BoardRow>(client, `SELECT ${BOARD_COLUMNS} FROM boards b JOIN lots l ON l.id = b.lot_id ORDER BY b.tag`);
}

export interface BoardMoney {
  volume_mm3: number;
  board_feet: string;
  rate_cents: number | null;
  price_cents: number | null;
  longest_clear_mm: number;
}

/** The figures that follow from a board's size, grade and the rate in force. */
export function boardMoney(board: BoardRow, rates: RateBook): BoardMoney {
  const volume = volumeMm3(board.thickness_mm, board.width_mm, board.length_mm);
  const rate = board.grade === null || isRetired(board.status) ? null : rates.rateFor(board.species, board.grade);
  return {
    volume_mm3: volume,
    board_feet: boardFeet(volume),
    rate_cents: rate,
    price_cents: rate === null ? null : priceCents(board.thickness_mm, board.width_mm, board.length_mm, rate),
    longest_clear_mm: boardLongestClearRun(board)
  };
}

export interface BoardSummary extends BoardMoney {
  tag: string;
  species: string;
  grade: string | null;
  status: BoardStatus;
  lot: { id: string; name: string };
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  defects: DefectZone[];
  parent_tag: string | null;
}

export function defectShapes(zones: DefectZone[]): DefectZone[] {
  return zones.map((zone) => ({ kind: zone.kind, start_mm: zone.start_mm, end_mm: zone.end_mm }));
}

export function boardSummary(board: BoardRow, rates: RateBook): BoardSummary {
  const money = boardMoney(board, rates);
  return {
    tag: board.tag,
    species: board.species,
    grade: board.grade,
    status: board.status,
    lot: { id: board.lot_id, name: board.lot_name },
    length_mm: board.length_mm,
    width_mm: board.width_mm,
    thickness_mm: board.thickness_mm,
    volume_mm3: money.volume_mm3,
    board_feet: money.board_feet,
    rate_cents: money.rate_cents,
    price_cents: money.price_cents,
    longest_clear_mm: money.longest_clear_mm,
    defects: defectShapes(board.defects),
    parent_tag: board.parent_tag
  };
}

export interface PhotoShape {
  id: string;
  url: string;
  thumb_url: string;
  width: number;
  height: number;
}

export interface PhotoRow {
  id: string;
  width: number;
  height: number;
}

export function photoShape(photo: PhotoRow): PhotoShape {
  return {
    id: photo.id,
    url: `/api/photos/${photo.id}`,
    thumb_url: `/api/photos/${photo.id}/thumb`,
    width: photo.width,
    height: photo.height
  };
}

export async function loadPhotos(client: Queryable, tag: string): Promise<PhotoRow[]> {
  return rows<PhotoRow>(client, 'SELECT id, width, height FROM photos WHERE board_tag = $1 ORDER BY sequence', [tag]);
}

export function boardDetail(
  board: BoardRow,
  rates: RateBook,
  photos: PhotoRow[],
  myHold: unknown
): Record<string, unknown> {
  const summary = boardSummary(board, rates);
  return {
    tag: summary.tag,
    species: summary.species,
    grade: summary.grade,
    status: summary.status,
    lot: { id: board.lot_id, name: board.lot_name, origin: board.lot_origin, built_year: board.lot_built_year },
    length_mm: summary.length_mm,
    width_mm: summary.width_mm,
    thickness_mm: summary.thickness_mm,
    volume_mm3: summary.volume_mm3,
    board_feet: summary.board_feet,
    rate_cents: summary.rate_cents,
    price_cents: summary.price_cents,
    longest_clear_mm: summary.longest_clear_mm,
    defects: summary.defects,
    parent_tag: summary.parent_tag,
    photos: photos.map(photoShape),
    my_hold: myHold
  };
}

export async function nextBoardTag(client: Queryable): Promise<string> {
  const allocated = await rows<{ value: string }>(client, "SELECT nextval('board_tag_seq')::text AS value");
  const value = allocated[0]?.value;
  if (value === undefined) throw new Error('board tag was not allocated');
  return `KW-${value.padStart(4, '0')}`;
}
