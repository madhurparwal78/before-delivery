/**
 * Deck post heights, deck heights, headroom, footprint and load value, decided only here.
 *
 * Heights are held as integer eighths of an inch and footprints as integer quarters of a
 * square inch, because rounded dimensions are always multiples of half an inch.
 */

const CLEARANCE_EIGHTHS = 4; // 0.5 in above the tallest piece
const SHELF_EIGHTHS = 5; // 0.625 in of shelf
export const FOOTPRINT_LIMIT_PCT = 85;

export interface DeckPiece {
  readonly roundedLengthHalves: number;
  readonly roundedWidthHalves: number;
  readonly roundedHeightHalves: number;
}

export interface DeckGeometry {
  readonly postHeightEighths: number;
  readonly deckHeightEighths: number;
  readonly footprintQuarters: number;
}

export function deckGeometry(pieces: readonly DeckPiece[]): DeckGeometry {
  let tallest = 0;
  let footprint = 0;
  for (const piece of pieces) {
    const heightEighths = piece.roundedHeightHalves * 4;
    if (heightEighths > tallest) tallest = heightEighths;
    footprint += piece.roundedLengthHalves * piece.roundedWidthHalves;
  }
  const post = pieces.length === 0 ? 0 : tallest + CLEARANCE_EIGHTHS;
  return {
    postHeightEighths: post,
    deckHeightEighths: post + SHELF_EIGHTHS,
    footprintQuarters: footprint,
  };
}

export function headroomEighths(
  stackHeightEighths: number,
  decks: readonly DeckGeometry[],
): number {
  let used = 0;
  for (const deck of decks) used += deck.deckHeightEighths;
  return stackHeightEighths - used;
}

export function inchesFromEighths(eighths: number): number {
  return eighths / 8;
}

export function sqInchesFromQuarters(quarters: number): number {
  return quarters / 4;
}

/** Footprint percent to one decimal, halves rounding up, as an integer count of tenths. */
export function footprintPctTenths(footprintQuarters: number, shelfAreaTenths: number): number {
  return Math.floor((footprintQuarters * 5000 + shelfAreaTenths) / (2 * shelfAreaTenths));
}

export function footprintPct(footprintQuarters: number, shelfAreaTenths: number): number {
  return footprintPctTenths(footprintQuarters, shelfAreaTenths) / 10;
}

/** The exact percent test: over 85 is refused, exactly 85 is allowed. */
export function footprintOverLimit(footprintQuarters: number, shelfAreaTenths: number): boolean {
  return footprintQuarters * 250 > FOOTPRINT_LIMIT_PCT * shelfAreaTenths;
}

export function formatHeadroom(eighths: number): string {
  return inchesFromEighths(eighths).toFixed(3);
}

export function formatPct(tenths: number): string {
  return (tenths / 10).toFixed(1);
}
