import type { Bootstrap } from '../shared/types';
import { env } from './env';
import { serviceStatus } from './services';

const escapeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const renderPage = (bootstrap: Bootstrap, title: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, '')}</title>
<link rel="stylesheet" href="/app.css">
<script>window.__PINSHEET__ = ${escapeJson(bootstrap)};</script>
</head>
<body>
<div id="app"></div>
<script src="/app.js"></script>
</body>
</html>
`;

export const pageBootstrap = (user: Bootstrap['user'], screen: Bootstrap['screen']): Bootstrap => ({
  user,
  upload_max_bytes: env.uploadMaxBytes,
  services: serviceStatus(),
  screen,
});
