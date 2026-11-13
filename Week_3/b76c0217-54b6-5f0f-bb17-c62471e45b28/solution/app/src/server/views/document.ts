// The HTML shared by every page the server renders: head, theme script, announcer.

import { escapeHtml } from '../domain/render';

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('galley-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'system'}catch(e){document.documentElement.dataset.theme='system'}})();`;

/** JSON for a `<script type="application/json">` block: `<` is escaped so the data can never close the tag. */
export const embed = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

export function documentHtml(options: { title: string; bodyClass: string; bodyAttributes?: string; body: string; scripts: string }): string {
  return `<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="preload" href="/static/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/ibm-plex-sans-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/ibm-plex-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/source-serif-4-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/source-serif-4-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/styles.css">
<script>${THEME_SCRIPT}</script>
</head>
<body class="${options.bodyClass}"${options.bodyAttributes ? ` ${options.bodyAttributes}` : ''}>
<div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="notices" class="notices"></div>
${options.body}
${options.scripts}
</body>
</html>`;
}

/** A page that says one thing: no access, an expired preview, an unknown address. */
export function messageHtml(options: { title: string; heading: string; text: string; mark: 'strike' | 'caret' }): string {
  const mark =
    options.mark === 'strike'
      ? '<svg class="proof-mark" viewBox="0 0 40 48" width="40" height="48" aria-hidden="true"><path d="M6 2h20l8 8v36H6z" class="proof-mark-page"/><path d="M26 2v8h8M12 20h16M12 27h16M12 34h10" class="proof-mark-page"/><path d="M2 40 38 8" class="proof-mark-strike"/></svg>'
      : '<svg class="proof-mark" viewBox="0 0 64 24" width="64" height="24" aria-hidden="true"><path d="M20 20l6-12 6 12M26 8v-6" class="proof-mark-caret"/></svg>';
  return documentHtml({
    title: options.title,
    bodyClass: 'message-page',
    body: `<main class="message"><div class="article">${mark}<h1>${escapeHtml(options.heading)}</h1><p>${escapeHtml(options.text)}</p></div></main>`,
    scripts: '',
  });
}
