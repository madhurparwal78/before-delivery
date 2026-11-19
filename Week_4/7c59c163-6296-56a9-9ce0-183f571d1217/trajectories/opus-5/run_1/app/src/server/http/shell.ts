export type InitialPage = 'app' | 'sign_in_error' | 'sign_in_unavailable';

/** The single HTML shell for every screen; no credential or service URL reaches the browser. */
export function shellPage(initialPage: InitialPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Plumtide Venue</title>
<link rel="preload" href="/assets/fonts/parkinsans-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/assets/fonts/urbanist-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/assets/app.css" />
<script>window.__PV_PAGE__=${JSON.stringify(initialPage)};</script>
<script type="module" src="/assets/app.js"></script>
</head>
<body><div id="root"></div></body>
</html>
`;
}
