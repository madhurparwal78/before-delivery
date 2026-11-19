/** The client routes the shell is served for; every other path is unknown. */
const CLIENT_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/markets$/,
  /^\/markets\/[^/]+$/,
  /^\/balance$/,
  /^\/orders$/,
  /^\/orders\/[^/]+$/,
  /^\/statements$/,
  /^\/profile$/,
  /^\/builder$/,
  /^\/admin$/,
  /^\/owner$/,
  /^\/platform$/,
  /^\/invites\/[^/]+$/,
];

export const isClientRoute = (pathname: string): boolean =>
  CLIENT_ROUTES.some((route) => route.test(pathname));

/**
 * A request for a file the server does not serve, such as source, `run.json`, package manifests,
 * lockfiles or environment files, rather than a mistyped screen address.
 */
export function looksLikeFileRequest(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.') || /^\/(src|dist|scripts|node_modules|public)\//.test(pathname);
}
