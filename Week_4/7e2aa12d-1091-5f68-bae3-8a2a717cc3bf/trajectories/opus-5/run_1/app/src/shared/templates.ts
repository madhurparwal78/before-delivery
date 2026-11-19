import type { LayoutState } from './types.js';

export const TEMPLATE_KEYS = ['blank', 'holy-grail', 'dashboard-shell', 'magazine-spread'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  blank: 'Blank',
  'holy-grail': 'Holy Grail',
  'dashboard-shell': 'Dashboard Shell',
  'magazine-spread': 'Magazine Spread',
};

const blank: LayoutState = {
  columns: ['1fr', '1fr', '1fr'],
  rows: ['1fr', '1fr', '1fr'],
  gap: { row: 16, column: 16 },
  areas: [],
  breakpoints: [],
};

const holyGrail: LayoutState = {
  columns: ['1fr'],
  rows: ['auto', 'auto', '1fr', 'auto', 'auto'],
  gap: { row: 16, column: 16 },
  areas: [
    { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 2 },
    { name: 'nav', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
    { name: 'main', row_start: 3, column_start: 1, row_end: 4, column_end: 2 },
    { name: 'aside', row_start: 4, column_start: 1, row_end: 5, column_end: 2 },
    { name: 'footer', row_start: 5, column_start: 1, row_end: 6, column_end: 2 },
  ],
  breakpoints: [
    {
      min_width: 768,
      columns: ['200px', '1fr', '200px'],
      rows: ['auto', '1fr', 'auto'],
      areas: [
        { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 4 },
        { name: 'nav', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
        { name: 'main', row_start: 2, column_start: 2, row_end: 3, column_end: 3 },
        { name: 'aside', row_start: 2, column_start: 3, row_end: 3, column_end: 4 },
        { name: 'footer', row_start: 3, column_start: 1, row_end: 4, column_end: 4 },
      ],
      gap: null,
    },
  ],
};

const dashboardShell: LayoutState = {
  columns: ['1fr'],
  rows: ['56px', 'auto', '1fr'],
  gap: { row: 12, column: 12 },
  areas: [
    { name: 'top', row_start: 1, column_start: 1, row_end: 2, column_end: 2 },
    { name: 'side', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
    { name: 'content', row_start: 3, column_start: 1, row_end: 4, column_end: 2 },
  ],
  breakpoints: [
    {
      min_width: 1024,
      columns: ['240px', '1fr'],
      rows: ['56px', '1fr'],
      areas: [
        { name: 'top', row_start: 1, column_start: 1, row_end: 2, column_end: 3 },
        { name: 'side', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
        { name: 'content', row_start: 2, column_start: 2, row_end: 3, column_end: 3 },
      ],
      gap: null,
    },
  ],
};

const magazineSpread: LayoutState = {
  columns: ['1fr', '1fr'],
  rows: ['auto', 'auto', 'auto'],
  gap: { row: 24, column: 16 },
  areas: [
    { name: 'lead', row_start: 1, column_start: 1, row_end: 2, column_end: 3 },
    { name: 'story-a', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
    { name: 'story-b', row_start: 2, column_start: 2, row_end: 3, column_end: 3 },
    { name: 'story-c', row_start: 3, column_start: 1, row_end: 4, column_end: 3 },
  ],
  breakpoints: [
    {
      min_width: 1280,
      columns: ['2fr', '1fr', '1fr'],
      rows: ['auto', '1fr'],
      areas: [
        { name: 'lead', row_start: 1, column_start: 1, row_end: 3, column_end: 2 },
        { name: 'story-a', row_start: 1, column_start: 2, row_end: 2, column_end: 3 },
        { name: 'story-b', row_start: 1, column_start: 3, row_end: 2, column_end: 4 },
        { name: 'story-c', row_start: 2, column_start: 2, row_end: 3, column_end: 4 },
      ],
      gap: null,
    },
  ],
};

const TEMPLATES: Record<TemplateKey, LayoutState> = {
  blank,
  'holy-grail': holyGrail,
  'dashboard-shell': dashboardShell,
  'magazine-spread': magazineSpread,
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function templateState(key: TemplateKey): LayoutState {
  return structuredClone(TEMPLATES[key]);
}
