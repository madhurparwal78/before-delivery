import type { Language } from "./towns.ts";

const FORMS: Record<Language, RegExp[]> = {
  en: [/^\d+(?:\.\d+)?$/],
  it: [/^\d+(?:,\d+)?$/],
  ja: [/^\d+(?:\.\d+)?$/, /^[０-９]+(?:．[０-９]+)?$/],
  ar: [/^[٠-٩]+(?:٫[٠-٩]+)?$/, /^\d+(?:\.\d+)?$/],
};

function latin(typed: string): string {
  return typed
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[,．٫]/, ".");
}

/** Reads a typed height the page's local way: the decimal string with a Latin point, or null when refused. */
export function readSeatHeight(typed: string, language: Language): string | null {
  if (!FORMS[language].some((form) => form.test(typed))) return null;
  const text = latin(typed);
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > 1) return null;
  const tenths = Number(whole) * 10 + Number(fraction || "0");
  return tenths >= 300 && tenths <= 600 ? text : null;
}
