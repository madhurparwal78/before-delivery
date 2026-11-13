import { clientConfig } from './config';
import type { JsonValue } from '../shared/types';

function shell(title: string, bootstrap: string, me: JsonValue = null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/app.css">
<script>window.__HALATION__ = ${JSON.stringify({ config: clientConfig(), me })};</script>
</head>
<body>
<div id="root"></div>
<script>${bootstrap}</script>
<script src="/app.js" defer></script>
</body>
</html>`;
}

export function appPage(me: JsonValue = null): string {
  return shell('Halation Studio', 'window.__HALATION_MODE__ = "app";', me);
}

export function embedPage(projectId: string): string {
  return shell(
    'Halation Studio embed',
    `window.__HALATION_MODE__ = "embed"; window.__HALATION_PROJECT__ = ${JSON.stringify(projectId)};`,
  );
}

export function embedMissingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Halation Studio embed</title>
<link rel="stylesheet" href="/app.css">
</head>
<body class="embed-missing">
<main><p>This scene is not published.</p></main>
</body>
</html>`;
}
