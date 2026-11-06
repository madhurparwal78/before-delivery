// The published fee-quote rule, applied identically wherever a firing fee appears.
// Rounded dimensions are kept as integer half-inches; cubic inches as integer
// eighths (every product of half-inch values is a multiple of 1/8).

export type RoundedDims = { lengthHalf: number; widthHalf: number; heightHalf: number };

// Round one dimension up to the next multiple of 0.5 in.
export function roundHalfInches(value: number): number {
  return Math.ceil(value * 2 - 1e-9);
}

export function roundDims(length: number, width: number, height: number): RoundedDims {
  return { lengthHalf: roundHalfInches(length), widthHalf: roundHalfInches(width), heightHalf: roundHalfInches(height) };
}

// Cubic inches of rounded dims, in eighths.
export function cubicEighths(d: RoundedDims): number {
  return d.lengthHalf * d.widthHalf * d.heightHalf;
}

export function cubicInchesValue(d: RoundedDims): number {
  return cubicEighths(d) / 8;
}

// Fee in cents = cubic inches x rate cents, rounded once per piece, halves up.
export function feeCents(cubicE: number, rateCents: number): number {
  const total = cubicE * rateCents * 2;
  return Math.floor((total + 8) / 16);
}

// Footprint of a deck in quarter square inches (rounded length x rounded width).
export function footprintQuarters(d: RoundedDims): number {
  return d.lengthHalf * d.widthHalf;
}

// Footprint percent, one decimal, halves rounding up:
// pct10 = round_half_up(quarters / 4 / area * 100 * 10) = round_half_up(quarters * 250 / area)
export function footprintPct(quarters: number, areaSqIn: number): number {
  const num = quarters * 250;
  return Math.floor((num * 2 + areaSqIn) / (2 * areaSqIn)) / 10;
}

export function footprintPctExact(quarters: number, areaSqIn: number): number {
  return (quarters * 250) / areaSqIn;
}
