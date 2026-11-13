/** The text-field character rule and caseless name matching. */

import { CASE_FOLD } from "./caseFold.js";

const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function hasForbiddenCharacters(raw: string): boolean {
  return FORBIDDEN.test(raw);
}

/** Trimmed and NFC-normalised: the form that is stored and counted. */
export function normalizeTextField(raw: string): string {
  return raw.trim().normalize("NFC");
}

export function codePointLength(text: string): number {
  return [...text].length;
}

/** Unicode canonical caseless match key (Unicode 3.13 D145) with full case folding. */
export function caselessKey(text: string): string {
  const decomposed = text.normalize("NFD");
  let folded = "";
  for (const character of decomposed) {
    folded += CASE_FOLD.get(character) ?? character;
  }
  return folded.normalize("NFD");
}
