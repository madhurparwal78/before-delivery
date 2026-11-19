import { validationFailed } from "./errors.js";

const SEARCH_LIMIT = 100;

/** Lower case with accents removed: what "without regard to case or accents" means. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The trimmed `q`, checked against the length limit; an empty string means no text filter. */
export function searchTerm(raw: string | null): string {
  const term = (raw ?? "").trim();
  if ([...term].length > SEARCH_LIMIT) throw validationFailed({ q: `Use at most ${SEARCH_LIMIT} characters.` });
  return term;
}

/** True when `term` appears literally inside any of the fields. */
export function matchesLiterally(term: string, fields: string[]): boolean {
  if (term === "") return true;
  const needle = fold(term);
  return fields.some((field) => fold(field).includes(needle));
}
