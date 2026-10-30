import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { applySchema, waitForDatabase } from './db';
import { env } from './env';
import { methodNotAllowed, notFound } from './errors';
import { CSP, PUBLIC_PAGE_HEADERS, Router, errorReply, writeReply } from './http/kernel';
import { CLIENT_ROOT, appShellHtml, loadClientShell } from './http/pages';
import { registerFeatureRoutes } from './http/routes/features';
import { registerImportRoutes } from './http/routes/imports';
import { registerInsightRoutes } from './http/routes/insights';
import { registerInvitationRoutes } from './http/routes/invitations';
import { registerNoteRoutes } from './http/routes/notes';
import { registerPublicRoutes } from './http/routes/public';
import { registerRoadmapRoutes } from './http/routes/roadmap';
import { registerSessionRoutes } from './http/routes/session';
import { registerWorkspaceRoutes } from './http/routes/workspace';
import { seedIfEmpty } from './seed';
import { startWorkers } from './services/workers';

const APP_ROUTES = [
  /^\/$/u,
  /^\/signin$/u,
  /^\/inbox$/u,
  /^\/inbox\/[^/]+$/u,
  /^\/features$/u,
  /^\/features\/[^/]+$/u,
  /^\/roadmap$/u,
  /^\/companies$/u,
  /^\/companies\/[^/]+$/u,
  /^\/import$/u,
  /^\/settings$/u,
  /^\/invite\/[^/]+$/u,
];

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const router = new Router();
registerSessionRoutes(router);
registerNoteRoutes(router);
registerInsightRoutes(router);
registerFeatureRoutes(router);
registerRoadmapRoutes(router);
registerWorkspaceRoutes(router);
registerImportRoutes(router);
registerInvitationRoutes(router);
registerPublicRoutes(router);

async function serveAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, '');
  if (!relative.startsWith('assets/')) return false;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = ASSET_TYPES[extension];
  if (contentType === undefined) return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(CLIENT_ROOT, relative));
  } catch {
    return false;
  }
  writeReply(response, {
    status: 200,
    bytes,
    contentType,
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
  return true;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = decodeURI((request.url ?? '/').split('?')[0]);

  if (request.method === 'GET' && (await serveAsset(pathname, response))) return;
  if (await router.dispatch(request, response, pathname)) return;

  if (pathname.startsWith('/api/public/')) {
    writeReply(response, { ...errorReply(methodNotAllowed(), pathname), headers: { ...PUBLIC_PAGE_HEADERS } });
    return;
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/r/')) {
    writeReply(response, errorReply(notFound(), pathname));
    return;
  }
  if (request.method === 'GET' && APP_ROUTES.some((route) => route.test(pathname))) {
    writeReply(response, {
      status: 200,
      html: appShellHtml(),
      headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP },
    });
    return;
  }
  writeReply(response, errorReply(notFound(), pathname));
}

async function main(): Promise<void> {
  loadClientShell();
  await waitForDatabase();
  await applySchema();
  await seedIfEmpty();
  startWorkers();

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) writeReply(response, errorReply(new Error('unhandled'), '/'));
      else response.end();
    });
  });
  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`Evidence Desk listening on ${env.port}\n`);
  });
}

void main();
