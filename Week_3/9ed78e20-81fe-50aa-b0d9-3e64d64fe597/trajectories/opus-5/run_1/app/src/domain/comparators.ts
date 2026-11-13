export const ALDERMOOR = 'Aldermoor Labs';

export type Comparator = {
  readonly slug: string;
  readonly name: string;
  readonly organisation: string;
};

/** The recorded comparators of the open record. */
export const COMPARATORS: readonly Comparator[] = [
  { slug: 'halvard-3', name: 'Halvard 3', organisation: 'Brightline AI' },
  { slug: 'morrow-l', name: 'Morrow L', organisation: 'Teague Systems' },
];

export function findComparator(slug: string): Comparator | undefined {
  return COMPARATORS.find((comparator) => comparator.slug === slug);
}
