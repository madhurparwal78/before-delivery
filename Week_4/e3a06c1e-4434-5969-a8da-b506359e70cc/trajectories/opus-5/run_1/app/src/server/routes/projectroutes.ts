import { randomUUID } from 'node:crypto';
import {
  hashKeySecret,
  keyPrefix,
  newKeySecret,
  requireAction,
  requireActor,
  requireVisibleProject,
} from '../auth.js';
import { query, queryOne } from '../db/pool.js';
import { haltExhaustedProject, revokeKeySessions } from '../engine.js';
import { conflict, notFound } from '../http/errors.js';
import { json, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { correctionView, type CorrectionRow } from '../review.js';
import {
  keyView,
  loadProject,
  loadProjectsForMember,
  loadProjectsForOrg,
  projectUsage,
  projectView,
  projectViews,
  quotaFor,
  type ApiKeyRow,
} from '../store.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkText, normaliseText } from '../../shared/text.js';

const QUOTA_MIN = 1;
const QUOTA_MAX = 1_000_000;

/** Two names match when they are equal after the text-limit rule and Unicode lower-casing. */
const foldName = (name: string): string => name.toLowerCase();

const checkQuota = (raw: unknown): number | null => {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < QUOTA_MIN || value > QUOTA_MAX) return null;
  return value;
};

export const registerProjectRoutes = (router: Router): void => {
  router.add('GET', '/api/projects', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'read_projects');
    const projects = actor.seesAllProjects
      ? await loadProjectsForOrg(actor.org.id)
      : await loadProjectsForMember(actor.member.id);
    return json(200, { projects: await projectViews(projects, new Date()) });
  });

  router.add('POST', '/api/projects', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'manage_org');
    const body = ctx.body;

    const name = checkText(body.name, 1, 60);
    if (name.ok) {
      const taken = await queryOne<{ id: string }>(
        'select id from projects where org_id = $1 and name_folded = $2',
        [actor.org.id, foldName(name.value)],
      );
      if (taken !== null) throw conflict('name_taken', 'A project with this name already exists.');
    }
    const fields = new FieldErrors();
    if (!name.ok) fields.add('name', fieldCopy.projectName);
    const quota = checkQuota(body.monthly_quota_minutes);
    if (quota === null) fields.add('monthly_quota_minutes', fieldCopy.quota);
    fields.raiseIfAny();

    const id = randomUUID();
    const created = await query<{ id: string }>(
      `insert into projects (id, org_id, name, name_folded, monthly_quota_minutes)
       values ($1, $2, $3, $4, $5) on conflict (org_id, name_folded) do nothing returning id`,
      [id, actor.org.id, name.value, foldName(name.value), quota as number],
    );
    if (created.length === 0) throw conflict('name_taken', 'A project with this name already exists.');
    const project = await loadProject(id);
    if (project === null) throw notFound();
    const now = new Date();
    const usage = await projectUsage([id], now);
    return json(201, {
      project: projectView(project, usage.get(id) ?? { usedSeconds: 0, sessions: 0, pendingSessions: 0 }, now),
    });
  }, 'json');

  router.add('GET', '/api/projects/:projectId', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'read_projects');
    const now = new Date();
    const usage = await projectUsage([project.id], now);
    return json(200, {
      project: projectView(
        project,
        usage.get(project.id) ?? { usedSeconds: 0, sessions: 0, pendingSessions: 0 },
        now,
      ),
    });
  });

  router.add('PATCH', '/api/projects/:projectId/quota', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_org');
    const body = ctx.body;
    const fields = new FieldErrors();
    const quota = checkQuota(body.monthly_quota_minutes);
    if (quota === null) fields.add('monthly_quota_minutes', fieldCopy.quota);
    fields.raiseIfAny();

    await query('update projects set monthly_quota_minutes = $2 where id = $1', [project.id, quota as number]);
    const committed = await quotaFor({ ...project, monthly_quota_minutes: quota as number }, new Date());
    await haltExhaustedProject(project.id);
    return json(200, { quota: committed });
  }, 'json');

  router.add('GET', '/api/projects/:projectId/keys', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'read_keys');
    const rows = await query<ApiKeyRow>(
      'select id, project_id, name, prefix, created_at, revoked_at from api_keys where project_id = $1 order by created_at desc',
      [project.id],
    );
    return json(200, { keys: rows.map(keyView) });
  });

  router.add('POST', '/api/projects/:projectId/keys', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_keys');
    const body = ctx.body;
    const fields = new FieldErrors();
    const name = checkText(body.name, 1, 60);
    if (!name.ok) fields.add('name', fieldCopy.keyName);
    fields.raiseIfAny();

    const secret = newKeySecret();
    const id = randomUUID();
    await query(
      'insert into api_keys (id, project_id, name, prefix, key_hash) values ($1, $2, $3, $4, $5)',
      [id, project.id, normaliseText(name.value), keyPrefix(secret), hashKeySecret(secret)],
    );
    const row = await queryOne<ApiKeyRow>(
      'select id, project_id, name, prefix, created_at, revoked_at from api_keys where id = $1',
      [id],
    );
    if (row === null) throw notFound();
    return json(201, { key: keyView(row), secret });
  }, 'json');

  router.add('DELETE', '/api/projects/:projectId/keys/:keyId', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_keys');
    const row = await queryOne<ApiKeyRow>(
      'select id, project_id, name, prefix, created_at, revoked_at from api_keys where id = $1 and project_id = $2',
      [ctx.params.keyId as string, project.id],
    );
    if (row === null) throw notFound();
    if (row.revoked_at !== null) throw conflict('already_revoked', 'That key was already revoked.');
    const revoked = await query<ApiKeyRow>(
      `update api_keys set revoked_at = now() where id = $1 and revoked_at is null
       returning id, project_id, name, prefix, created_at, revoked_at`,
      [row.id],
    );
    const updated = revoked[0];
    if (updated === undefined) throw conflict('already_revoked', 'That key was already revoked.');
    const closed = await revokeKeySessions(row.id);
    return json(200, { key: keyView(updated), closed_sessions: closed });
  });

  router.add('GET', '/api/projects/:projectId/corrections', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'read_corrections');
    const state = ctx.search.get('state');
    const rows = await query<CorrectionRow>(
      `select c.id, c.session_id, c.segment_id, c.author_id, m.name as author_name, c.state, c.text, c.note,
         c.created_at, c.submitted_at, c.decided_at, c.decided_by
       from corrections c
       join members m on m.id = c.author_id
       join sessions s on s.id = c.session_id
      where s.project_id = $1 and ($2::text is null or c.state = $2)
      order by c.created_at desc`,
      [project.id, state],
    );
    return json(200, { corrections: rows.map(correctionView) });
  });
};
