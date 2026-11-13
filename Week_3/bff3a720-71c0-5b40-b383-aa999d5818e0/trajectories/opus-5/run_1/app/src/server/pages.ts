import { config } from './config.js';

const PAGE_PATHS: RegExp[] = [
  /^\/$/,
  /^\/search$/,
  /^\/offer$/,
  /^\/my-rides$/,
  /^\/wallet$/,
  /^\/earnings$/,
  /^\/profile$/,
  /^\/sign-in$/,
  /^\/founder\/id-review$/,
  /^\/founder\/network$/,
  /^\/rides\/[0-9a-fA-F-]{36}$/,
  /^\/bookings\/[0-9a-fA-F-]{36}$/,
];

export function isPagePath(pathname: string): boolean {
  return PAGE_PATHS.some((pattern) => pattern.test(pathname));
}

/** The page receives only the two durations it runs on its own clock. */
export function shell(): string {
  const pageConfig = JSON.stringify({
    toast_seconds: config.limits.toastSeconds,
    search_debounce_ms: config.limits.searchDebounceMs,
  });
  return `<!doctype html>
<html lang="en" data-motion-pref="full">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Longseat</title>
<link rel="stylesheet" href="/styles.css">
<script type="application/json" id="page-config">${pageConfig}</script>
<script type="module" src="/app.js"></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`;
}
