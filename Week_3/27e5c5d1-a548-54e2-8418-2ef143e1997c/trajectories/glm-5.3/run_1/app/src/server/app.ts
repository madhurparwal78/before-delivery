import fastify, { type FastifyInstance } from 'fastify';
import { readConfig, type AppConfig } from './config.js';
import { WorkerRuntime } from './worker-runtime.js';
import { ApiError } from './api/errors.js';
import { registerBoundary, sessionRoutes } from './api/sessions.js';
import { workspaceRoutes } from './api/workspaces.js';
import { boardRoutes } from './api/boards.js';
import { cardRoutes } from './api/cards.js';
import { attachmentRoutes } from './api/attachments.js';
import { streamRoutes } from './api/streams.js';
import { Pool } from 'pg';

export interface AppHandle {
  app: FastifyInstance;
  runtime: WorkerRuntime;
  config: AppConfig;
}

/** Build one worker's app: the boundary, the routes and the opaque error handler. */
export async function buildApp(pool: Pool, workerId: 1 | 2): Promise<AppHandle> {
  const config = readConfig();
  const runtime = new WorkerRuntime(config, workerId, pool);
  const app: FastifyInstance = fastify({
    logger: false,
    bodyLimit: 11_000_000,
    disableRequestLogging: true,
  });

  // Raw bodies so every endpoint owns its own parsing and key checking.
  app.addContentTypeParser(
    ['application/json', 'text/plain'],
    { parseAs: 'buffer' },
    (_request, body: Buffer, done: (err: null, result?: { raw: Buffer }) => void) => {
      done(null, { raw: body });
    },
  );
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer' },
    (_request, body: Buffer, done: (err: null, result?: { raw: Buffer }) => void) => {
      done(null, { raw: body });
    },
  );

  registerBoundary(app, runtime);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.failure.status);
      if (error.failure.allow) reply.header('Allow', error.failure.allow);
      reply.send(error.failure.body);
      return;
    }
    const statusCode = error.statusCode;
    if (statusCode === 413) {
      reply.status(413).send({ error: 'too_large' });
      return;
    }
    if (statusCode === 415) {
      reply.status(415).send({ error: 'unsupported_media_type' });
      return;
    }
    reply.status(500).send({ error: 'internal' });
  });
  await app.register(sessionRoutes, { runtime });
  await app.register(workspaceRoutes, { runtime });
  await app.register(boardRoutes, { runtime });
  await app.register(cardRoutes, { runtime });
  await app.register(attachmentRoutes, { runtime });
  await app.register(streamRoutes, { runtime });

  return { app, runtime, config };
}
