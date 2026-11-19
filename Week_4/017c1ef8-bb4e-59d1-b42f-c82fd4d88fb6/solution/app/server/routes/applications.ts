import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { MULTIPART_SLACK, config } from '../config.js';
import { pool } from '../db.js';
import { applicationResumeKey, applyToJob, boardColumns, checkApplyTargets, readApplication, transition, type ApplyInput } from '../domain/applications.js';
import { requireJobPoster } from '../domain/jobs.js';
import { storeResume } from '../domain/resumes.js';
import { idempotent } from '../idempotency.js';
import { getObject } from '../storage.js';
import { filePart } from '../uploads.js';

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/uploads/resume', { bodyLimit: config.resumeMaxBytes + MULTIPART_SLACK, config: { upload: true } }, async (request, reply) => {
    return reply.status(201).send(await storeResume(pool, memberOf(request).id, await filePart(request.body)));
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/applications', async (request, reply) => {
    const member = memberOf(request);
    const input = (request.body ?? {}) as ApplyInput;
    await checkApplyTargets(pool, member.id, request.params.id, input);
    return idempotent(request, reply, (tx) => applyToJob(tx, member.id, request.params.id, input));
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/applications', async (request) => {
    await requireJobPoster(pool, memberOf(request).id, request.params.id);
    return { columns: await boardColumns(pool, request.params.id) };
  });

  app.get<{ Params: { id: string } }>('/api/applications/:id', async (request) => readApplication(memberOf(request).id, request.params.id));

  app.post<{ Params: { id: string } }>('/api/applications/:id/transition', async (request) =>
    transition(memberOf(request).id, request.params.id, (request.body as { to?: unknown } | undefined)?.to),
  );

  app.get<{ Params: { id: string } }>('/api/applications/:id/resume', async (request, reply) => {
    const key = await applicationResumeKey(pool, memberOf(request).id, request.params.id);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline; filename="resume.pdf"').send(await getObject(key));
  });
}

