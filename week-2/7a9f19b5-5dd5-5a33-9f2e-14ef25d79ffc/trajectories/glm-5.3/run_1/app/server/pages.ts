/**
 * HTML template for every screen. Pages are single documents: the server
 * fills in the page title; the browser code takes over from there.
 */
export function page_html(title: string): string {
  return `<!doctype html>
<html lang="en" data-light="night" data-light-mode="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="preload" href="/assets/fonts/instrument-serif.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" type="module"></script>
</body>
</html>`
}
