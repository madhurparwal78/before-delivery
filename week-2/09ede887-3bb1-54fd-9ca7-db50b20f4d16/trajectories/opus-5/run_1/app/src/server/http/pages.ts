export const PAGE_ROUTES: readonly string[] = [
  '/',
  '/agenda',
  '/my-agenda',
  '/speakers',
  '/record',
  '/organiser',
  '/signin',
  '/signup',
];

export function isPageRoute(path: string): boolean {
  if (PAGE_ROUTES.includes(path)) return true;
  const segments = path.split('/');
  return segments.length === 3 && segments[1] === 'sessions' && segments[2] !== '';
}

export const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel Outpost 2026</title>
<meta name="description" content="Keel Outpost 2026: two days of builders' sessions at Harbour Quay Hall, Port Ashby.">
<link rel="stylesheet" href="/assets/app.css">
<link rel="preload" href="/assets/InterVariable.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="app"><p class="loading">Loading</p></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`;

export const STARTING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel Outpost 2026</title>
<style>
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fafafa; color: #121212; }
main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem; }
h1 { font-size: 2rem; letter-spacing: -0.02em; }
</style>
</head>
<body>
<main>
<h1>Keel Outpost 2026</h1>
<p>Keel Outpost is starting. Try again in a moment.</p>
</main>
</body>
</html>
`;
