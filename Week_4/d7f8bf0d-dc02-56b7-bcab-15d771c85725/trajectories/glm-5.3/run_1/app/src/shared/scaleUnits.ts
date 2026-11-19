/** Display helpers shared by server and web. */

/** Round halves up to the nearest integer. */
export function roundHalfUp(n: number): number {
  const f = Math.floor(n);
  const diff = n - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f + 1;
}

/** Inches display: nearest eighth, fraction reduced. */
export function mmToInches(mm: number): string {
  const eighths = Math.round((mm / 25.4) * 8);
  if (eighths === 0) return '0 in';
  const whole = Math.floor(eighths / 8);
  let num = eighths % 8;
  if (num === 0) return `${whole} in`;
  let den = 8;
  while (num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return whole > 0 ? `${whole} ${num}/${den} in` : `${num}/${den} in`;
}

export function mmToMm(mm: number): string {
  return `${Math.round(mm)} mm`;
}

export function displayLength(mm: number, units: 'in' | 'mm'): string {
  return units === 'in' ? mmToInches(mm) : mmToMm(mm);
}

export function displayGrade(tenths: number): string {
  return `${(tenths / 10).toFixed(1)}%`;
}

/** Fast clock label HH:MM:SS. */
export function fastClockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Parse a display length into stored integer millimetres. */
export function parseLengthToMm(text: string, units: 'in' | 'mm'): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (units === 'in') {
    if (!/^\d{1,4}(\.\d{1,3})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 25.4);
  }
  if (!/^\d{1,6}$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Elevation step accepts up to two decimals of a millimetre in mm mode. */
export function parseElevationStep(text: string, units: 'in' | 'mm'): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (units === 'in') {
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 25.4 * 100);
  }
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

export function displayElevationStep(hundredths: number, units: 'in' | 'mm'): string {
  if (units === 'in') return mmToInches(hundredths / 100);
  const mm = hundredths / 100;
  return Number.isInteger(mm) ? `${mm} mm` : mm.toFixed(2).replace(/0$/, '') + ' mm';
}
