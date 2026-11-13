/**
 * An item's identity is its normalised name plus its category. Name
 * normalisation is decided only here, for gear entry and for import matching.
 */
const WHITE_SPACE_RUN = /[\s\u0085]+/gu;

export function normaliseName(name: string): string {
  return name.normalize('NFKC').replace(WHITE_SPACE_RUN, ' ').trim().toLowerCase();
}
