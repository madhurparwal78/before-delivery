import { SEATS_PER_ROW, sectionByCode, type SectionCode } from '../../shared/hall';

/** The map is drawn in these user units; the SVG scales them to the frame. */
export const MAP_WIDTH = 1000;
export const STAGE_X = 270;
export const STAGE_WIDTH = 460;
export const STAGE_TOP = 6;
export const STAGE_HEIGHT = 46;
/** The stage lip: the edge of the stage band that faces the seats. */
export const STAGE_LIP_Y = STAGE_TOP + STAGE_HEIGHT;
export const STAGE_LIP_LEFT_X = STAGE_X;
export const STAGE_LIP_RIGHT_X = STAGE_X + STAGE_WIDTH;

const FIRST_ROW_Y = 150;
const ROW_GAP = 40;
const ROW_BOTTOM_PADDING = 44;
/** How far a row's end seats bend back towards the stage, so rows read as concentric arcs. */
const ROW_ARC_RISE = 30;
const BASE_PITCH = 26;
const PITCH_GROWTH = 0.45;

export interface SeatPoint {
  readonly x: number;
  readonly y: number;
  readonly pitch: number;
}

function middleOffset(seatNumber: number): number {
  return seatNumber - (SEATS_PER_ROW + 1) / 2;
}

export function seatPitch(rowIndex: number): number {
  return BASE_PITCH + PITCH_GROWTH * rowIndex;
}

export function seatPoint(rowIndex: number, seatNumber: number): SeatPoint {
  const pitch = seatPitch(rowIndex);
  const offset = middleOffset(seatNumber);
  const across = offset * pitch;
  const edgeShare = (offset / ((SEATS_PER_ROW - 1) / 2)) ** 2;
  return {
    x: MAP_WIDTH / 2 + across,
    y: FIRST_ROW_Y + rowIndex * ROW_GAP - ROW_ARC_RISE * edgeShare,
    pitch,
  };
}

export function mapHeight(section: SectionCode): number {
  const rows = sectionByCode(section).rows.length;
  return FIRST_ROW_Y + (rows - 1) * ROW_GAP + ROW_BOTTOM_PADDING;
}

export function rowArcPath(rowIndex: number): string {
  const first = seatPoint(rowIndex, 1);
  const middle = seatPoint(rowIndex, (SEATS_PER_ROW + 1) / 2);
  const last = seatPoint(rowIndex, SEATS_PER_ROW);
  const controlY = middle.y + (middle.y - first.y);
  return `M ${first.x} ${first.y} Q ${MAP_WIDTH / 2} ${controlY} ${last.x} ${last.y}`;
}
