// After signing in or up a person returns to the page that asked, but only to a path on this origin.

const SAME_ORIGIN_PATH = /^\/(?![/\\])/;

export function requestedPath(): string | null {
  const next = new URLSearchParams(location.search).get('next');
  return next !== null && SAME_ORIGIN_PATH.test(next) ? next : null;
}

/** A link to another account screen that keeps the requested path. */
export function keepingRequest(path: string): string {
  const next = requestedPath();
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}
