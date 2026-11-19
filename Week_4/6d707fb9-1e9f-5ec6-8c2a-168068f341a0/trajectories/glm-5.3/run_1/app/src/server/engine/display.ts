import { abs, add, cmp, divRound, isZero, mul, roundHalfUp, sub } from "./decimal.js";

/** Group a whole number with commas: 1240 -> "1,240". */
export function groupInt(n: string): string {
  const neg = n.startsWith("-");
  const body = neg ? n.slice(1) : n;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${grouped}` : grouped;
}

const SUPER: Record<string, string> = {
  "0": "\u2070",
  "1": "\u00B9",
  "2": "\u00B2",
  "3": "\u00B3",
  "4": "\u2074",
  "5": "\u2075",
  "6": "\u2076",
  "7": "\u2077",
  "8": "\u2078",
  "9": "\u2079",
  "-": "\u207B",
};

function superscript(n: number): string {
  return String(n)
    .split("")
    .map((c) => SUPER[c] ?? c)
    .join("");
}

interface Split {
  digits: string; // digits from the first non-zero
  exp: number; // base-10 exponent of the first significant digit
}

function splitMag(mag: string): Split | null {
  const dot = mag.indexOf(".");
  const intStr = dot === -1 ? mag : mag.slice(0, dot);
  const fracStr = dot === -1 ? "" : mag.slice(dot + 1);
  const all = `${intStr}${fracStr}` || "0";
  const first = all.search(/[1-9]/);
  if (first === -1) return null;
  return { digits: all.slice(first), exp: intStr.length - first - 1 };
}

/**
 * The display rule: every figure shows 3 significant figures, half up on the exact value,
 * with comma grouping. Trailing zeros stay. Exactly 0 shows "0". A value under 0.001 shows
 * "d.dd × 10⁻ⁿ" with superscript digits. The single place a figure is formatted.
 */
export function showSig(v: string): string {
  if (isZero(v)) return "0";
  const neg = v.startsWith("-");
  const mag = neg ? v.slice(1) : v;
  const sp = splitMag(mag);
  if (!sp) return "0";
  const { digits, exp } = sp;

  if (exp <= -4) {
    // value under 0.001: mantissa of 3 significant digits × 10^exp
    const keep = digits.slice(0, 3).padEnd(3, "0");
    const rest = digits.slice(3);
    const bump = rest.length > 0 && rest.charCodeAt(0) - 48 >= 5;
    let kept = keep;
    let mantExp = exp;
    if (bump) {
      const bumped = add(keep, "1");
      if (bumped.length > keep.length) {
        kept = "100";
        mantExp = exp + 1;
      } else {
        kept = bumped.padEnd(3, "0");
      }
    }
    const mant = `${kept[0]}.${kept.slice(1)}`;
    return `${neg ? "-" : ""}${mant} \u00D7 10${superscript(mantExp)}`;
  }

  const keep = digits.slice(0, 3).padEnd(3, "0");
  const rest = digits.slice(3);
  const bump = rest.length > 0 && rest.charCodeAt(0) - 48 >= 5;
  let kept = keep;
  let expOut = exp;
  if (bump) {
    const bumped = add(keep, "1");
    if (bumped.length > keep.length) {
      kept = "100";
      expOut = exp + 1;
    } else {
      kept = bumped.padEnd(3, "0");
    }
  }
  if (expOut >= kept.length - 1) {
    const ip = kept.padEnd(expOut + 1, "0");
    return `${neg ? "-" : ""}${groupInt(ip)}`;
  }
  if (expOut >= 0) {
    return `${neg ? "-" : ""}${groupInt(kept.slice(0, expOut + 1))}.${kept.slice(expOut + 1)}`;
  }
  return `${neg ? "-" : ""}0.${"0".repeat(-expOut - 1)}${kept}`;
}

/** Stage / measure figure with no unit, e.g. "2.20". */
export function shownFigure(v: string): string {
  return showSig(v);
}

/** Total with unit, e.g. "2.20 kg CO₂e". */
export function shownTotal(v: string, unit: string): string {
  return `${showSig(v)} ${unit}`;
}

/** Mass half up to 0.1 g, e.g. 247.25 → "247.3 g". */
export function shownMass(v: string): string {
  return `${roundHalfUp(v, 1)} g`;
}

/** Half-up share of a part in a total, in percent with one decimal. */
export function percentOf(part: string, total: string): string {
  if (isZero(total)) return "0.0";
  return roundHalfUp(divRound(mul(part, "100"), total, 2), 1);
}

/** Difference copy: true minus sign or explicit plus, 3 sig figs on the magnitude, whole percent of the baseline. */
export function shownDifference(diff: string, baseline: string): string {
  if (isZero(diff)) return "no change";
  const mag = abs(diff);
  const fig = showSig(mag);
  const sign = diff.startsWith("-") ? "\u2212" : "+";
  if (isZero(baseline)) return `${sign}${fig}`;
  const pct = divRound(mul(mag, "100"), abs(baseline), 0);
  return `${sign}${fig} (${sign}${groupInt(pct)}%)`;
}

export { abs, add, cmp, divRound, isZero, mul, roundHalfUp, sub };
