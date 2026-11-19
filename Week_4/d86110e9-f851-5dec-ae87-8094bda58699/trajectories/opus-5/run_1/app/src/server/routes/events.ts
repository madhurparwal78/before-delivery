import { addConnection, removeConnection } from '../sse';
import type { Ctx, Reply, Route } from '../http';

async function stream(ctx: Ctx): Promise<Reply> {
  const draftId = ctx.url.searchParams.get('draft');
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  ctx.res.write(': stream open\n\n');
  const id = addConnection(ctx.workspace.id, ctx.user.id, ctx.user.name, draftId, ctx.res);
  ctx.req.on('close', () => removeConnection(id));
  return { handled: true };
}

export const eventRoutes: Route[] = [
  { method: 'GET', path: '/api/workspaces/:ws/events', auth: 'session', workspace: 'ws', handler: stream },
];
