import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_COPY } from '../shared/notices.js';
import { escapeTextContent } from '../shared/richtext.js';
import { accountForRequest } from './auth.js';
import { acceptInvitation } from './api.js';
import { liveSnapshotOf } from './publish.js';
import {
  getObject,
  heldObject,
  snapshotAssetKey,
} from './storage.js';
import {
  Router,
  redirect,
  sendBytes,
  sendHtml,
  type RequestContext,
} from './http.js';
import { accessFor, workspaceBySlug } from './workspaces.js';
import { loadDocument } from './workspaces.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

export function messagePage(heading: string, text: string, title = heading): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeTextContent(title)}</title><link rel="stylesheet" href="/app.css"></head>` +
    `<body class="message-page"><main class="message-card"><h1>${escapeTextContent(heading)}</h1>` +
    `<p>${escapeTextContent(text)}</p></main></body></html>`
  );
}

export function shellPage(boot: Record<string, unknown>): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Plinth</title><link rel="stylesheet" href="/app.css">` +
    `<script>window.__BOOT__=${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>` +
    `<script src="/build/client.js" defer></script></head>` +
    `<body><div id="app"></div>` +
    `<div id="announcer" role="status" aria-live="polite" data-announcement-count="0"></div>` +
    `</body></html>`
  );
}

export function editorNotFound(ctx: RequestContext): void {
  sendHtml(ctx, 404, messagePage(PAGE_COPY.editorNotFound.heading, PAGE_COPY.editorNotFound.text));
}

async function serveStatic(ctx: RequestContext, relative: string): Promise<boolean> {
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  const extension = extname(safe);
  const type = STATIC_TYPES[extension];
  if (type === undefined) return false;
  try {
    const bytes = await readFile(join(PUBLIC_DIR, safe));
    sendBytes(ctx, 200, bytes, type);
    return true;
  } catch {
    return false;
  }
}

export function registerPages(router: Router): void {
  router.add('GET', '/signup', (ctx) => sendHtml(ctx, 200, shellPage({ route: 'signup' })));
  router.add('GET', '/signin', (ctx) => sendHtml(ctx, 200, shellPage({ route: 'signin' })));

  router.add('GET', '/', async (ctx) => {
    const account = await accountForRequest(ctx.request);
    if (!account) {
      redirect(ctx, '/signin?next=%2F');
      return;
    }
    sendHtml(ctx, 200, shellPage({ route: 'workspaces', user: account }));
  });

  router.add('GET', '/w/:workspaceId/edit', async (ctx) => {
    const account = await accountForRequest(ctx.request);
    const path = `${ctx.url.pathname}${ctx.url.search}`;
    if (!account) {
      redirect(ctx, `/signin?next=${encodeURIComponent(path)}`);
      return;
    }
    const access = await accessFor(account.id, ctx.params['workspaceId']!);
    if (!access) {
      editorNotFound(ctx);
      return;
    }
    sendHtml(
      ctx,
      200,
      shellPage({
        route: 'editor',
        user: account,
        workspaceId: access.workspaceId,
        workspaceName: access.name,
        role: access.role,
        presenceTimeoutMs: 0,
      }),
    );
  });

  router.add('GET', '/invites/:token', async (ctx) => {
    const account = await accountForRequest(ctx.request);
    const path = ctx.url.pathname;
    if (!account) {
      redirect(ctx, `/signin?next=${encodeURIComponent(path)}`);
      return;
    }
    try {
      const accepted = await acceptInvitation(ctx.params['token']!, account);
      redirect(ctx, accepted.redirect);
    } catch {
      sendHtml(
        ctx,
        404,
        messagePage(PAGE_COPY.inviteInvalid.heading, PAGE_COPY.inviteInvalid.text),
      );
    }
  });

  const publicNotFound = (ctx: RequestContext): void => {
    sendHtml(
      ctx,
      404,
      messagePage(PAGE_COPY.publicNotFound.heading, PAGE_COPY.publicNotFound.text),
    );
  };

  const publicUnavailable = (ctx: RequestContext): void => {
    sendHtml(
      ctx,
      503,
      messagePage(PAGE_COPY.publicStorage.heading, PAGE_COPY.publicStorage.text),
    );
  };

  router.add('GET', '/p/:workspaceSlug/:pageSlug', async (ctx) => {
    const workspace = await workspaceBySlug(ctx.params['workspaceSlug']!);
    if (!workspace) {
      publicNotFound(ctx);
      return;
    }
    const doc = await loadDocument(workspace.id);
    const page = doc.pages.find((item) => item.slug === ctx.params['pageSlug']);
    if (!page) {
      publicNotFound(ctx);
      return;
    }
    const snapshot = await liveSnapshotOf(workspace.id, page.id);
    if (!snapshot) {
      publicNotFound(ctx);
      return;
    }
    const cached = heldObject(snapshot.snapshotKey);
    if (cached) {
      sendBytes(ctx, 200, cached.body, 'text/html; charset=utf-8');
      return;
    }
    try {
      const object = await getObject(workspace.id, snapshot.snapshotKey);
      sendBytes(ctx, 200, object.body, 'text/html; charset=utf-8');
    } catch {
      publicUnavailable(ctx);
    }
  });

  router.add('GET', '/p/:workspaceSlug/:pageSlug/assets/:imageId', async (ctx) => {
    const workspace = await workspaceBySlug(ctx.params['workspaceSlug']!);
    if (!workspace) {
      publicNotFound(ctx);
      return;
    }
    const doc = await loadDocument(workspace.id);
    const page = doc.pages.find((item) => item.slug === ctx.params['pageSlug']);
    if (!page) {
      publicNotFound(ctx);
      return;
    }
    const snapshot = await liveSnapshotOf(workspace.id, page.id);
    if (!snapshot) {
      publicNotFound(ctx);
      return;
    }
    const key = snapshotAssetKey(page.id, snapshot.publishId, ctx.params['imageId']!);
    const cached = heldObject(key);
    if (cached) {
      sendBytes(ctx, 200, cached.body, cached.contentType);
      return;
    }
    try {
      const object = await getObject(workspace.id, key);
      sendBytes(ctx, 200, object.body, object.contentType);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) publicNotFound(ctx);
      else publicUnavailable(ctx);
    }
  });

  router.add('GET', '/fonts/:file', async (ctx) => {
    if (!(await serveStatic(ctx, `fonts/${ctx.params['file']!}`))) editorNotFound(ctx);
  });
  router.add('GET', '/build/:file', async (ctx) => {
    if (!(await serveStatic(ctx, `build/${ctx.params['file']!}`))) editorNotFound(ctx);
  });
  router.add('GET', '/app.css', async (ctx) => {
    if (!(await serveStatic(ctx, 'app.css'))) editorNotFound(ctx);
  });
}
