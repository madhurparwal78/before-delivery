import type { Module } from '../http/app.ts';
import { forbidden, notFound } from '../http/errors.ts';
import { json, noContent } from '../http/reply.ts';
import type { SourceAccess } from '../sources/access.ts';
import { sourceAccess } from '../sources/access.ts';
import { refreshSource } from './refresh.ts';
import { deleteSchedule, saveSchedule } from './schedule.ts';
import { snapshotSchema } from './snapshot.ts';
import { extractOf, getExtractRow } from './state.ts';

/** Creators schedule and refresh; explorers too when the project's explorers-schedule setting is on. */
function requireScheduler({ role, project }: SourceAccess): void {
  if (role === 'creator' || (role === 'explorer' && project.explorers_schedule)) return;
  throw forbidden();
}

export const mountExtracts: Module = (app) => {
  app.schema(snapshotSchema);

  const extractState = async (sourceId: string) => {
    const row = await getExtractRow(app, sourceId);
    if (!row) throw notFound();
    return extractOf(app, row);
  };

  app.route({
    method: 'GET',
    path: '/api/sources/:id/extract',
    handler: async (ctx) => {
      const { source } = await sourceAccess(app, ctx.user, ctx.params.id ?? '');
      return json(200, await extractState(source.id));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sources/:id/refresh',
    handler: async (ctx) => {
      const access = await sourceAccess(app, ctx.user, ctx.params.id ?? '');
      requireScheduler(access);
      await refreshSource(app, access.source.id);
      return json(200, await extractState(access.source.id));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sources/:id/schedule',
    body: 'json',
    handler: async (ctx) => {
      const access = await sourceAccess(app, ctx.user, ctx.params.id ?? '');
      requireScheduler(access);
      return json(200, await saveSchedule(app, access.source.id, ctx.object()));
    },
  });

  app.route({
    method: 'DELETE',
    path: '/api/sources/:id/schedule',
    handler: async (ctx) => {
      const access = await sourceAccess(app, ctx.user, ctx.params.id ?? '');
      requireScheduler(access);
      await deleteSchedule(app, access.source.id);
      return noContent();
    },
  });
};
