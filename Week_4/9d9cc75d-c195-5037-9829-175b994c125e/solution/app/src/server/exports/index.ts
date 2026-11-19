import { fileURLToPath } from 'node:url';
import type { App, Module } from '../http/app.ts';
import { conflict, notFound } from '../http/errors.ts';
import { bytes, json } from '../http/reply.ts';
import { isObject } from '../http/validate.ts';
import { parsed } from '../sheets/shape.ts';
import { ExportJobs, fileType, jobOf, jobSchema, objectKey } from './jobs.ts';
import type { JobRow } from './jobs.ts';
import { renderFile } from './render.ts';
import { exportRequest, targetOf, tryExportRequest } from './request.ts';
import { openTarget } from './target.ts';

const FONT_DIR = fileURLToPath(new URL('../public/fonts/', import.meta.url));

/** `filename` is plain ASCII; a name with other characters also gets the `filename*` form. */
function disposition(name: string, kind: JobRow['kind']): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const extra = plain === name ? '' : `; filename*=UTF-8''${encodeURIComponent(name)}.${kind}`;
  return `attachment; filename="${plain}.${kind}"${extra}`;
}

const targetOfJob = (job: JobRow) => (job.target === 'sheet' ? { sheet: job.target_id } : { dashboard: job.target_id });

export const mountExports: Module = (app: App) => {
  app.schema(jobSchema);

  const jobs = new ExportJobs(app, async (job) => {
    const user = await app.db.row<{ id: string; username: string }>(`SELECT id, username FROM users WHERE id = $1`, [job.user_id]);
    if (!user) throw notFound();
    const target = await openTarget(app, user, targetOfJob(job));
    const document = await target.document({ filters: job.filters, parameters: job.parameters, sets: {} });
    return renderFile(document, job.kind, FONT_DIR);
  });

  app.route({
    method: 'POST',
    path: '/api/exports',
    body: 'json',
    handler: async (ctx) => {
      const sent = ctx.peek();
      const early = tryExportRequest(sent);
      const replay = early === null ? null : await jobs.running(ctx.user.id, early);
      if (replay) return json(200, jobOf(replay));
      const target = isObject(sent) ? targetOf(sent) : null;
      if (target) await openTarget(app, ctx.user, target);
      const { job, created } = await jobs.submit(ctx.user.id, parsed(() => exportRequest(ctx.object())));
      return json(created ? 202 : 200, jobOf(job));
    },
  });

  app.route({
    method: 'GET',
    path: '/api/exports/:id',
    handler: async (ctx) => json(200, jobOf(await jobs.find(ctx.params.id ?? '', ctx.user.id))),
  });

  app.route({
    method: 'GET',
    path: '/api/exports/:id/events',
    handler: async (ctx) => jobs.events(await jobs.find(ctx.params.id ?? '', ctx.user.id)),
  });

  app.route({
    method: 'POST',
    path: '/api/exports/:id/retry',
    handler: async (ctx) => {
      const queued = await jobs.retry(await jobs.find(ctx.params.id ?? '', ctx.user.id));
      if (!queued) throw conflict('not_failed');
      return json(202, jobOf(queued));
    },
  });

  app.route({
    method: 'GET',
    path: '/api/exports/:id/file',
    handler: async (ctx) => {
      const job = await jobs.find(ctx.params.id ?? '', ctx.user.id);
      if (job.status !== 'ready') throw conflict('not_ready');
      const target = await openTarget(app, ctx.user, targetOfJob(job));
      return bytes(200, await app.storage.get(objectKey(job)), fileType(job.kind), {
        'Content-Disposition': disposition(target.name, job.kind),
      });
    },
  });
};
