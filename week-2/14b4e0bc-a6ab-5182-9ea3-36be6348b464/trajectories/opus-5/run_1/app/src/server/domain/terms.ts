/** A term name is stored trimmed with each run of internal whitespace collapsed to one space. */
export function normaliseTermName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Two names conflict when they are equal after normalisation and case-folding. */
export function termNamesConflict(left: string, right: string): boolean {
  return normaliseTermName(left).toLowerCase() === normaliseTermName(right).toLowerCase();
}
