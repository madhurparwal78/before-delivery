// Quotes in integer euro cents with half-even rounding at the published stages (DP-19).

const FACTOR_PERMILLE: { [days: number]: number } = {
  1: 1000,
  2: 1800,
  3: 2500,
  4: 3100,
  5: 3600,
  6: 4100,
  7: 4600,
};

export function factorPermille(days: number): number {
  const factor = FACTOR_PERMILLE[days];
  return factor ?? 0;
}

// Net cents = the desk's day rate x factor / 1000, rounded half-even once.
export function netCents(dayRateCents: number, days: number): number {
  const factor = factorPermille(days);
  const product = BigInt(dayRateCents) * BigInt(factor);
  return Number(roundHalfEvenBig(product, 1000n));
}

// VAT is 21% of net, rounded half-even once. Total = net + VAT.
export function vatCents(net: number): number {
  const product = BigInt(net) * 21n;
  return Number(roundHalfEvenBig(product, 100n));
}

export function totalCents(net: number, vat: number): number {
  return net + vat;
}

function roundHalfEvenBig(value: bigint, divisor: bigint): bigint {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const half = divisor / 2n;
  let rounded = quotient;
  if (remainder > half || (remainder === half && quotient % 2n === 1n)) rounded = quotient + 1n;
  return negative ? -rounded : rounded;
}

// Derating: effective output falls linearly from rated lumens to 50% at the model's
// rated hours and stays there (DP-17).
export function deratedLumens(ratedLumens: number, loggedHours: bigint, ratedHours: number): number {
  if (ratedHours <= 0) return ratedLumens;
  if (loggedHours <= 0n) return ratedLumens;
  if (loggedHours >= BigInt(ratedHours)) return Math.floor(ratedLumens / 2);
  // effective = rated - rated * hours / (2 * ratedHours), truncated to whole lumens
  const lossNumerator = BigInt(ratedLumens) * loggedHours;
  const lossDenominator = 2n * BigInt(ratedHours);
  const loss = lossNumerator / lossDenominator;
  return ratedLumens - Number(loss);
}
