import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { pool, transaction } from '../db.js';
import { hiringFunnel } from '../domain/funnel.js';
import { JOB_FIELDS, createJob, editorState, jobObject, myJobs, requireJobAdmin, requireJobPoster, saveJobField, setSaved, type JobField, type NewJob } from '../domain/jobs.js';
import { publishToEditors } from '../live.js';
import { notFound, validation } from '../errors.js';

const isJobField = (value: string): value is JobField => (JOB_FIELDS as string[]).includes(value);

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/jobs', async (request, reply) => {
    const member = memberOf(request);
    const id = await transaction((tx) => createJob(tx, member.id, (request.body ?? {}) as NewJob));
    return reply.status(201).send(await jobObject(pool, member.id, id));
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request) => jobObject(pool, memberOf(request).id, request.params.id));

  app.get<{ Params: { id: string } }>('/api/jobs/:id/editor', async (request) => editorState(pool, request.params.id, memberOf(request).id));

  app.patch<{ Params: { id: string; field: string } }>('/api/jobs/:id/fields/:field', async (request) => {
    const member = memberOf(request);
    if (!isJobField(request.params.field)) throw notFound();
    const body = (request.body ?? {}) as { value?: unknown; version?: unknown };
    const field = request.params.field;
    return transaction((tx) => saveJobField(tx, request.params.id, member, field, body.value, body.version));
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/editor/typing', async (request, reply) => {
    const member = memberOf(request);
    await requireJobAdmin(pool, member.id, request.params.id);
    const field = (request.body as { field?: unknown } | undefined)?.field;
    if (typeof field !== 'string' || !isJobField(field)) throw validation({ field: 'Choose a job field.' });
    publishToEditors(request.params.id, { type: 'job_typing', job_id: request.params.id, field, member: { id: member.id, name: member.name } }, member.id);
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/funnel', async (request) => {
    await requireJobPoster(pool, memberOf(request).id, request.params.id);
    return hiringFunnel(pool, request.params.id);
  });

  app.put<{ Params: { id: string } }>('/api/jobs/:id/save', async (request) => setSaved(pool, memberOf(request).id, request.params.id, true));
  app.delete<{ Params: { id: string } }>('/api/jobs/:id/save', async (request) => setSaved(pool, memberOf(request).id, request.params.id, false));

  app.get<{ Querystring: { tab?: string } }>('/api/me/jobs', async (request) => {
    const tab = request.query.tab;
    if (tab !== 'saved' && tab !== 'applied') throw validation({ tab: 'Choose saved or applied.' });
    return { jobs: await myJobs(pool, memberOf(request).id, tab) };
  });
}
