import type { Request, Response } from 'express';

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boltrope</title>
<link rel="stylesheet" href="/css/boltrope.css">
</head>
<body>
<div id="app"></div>
<div id="store-outage" class="outage" role="region" aria-label="Store outage" hidden></div>
<div id="loft-status" class="status-live" role="status" aria-live="polite" aria-label="Loft status"></div>
<div id="loft-alert" class="status-live" role="alert" aria-label="Loft alert"></div>
<script type="module" src="/js/app.js"></script>
</body>
</html>`;

/** Serve the single-page shell at every non-API address. */
export function servePage(req: Request, res: Response): void {
  void req;
  res.status(200);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  res.send(Buffer.from(HTML, 'utf8'));
}

export function serveNotFoundPage(res: Response): void {
  res.status(404);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  res.send(Buffer.from(HTML, 'utf8'));
}
