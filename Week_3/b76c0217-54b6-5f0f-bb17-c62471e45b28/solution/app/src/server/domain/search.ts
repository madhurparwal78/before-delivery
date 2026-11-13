// Public search: every page of a version's live snapshot appears once, in its best band.

import type { SearchResult } from '../../shared/types';

export interface IndexedPage {
  pageId: string;
  path: string;
  title: string;
  groupTitle: string;
  headings: { text: string; anchor: string }[];
  bodyText: string;
}

/** Bands: 1 the title contains the query, 2 a heading does, 3 only the body does. Pages arrive in navigation order. */
export function searchPages(pages: IndexedPage[], rawQuery: string, urlOf: (path: string) => string): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') {
    return [];
  }
  const banded = pages.flatMap((page, order) => {
    const heading = page.headings.find((h) => h.text.toLowerCase().includes(query)) ?? null;
    const band = page.title.toLowerCase().includes(query) ? 1 : heading ? 2 : page.bodyText.toLowerCase().includes(query) ? 3 : 0;
    if (band === 0) {
      return [];
    }
    const found = band === 2 && heading !== null;
    return [
      {
        band,
        order,
        result: {
          pageId: page.pageId,
          title: page.title,
          group: page.groupTitle,
          heading: found ? heading.text : null,
          url: urlOf(page.path) + (found ? `#${heading.anchor}` : ''),
        },
      },
    ];
  });
  return banded.sort((a, b) => a.band - b.band || a.order - b.order).map((entry) => entry.result);
}
