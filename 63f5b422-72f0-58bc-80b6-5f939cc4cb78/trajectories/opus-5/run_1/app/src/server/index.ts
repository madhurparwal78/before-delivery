import { createServer } from 'node:http';
import { registerApi } from './api.js';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { toApiError } from './errors.js';
import { attachHub } from './hub.js';
import { Router, checkOrigin, sendJson, type RequestContext } from './http.js';
import { editorNotFound, registerPages } from './pages.js';

const router = new Router();
registerApi(router);
registerPages(router);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const ctx: RequestContext = {
    request,
    response,
    url,
    method: request.method ?? 'GET',
    params: {},
  };
  void (async () => {
    try {
      checkOrigin(ctx);
      const match = router.match(ctx.method, url.pathname);
      if (!match) {
        if (url.pathname.startsWith('/api/')) {
          sendJson(ctx, 404, { error: { code: 'not_found', message: 'Not found.' } });
        } else {
          editorNotFound(ctx);
        }
        return;
      }
      ctx.params = match.params;
      await match.handler(ctx);
    } catch (error) {
      const apiError = toApiError(error);
      if (response.headersSent) {
        response.end();
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        sendJson(ctx, apiError.status, apiError.body());
        return;
      }
      if (apiError.status === 404) {
        editorNotFound(ctx);
        return;
      }
      sendJson(ctx, apiError.status, apiError.body());
    }
  })();
});

attachHub(server);

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Plinth listening on ${config.port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
