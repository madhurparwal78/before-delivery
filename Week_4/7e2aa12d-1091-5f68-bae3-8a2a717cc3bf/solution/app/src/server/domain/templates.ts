import type { Area, LayoutState } from '../../shared/types.js';

const TEMPLATE_NAMES = ['blank', 'holy-grail', 'dashboard-shell', 'magazine-spread'] as const;
type TemplateName = (typeof TEMPLATE_NAMES)[number];

const area = (name: string, row_start: number, column_start: number, row_end: number, column_end: number): Area => ({
  name,
  row_start,
  column_start,
  row_end,
  column_end,
});

const TEMPLATES: Record<TemplateName, LayoutState> = {
  blank: {
    columns: ['1fr', '1fr', '1fr'],
    rows: ['1fr', '1fr', '1fr'],
    gap: { row: 16, column: 16 },
    areas: [],
    breakpoints: [],
  },
  'holy-grail': {
    columns: ['1fr'],
    rows: ['auto', 'auto', '1fr', 'auto', 'auto'],
    gap: { row: 16, column: 16 },
    areas: [area('header', 1, 1, 2, 2), area('nav', 2, 1, 3, 2), area('main', 3, 1, 4, 2), area('aside', 4, 1, 5, 2), area('footer', 5, 1, 6, 2)],
    breakpoints: [
      {
        min_width: 768,
        columns: ['200px', '1fr', '200px'],
        rows: ['auto', '1fr', 'auto'],
        areas: [area('header', 1, 1, 2, 4), area('nav', 2, 1, 3, 2), area('main', 2, 2, 3, 3), area('aside', 2, 3, 3, 4), area('footer', 3, 1, 4, 4)],
        gap: null,
      },
    ],
  },
  'dashboard-shell': {
    columns: ['1fr'],
    rows: ['56px', 'auto', '1fr'],
    gap: { row: 12, column: 12 },
    areas: [area('top', 1, 1, 2, 2), area('side', 2, 1, 3, 2), area('content', 3, 1, 4, 2)],
    breakpoints: [
      {
        min_width: 1024,
        columns: ['240px', '1fr'],
        rows: ['56px', '1fr'],
        areas: [area('top', 1, 1, 2, 3), area('side', 2, 1, 3, 2), area('content', 2, 2, 3, 3)],
        gap: null,
      },
    ],
  },
  'magazine-spread': {
    columns: ['1fr', '1fr'],
    rows: ['auto', 'auto', 'auto'],
    gap: { row: 24, column: 16 },
    areas: [area('lead', 1, 1, 2, 3), area('story-a', 2, 1, 3, 2), area('story-b', 2, 2, 3, 3), area('story-c', 3, 1, 4, 3)],
    breakpoints: [
      {
        min_width: 1280,
        columns: ['2fr', '1fr', '1fr'],
        rows: ['auto', '1fr'],
        areas: [area('lead', 1, 1, 3, 2), area('story-a', 1, 2, 2, 3), area('story-b', 1, 3, 2, 4), area('story-c', 2, 2, 3, 4)],
        gap: null,
      },
    ],
  },
};

export const template = (name: TemplateName): LayoutState => structuredClone(TEMPLATES[name]);
