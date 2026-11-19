export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

export function roundHalfUpDiv(numerator: number, denominator: number): number {
  return roundHalfUp((numerator * 2) / denominator) / 2;
}

export function lineTotalCents(quantity: number, unitPriceMilli: number): number {
  return roundHalfUp((quantity * unitPriceMilli) / 10);
}

export function vatCents(lineTotal: number, vatRate: number): number {
  return roundHalfUp((lineTotal * vatRate) / (100 + vatRate));
}

export function milliToCents(value: number): number {
  return value / 10;
}

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${wholeText},${String(rest).padStart(2, "0")} €`;
}
