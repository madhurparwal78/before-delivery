'use strict';

// Integer cents only; no floating-point arithmetic touches money.

function centsToPlainDollars(cents) {
  const value = Number(cents);
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fraction = abs - whole * 100;
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

function centsToGroupedDollars(cents) {
  const value = Number(cents);
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fraction = abs - whole * 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(fraction).padStart(2, '0')}`;
}

// Exact half-up rounding of an integer-scaled product, without floating point.
function multiplyRateHalfUp(amountCents, rateNumerator, rateDenominator) {
  const product = BigInt(amountCents) * BigInt(rateNumerator);
  const denominator = BigInt(rateDenominator);
  const quotient = product / denominator;
  const remainder = product % denominator;
  return Number(remainder * 2n >= denominator ? quotient + 1n : quotient);
}

// One percent of an amount, rounded half up.
function onePercentHalfUp(amountCents) {
  return multiplyRateHalfUp(amountCents, 1, 100);
}

module.exports = { centsToPlainDollars, centsToGroupedDollars, multiplyRateHalfUp, onePercentHalfUp };
