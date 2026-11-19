export function escape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export type PageOptions = {
  title: string;
  bodyClass?: string;
  bootstrap: Record<string, unknown>;
  head?: string;
};

export function page(options: PageOptions, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(options.title)}</title>
<link rel="stylesheet" href="/app.css">
${options.head ?? ''}
</head>
<body class="${escape(options.bodyClass ?? '')}">
${body}
<script type="application/json" id="bootstrap">${json(options.bootstrap)}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}
