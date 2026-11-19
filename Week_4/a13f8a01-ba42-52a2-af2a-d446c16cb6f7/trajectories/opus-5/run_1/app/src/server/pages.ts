import { readFileSync } from 'node:fs';
import { extname, normalize } from 'node:path';
import { copy } from '../shared/copy';
import { assetPath } from './assets';
import { type Reply } from './http';

const shell = (title: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/public/app.css">
<script src="/public/app.js" defer></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`;

const APP_SHELL = shell('Ashlar');
const EMBED_SHELL = shell('Ashlar embed');

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${copy.notFoundHeading}</title>
<link rel="stylesheet" href="/public/app.css">
</head>
<body class="not-found-body">
<main class="panel panel-empty not-found">
<h1>${copy.notFoundHeading}</h1>
<p>${copy.notFoundLine}</p>
<a href="/explore">Go to Explore</a>
</main>
</body>
</html>
`;

const htmlReply = (status: number, body: string, framable: boolean): Reply => ({
  status,
  raw: body,
  contentType: 'text/html; charset=utf-8',
  headers: {
    'cache-control': 'no-store',
    'content-security-policy': `frame-ancestors ${framable ? '*' : "'self'"}`,
    ...(framable ? {} : { 'x-frame-options': 'SAMEORIGIN' }),
  },
});

export const appPage = (): Reply => htmlReply(200, APP_SHELL, false);
export const embedPage = (): Reply => htmlReply(200, EMBED_SHELL, true);

/** Anything the viewer may not see answers with these exact bytes and this exact status. */
export const notFoundPage = (): Reply => htmlReply(404, NOT_FOUND_PAGE, false);

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

export const staticFile = (pathname: string): Reply | null => {
  const relative = normalize(pathname.replace(/^\/public\//, ''));
  if (relative.startsWith('..') || relative.includes('\0')) return null;
  const type = CONTENT_TYPES[extname(relative)];
  if (!type) return null;
  try {
    const body = readFileSync(assetPath('public', relative));
    return {
      status: 200,
      raw: body,
      contentType: type,
      headers: { 'cache-control': 'public, max-age=3600' },
    };
  } catch {
    return null;
  }
};
