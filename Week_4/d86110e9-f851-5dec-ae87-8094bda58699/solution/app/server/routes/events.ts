import { findAutomation } from '../automations.js';
import { db } from '../db.js';
import { attach } from '../events.js';
import type { Route } from '../http.js';

export const eventRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:ws/events',
    async handle(ctx) {
      const wanted = ctx.query.get('draft');
      const draft = wanted && (await findAutomation(db, ctx.workspaceId, wanted)) !== null ? wanted : null;
      ctx.response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      attach({ response: ctx.response, userId: ctx.user.id, userName: ctx.user.name, workspaceId: ctx.workspaceId, draft });
      return { status: 200, stream: true };
    },
  },
];
