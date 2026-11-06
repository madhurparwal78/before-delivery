import { randomNonce } from './crypto';

export interface BootData {
  user: { id: string; email: string; displayName: string } | null;
  csrfToken: string | null;
  notFound: 'diagram' | 'page' | null;
  firstPageId: string | null;
}

function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export interface RenderedHtml {
  html: string;
  nonce: string;
}

export function renderShell(boot: BootData): RenderedHtml {
  const nonce = randomNonce();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scopewright</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__BOOT__=${embedJson(boot)};</script>
<script nonce="${nonce}" src="/assets/app.js"></script>
</body>
</html>
`;
  return { html, nonce };
}
