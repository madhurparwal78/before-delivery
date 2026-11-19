import Decimal from "decimal.js";
import type { Language } from "../shared/catalog";
import { wallTime } from "../shared/time";

const Exact = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

export function exact(value: string | number | Decimal): Decimal {
  return new Exact(value);
}

/** A whole JSON number the database's integer columns can hold. */
export function fitsInteger(value: unknown): boolean {
  return Number.isInteger(value) && Math.abs(value as number) <= 2_147_483_647;
}

export function plain(value: Decimal): string {
  return value.toFixed();
}

function grouped(text: string): string {
  const [whole, fraction] = text.split(".") as [string, string | undefined];
  const commas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? commas : `${commas}.${fraction}`;
}

const SUPERSCRIPTS: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** The display rule: 3 significant figures, half up on the exact value. */
export function display(value: Decimal): string {
  if (value.isZero()) return "0";
  const rounded = value.toSignificantDigits(3, Decimal.ROUND_HALF_UP);
  if (value.abs().lessThan("0.001") && rounded.abs().lessThan("0.001")) {
    const power = rounded.e;
    const mantissa = rounded.div(exact(10).pow(power)).toFixed(2);
    const digits = [...String(Math.abs(power))].map((digit) => SUPERSCRIPTS[digit]).join("");
    return `${mantissa} × 10⁻${digits}`;
  }
  return grouped(rounded.toFixed(Math.max(0, 2 - rounded.e)));
}

/** A share of an exact total in percent, half up to one decimal; a zero total gives 0.0. */
export function shareOf(part: Decimal, total: Decimal): string {
  if (total.isZero()) return "0.0";
  return part.div(total).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
}

export function shownMass(grams: Decimal): string {
  return `${grams.toFixed(1, Decimal.ROUND_HALF_UP)} g`;
}

export function fullGrouped(value: Decimal): string {
  return grouped(value.toFixed());
}

const ENGLISH = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const FRENCH = /^(\d{1,3}([   ]\d{3})+|\d+)(,\d+)?$/;
const TURKISH = /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
const ARABIC_INDIC = /^([٠-٩]{1,3}(٬[٠-٩]{3})+|[٠-٩]+)(٫[٠-٩]+)?$/;
const ARABIC_PLAIN = /^\d+(\.\d+)?$/;

/** The exact value a number typed the local way means, or null when the language refuses it. */
export function readLocalNumber(typed: string, language: Language): Decimal | null {
  const text = typed.trim();
  switch (language) {
    case "en":
      return ENGLISH.test(text) ? exact(text.replaceAll(",", "")) : null;
    case "fr":
      return FRENCH.test(text) ? exact(text.replace(/[   ]/g, "").replace(",", ".")) : null;
    case "tr":
      return TURKISH.test(text) ? exact(text.replaceAll(".", "").replace(",", ".")) : null;
    case "ar":
      if (ARABIC_PLAIN.test(text)) return exact(text);
      if (!ARABIC_INDIC.test(text)) return null;
      return exact(
        text
          .replaceAll("٬", "")
          .replace("٫", ".")
          .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)),
      );
  }
}

const MJ_PER_UNIT: Record<string, string> = { kWh: "3.6", MJ: "1", m3: "37.8" };

export function toMegajoules(value: Decimal, unit: string): Decimal {
  return value.times(MJ_PER_UNIT[unit] as string);
}

export function isEnergyUnit(unit: unknown): unit is string {
  return typeof unit === "string" && unit in MJ_PER_UNIT;
}

export function isPlainDecimal(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
}

export function isPositiveDecimal(value: unknown): value is string {
  return isPlainDecimal(value) && exact(value).greaterThan(0);
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

export function atLisbon(at: Date): string {
  return wallTime(at);
}

/** Text fields count characters with an emoji as 1. */
export function characters(text: string): number {
  return [...text].length;
}

const FOLDS: Record<string, string> = {
  ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u", é: "e", è: "e", ê: "e", ë: "e", à: "a", â: "a", ã: "a", á: "a",
  î: "i", í: "i", ô: "o", õ: "o", ó: "o", ù: "u", û: "u", ú: "u", ñ: "n",
};

/** The published folding table for search. */
export function fold(text: string): string {
  return text
    .replaceAll("İ", "i")
    .toLowerCase()
    .replace(/[ışğçöüéèêëàâãáîíôõóùûúñ]/g, (letter) => FOLDS[letter] as string);
}

/** The GTIN copy that refuses a value, or null for a valid one. */
export function gtinProblem(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{13}$/.test(value)) return "A GTIN has 13 digits.";
  const total = [...value.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
  const digit = (10 - (total % 10)) % 10;
  return String(digit) === value[12] ? null : `That GTIN's check digit should be ${digit}.`;
}
