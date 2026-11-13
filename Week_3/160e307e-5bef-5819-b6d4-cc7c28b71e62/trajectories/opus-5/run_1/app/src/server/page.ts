export interface Boot {
  link?: 'expired';
  linkedEmail?: string;
  signedInName?: string;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function pageHtml(boot: Boot): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>Due Coin</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="application/json" id="boot">${escapeJson(boot)}</script>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}
