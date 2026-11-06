/** Term names: trimmed, internal whitespace runs collapsed to one space, case kept (DP-73). */
export function normaliseTermName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

/** Two names conflict when equal after normalisation and case-folding. */
export function termNameKey(name: string): string {
  return normaliseTermName(name).toLowerCase();
}
