// Projects, quota, API keys and synthesis routes.

import { randomUUID } from 'node:crypto';
import { errors } from './errors';
import { json, route, type Ctx, type Route } from './router';
import { readJson, readMultipart } from './body';
import { requireAction, requireProjectVisible } from './access';
import { newApiSecret } from './auth';
import { checkText, foldName } from '../src-shared/text';
import { PROJECT_ERRORS, KEYS_STATUS, SYNTHESIS_STATUS, FIELD_MESSAGES } from '../src-shared/copy';
import {
  iso, sessionObject, SESSION_COLUMNS, loadSessionRow, requireQuotaForProject,
} from './api';
import { Storage } from './storage';
import { renderSynthesis } from '../src-shared/audio';
import { splitWords } from '../src-shared/text';
import type { PlanId } from '../src-shared/billing';

export function projectRoutes(): Route[] {
  return [
    route('GET', '/api/projects', async (ctx: Ctx) => {
      if (!ctx.member) throw errors.unauthenticated();
      requireAction(ctx.member, 'listProjects');
      const { rows } = await ctx.db.query(
        `SELECT p.id, p.name, p.monthly_quota_minutes FROM projects p WHERE p.org_id=$1 ORDER BY p.created_at`,
        [ctx.member.org_id],
      );
      const out = [];
      for (const p of rows) {
        const quota = await ctx.hub.quotaFor(String(p.id), p.monthly_quota_minutes as number);
        const { rows: sc } = await ctx.db.query(
          `SELECT count(*)::int AS n FROM sessions
            WHERE project_id=$1 AND ended_at >= $2 AND billing_state IN ('pending','confirmed')`,
          [String(p.id), quota.period_start],
        );
        out.push({ id: String(p.id), name: p.name, sessions: sc[0].n, quota });
      }
      json(ctx, 200, { projects: out });
    }),

    route('POST', '/api/projects', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'createProjects');
      const body = await readJson(ctx.req);
      const name = typeof body.name === 'string' ? body.name : '';
      const quotaRaw = body.monthly_quota_minutes;
      const fields: Record<string, string> = {};
      const nameCheck = checkText(name, 1, 60);
      if (!nameCheck.ok) fields.name = PROJECT_ERRORS.name;
      if (typeof quotaRaw !== 'number' || !Number.isInteger(quotaRaw) || quotaRaw < 1 || quotaRaw > 1000000) {
        fields.monthly_quota_minutes = PROJECT_ERRORS.quota;
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      const projectName = (nameCheck as { value: string }).value;

      const id = randomUUID();
      // The database decides name conflicts via the unique folded constraint (DP-11).
      const { rowCount } = await ctx.db.query(
        `INSERT INTO projects (id, org_id, name, name_folded, monthly_quota_minutes) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_id, name_folded) DO NOTHING`,
        [id, member.org_id, projectName, foldName(name), quotaRaw],
      );
      if (rowCount === 0) throw errors.conflict('name_taken', PROJECT_ERRORS.nameTaken);
      const quota = await ctx.hub.quotaFor(id, quotaRaw as number);
      json(ctx, 201, { project: { id, name: projectName, sessions: 0, quota } });
    }),

    route('GET', '/api/projects/:project_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'listProjects');
      const id = ctx.url.pathname.split('/')[3];
      const p = await requireProjectVisible(ctx.db, member, id);
      const quota = await ctx.hub.quotaFor(p.id, p.monthly_quota_minutes);
      const { rows: sc } = await ctx.db.query(
        `SELECT count(*)::int AS n FROM sessions WHERE project_id=$1 AND ended_at >= $2 AND billing_state IN ('pending','confirmed')`,
        [p.id, quota.period_start],
      );
      json(ctx, 200, { project: { id: p.id, name: p.name, sessions: sc[0].n, quota } });
    }),

    route('PATCH', '/api/projects/:project_id/quota', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'createProjects');
      const id = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, id);
      const body = await readJson(ctx.req);
      const quotaRaw = body.monthly_quota_minutes;
      if (typeof quotaRaw !== 'number' || !Number.isInteger(quotaRaw) || quotaRaw < 1 || quotaRaw > 1000000) {
        throw errors.validation({ monthly_quota_minutes: PROJECT_ERRORS.quota });
      }
      // Each save applies whole; the reply carries the quota as this request committed it.
      await ctx.db.query(`UPDATE projects SET monthly_quota_minutes=$2 WHERE id=$1`, [id, quotaRaw]);
      const quota = await ctx.hub.quotaFor(id, quotaRaw as number);
      // Lowering to or below usage halts open sessions within 1s (the hub pulse does this).
      await ctx.hub.enforceQuotas();
      json(ctx, 200, { quota });
    }),

    route('GET', '/api/projects/:project_id/keys', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'listKeys');
      const id = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, id);
      const { rows } = await ctx.db.query(
        `SELECT id, name, prefix, created_at, revoked_at FROM api_keys WHERE project_id=$1 ORDER BY created_at`,
        [id],
      );
      json(ctx, 200, {
        keys: rows.map((k) => ({
          id: String(k.id), name: k.name, prefix: k.prefix,
          created_at: iso(k.created_at), revoked_at: k.revoked_at ? iso(k.revoked_at) : null,
        })),
      });
    }),

    route('POST', '/api/projects/:project_id/keys', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageKeys');
      const id = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, id);
      const body = await readJson(ctx.req);
      const name = typeof body.name === 'string' ? body.name : '';
      const nameCheck = checkText(name, 1, 60);
      if (!nameCheck.ok) throw errors.validation({ name: KEYS_STATUS.keyNameError });
      const keyName = nameCheck.value;
      const keyId = randomUUID();
      const { secret, prefix, hash } = newApiSecret();
      await ctx.db.query(
        `INSERT INTO api_keys (id, project_id, name, prefix, secret_hash) VALUES ($1,$2,$3,$4,$5)`,
        [keyId, id, keyName, prefix, hash],
      );
      json(ctx, 201, {
        key: { id: keyId, name: keyName, prefix, created_at: iso(new Date()), revoked_at: null },
        secret,
      });
    }),

    route('DELETE', '/api/projects/:project_id/keys/:key_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageKeys');
      const parts = ctx.url.pathname.split('/');
      await requireProjectVisible(ctx.db, member, parts[3]);
      const keyId = parts[5];
      const { rows } = await ctx.db.query(`SELECT id, project_id FROM api_keys WHERE id=$1`, [keyId]);
      if (rows.length === 0 || String(rows[0].project_id) !== parts[3]) throw errors.notFound();
      const updated = await ctx.db.query(
        `UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id, name, prefix, created_at`,
        [keyId],
      );
      if (updated.rows.length === 0) throw errors.conflict('already_revoked', 'This key is already revoked.');
      const closed = await ctx.hub.revokeKey(keyId);
      json(ctx, 200, {
        key: {
          id: String(updated.rows[0].id), name: updated.rows[0].name, prefix: updated.rows[0].prefix,
          created_at: iso(updated.rows[0].created_at), revoked_at: iso(new Date()),
        },
        closed_sessions: closed,
      });
    }),

    route('POST', '/api/projects/:project_id/synthesis', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'runSessions');
      const projectId = ctx.url.pathname.split('/')[3];
      const project = await requireProjectVisible(ctx.db, member, projectId);
      const body = await readJson(ctx.req);
      const keyId = typeof body.key_id === 'string' ? body.key_id : '';
      const text = typeof body.text === 'string' ? body.text : '';
      const voice = body.voice;
      const fields: Record<string, string> = {};
      if (keyId === '') fields.key_id = SYNTHESIS_STATUS.keyError;
      const textCheck = checkText(text, 1, 1000);
      if (!textCheck.ok) fields.text = SYNTHESIS_STATUS.textError;
      if (voice !== 'lumen' && voice !== 'basalt') fields.voice = SYNTHESIS_STATUS.voiceError;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      const synthText = (textCheck as { value: string }).value;
      const synthVoice = voice as 'lumen' | 'basalt';

      const { rows: keyRows } = await ctx.db.query(`SELECT id, revoked_at FROM api_keys WHERE id=$1 AND project_id=$2`, [keyId, projectId]);
      if (keyRows.length === 0) throw errors.notFound();
      if (keyRows[0].revoked_at !== null) throw errors.conflict('key_revoked', 'Choose an active API key.');

      const render = renderSynthesis(synthText, synthVoice);
      const jobId = randomUUID();
      // Stored byte for byte; the stored key is derived from the render bytes so retries stay identical.
      const renderKey = `synth:${Buffer.from(render).length}:${synthVoice}:${synthText.length}`;
      await ctx.db.query(
        `INSERT INTO synthesis_jobs (id, project_id, voice, characters, duration_ms, render_key) VALUES ($1,$2,$3,$4,$5,$6)`,
        [jobId, projectId, synthVoice, textLengthOf(synthText), Math.round((render.length - 44) / 32), renderKey],
      );
      const key = Storage.synthesisKey(member.org_id, project.id, jobId);
      await ctx.storage.put(key, Buffer.from(render), 'audio/wav');
      json(ctx, 201, {
        job: {
          id: jobId, project_id: projectId, voice,
          characters: textLengthOf(synthText),
          duration_ms: Math.round((render.length - 44) / 32),
          audio_url: `/v1/speak/${jobId}/audio`,
          console_audio_url: `/api/projects/${projectId}/synthesis/${jobId}/audio`,
          created_at: iso(new Date()),
        },
      });
    }),

    route('GET', '/api/projects/:project_id/synthesis/:job_id/audio', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'runSessions');
      const parts = ctx.url.pathname.split('/');
      const project = await requireProjectVisible(ctx.db, member, parts[3]);
      const jobId = parts[5];
      const { rows } = await ctx.db.query(`SELECT id FROM synthesis_jobs WHERE id=$1 AND project_id=$2`, [jobId, parts[3]]);
      if (rows.length === 0) throw errors.notFound();
      const data = await ctx.storage.get(Storage.synthesisKey(member.org_id, project.id, jobId));
      const { res } = ctx;
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      res.end(data);
    }),
  ];
}

function textLengthOf(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export { requireQuotaForProject, loadSessionRow, sessionObject, SESSION_COLUMNS };
export type { PlanId };
