/** The text-field character rule and caseless name matching. */

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

/** Full case folding beyond `toLowerCase`, from CaseFolding.txt status F. */
const FULL_FOLD: ReadonlyMap<string, string> = new Map([
  ["\u00df", "ss"],
  ["\u1e9e", "ss"],
  ["\u0130", "i\u0307"],
  ["\u0149", "\u02bcn"],
  ["\u0587", "\u0565\u0582"],
  ["\ufb00", "ff"],
  ["\ufb01", "fi"],
  ["\ufb02", "fl"],
  ["\ufb03", "ffi"],
  ["\ufb04", "ffl"],
  ["\ufb05", "st"],
  ["\ufb06", "st"],
  ["\ufb13", "\u0574\u0576"],
  ["\ufb14", "\u0574\u0565"],
  ["\ufb15", "\u0574\u056b"],
  ["\ufb16", "\u057e\u0576"],
  ["\ufb17", "\u0574\u056d"],
]);

/** Unicode canonical caseless match key (Unicode 3.13 D145) with full case folding. */
export function caselessKey(text: string): string {
  const decomposed = text.normalize("NFD");
  let folded = "";
  for (const character of decomposed) {
    folded += FULL_FOLD.get(character) ?? character.toLowerCase();
  }
  return folded.normalize("NFD");
}
