/** The HTML the server sends for each screen. */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pool, queryOne } from '../db';
import { config } from '../config';
import { applyLapseCheck } from '../domain/lapse';
import { sendText, type Wire } from './wire';

const publicDir = path.join(__dirname, 'public');

const STATIC_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

interface ShellOptions {
  title: string;
  robotsNoindex?: boolean;
}

/** The display zone is the only configuration value the browser is given. */
function shell(options: ShellOptions): string {
  const bootstrap = JSON.stringify({ salesOfficeTz: config.salesOfficeTz });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
${options.robotsNoindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="stylesheet" href="/app.css">
<script type="application/json" id="hw-display">${bootstrap}</script>
</head>
<body>
<div id="app"></div>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

export function sendAppShell(wire: Wire, title: string): void {
  sendText(wire, 200, shell({ title }), 'text/html; charset=utf-8');
}

/**
 * The shared hold page carries the unit code in its title and nothing private:
 * no buyer name or email, no hold id, no start time and no price.
 */
export async function sendSharedPage(wire: Wire, token: string): Promise<void> {
  await applyLapseCheck(pool);
  const row = await queryOne<{ unit_code: string }>(
    pool,
    `select h.unit_code from holds h join units u on u.code = h.unit_code
      where h.share_token = $1 and h.status = 'active' and u.status in ('available','held','reserved')`,
    [token],
  );
  const title = row ? `Home ${row.unit_code} · Highwater` : 'Shared link · Highwater';
  sendText(wire, 200, shell({ title, robotsNoindex: true }), 'text/html; charset=utf-8', {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

/** Serves the app's own built assets, and nothing else. */
export async function sendStatic(wire: Wire, pathname: string): Promise<boolean> {
  const relative = pathname.replace(/^\/+/, '');
  if (relative === '' || relative.includes('..') || relative.split('/').some((part) => part.startsWith('.'))) {
    return false;
  }
  const extension = path.extname(relative);
  const contentType = STATIC_TYPES[extension];
  if (!contentType) return false;
  const full = path.join(publicDir, relative);
  if (!full.startsWith(publicDir)) return false;
  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
    const body = await readFile(full);
    sendText(wire, 200, body, contentType, { 'Cache-Control': 'public, max-age=300' });
    return true;
  } catch {
    return false;
  }
}
