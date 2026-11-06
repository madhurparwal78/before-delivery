/** The one HTML shell every page route serves, with the status the server decides. */

export function pageShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lanternline Handshake Desk</title>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/js/client/app.js"></script>
</body>
</html>
`;
}

const STAFF_SECTIONS = [
  'cases',
  'review',
  'messages',
  'counterparties',
  'rules',
  'reports',
  'months',
  'files',
  'partner-keys',
  'members',
  'listing',
] as const;

export type PageMatch =
  | { kind: 'page' }
  | { kind: 'exchange'; listingSlug: string }
  | { kind: 'request-page'; token: string }
  | { kind: 'unknown' };

/** Which published page route a path is, so the server can set its status. */
export function matchPage(pathname: string): PageMatch {
  const parts = pathname.split('/').filter((part) => part !== '');
  if (parts.length === 0) return { kind: 'page' };
  if (parts[0] === 'sign-in' && parts.length === 1) return { kind: 'page' };
  if (parts[0] === 'jurisdictions' && parts.length === 2) return { kind: 'page' };
  if (parts[0] === 'exchanges' && parts.length === 2) {
    return { kind: 'exchange', listingSlug: parts[1] };
  }
  if (parts[0] === 'r' && parts.length === 2) return { kind: 'request-page', token: parts[1] };
  if (parts[0] === 'w' && parts.length >= 3) {
    const section = parts[2];
    if (!(STAFF_SECTIONS as readonly string[]).includes(section)) return { kind: 'unknown' };
    if (section === 'reports') {
      return parts.length === 4 && parts[3] === 'daily' ? { kind: 'page' } : { kind: 'unknown' };
    }
    if (parts.length === 3) return { kind: 'page' };
    if (parts.length === 4 && (section === 'cases' || section === 'messages' || section === 'counterparties' || section === 'rules' || section === 'months')) {
      return { kind: 'page' };
    }
    return { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

export function sitemapXml(publicUrl: string, jurisdictionCodes: readonly string[], listingSlugs: readonly string[]): string {
  const locations = [
    `${publicUrl}/`,
    ...jurisdictionCodes.map((code) => `${publicUrl}/jurisdictions/${code}`),
    ...listingSlugs.map((slug) => `${publicUrl}/exchanges/${slug}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations.map((location) => `  <url><loc>${location}</loc></url>`).join('\n')}
</urlset>
`;
}
