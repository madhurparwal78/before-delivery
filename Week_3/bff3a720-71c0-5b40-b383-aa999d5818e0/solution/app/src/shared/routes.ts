/** Page paths the single-page app answers with 200; every other path is the not-found page. */
const PAGE_PATTERNS: readonly RegExp[] = [
  /^\/$/,
  /^\/search$/,
  /^\/rides\/[^/]+$/,
  /^\/bookings\/[^/]+$/,
  /^\/offer$/,
  /^\/my-rides$/,
  /^\/wallet$/,
  /^\/earnings$/,
  /^\/profile$/,
  /^\/sign-in$/,
  /^\/founder\/id-review$/,
  /^\/founder\/network$/,
];

export function isPagePath(path: string): boolean {
  return PAGE_PATTERNS.some((pattern) => pattern.test(path));
}
