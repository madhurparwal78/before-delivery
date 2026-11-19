import type { Lang } from "./copy.js";
import { mul } from "./decimal.js";

/**
 * Local number typing, decided in one place. English: digits, optional `,` every three
 * digits, `.` for decimals. French: digits, optional plain/no-break/narrow no-break space
 * every three digits, `,` for decimals. Turkish: digits, optional `.` every three digits,
 * `,` for decimals. Arabic: Arabic-Indic digits, optional `\u066C` every three digits,
 * `\u066B` for decimals, or else plain digits with `.` and no grouping.
 * Returns the exact value the typed form means, or null when refused.
 */
export function parseLocalNumber(raw: string, lang: Lang): string | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (lang === "ar" && /^[\u0660-\u0669\u066C\u066B]+$/.test(s)) return parseEasternDigits(s);
  if (lang === "en") return parseDecimal(s, ".", [","]);
  if (lang === "fr") return parseDecimal(s, ",", [" ", "\u00A0", "\u202F"]);
  if (lang === "tr") return parseDecimal(s, ",", ["."]);
  return parseDecimal(s, ".", []);
}

function parseEasternDigits(s: string): string | null {
  const hasDecimal = s.includes("\u066B");
  let intPart: string;
  let fracPart: string;
  if (hasDecimal) {
    const parts = s.split("\u066B");
    if (parts.length !== 2) return null;
    intPart = parts[0];
    fracPart = parts[1];
    if (intPart.length === 0 || fracPart.length === 0) return null;
    if (/[\u066C]/.test(fracPart)) return null;
  } else {
    intPart = s;
    fracPart = "";
    if (intPart.length === 0) return null;
  }
  const groups = intPart.split("\u066C");
  if (groups.length > 1) {
    if (groups[0].length === 0 || groups[0].length > 3) return null;
    for (let i = 1; i < groups.length; i++) {
      if (groups[i].length !== 3) return null;
    }
  }
  for (const g of groups) {
    if (g.length === 0 || !/^[\u0660-\u0669]+$/.test(g)) return null;
  }
  const western = (x: string): string => x.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const wi = western(groups.join(""));
  if (fracPart.length > 0) return `${wi}.${western(fracPart)}`;
  return wi;
}

function parseDecimal(s: string, decimalSep: string, groupSeps: string[]): string | null {
  const hasDecimal = s.includes(decimalSep);
  let intRaw: string;
  let fracRaw: string;
  if (hasDecimal) {
    const parts = s.split(decimalSep);
    if (parts.length !== 2) return null;
    intRaw = parts[0];
    fracRaw = parts[1];
    if (fracRaw.length === 0) return null;
  } else {
    intRaw = s;
    fracRaw = "";
  }
  if (intRaw.length === 0) return null;
  for (const g of groupSeps) {
    if (intRaw.includes(g)) {
      const groups = intRaw.split(g);
      if (groups.length === 1) return null;
      if (groups[0].length === 0 || groups[0].length > 3) return null;
      for (let i = 1; i < groups.length; i++) {
        if (groups[i].length !== 3) return null;
      }
      intRaw = groups.join("");
      break;
    }
  }
  if (!/^\d+$/.test(intRaw)) return null;
  if (fracRaw.length > 0 && !/^\d+$/.test(fracRaw)) return null;
  if (fracRaw.length > 0) return `${intRaw}.${fracRaw}`;
  return intRaw;
}

/** kWh × 3.6 and m³ × 37.8 into exact MJ. */
export function energyToMj(value: string, unit: "kWh" | "MJ" | "m3"): string {
  if (unit === "MJ") return value;
  if (unit === "kWh") return mul(value, "3.6");
  return mul(value, "37.8");
}
