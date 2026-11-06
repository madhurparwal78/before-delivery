const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/** Every path in the route table that a `next` may point at. */
function isDeskRoutePath(path) {
  if (path === '/' || path === '/requests' || path === '/requests/new' || path === '/calendar' || path === '/policy') {
    return true;
  }
  if (path.startsWith('/requests/')) {
    const segment = path.slice('/requests/'.length);
    return segment.length > 0 && !segment.includes('/');
  }
  return false;
}

/**
 * The one test for a safe `next`, taking the already decoded parameter value.
 * Returns the path and query to navigate to, or null. `/login` and `/share/<token>`
 * are never safe targets.
 */
export function safeNext(decoded) {
  if (typeof decoded !== 'string' || decoded === '') return null;
  if (!decoded.startsWith('/')) return null;
  if (decoded.length > 1 && (decoded[1] === '/' || decoded[1] === '\\')) return null;
  if (decoded.includes('\\')) return null;
  if (CONTROL_CHARACTERS.test(decoded)) return null;

  const queryAt = decoded.indexOf('?');
  const path = queryAt === -1 ? decoded : decoded.slice(0, queryAt);
  if (path.includes(':')) return null;
  if (!isDeskRoutePath(path)) return null;
  return decoded;
}

/** The `next` parameter for a sign-in redirect, percent-encoded as one URI component. */
export function encodeNext(pathAndQuery) {
  return encodeURIComponent(pathAndQuery);
}
