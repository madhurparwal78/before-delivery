/** Every page address the app serves. An address outside this list answers 404. */
export const PAGE_ROUTES: readonly { pattern: string; route: string }[] = [
  { pattern: '/', route: 'home' },
  { pattern: '/boards', route: 'boards' },
  { pattern: '/foil-boards', route: 'foil-boards' },
  { pattern: '/parts', route: 'parts' },
  { pattern: '/match', route: 'match' },
  { pattern: '/build', route: 'build' },
  { pattern: '/build/:code', route: 'build-code' },
  { pattern: '/cart', route: 'cart' },
  { pattern: '/cart/shared/:token', route: 'cart-shared' },
  { pattern: '/checkout', route: 'checkout' },
  { pattern: '/account', route: 'account' },
  { pattern: '/account/orders/:number', route: 'order' },
  { pattern: '/trade-in', route: 'trade-in' },
  { pattern: '/locations', route: 'locations' },
  { pattern: '/events', route: 'events' },
  { pattern: '/callback', route: 'callback' },
  { pattern: '/track', route: 'track' },
  { pattern: '/support', route: 'support' },
  { pattern: '/contact', route: 'contact' },
  { pattern: '/signup', route: 'signup' },
  { pattern: '/login', route: 'login' },
  { pattern: '/forgot-password', route: 'forgot-password' },
  { pattern: '/reset-password', route: 'reset-password' },
  { pattern: '/staff', route: 'staff' },
  { pattern: '/shipping', route: 'shipping' },
  { pattern: '/protection', route: 'protection' },
  { pattern: '/faq', route: 'faq' },
  { pattern: '/partners', route: 'partners' },
  { pattern: '/privacy-policy', route: 'privacy-policy' },
];

export function matchPage(pathname: string): string | null {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  for (const { pattern, route } of PAGE_ROUTES) {
    const patternSegments = pattern.split('/').filter((s) => s.length > 0);
    if (patternSegments.length !== segments.length) continue;
    const ok = patternSegments.every((part, index) => part.startsWith(':') || part === segments[index]);
    if (ok) return route;
  }
  return null;
}

export function pageHtml(route: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="tf-route" content="${route}">
<title>Tern Foils</title>
<link rel="preload" href="/fonts/montserrat-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/open-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/app.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="app"></div>
</body>
</html>
`;
}
