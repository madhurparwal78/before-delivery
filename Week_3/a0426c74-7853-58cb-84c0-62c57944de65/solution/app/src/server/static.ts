import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as copy from '../shared/copy.ts';
import { matchPage } from '../shared/pages.ts';
import { config } from './config.ts';

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const SHELL_FILE = 'index.html';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface StaticAnswer { status: number; contentType: string; body: Buffer }

/** The page shell with the three settings the browser needs placed in its config element; read once, as neither changes while running. */
const shell = await (async (): Promise<string> => {
  const html = await readFile(join(PUBLIC_DIR, SHELL_FILE), 'utf8');
  const settings = JSON.stringify({ toast_ms: config.toastMs, dom_margin_px: config.domMarginPx, dom_ceiling: config.domCeiling });
  return html.replace(/(<script id="plot-config" type="application\/json">)(<\/script>)/, `$1${settings}$2`);
})();

const htmlAnswer = (status: number, html: string): StaticAnswer => ({ status, contentType: 'text/html; charset=utf-8', body: Buffer.from(html) });

/** The shell, carrying the not-found sentence in its root element: it shows without scripts and the app replaces it when it starts. */
export function notFoundPage(): StaticAnswer {
  return htmlAnswer(404, shell.replace('<div id="root"></div>', `<div id="root"><p>${copy.NOT_FOUND_PAGE}</p></div>`));
}

/** Answers a non-API GET: an app page gets the shell, a built file or font gets its bytes, everything else the not-found page. */
export async function serveStatic(path: string): Promise<StaticAnswer> {
  if (matchPage(path) !== null) return htmlAnswer(200, shell);
  const file = normalize(join(PUBLIC_DIR, path));
  const contentType = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(PUBLIC_DIR + sep) || !contentType) return notFoundPage();
  try {
    return { status: 200, contentType, body: await readFile(file) };
  } catch {
    return notFoundPage();
  }
}
