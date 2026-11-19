// The hall's fixed seat catalogue: sections, rows, seat ids, labels and sightline geometry.
// One coordinate system (cell units, origin at the centre of the stage lip, y towards the seats)
// draws the seat map and, scaled to metres, gives each seat's angle and distance.

export type SectionCode = "ST" | "CI" | "BA";

interface Section {
  code: SectionCode;
  name: string;
  rows: string[];
  /** Physical depth added behind the stage lip, in cells, and the tier's height above the stalls floor in metres. */
  depthCells: number;
  elevationM: number;
}

export interface HallSeat {
  id: string;
  section: SectionCode;
  row: string;
  number: number;
  label: string;
  ordinal: number;
  /** Seat centre on the drawing, in cells. */
  x: number;
  y: number;
  offCentreDeg: number;
  stageDistanceM: number;
}

const letters = (count: number): string[] => Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));

export const SECTION: Readonly<Record<SectionCode, Section>> = {
  ST: { code: "ST", name: "Stalls", rows: letters(16), depthCells: 0, elevationM: 0 },
  CI: { code: "CI", name: "Circle", rows: letters(8), depthCells: 17, elevationM: 10 },
  BA: { code: "BA", name: "Balcony", rows: letters(6), depthCells: 26, elevationM: 17 },
};

/** Stalls, Circle, Balcony: the seat order and the Page Up / Page Down order. */
export const SECTIONS: readonly Section[] = [SECTION.ST, SECTION.CI, SECTION.BA];

const SEATS_PER_ROW = 30;
const CENTRE_SEAT = 15;
const FIRST_ROW_RADIUS = 11;
/** Half the width of the stage lip, in cells. */
export const LIP_HALF_WIDTH = 8;
export const STAGE_DEPTH = 2.4;
const METRES_PER_CELL = 0.6;

function seatLabel(sectionName: string, row: string, number: number): string {
  return `${sectionName} row ${row} seat ${number}`;
}

/** Radius of a row's arc on the drawing, in cells: row A at 11, each row one cell farther out. */
export function rowRadius(rowIndex: number): number {
  return FIRST_ROW_RADIUS + rowIndex;
}

/** Angle of a seat position from the centre line, in radians; seats sit one cell apart along their arc. */
export function seatAngle(rowIndex: number, number: number): number {
  return (number - (CENTRE_SEAT + 0.5)) / rowRadius(rowIndex);
}

function distanceToLip(x: number, y: number): number {
  const nearestX = Math.max(-LIP_HALF_WIDTH, Math.min(LIP_HALF_WIDTH, x));
  return Math.hypot(x - nearestX, y);
}

function buildSeats(): HallSeat[] {
  const seats: HallSeat[] = [];
  for (const section of SECTIONS) {
    section.rows.forEach((row, rowIndex) => {
      const radius = rowRadius(rowIndex);
      for (let number = 1; number <= SEATS_PER_ROW; number += 1) {
        const theta = seatAngle(rowIndex, number);
        const x = radius * Math.sin(theta);
        const y = radius * Math.cos(theta);
        const reach = (radius + section.depthCells) / radius;
        const planarM = distanceToLip(x * reach, y * reach) * METRES_PER_CELL;
        const degrees = Math.round((theta * 180) / Math.PI);
        seats.push({
          id: `${section.code}-${row}-${number}`,
          section: section.code,
          row,
          number,
          label: seatLabel(section.name, row, number),
          ordinal: seats.length,
          x,
          y,
          offCentreDeg: degrees + 0,
          stageDistanceM: Math.round(Math.hypot(planarM, section.elevationM) * 10) / 10,
        });
      }
    });
  }
  return seats;
}

export const HALL_SEATS: readonly HallSeat[] = buildSeats();
const BY_ID = new Map(HALL_SEATS.map((seat) => [seat.id, seat]));

/** A seat named by a request or an address, which may not exist. */
export function hallSeat(id: string): HallSeat | undefined {
  return BY_ID.get(id);
}

/** A seat id the database or the catalogue itself holds, which always exists. */
export function seatById(id: string): HallSeat {
  return BY_ID.get(id) as HallSeat;
}

/** Seat order: Stalls, Circle, Balcony; then row; then seat number. */
export function bySeatOrder(a: string, b: string): number {
  return (BY_ID.get(a)?.ordinal ?? 0) - (BY_ID.get(b)?.ordinal ?? 0);
}
