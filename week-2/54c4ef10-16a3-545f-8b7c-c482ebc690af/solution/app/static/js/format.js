// Display formats. Rounding is half away from zero on the shortest decimal form, as on the server.

const MINUS = '−';

function digitsOf(value, places) {
  const text = String(Math.abs(value));
  if (text.includes('e')) return (Math.round(Math.abs(value) * 10 ** places)).toString().padStart(places + 1, '0');
  const [whole, fraction = ''] = text.split('.');
  const padded = fraction.padEnd(places + 1, '0');
  let kept = BigInt(whole + padded.slice(0, places));
  if (padded[places] >= '5') kept += 1n;
  return kept.toString().padStart(places + 1, '0');
}

function plain(value, places) {
  const digits = digitsOf(value, places);
  return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/** Rounded number, as a string with exactly `places` decimals. */
export function fixed(value, places = 2) {
  if (value === null || value === undefined) return '—';
  const text = plain(value, places);
  return value < 0 && Number(text) !== 0 ? `-${text}` : text;
}

/** Signed figure: + for positive, the minus sign for negative, bare 0.00 when it rounds to zero. */
export function signed(value, places = 2) {
  if (value === null || value === undefined) return '—';
  const text = plain(value, places);
  if (Number(text) === 0) return text;
  return (value > 0 ? '+' : MINUS) + text;
}

export function signedWhole(value) {
  return value === 0 ? '0' : (value > 0 ? '+' : MINUS) + Math.abs(value);
}

/** Characters as code points, after trimming. */
export function characters(text) {
  return [...text.trim()].length;
}
