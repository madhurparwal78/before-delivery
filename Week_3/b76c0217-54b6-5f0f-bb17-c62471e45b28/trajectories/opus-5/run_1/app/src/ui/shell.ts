import { escapeHtml } from '../domain/markdown';

export type ClientScript = 'reader' | 'editor';

export interface ShellOptions {
  documentTitle: string;
  bodyClass: string;
  script: ClientScript;
  data?: unknown;
  content: string;
}

/** The theme choice is applied before paint and shared by the editor and the public site. */
const THEME_BOOTSTRAP = `(function(){var c=localStorage.getItem('galley.theme')||'system';var r=document.documentElement;r.dataset.themeChoice=c;var dark=c==='dark'||(c==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);r.dataset.theme=dark?'dark':'light';})();`;

export function page(options: ShellOptions): string {
  const data =
    options.data === undefined
      ? ''
      : `<script type="application/json" id="page-data">${JSON.stringify(options.data).replace(/</g, '\\u003c')}</script>`;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.documentTitle)}</title>
<link rel="stylesheet" href="/static/app.css">
<script>${THEME_BOOTSTRAP}</script>
</head>
<body class="${options.bodyClass}">
<div id="announcer" role="status" aria-live="polite" class="announcer"></div>
${options.content}
${data}
<script src="/static/${options.script}.js"></script>
</body>
</html>`;
}

export function themeRadios(): string {
  const radio = (value: string, label: string): string =>
    `<label class="theme-radio"><input type="radio" name="theme" value="${value}"><span>${label}</span></label>`;
  return `<div class="theme-group" role="radiogroup" aria-label="Theme">${radio('light', 'Light')}${radio('dark', 'Dark')}${radio('system', 'System')}</div>`;
}
