// Published numerals. Money is whole cents, depths whole millimetres, and
// rounding happens only where the brief publishes it.

export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

// Metres show two decimals: round the size of the millimetre value half up,
// then apply the sign.
export function mmToMetres(mm: number): string {
  const v = roundHalfUp((Math.abs(mm) / 1000) * 100) / 100;
  return `${mm < 0 && v !== 0 ? '-' : ''}${v.toFixed(2)}`;
}

export function mmToDraughtMetres(mm: number): string {
  return `${mm < 0 ? '-' : ''}${(Math.abs(mm) / 1000).toFixed(3)}`;
}

// Feet and inches: the size of the stored millimetres divided by 25.4, rounded
// half up to the nearest quarter inch.
export function mmToFeetInches(mm: number): string {
  const quarter = roundHalfUp((Math.abs(mm) / 25.4) * 4);
  const inches = Math.floor(quarter / 4);
  const quarterPart = quarter % 4;
  const ft = Math.floor(inches / 12);
  const inchPart = inches % 12;
  const frac = quarterPart === 0 ? '' : quarterPart === 1 ? '.25' : quarterPart === 2 ? '.5' : '.75';
  return `${mm < 0 ? '-' : ''}${ft} ft ${inchPart}${frac} in`;
}

// A clearance cell reads "1.14 m / 3 ft 9 in".
export function clearanceCell(mm: number): string {
  return `${mmToMetres(mm)} m / ${mmToFeetInches(mm)}`;
}

// A margin always shows its sign, even when it rounds to zero.
export function marginMetres(mm: number): string {
  const size = roundHalfUp(Math.abs(mm) / 10) / 100;
  return `${mm < 0 ? '-' : '+'}${size.toFixed(2)}`;
}

export function money(cents: number): string {
  // "$2,912.50" with a leading dollar sign.
  const size = Math.abs(cents);
  const whole = Math.floor(size / 100);
  const frac = String(size % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${frac}`;
}
