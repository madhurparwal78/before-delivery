/**
 * The folding table that decides whether a typed name is the one on record.
 * Used by the client's sign-off and by the dossier's signature.
 */

const SPECIALS: ReadonlyArray<readonly [string, string]> = [
  ['\u00f8', 'o'],
  ['\u00df', 'ss'],
  ['\u0131', 'i'],
  ['\u0130', 'i'],
  ['\u00e6', 'ae'],
  ['\u0153', 'oe'],
  ['\u0142', 'l'],
  ['\u0111', 'd'],
];

/**
 * Lower-cases, decomposes and drops combining marks, then maps the published
 * letters, and collapses surrounding space.
 */
export function foldName(name: string): string {
  let out = name.trim().toLowerCase();
  for (const [from, to] of SPECIALS) out = out.split(from).join(to);
  out = out.normalize('NFD').replace(/\p{M}+/gu, '');
  for (const [from, to] of SPECIALS) out = out.split(from).join(to);
  return out;
}

export function namesMatch(typed: string, held: string): boolean {
  return foldName(typed) === foldName(held);
}

/** True for text that is empty or only spaces. */
export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}
