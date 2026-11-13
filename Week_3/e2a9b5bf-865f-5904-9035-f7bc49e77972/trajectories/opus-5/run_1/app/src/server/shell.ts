/** The single-page document. Everything it loads comes from this app. */
export function shellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Lowlamp Field Log</title>
<link rel="preload" href="/fonts/sora-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/sora-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}
