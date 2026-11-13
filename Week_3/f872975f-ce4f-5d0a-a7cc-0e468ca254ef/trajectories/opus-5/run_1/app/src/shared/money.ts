import { MM3_PER_BOARD_FOOT_X1000 } from './constants';

/** Rounds a quotient of positive integers half up. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function volumeMm3(thicknessMm: number, widthMm: number, lengthMm: number): number {
  return thicknessMm * widthMm * lengthMm;
}

/** Board feet, rounded half up to two decimals and rendered as a string. */
export function boardFeet(volumeMm3Value: number | bigint): string {
  const volume = BigInt(volumeMm3Value);
  const hundredths = divideRoundHalfUp(volume * 100_000n, MM3_PER_BOARD_FOOT_X1000);
  const whole = hundredths / 100n;
  const rest = hundredths % 100n;
  return `${whole.toString()}.${rest.toString().padStart(2, '0')}`;
}

/** The price of a cut in whole cents, rounded half up exactly once. */
export function priceCents(thicknessMm: number, widthMm: number, takeMm: number, rateCents: number): number {
  const numerator = BigInt(thicknessMm) * BigInt(widthMm) * BigInt(takeMm) * BigInt(rateCents) * 1000n;
  return Number(divideRoundHalfUp(numerator, MM3_PER_BOARD_FOOT_X1000));
}

export interface InvoiceLineInput {
  label: string;
  length_mm: number;
}

export interface InvoiceLine {
  label: string;
  length_mm: number;
  amount_cents: number;
}

/**
 * Splits a price into one line per piece in proportion to length: floored cents, then the
 * remaining cents one each to the largest remainders, ties to the earlier piece.
 */
export function invoiceLines(price: number, pieces: InvoiceLineInput[]): InvoiceLine[] {
  const totalLength = pieces.reduce((sum, piece) => sum + piece.length_mm, 0);
  if (totalLength <= 0) return pieces.map((piece) => ({ ...piece, amount_cents: 0 }));
  const floors = pieces.map((piece) => Math.floor((price * piece.length_mm) / totalLength));
  const remainders = pieces.map((piece, index) => price * piece.length_mm - (floors[index] ?? 0) * totalLength);
  let left = price - floors.reduce((sum, value) => sum + value, 0);
  const order = pieces
    .map((_piece, index) => index)
    .sort((a, b) => (remainders[b] ?? 0) - (remainders[a] ?? 0) || a - b);
  const amounts = [...floors];
  for (const index of order) {
    if (left <= 0) break;
    amounts[index] = (amounts[index] ?? 0) + 1;
    left -= 1;
  }
  return pieces.map((piece, index) => ({ ...piece, amount_cents: amounts[index] ?? 0 }));
}
