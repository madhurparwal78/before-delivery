import type { FastifyPluginAsync } from 'fastify';
import { fail, failures, isValidOpaqueId } from './errors.js';
import { loadSession, requireAuth } from './sessions.js';
import type { WorkerRuntime, StreamClient } from '../worker-runtime.js';

export const streamRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.get('/api/boards/:boardId/events', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { boardId } = request.params as { boardId: string };
    if (!isValidOpaqueId(boardId)) fail(failures.notFound());
    const access = await runtime.store.boardAccess(boardId, authed.session.userId);
    if (!access) fail(failures.notFound());

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Kinfold-Worker': String(runtime.workerId),
    });
    reply.raw.write(':ok\n\n');

    let closed = false;
    const write = (chunk: string): void => {
      if (closed) return;
      reply.raw.write(chunk);
    };

    const client: StreamClient = {
      boardId,
      userId: authed.session.userId,
      role: access.role,
      tokenHash: authed.tokenHash,
      closed: false,
      send: (event, data) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close: () => {
        if (closed) return;
        closed = true;
        client.closed = true;
        runtime.unregisterBoardStream(client);
        try {
          reply.raw.end();
        } catch {
          // already ended
        }
      },
    };
    runtime.registerBoardStream(client);

    if (!runtime.relay.isUp()) {
      client.send('live.paused', {});
    }

    const commentTimer = setInterval(() => {
      write(`:keep-alive\n\n`);
    }, 10_000);
    if (typeof commentTimer.unref === 'function') commentTimer.unref();

    const sessionCheckTimer = setInterval(() => {
      void (async () => {
        const token = (request.headers.cookie ?? '').match(/kinfold_session=([^;]*)/)?.[1];
        if (!token) {
          client.send('session.ended', {});
          client.close();
          return;
        }
      })();
    }, 2_000);
    if (typeof sessionCheckTimer.unref === 'function') sessionCheckTimer.unref();

    request.raw.on('close', () => {
      clearInterval(commentTimer);
      clearInterval(sessionCheckTimer);
      closed = true;
      client.closed = true;
      runtime.unregisterBoardStream(client);
    });

    await new Promise<void>((resolve) => {
      request.raw.on('close', () => resolve());
    });
  });
};
