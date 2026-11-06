// The safe `next` test and the route table, shared by loaders.
const ROUTE_TABLE = [
  /^\/$/,
  /^\/login$/,
  /^\/requests$/,
  /^\/requests\/new$/,
  /^\/requests\/[^/]+$/,
  /^\/calendar$/,
  /^\/policy$/,
  /^\/share\/[^/]+$/,
];

export function isDeskRoute(pathname) {
  return ROUTE_TABLE.some((re) => re.test(pathname));
}

export function isShareRoute(pathname) {
  return /^\/share\/[^/]+$/.test(pathname);
}

/** A `next` is safe only when it is a same-origin desk path, not /login or /share. */
export function isSafeNext(next) {
  if (typeof next !== 'string' || next === '') return false;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return false;
  if (next.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  if (/:\/\//.test(next)) return false;
  const path = next.split('?')[0].split('#')[0];
  if (path === '/login' || isShareRoute(path)) return false;
  return isDeskRoute(path);
}

export function encodeNext(next) {
  return encodeURIComponent(next);
}
