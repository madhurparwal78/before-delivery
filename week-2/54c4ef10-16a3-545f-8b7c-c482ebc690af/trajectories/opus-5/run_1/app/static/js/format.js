// Display formats: the published figures, rounded half away from zero.
export const MISSING = '—';
const MINUS = '\u2212';
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function roundHalfAway(value, digits) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded = Math.floor(Math.abs(scaled) + 0.5) * (scaled >= 0 ? 1 : -1);
  return rounded / factor;
}

function digitsOf(value, digits) {
  return Math.abs(roundHalfAway(value, digits)).toFixed(digits);
}

export function signed(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  const rounded = roundHalfAway(value, digits);
  const body = digitsOf(value, digits);
  if (Number(body) === 0) return body;
  return (rounded < 0 ? MINUS : '+') + body;
}

export function unsigned(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return digitsOf(value, digits);
}

export const density = (value) => unsigned(value, 2);
export const stops = (value) => signed(value, 2);
export const logH = (value) => signed(value, 2);
export const bias = (value) => signed(value, 1);
export const span = (value) => unsigned(value, 1);
export const exponent = (value) => unsigned(value, 2);

export function zone(label) {
  return label === null || label === undefined ? MISSING : label;
}

export function zoneLabel(index) {
  return index === null || index === undefined ? MISSING : ROMAN[index];
}

export function previewText(figures) {
  if (!figures) return MISSING;
  return `${stops(figures.stops)} stops · log H ${logH(figures.logH)}`;
}
