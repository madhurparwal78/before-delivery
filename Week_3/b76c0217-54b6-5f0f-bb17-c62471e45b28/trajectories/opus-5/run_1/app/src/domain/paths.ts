/** The one path rule: 1 to 5 segments of 1 to 60 letters, digits, hyphens and underscores. */
const SEGMENT = /^[A-Za-z0-9_-]{1,60}$/;

export function isValidPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.length < 1 || segments.length > 5) return false;
  return segments.every((segment) => SEGMENT.test(segment));
}

/** A version-relative path as written in redirects, links and messages. */
export const withSlash = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

/** A page path as stored in page JSON: no leading or trailing slash. */
export const withoutSlash = (path: string): string => path.replace(/^\/+/, '');

export const hasSchemeOrHost = (value: string): boolean =>
  value.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);

export const isValidSlug = (slug: string): boolean => SEGMENT.test(slug);
