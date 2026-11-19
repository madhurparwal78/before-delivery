import type { Express, Request, Response } from 'express';
import { q, one } from './db.js';
import { unauthenticated, notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { now, nowMs } from './clock.js';
import { requireUser, type SessionUser } from './http.js';
import { randomToken } from './config.js';
import { queueMail, formatForRecipient } from './mail.js';
import { config } from './http.js';
import { relativeTime, formatNumber } from '../shared/rules.js';

export interface ProjectRow { id: string; name: string; owner_id: string }

async function membership(projectId: number, userId: number): Promise<string | null> {
  const row = await one<{ role: string }>('select role from memberships where project_id = $1 and user_id = $2', [projectId, userId]);
  return row?.role ?? null;
}

export async function requireMember(projectId: number, userId: number): Promise<string> {
  const role = await membership(projectId, userId);
  if (!role) throw notFound();
  return role;
}

export async function requireOwner(projectId: number, userId: number): Promise<void> {
  const role = await requireMember(projectId, userId);
  if (role !== 'owner') throw forbidden('Only the project owner can do this');
}

export function publicUrl(req: Request): string {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get('host') ?? `127.0.0.1:${config.port}`}`;
}

export async function recordActivity(projectId: number, spriteId: number | null, kind: string, by: number, sentence: string, eventKey: string | null): Promise<void> {
  // Consecutive strokes by one person within 60 seconds of the group's first
  // event merge into one sentence.
  if (kind === 'stroke' && spriteId) {
    const recent = await one<{ id: string; sentence: string }>(
      `select a.id, a.sentence from activity a where a.project_id = $1 and a.sprite_id = $2 and a.by = $3 and a.kind = 'stroke'
       and a.event_key is not null order by a.id desc limit 1`,
      [projectId, spriteId, by]
    );
    if (recent) {
      const row = await one<{ at: string }>('select at from activity where id = $1', [recent.id]);
      const atMs = Date.parse(row!.at);
      const nowValue = Date.parse(await now());
      if (nowValue - atMs < 60000) {
        const strokes = recent.sentence.match(/in (\d+) strokes/) ? Number(recent.sentence.match(/in (\d+) strokes/)![1]) : 1;
        const prevPx = parseInt(recent.sentence.match(/painted ([\d,]+) pixels/)?.[1]?.replace(/,/g, '') ?? '0', 10);
        const thisPx = parseInt(sentence.match(/painted ([\d,]+) pixels/)?.[1]?.replace(/,/g, '') ?? '0', 10);
        const total = prevPx + thisPx;
        const sprite = await one<{ name: string }>('select name from sprites where id = $1', [spriteId]);
        const person = await one<{ name: string }>('select name from users where id = $1', [by]);
        await q('update activity set sentence = $1 where id = $2',
          [`${person!.name} painted ${formatNumber(total, 'en-US')} pixels in ${strokes + 1} strokes on ${sprite!.name}`, recent.id]);
        return;
      }
    }
  }
  await q('insert into activity (project_id, sprite_id, kind, by, sentence, at, event_key) values ($1, $2, $3, $4, $5, $6, $7)',
    [projectId, spriteId, kind, by, sentence, await now(), eventKey]);
}

export function registerProjectRoutes(app: Express): void {
  app.get('/api/projects', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const rows = await q<{ id: string; name: string; role: string }>(
        `select p.id::text, p.name, m.role from projects p join memberships m on m.project_id = p.id
         where m.user_id = $1 order by p.id asc`,
        [user.id]
      );
      res.json({ projects: rows.map((r) => ({ id: Number(r.id), name: r.name, role: r.role })) });
    } catch (e) { next(e); }
  });

  app.post('/api/projects', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const name = String((req.body as Record<string, unknown>)['name'] ?? '').trim();
      if (!name) throw fieldErrors({ name: 'Write a project name' });
      const at = await now();
      const project = await one<{ id: string }>('insert into projects (name, owner_id, created_at) values ($1, $2, $3) returning id::text', [name, user.id, at]);
      await q('insert into memberships (project_id, user_id, role, joined_at) values ($1, $2, $3, $4)', [project!.id, user.id, 'owner', at]);
      res.status(201).json({ id: Number(project!.id), name, role: 'owner' });
    } catch (e) { next(e); }
  });

  app.get('/api/projects/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const role = await requireMember(Number(req.params.id), user.id);
      const members = await q<{ id: string; name: string; email: string; role: string }>(
        `select u.id::text, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
         where m.project_id = $1 order by m.joined_at asc, m.id asc`,
        [req.params.id]
      );
      const sprites = await q<{ id: string; name: string }>('select id::text, name from sprites where project_id = $1 order by id asc', [req.params.id]);
      const project = await one<{ name: string }>('select name from projects where id = $1', [req.params.id]);
      res.json({
        id: Number(req.params.id), name: project!.name, role,
        members: members.map((m) => ({ id: Number(m.id), name: m.name, email: m.email, role: m.role })),
        sprites: sprites.map((s) => ({ id: Number(s.id), name: s.name }))
      });
    } catch (e) { next(e); }
  });

  app.patch('/api/projects/:id/members/:userId', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireOwner(projectId, user.id);
      const target = Number(req.params.userId);
      const owner = await one<{ owner_id: string }>('select owner_id::text from projects where id = $1', [projectId]);
      if (owner!.owner_id === String(target)) throw conflict('owner_required');
      const role = String((req.body as Record<string, unknown>)['role'] ?? '');
      if (role !== 'editor' && role !== 'reviewer') throw fieldErrors({ role: 'Use editor or reviewer' });
      await q('update memberships set role = $1 where project_id = $2 and user_id = $3', [role, projectId, target]);
      res.json({ id: target, role });
    } catch (e) { next(e); }
  });

  app.delete('/api/projects/:id/members/:userId', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireOwner(projectId, user.id);
      const target = Number(req.params.userId);
      const owner = await one<{ owner_id: string }>('select owner_id::text from projects where id = $1', [projectId]);
      if (owner!.owner_id === String(target)) throw conflict('owner_required');
      await q('delete from memberships where project_id = $1 and user_id = $2', [projectId, target]);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  app.get('/api/projects/:id/invites', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireOwner(projectId, user.id);
      const rows = await q<{ id: string; email: string; role: string; state: string; expires_at: string }>(
        'select id::text, email, role, state, expires_at from invites where project_id = $1 order by id desc', [projectId]
      );
      res.json({ invites: rows.map((r) => ({ id: Number(r.id), email: r.email, role: r.role, state: r.state, expires_at: r.expires_at })) });
    } catch (e) { next(e); }
  });

  app.post('/api/projects/:id/invites', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireOwner(projectId, user.id);
      const email = String((req.body as Record<string, unknown>)['email'] ?? '').trim().toLowerCase();
      const role = String((req.body as Record<string, unknown>)['role'] ?? '');
      if (role !== 'editor' && role !== 'reviewer') throw fieldErrors({ role: 'Use editor or reviewer' });
      const member = await one<{ id: string }>(
        `select u.id::text from memberships m join users u on u.id = m.user_id where m.project_id = $1 and lower(u.email) = $2`,
        [projectId, email]
      );
      if (member) throw conflict('already_member');
      const pending = await one<{ id: string }>(
        'select id::text from invites where project_id = $1 and email = $2 and state = $3', [projectId, email, 'pending']
      );
      if (pending) throw conflict('invite_pending');
      const token = 'inv-' + randomToken().slice(0, 12);
      const expires = new Date(Date.parse(await now()) + config.inviteTtlSeconds * 1000).toISOString();
      const row = await one<{ id: string }>(
        'insert into invites (project_id, email, role, token, state, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7) returning id::text',
        [projectId, email, role, token, 'pending', expires, await now()]
      );
      const project = await one<{ name: string }>('select name from projects where id = $1', [projectId]);
      const target = await one<{ number_format: string; time_zone: string }>('select number_format, time_zone from users where email = $1', [email]);
      const dateText = formatForRecipient(expires, target?.number_format ?? 'en-US', target?.time_zone ?? 'UTC');
      await queueMail(email, `Join ${project!.name} on Celmate`, `Role: ${role}\nExpires: ${dateText}\nAccept: ${publicUrl(req)}/invites/${token}`);
      await recordActivity(projectId, null, 'invite', user.id, `${user.name} invited ${email}`, null);
      res.status(201).json({ id: Number(row!.id), state: 'pending', expires_at: expires });
    } catch (e) { next(e); }
  });

  app.delete('/api/invites/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ id: string; project_id: string; state: string }>('select id::text, project_id::text, state from invites where id = $1', [req.params.id]);
      if (!row) throw notFound();
      await requireOwner(Number(row.project_id), user.id);
      if (row.state !== 'pending') throw conflict('invite_closed');
      await q('update invites set state = $1 where id = $2', ['revoked', row.id]);
      res.json({ state: 'revoked' });
    } catch (e) { next(e); }
  });

  app.get('/api/invites/:token', async (req, res, next) => {
    try {
      const row = await one<{ project: string; role: string; state: string; expires_at: string }>(
        `select project_id::text as project, role, state, expires_at from invites where token = $1`,
        [req.params.token]
      );
      if (!row) throw notFound();
      res.json({ project: Number(row.project), role: row.role, state: row.state, expires_at: row.expires_at });
    } catch (e) { next(e); }
  });

  app.post('/api/invites/:token/accept', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const row = await one<{ id: string; project_id: string; email: string; role: string; state: string; expires_at: string }>(
        'select id::text, project_id::text, email, role, state, expires_at from invites where token = $1',
        [req.params.token]
      );
      if (!row) throw notFound();
      const nowIso = await now();
      if (row.state === 'accepted') throw conflict('invite_used');
      if (row.state === 'revoked') throw conflict('invite_revoked');
      if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(nowIso)) {
        await q('update invites set state = $1 where id = $2', ['lapsed', row.id]);
        throw conflict('invite_lapsed', { message: 'This invite has lapsed' });
      }
      if (row.state === 'lapsed') throw conflict('invite_lapsed', { message: 'This invite has lapsed' });
      if (row.email.toLowerCase() !== user.email.toLowerCase()) {
        throw forbidden('This invite is for another email');
      }
      await q('update invites set state = $1 where id = $2', ['accepted', row.id]);
      await q('insert into memberships (project_id, user_id, role, joined_at) values ($1, $2, $3, $4) on conflict (project_id, user_id) do nothing',
        [row.project_id, user.id, row.role, nowIso]);
      res.json({ project: Number(row.project_id), role: row.role });
    } catch (e) { next(e); }
  });

  app.get('/api/projects/:id/activity', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const projectId = Number(req.params.id);
      await requireMember(projectId, user.id);
      const cursor = req.query.cursor ? String(req.query.cursor) : null;
      const size = config.activityPage;
      let rows: { id: string; sentence: string; at: string }[];
      if (cursor) {
        rows = await q<{ id: string; sentence: string; at: string }>(
          'select id::text, sentence, at from activity where project_id = $1 and id < $2 order by id desc limit $3',
          [projectId, cursor, size + 1]
        );
      } else {
        rows = await q<{ id: string; sentence: string; at: string }>(
          'select id::text, sentence, at from activity where project_id = $1 order by id desc limit $2',
          [projectId, size + 1]
        );
      }
      const hasMore = rows.length > size;
      const page = rows.slice(0, size);
      res.json({
        items: page.map((r) => ({ id: Number(r.id), sentence: r.sentence, at: r.at })),
        next_cursor: hasMore ? Number(page[page.length - 1].id) : null
      });
    } catch (e) { next(e); }
  });
}
