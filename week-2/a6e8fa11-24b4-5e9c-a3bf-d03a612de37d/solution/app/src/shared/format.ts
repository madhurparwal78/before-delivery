// Display formats (Business rules · Display formats) and half-away-from-zero decimal rounding.
import { type CellValue, type NumberFormat, dateTextOfSerial, isError } from "./values.js";

interface Decimal {
  negative: boolean;
  digits: string; // all significant digits, no leading zeros except a single "0"
  point: number; // count of digits before the decimal point
}

/** The shortest round-trip decimal of `value` (as `String(value)`), unpacked without an exponent. */
function decimalOf(value: number): Decimal {
  const text = String(Math.abs(value));
  const [mantissa, exponentText] = text.split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fraction = ""] = mantissa.split(".");
  return { negative: value < 0 || Object.is(value, -0), digits: whole + fraction, point: whole.length + exponent };
}

function plainParts(d: Decimal): { whole: string; fraction: string } {
  let digits = d.digits;
  let point = d.point;
  if (point <= 0) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  } else if (point > digits.length) {
    digits = digits + "0".repeat(point - digits.length);
  }
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, "");
  return { whole, fraction: digits.slice(point) };
}

/** Rounds half away from zero to `places` decimals and returns the fixed text. */
function fixedFromDecimal(d: Decimal, places: number): string {
  const { whole, fraction } = plainParts(d);
  const kept = (fraction + "0".repeat(places)).slice(0, places);
  let body = whole + kept;
  if ((fraction[places] ?? "0") >= "5") {
    const chars = body.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] === "9") {
        chars[i] = "0";
        i--;
      } else {
        chars[i] = String(Number(chars[i]) + 1);
        break;
      }
    }
    body = (i < 0 ? "1" : "") + chars.join("");
  }
  const intLength = body.length - places;
  const text = places > 0 ? `${body.slice(0, intLength)}.${body.slice(intLength)}` : body;
  const zero = /^[0.]*$/.test(text);
  return d.negative && !zero ? `-${text}` : text;
}

function toFixedHalfAway(value: number, places: number): string {
  return fixedFromDecimal(decimalOf(value), places);
}

/** ROUND(x, digits) with digits possibly negative. */
export function roundHalfAway(value: number, digits: number): number {
  if (digits >= 0) return Number(toFixedHalfAway(value, digits));
  const scale = 10 ** -digits;
  return Number(toFixedHalfAway(value / scale, 0)) * scale;
}

function trimExponential(value: number): string {
  const [m, e] = value.toExponential(5).split("e");
  const mantissa = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
  const exp = Number(e);
  return `${mantissa}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** Up to 10 significant digits, trailing zeros trimmed. */
export function generalNumber(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e10 || magnitude < 1e-6) return trimExponential(value);
  return String(Number(value.toPrecision(10)));
}

function percent(value: number): string {
  const d = decimalOf(value);
  return `${fixedFromDecimal({ ...d, point: d.point + 2 }, 1)}%`;
}

export function formatNumber(value: number, format: NumberFormat): string {
  switch (format) {
    case "general":
      return generalNumber(value);
    case "0":
      return toFixedHalfAway(value, 0);
    case "0.0":
      return toFixedHalfAway(value, 1);
    case "0.00":
      return toFixedHalfAway(value, 2);
    case "0.000":
      return toFixedHalfAway(value, 3);
    case "0.0%":
      return percent(value);
    case "date":
      return dateTextOfSerial(value);
  }
}

/** The text a cell shows in the grid. */
export function displayOf(value: CellValue, format: NumberFormat): string {
  if (value === null) return "";
  if (isError(value)) return value.error;
  if (typeof value === "number") return formatNumber(value, format);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value;
}
