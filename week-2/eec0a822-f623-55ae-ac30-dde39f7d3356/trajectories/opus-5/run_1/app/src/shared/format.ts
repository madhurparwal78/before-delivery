export type BaseKey = 'split' | 'lavrio';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const BASE_LABELS: Record<BaseKey, string> = { split: 'Split', lavrio: 'Lavrio' };

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `Sat 3 Jul 2027` from a `YYYY-MM-DD` date. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatDayTab(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]}`;
}

/** `EUR 12,450.00` from integer minor units. */
export function formatMoney(minor: number | string, currency: string): string {
  const value = typeof minor === 'string' ? BigInt(minor) : BigInt(Math.trunc(minor));
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const units = absolute / 100n;
  const cents = absolute % 100n;
  const grouped = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${negative ? '-' : ''}${grouped}.${cents.toString().padStart(2, '0')}`;
}

/** Metres to one decimal, rounded half up on the stored centimetre value. */
export function metresOneDecimal(centimetres: number): string {
  const tenths = Math.floor((centimetres * 2 + 10) / 20);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

function inchesFromCentimetres(centimetres: number): number {
  return Math.floor((2 * centimetres * 100 + 254) / 508);
}

/** `18.3 m – 60 ft 0 in` from a stored centimetre measurement. */
export function formatMeasurement(centimetres: number): string {
  const inches = inchesFromCentimetres(centimetres);
  const feet = Math.floor(inches / 12);
  return `${metresOneDecimal(centimetres)} m – ${feet} ft ${inches % 12} in`;
}

export function centimetresFromMetres(metres: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(metres.trim());
  if (match === null) throw new Error(`Not a metre value: ${metres}`);
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const value = Number.parseInt(match[2], 10) * 100 + Number.parseInt(fraction, 10);
  return match[1] === '-' ? -value : value;
}

export function metresFromCentimetres(centimetres: number): string {
  return `${Math.floor(centimetres / 100)}.${pad2(centimetres % 100)}`;
}

export function formatDistance(nauticalMiles: number): string {
  return `${oneDecimal(nauticalMiles)} nm`;
}

export function formatSpeed(knots: number): string {
  return `${oneDecimal(knots)} kn`;
}

export function formatChargePct(percent: number): string {
  return `${percent}%`;
}

export function formatSolarKwh(wattHours: number): string {
  return `${oneDecimal(wattHours / 1000)} kWh`;
}

export function oneDecimal(value: number): string {
  const tenths = Math.round(value * 10 + Number.EPSILON * Math.abs(value) * 10);
  const negative = tenths < 0;
  const absolute = Math.abs(tenths);
  return `${negative ? '-' : ''}${Math.floor(absolute / 10)}.${absolute % 10}`;
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-GB')} bytes`;
}

