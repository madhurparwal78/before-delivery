import type { Module } from '../http/app.ts';
import { json } from '../http/reply.ts';
import { openSheet } from '../sheets/store.ts';
import { alertBody, alertSchema, evaluateAlerts, subscribe } from './alerts.ts';
import { mountInbox } from './inbox.ts';
import { registerAlertSeed } from './seed.ts';

export const mountAlerts: Module = (app) => {
  app.schema(alertSchema);
  mountInbox(app);
  registerAlertSeed(app);
  app.onRefreshed((sourceId) => evaluateAlerts(app, sourceId));

  app.route({
    method: 'POST',
    path: '/api/sheets/:id/alerts',
    body: 'json',
    handler: async (ctx) => {
      const access = await openSheet(app, ctx.user, ctx.params.id ?? '');
      return json(201, await subscribe(app, ctx.user, access, alertBody(ctx.object())));
    },
  });
};
