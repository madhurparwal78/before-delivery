// Plate normalisation and format checking. One place decides a plate's canonical form.
// NL LLL-NN-L, BE L-LLL-NNN, DE NNN-LLL (L letter, N digit).

export const PLATE_EXAMPLES: Record<string, string> = {
  NL: 'FGH-12-K',
  BE: 'A-KLM-204',
  DE: '418-RTV',
};

export function plateExample(country: string): string {
  return PLATE_EXAMPLES[country] ?? 'FGH-12-K';
}

export function normalisePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function canonicalPlate(raw: string, country: string): string | null {
  const bare = normalisePlate(raw);
  const nl = /^([A-Z]{3})(\d{2})([A-Z])$/.exec(bare);
  const be = /^([A-Z])([A-Z]{3})(\d{3})$/.exec(bare);
  const de = /^(\d{3})([A-Z]{3})$/.exec(bare);
  if (country === 'NL' && nl) return `${nl[1]}-${nl[2]}-${nl[3]}`;
  if (country === 'BE' && be) return `${be[1]}-${be[2]}-${be[3]}`;
  if (country === 'DE' && de) return `${de[1]}-${de[2]}`;
  return null;
}
