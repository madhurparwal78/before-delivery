export type SectionCode = 'ST' | 'CI' | 'BA';

export interface SectionDefinition {
  readonly code: SectionCode;
  readonly name: string;
  readonly rows: readonly string[];
  /** Radius in metres from the stage-lip centre to the first row of the section. */
  readonly firstRowRadiusM: number;
  /** Extra radius in metres for each row farther from the stage. */
  readonly rowDepthM: number;
}

export const SEATS_PER_ROW = 30;

/** Half the width of the stage lip, in metres. */
export const STAGE_LIP_HALF_WIDTH_M = 6;

/** Angle in degrees between two neighbouring seats of a row, seen from the stage-lip centre. */
export const SEAT_ANGLE_STEP_DEG = 2.4;

function rowLetters(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

export const SECTIONS: readonly SectionDefinition[] = [
  { code: 'ST', name: 'Stalls', rows: rowLetters(16), firstRowRadiusM: 6, rowDepthM: 0.95 },
  { code: 'CI', name: 'Circle', rows: rowLetters(8), firstRowRadiusM: 24, rowDepthM: 1.1 },
  { code: 'BA', name: 'Balcony', rows: rowLetters(6), firstRowRadiusM: 35.5, rowDepthM: 0.5 },
];

export const SECTION_CODES: readonly SectionCode[] = SECTIONS.map((section) => section.code);

export function sectionByCode(code: SectionCode): SectionDefinition {
  const section = SECTIONS.find((candidate) => candidate.code === code);
  if (!section) throw new Error(`unknown section ${code}`);
  return section;
}

export function isSectionCode(value: string): value is SectionCode {
  return SECTION_CODES.includes(value as SectionCode);
}

export interface HallSeat {
  readonly id: string;
  readonly section: SectionCode;
  readonly sectionName: string;
  readonly row: string;
  readonly number: number;
  readonly label: string;
  /** Row index inside its section, 0 for the row nearest the stage. */
  readonly rowIndex: number;
  /** Exact angle from the hall centre line, negative at house left. */
  readonly angleDeg: number;
  /** Exact radius in metres from the stage-lip centre. */
  readonly radiusM: number;
  readonly offCentreDeg: number;
  readonly stageDistanceM: number;
}

function roundHalfUpAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function buildSeat(section: SectionDefinition, rowIndex: number, row: string, number: number): HallSeat {
  const angleDeg = (number - (SEATS_PER_ROW + 1) / 2) * SEAT_ANGLE_STEP_DEG;
  const radiusM = section.firstRowRadiusM + rowIndex * section.rowDepthM;
  const angleRad = (angleDeg * Math.PI) / 180;
  const acrossM = radiusM * Math.sin(angleRad);
  const awayM = radiusM * Math.cos(angleRad);
  const beyondLipM = Math.max(0, Math.abs(acrossM) - STAGE_LIP_HALF_WIDTH_M);
  const distanceM = Math.sqrt(beyondLipM * beyondLipM + awayM * awayM);
  return {
    id: `${section.code}-${row}-${number}`,
    section: section.code,
    sectionName: section.name,
    row,
    number,
    label: `${section.name} row ${row} seat ${number}`,
    rowIndex,
    angleDeg,
    radiusM,
    offCentreDeg: roundHalfUpAwayFromZero(angleDeg),
    stageDistanceM: Math.round(distanceM * 10) / 10,
  };
}

export const HALL_SEATS: readonly HallSeat[] = SECTIONS.flatMap((section) =>
  section.rows.flatMap((row, rowIndex) =>
    Array.from({ length: SEATS_PER_ROW }, (_, index) => buildSeat(section, rowIndex, row, index + 1)),
  ),
);

const seatsById = new Map(HALL_SEATS.map((seat) => [seat.id, seat]));
const seatOrder = new Map(HALL_SEATS.map((seat, index) => [seat.id, index]));

export function hallSeat(seatId: string): HallSeat | undefined {
  return seatsById.get(seatId);
}

export function seatLabel(seatId: string): string {
  return seatsById.get(seatId)?.label ?? seatId;
}

function rowIdOf(seat: HallSeat): string {
  return `${seat.section}-${seat.row}`;
}

export function seatsOfRowId(rowId: string): readonly HallSeat[] {
  return HALL_SEATS.filter((seat) => rowIdOf(seat) === rowId);
}

export function sortSeatIds(seatIds: readonly string[]): string[] {
  return [...seatIds].sort((a, b) => (seatOrder.get(a) ?? 0) - (seatOrder.get(b) ?? 0));
}

export function labelsInSeatOrder(seatIds: readonly string[]): string[] {
  return sortSeatIds(seatIds).map(seatLabel);
}
