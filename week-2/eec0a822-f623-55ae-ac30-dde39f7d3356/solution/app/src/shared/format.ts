// Display formats (brief: Business rules, Display formats), used on every screen and in every mail.
import { roundDecimalText, plainDecimal } from "./money";
import { BASE_NAMES, localParts, weekday, type Base } from "./zones";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Sat 3 Jul 2027` */
export function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${DAYS[weekday(date)]} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** `Sat 27 Mar`, the rota day tab label. */
export function formatTabDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${DAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}`;
}

/** `Sat 3 Jul 2027, 17:00 Split time`: the minute rounded down, in the named base. */
export function formatTime(instant: string, base: Base = "split"): string {
  const p = localParts(Date.parse(instant), base);
  const date = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return `${formatDay(date)}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ${BASE_NAMES[base]} time`;
}

/** `24.4 m – 80 ft 1 in` from whole centimetres. */
export function formatFigure(cm: number): string {
  const tenths = (cm + 5 - ((cm + 5) % 10)) / 10;
  const metres = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  const inches = Math.floor((cm * 100 * 2 + 254) / (254 * 2));
  return `${metres} m – ${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

/** `12.3 nm` from a full-precision distance, rounded half up on its decimal value. */
export function formatDistance(nm: number): string {
  return `${roundDecimalText(plainDecimal(nm), 1)} nm`;
}

/** `6.0 kn` */
export function formatSpeed(kn: number): string {
  return `${kn.toFixed(1)} kn`;
}
