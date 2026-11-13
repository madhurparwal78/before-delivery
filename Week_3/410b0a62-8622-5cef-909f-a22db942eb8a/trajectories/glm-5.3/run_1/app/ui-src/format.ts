import { fmtForm, fmtTss, fmtIf, fmtDuration, fmtPace, roundHalfAwayFromZero } from './domain.js';

export {
  fmtForm,
  fmtTss,
  fmtIf,
  fmtDuration,
  fmtPace,
  roundHalfAwayFromZero,
};

export function dataAttr(value: number, decimals: number): string {
  const rounded = roundHalfAwayFromZero(value, decimals);
  return rounded.toFixed(decimals);
}

export function fmtTssAttr(value: number): string {
  return dataAttr(value, 1);
}

export function fmtFormAttr(value: number): string {
  const rounded = roundHalfAwayFromZero(value, 1);
  return rounded === 0 ? '0.0' : (rounded > 0 ? rounded.toFixed(1) : (-rounded).toFixed(1));
}

export function formSigned(value: number): string {
  const rounded = roundHalfAwayFromZero(value, 1);
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `\u2212${Math.abs(rounded).toFixed(1)}`;
}

export function fmtDurationAttr(seconds: number): string {
  return String(Math.round(seconds));
}

export function fmtNpW(value: number): string {
  return `${Math.round(value)} W`;
}

export function dayLabel(date: string, long = false): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const wd = names[dt.getUTCDay()]!;
  const mon = months[dt.getUTCMonth()]!;
  return long ? `${wd} ${d} ${mon} ${y}` : `${wd} ${d} ${mon}`;
}

export function mondayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dt.getUTCDate()} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
