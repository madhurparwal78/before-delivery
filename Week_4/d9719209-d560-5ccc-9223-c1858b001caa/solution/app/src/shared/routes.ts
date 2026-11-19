/** Every page the browser app shows; the server answers 404 for any other path. */
export const PAGE_ROUTES = [
  '/',
  '/signup',
  '/login',
  '/verify',
  '/forgot',
  '/reset',
  '/settings',
  '/settings/2fa',
  '/communities',
  '/communities/new',
  '/c/:name',
  '/c/:name/submit',
  '/c/:name/about/log',
  '/c/:name/about/mod',
  '/c/:name/post/:postId',
  '/c/:name/post/:postId/comment/:commentId',
  '/u/:username',
  '/admin/reports',
] as const;

export type PagePattern = (typeof PAGE_ROUTES)[number];

const compiled = PAGE_ROUTES.map((pattern) => ({
  pattern,
  names: [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1] as string),
  regex: new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`),
}));

export interface PageMatch { pattern: PagePattern; params: Record<string, string> }

export function matchPage(path: string): PageMatch | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const route of compiled) {
    const found = route.regex.exec(clean);
    if (found) {
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(found[i + 1] as string); });
      return { pattern: route.pattern, params };
    }
  }
  return null;
}
