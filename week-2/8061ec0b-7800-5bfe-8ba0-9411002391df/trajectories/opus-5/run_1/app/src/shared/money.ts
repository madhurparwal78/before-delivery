/** Every computed money line is rounded once, to the cent, half up, with exact integer arithmetic. */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return Number(negative ? -rounded : rounded);
}

export function taxOn(amountCents: number, taxRateBp: number): number {
  return roundHalfUp(BigInt(amountCents) * BigInt(taxRateBp), 10000n);
}

export function percentOf(amountCents: number, percent: number): number {
  return roundHalfUp(BigInt(amountCents) * BigInt(percent), 100n);
}

export interface PaymentSplit {
  base_rent_cents: number;
  waiver_cents: number;
  tax_cents: number;
}

/** Splits a charged amount into base rent, waiver and tax from the monthly figures. */
export function splitPayment(
  amountCents: number,
  monthlyBaseRentCents: number,
  monthlyWaiverCents: number,
  taxRateBp: number,
): PaymentSplit {
  const w = monthlyWaiverCents;
  const t = taxOn(monthlyBaseRentCents + w, taxRateBp);
  const total = monthlyBaseRentCents + w + t;
  const taxPart = roundHalfUp(BigInt(amountCents) * BigInt(t), BigInt(total));
  const waiverPart = roundHalfUp(BigInt(amountCents) * BigInt(w), BigInt(total));
  return {
    tax_cents: taxPart,
    waiver_cents: waiverPart,
    base_rent_cents: amountCents - taxPart - waiverPart,
  };
}

export function termMonths(purchasePriceCents: number, baseRentCents: number): number {
  return Math.ceil(purchasePriceCents / baseRentCents);
}

export function contractMonthOf(equityCents: number, baseRentCents: number): number {
  return Math.floor(equityCents / baseRentCents);
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString();
  const pennies = (abs % 100).toString().padStart(2, '0');
  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${pennies}`;
}

/** Bare amount without the dollar sign, for copy that writes "$<amount>" itself. */
export function formatAmount(cents: number): string {
  return formatMoney(cents).replace('$', '');
}

export function formatTaxPercent(taxRateBp: number): string {
  const whole = Math.floor(taxRateBp / 100);
  const fraction = (taxRateBp % 100).toString().padStart(2, '0');
  return `${whole}.${fraction}%`;
}
