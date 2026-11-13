// The pages of the app by path: the server answers the page shell for exactly these paths, and the browser renders one page for each.

/** Path segments of each page; a segment starting with `:` captures that part of the path. */
export const PAGES = {
  landing: [],
  register: ['register'],
  signin: ['signin'],
  folders: ['folders'],
  drawing: ['drawings', ':id'],
  review: ['versions', ':id'],
  viewLink: ['v', ':token'],
} as const satisfies Record<string, readonly string[]>;

export type PageName = keyof typeof PAGES;
export interface PageMatch { page: PageName; params: string[] }

const PAGE_NAMES = Object.keys(PAGES) as PageName[];

/** The page at `path` with its captured parts, or null when no page lives there (a trailing slash or an empty part is no page). */
export function matchPage(path: string): PageMatch | null {
  const parts = path === '/' ? [] : path.slice(1).split('/');
  for (const page of PAGE_NAMES) {
    const segments: readonly string[] = PAGES[page];
    if (segments.length !== parts.length) continue;
    const params: string[] = [];
    const matches = segments.every((segment, index) => {
      if (!segment.startsWith(':')) return segment === parts[index];
      params.push(parts[index]);
      return parts[index] !== '';
    });
    if (matches) return { page, params };
  }
  return null;
}
