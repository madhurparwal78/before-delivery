import { errors } from '../http/errors';

/** The one place that decides how search text is read and matched. */
export function validateQuery(raw: string | null): string {
  if (raw === null) throw errors.validation({ q: 'Search for 2 to 100 characters.' });
  const length = [...raw].length;
  if (length < 2 || length > 100) throw errors.validation({ q: 'Search for 2 to 100 characters.' });
  return raw;
}

export function matchesQuery(text: string, query: string): boolean {
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export const SEARCH_RESULT_LIMIT = 50;
