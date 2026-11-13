import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';

/** Serving the built app's shell. */

const here = dirname(fileURLToPath(import.meta.url));
export const clientRoot = join(here, '..', '..', 'client');

let shell: string | null = null;

export async function appShell(): Promise<string> {
  if (shell === null) {
    shell = await readFile(join(clientRoot, 'index.html'), 'utf8');
  }
  return shell;
}

export type ServerPage = 'signin_error' | 'signin_unavailable';

/**
 * Answer with the app's shell, telling it to show a page the server decided on.
 * The screen keeps the product's look while carrying the published status.
 */
export async function sendServerPage(
  res: Response,
  status: number,
  page: ServerPage,
): Promise<void> {
  const html = await appShell();
  const injected = html.replace(
    '</head>',
    `<script>window.__SPINDRIFT_PAGE__=${JSON.stringify(page)};</script></head>`,
  );
  res.status(status).type('html').send(injected);
}
