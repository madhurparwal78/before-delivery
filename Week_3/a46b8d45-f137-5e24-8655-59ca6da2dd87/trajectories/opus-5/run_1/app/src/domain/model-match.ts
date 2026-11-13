/**
 * The one place that matches a supplier row's model name against the catalogue, under the
 * published normalisation, code-suffix and retired-name rules.
 */

export interface CatalogueNames {
  slug: string;
  name: string;
  retiredNames: readonly string[];
}

export type ModelMatch =
  | { outcome: 'matched'; slug: string }
  | { outcome: 'unknown_model' }
  | { outcome: 'ambiguous_model' };

/** A trailing supplier code is 2 to 4 letters then 2 to 4 digits, set off by spaces, a hyphen or a slash. */
const TRAILING_SUPPLIER_CODE = /[\s\-/]+[A-Za-z]{2,4}\d{2,4}$/;

function stripSupplierCode(name: string): string {
  return name.replace(TRAILING_SUPPLIER_CODE, '');
}

export function normaliseModelName(name: string): string {
  return name.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchModelName(supplied: string, catalogue: readonly CatalogueNames[]): ModelMatch {
  const wanted = normaliseModelName(stripSupplierCode(supplied));
  if (wanted === '') return { outcome: 'unknown_model' };

  const hits = catalogue.filter((model) =>
    [model.name, ...model.retiredNames].some((candidate) => normaliseModelName(candidate) === wanted),
  );

  if (hits.length === 1) return { outcome: 'matched', slug: hits[0]!.slug };
  return hits.length === 0 ? { outcome: 'unknown_model' } : { outcome: 'ambiguous_model' };
}
