import { paletteCssVariables } from '../../shared/palette.js';
import { attr, escapeText, jsonScript } from './html.js';
import type { SessionUser } from '../../shared/types.js';

export interface PageBootstrap {
  page: string;
  [key: string]: unknown;
}

export interface PageOptions {
  title: string;
  page: string;
  body: string;
  bootstrap: PageBootstrap;
  /** The embed view shows no account name and sets no cookie. */
  viewer?: SessionUser | null;
  wordmark?: boolean;
}

export function renderDocument(options: PageOptions): string {
  const wordmark =
    options.wordmark === false
      ? ''
      : `<a class="wordmark" href="/">Pennywasher</a>`;
  const account =
    options.viewer == null
      ? ''
      : `<p class="account-name">${escapeText(options.viewer.name)}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(options.title)}</title>
<style>:root{${paletteCssVariables()}}</style>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body data-page="${attr(options.page)}">
${wordmark}${account}${options.body}
${jsonScript('bootstrap', options.bootstrap)}
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
