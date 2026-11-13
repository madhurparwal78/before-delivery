/** Public search ranking: title band, heading band, body band, navigation order within a band. */

export interface SearchableHeading {
  text: string;
  anchor: string;
}

export interface SearchablePage {
  pageId: string;
  title: string;
  path: string;
  groupTitle: string;
  headings: readonly SearchableHeading[];
  bodyText: string;
}

export interface SearchResult {
  pageId: string;
  title: string;
  group: string;
  heading: string | null;
  url: string;
}

export function searchPages(
  pages: readonly SearchablePage[],
  query: string,
  urlFor: (path: string, anchor: string | null) => string,
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const contains = (value: string): boolean => value.toLowerCase().includes(needle);
  const bands: SearchResult[][] = [[], [], []];
  for (const page of pages) {
    if (contains(page.title)) {
      bands[0].push({
        pageId: page.pageId,
        title: page.title,
        group: page.groupTitle,
        heading: null,
        url: urlFor(page.path, null),
      });
      continue;
    }
    const heading = page.headings.find((candidate) => contains(candidate.text));
    if (heading !== undefined) {
      bands[1].push({
        pageId: page.pageId,
        title: page.title,
        group: page.groupTitle,
        heading: heading.text,
        url: urlFor(page.path, heading.anchor),
      });
      continue;
    }
    if (contains(page.bodyText)) {
      bands[2].push({
        pageId: page.pageId,
        title: page.title,
        group: page.groupTitle,
        heading: null,
        url: urlFor(page.path, null),
      });
    }
  }
  return [...bands[0], ...bands[1], ...bands[2]];
}
