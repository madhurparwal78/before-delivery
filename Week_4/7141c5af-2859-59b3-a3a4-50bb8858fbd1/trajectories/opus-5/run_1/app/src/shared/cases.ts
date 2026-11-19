/** The finished cases the public site shows. All of them are invented. */

export type CaseKind = 'leather' | 'fabric' | 'frame-only';

export interface PublicCase {
  slug: string;
  title: string;
  kind: CaseKind;
  figure: string;
}

export const PUBLIC_CASES: readonly PublicCase[] = [
  { slug: 'bentwood-armchair', title: 'Bentwood armchair', kind: 'leather', figure: '38.75 sq ft' },
  { slug: 'tubular-lounge', title: 'Tubular lounge', kind: 'leather', figure: '47.20 sq ft' },
  { slug: 'swivel-desk-chair', title: 'Swivel desk chair', kind: 'leather', figure: '31.40 sq ft' },
  { slug: 'folding-deck-chair', title: 'Folding deck chair', kind: 'fabric', figure: '8.25 m' },
  { slug: 'cantilever-side-chair', title: 'Cantilever side chair', kind: 'fabric', figure: '6.50 m' },
  { slug: 'slat-bench', title: 'Slat bench', kind: 'frame-only', figure: '0.00 sq ft' },
];

export const CASE_KIND_NAMES: Record<CaseKind, string> = {
  leather: 'Leather',
  fabric: 'Fabric',
  'frame-only': 'Frame only',
};

export const CASE_SECTIONS = [
  { number: '01', heading: 'As it came', hash: 'as-it-came' },
  { number: '02', heading: 'What we found', hash: 'what-we-found' },
  { number: '03', heading: 'The cover', hash: 'the-cover' },
  { number: '04', heading: 'The frame', hash: 'the-frame' },
  { number: '05', heading: 'Keeping it well', hash: 'keeping-it-well' },
  { number: '06', heading: 'Files', hash: 'files' },
] as const;

export function findCase(slug: string): PublicCase | undefined {
  return PUBLIC_CASES.find((item) => item.slug === slug);
}
