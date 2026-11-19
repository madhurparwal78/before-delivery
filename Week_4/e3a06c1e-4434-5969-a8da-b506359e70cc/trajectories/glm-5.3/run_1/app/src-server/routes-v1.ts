// /v1 routes: the live WebSocket upgrade, synthesis and synthesis audio.

import { errors } from './errors';
import { json, route, type Ctx, type Route } from './router';
import { readJson } from './body';
import { principalForToken } from './auth';
import { checkText, splitWords } from '../src-shared/text';
import { UPLOAD_STATUS, FIELD_MESSAGES, SYNTHESIS_STATUS } from '../src-shared/copy';
import { renderSynthesis } from '../src-shared/audio';
import { Storage } from './storage';
import { iso } from './api';
import { randomUUID } from 'node:crypto';

export function v1Routes(): Route[] {
  return [
    route('POST', '/v1/speak', async (ctx: Ctx) => {
      const principal = await v1Auth(ctx);
      const body = await readJson(ctx.req);
      const text = typeof body.text === 'string' ? body.text : '';
      const voice = body.voice;
      const fields: Record<string, string> = {};
      const textCheck = checkText(text, 1, 1000);
      if (!textCheck.ok) fields.text = SYNTHESIS_STATUS.textError;
      if (voice !== 'lumen' && voice !== 'basalt') fields.voice = SYNTHESIS_STATUS.voiceError;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const synthText = (textCheck as { value: string }).value;
      const synthVoice = voice as 'lumen' | 'basalt';
      const render = renderSynthesis(synthText, synthVoice);
      const jobId = randomUUID();
      let characters = 0;
      for (const _ of synthText) characters++;
      const durationMs = Math.round((render.length - 44) / 32);
      await ctx.db.query(
        `INSERT INTO synthesis_jobs (id, project_id, voice, characters, duration_ms, render_key) VALUES ($1,$2,$3,$4,$5,$6)`,
        [jobId, principal.project_id, synthVoice, characters, durationMs, `${jobId}`],
      );
      await ctx.storage.put(Storage.synthesisKey(principal.org_id, principal.project_id, jobId), Buffer.from(render), 'audio/wav');
      json(ctx, 201, {
        job: {
          id: jobId, project_id: principal.project_id, voice,
          characters, duration_ms: durationMs,
          audio_url: `/v1/speak/${jobId}/audio`,
          console_audio_url: `/api/projects/${principal.project_id}/synthesis/${jobId}/audio`,
          created_at: iso(new Date()),
        },
      });
    }),

    route('GET', '/v1/speak/:job_id/audio', async (ctx: Ctx) => {
      const principal = await v1Auth(ctx);
      const jobId = ctx.url.pathname.split('/')[3];
      const { rows } = await ctx.db.query(`SELECT id, project_id FROM synthesis_jobs WHERE id=$1`, [jobId]);
      if (rows.length === 0 || String(rows[0].project_id) !== principal.project_id) throw errors.notFound();
      const data = await ctx.storage.get(Storage.synthesisKey(principal.org_id, principal.project_id, jobId));
      ctx.res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length });
      ctx.res.end(data);
    }),
  ];
}

export async function v1Auth(ctx: Ctx): Promise<{ key_id: string; project_id: string; org_id: string }> {
  const header = ctx.req.headers.authorization;
  const m = /^Token (.+)$/.exec(String(header ?? ''));
  if (!m) throw errors.invalidKey();
  const principal = await principalForToken(ctx.db, m[1]);
  if (!principal) throw errors.invalidKey();
  return principal;
}
