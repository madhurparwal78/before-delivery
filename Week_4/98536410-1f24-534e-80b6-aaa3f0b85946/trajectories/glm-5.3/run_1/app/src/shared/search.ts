const DIACRITICS = /[\u0300-\u036f]/g;

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

export function isValidQuery(q: string | undefined): boolean {
  return q === undefined || q.trim().length <= 100;
}

export function searchLiteral(q: string | undefined): string {
  return q === undefined ? "" : q.trim();
}

export function literalMatch(haystack: string, needle: string): boolean {
  return normalizeSearch(haystack).includes(normalizeSearch(needle));
}
