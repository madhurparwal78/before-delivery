const PAGE_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/kits\/[^/]+$/,
  /^\/bookings\/[^/]+$/,
  /^\/desk$/,
  /^\/desk\/counter$/,
  /^\/desk\/owner$/,
];

export function isKnownPageRoute(pathname: string): boolean {
  return PAGE_ROUTES.some((pattern) => pattern.test(pathname));
}

export function pageShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Northbar Camera Hire · Tallyslate</title>
<link rel="preload" href="/fonts/big-shoulders-display-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<div id="app"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
}
