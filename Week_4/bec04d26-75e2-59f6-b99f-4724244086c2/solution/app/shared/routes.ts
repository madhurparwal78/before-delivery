/** Every page the app has: the server answers 200 for these and 404 for anything else. */
const PAGE_PATTERNS: RegExp[] = [
  /^\/$/, /^\/sign-in$/, /^\/sign-up$/, /^\/today$/, /^\/catalogue$/, /^\/month(\/\d{4}-(0[1-9]|1[0-2]))?$/,
  /^\/year(\/\d{4})?$/, /^\/clients$/, /^\/states$/, /^\/settings$/, /^\/home$/, /^\/returns\/[^/]+$/,
];

export const isPage = (path: string): boolean => PAGE_PATTERNS.some((pattern) => pattern.test(path));
