import { randomUUID } from 'node:crypto';
import { isUuid, requireAction, requireActor, requireKeyActor, requireVisibleProject } from '../auth.js';
import { query, queryOne } from '../db/pool.js';
import { renderSynthesis, synthesisDurationMs } from '../domain/audio.js';
import { conflict, invalidKey, notFound } from '../http/errors.js';
import { bytes, json, type Reply, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { getObject, putObject, synthesisKey } from '../services/storage.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkText } from '../../shared/text.js';
import type { SynthesisJobView, Voice } from '../../shared/types.js';

const voices: readonly Voice[] = ['lumen', 'basalt'];

interface JobRow {
  id: string;
  project_id: string;
  voice: Voice;
  characters: number;
  duration_ms: number;
  created_at: Date;
}

const jobView = (row: JobRow): SynthesisJobView => ({
  id: row.id,
  project_id: row.project_id,
  voice: row.voice,
  characters: row.characters,
  duration_ms: row.duration_ms,
  audio_url: `/v1/speak/${row.id}/audio`,
  console_audio_url: `/api/projects/${row.project_id}/synthesis/${row.id}/audio`,
  created_at: row.created_at.toISOString(),
});

/** A render is deterministic in its text and voice, and is stored before the job is returned. */
const renderJob = async (projectId: string, orgId: string, rawText: unknown, rawVoice: unknown): Promise<Reply> => {
  const fields = new FieldErrors();
  const text = checkText(rawText, 1, 1000);
  if (!text.ok) fields.add('text', fieldCopy.synthesisText);
  if (!voices.includes(rawVoice as Voice)) fields.add('voice', fieldCopy.voice);
  fields.raiseIfAny();

  const voice = rawVoice as Voice;
  const id = randomUUID();
  await putObject(synthesisKey(orgId, projectId, id), renderSynthesis(text.value, voice));
  await query(
    'insert into synthesis_jobs (id, project_id, voice, characters, duration_ms) values ($1, $2, $3, $4, $5)',
    [id, projectId, voice, text.length, synthesisDurationMs(text.value)],
  );
  const row = await queryOne<JobRow>(
    'select id, project_id, voice, characters, duration_ms, created_at from synthesis_jobs where id = $1',
    [id],
  );
  if (row === null) throw notFound();
  return json(201, { job: jobView(row) });
};

const loadJob = async (jobId: string, projectId: string): Promise<JobRow> => {
  if (!isUuid(jobId)) throw notFound();
  const row = await queryOne<JobRow>(
    'select id, project_id, voice, characters, duration_ms, created_at from synthesis_jobs where id = $1 and project_id = $2',
    [jobId, projectId],
  );
  if (row === null) throw notFound();
  return row;
};

export const registerSynthesisRoutes = (router: Router): void => {
  router.add('POST', '/api/projects/:projectId/synthesis', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_keys');
    const body = ctx.body;
    const keyId = body.key_id;
    const keyRow =
      isUuid(keyId)
        ? await queryOne<{ id: string; revoked_at: Date | null }>(
            'select id, revoked_at from api_keys where id = $1 and project_id = $2',
            [keyId, project.id],
          )
        : null;
    if (isUuid(keyId) && keyRow === null) throw notFound();
    if (keyRow !== null && keyRow.revoked_at !== null) throw conflict('key_revoked', 'That API key was revoked.');
    if (keyRow === null) {
      const fields = new FieldErrors();
      fields.add('key_id', fieldCopy.uploadKey);
      const text = checkText(body.text, 1, 1000);
      if (!text.ok) fields.add('text', fieldCopy.synthesisText);
      if (!voices.includes(body.voice as Voice)) fields.add('voice', fieldCopy.voice);
      fields.raiseIfAny();
    }
    return renderJob(project.id, project.org_id, body.text, body.voice);
  }, 'json');

  router.add('GET', '/api/projects/:projectId/synthesis/:jobId/audio', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_keys');
    const job = await loadJob(ctx.params.jobId as string, project.id);
    return bytes(200, await getObject(synthesisKey(project.org_id, project.id, job.id)), 'audio/wav');
  });

  router.add('POST', '/v1/speak', async (ctx) => {
    const keyActor = await requireKeyActor(ctx);
    const body = ctx.body;
    return renderJob(keyActor.project.id, keyActor.org.id, body.text, body.voice);
  }, 'json');

  router.add('GET', '/v1/speak/:jobId/audio', async (ctx) => {
    const keyActor = await requireKeyActor(ctx);
    const jobId = ctx.params.jobId as string;
    if (!isUuid(jobId)) throw invalidKey();
    const row = await queryOne<JobRow>(
      'select id, project_id, voice, characters, duration_ms, created_at from synthesis_jobs where id = $1 and project_id = $2',
      [jobId, keyActor.project.id],
    );
    if (row === null) throw invalidKey();
    return bytes(200, await getObject(synthesisKey(keyActor.org.id, keyActor.project.id, row.id)), 'audio/wav');
  });
};
