export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

function fixed(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  const units = Math.floor(value / scale);
  const rest = value - units * scale;
  return decimals === 0 ? String(units) : `${units}.${String(rest).padStart(decimals, '0')}`;
}

/** Metres from whole millimetres: the size is rounded half up, then the sign applied. */
export function metresFromMm(mm: number, decimals = 2): string {
  const scale = 10 ** (3 - decimals);
  const magnitude = roundHalfUp(Math.abs(mm) / scale);
  return `${mm < 0 ? '-' : ''}${fixed(magnitude, decimals)}`;
}

/** A margin always shows a sign taken from its stored value, even when it rounds to zero. */
export function marginFromMm(mm: number): string {
  const magnitude = roundHalfUp(Math.abs(mm) / 10);
  return `${mm < 0 ? '-' : '+'}${fixed(magnitude, 2)}`;
}

export function draughtMetresFromMm(mm: number): string {
  return metresFromMm(mm, 3);
}

/** Feet and inches at 25.4 mm to the inch, rounded half up to the nearest quarter inch. */
export function feetInchesFromMm(mm: number): string {
  const quarters = roundHalfUp(Math.abs(mm) / 25.4 / 0.25);
  const feet = Math.floor(quarters / 48);
  const inchQuarters = quarters - feet * 48;
  const whole = Math.floor(inchQuarters / 4);
  const fraction = inchQuarters - whole * 4;
  const inches = fraction === 0 ? String(whole) : `${whole}.${fraction * 25}`;
  return `${mm < 0 ? '-' : ''}${feet} ft ${inches} in`;
}

/** A clearance cell reads, for example, "1.14 m / 3 ft 9 in". */
export function clearanceCell(mm: number): string {
  return `${metresFromMm(mm)} m / ${feetInchesFromMm(mm)}`;
}

/** Whole dollars grouped in threes, a point, then exactly two decimals. */
export function moneyFromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const magnitude = Math.abs(cents);
  const dollars = Math.floor(magnitude / 100);
  const rest = magnitude - dollars * 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${String(rest).padStart(2, '0')}`;
}

export function draughtMmFromMetres(metres: number): number {
  return roundHalfUp(metres * 1000);
}

/** Feet and inches convert at 25.4 mm to the inch, dropping any fraction of a millimetre. */
export function draughtMmFromFeetInches(feet: number, inches: number): number {
  return Math.floor((feet * 12 + inches) * 25.4);
}

/** The billed draft foot is the stored millimetres divided by 304.8, rounded up once. */
export function billedDraftFeet(draughtMm: number): number {
  return Math.ceil(draughtMm / 304.8);
}
