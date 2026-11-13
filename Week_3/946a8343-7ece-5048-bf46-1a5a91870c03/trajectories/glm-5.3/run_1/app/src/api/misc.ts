import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, groupById, canReadGroup } from './common.js';
import { ROLE_LEVEL, groupAccess } from '../domain/access.js';
import { renderWiki } from '../domain/wiki-render.js';

export async function getWikiPage(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const slug = rc.params.slug;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const page = (await client.query(`SELECT id FROM wiki_pages WHERE project_id = $1 AND slug = $2`, [id, slug])).rows[0];
    if (!page) throw errs.notFound();
    const version = (await client.query(`SELECT version, title, content, author, created_at FROM wiki_versions WHERE page_id = $1 ORDER BY version DESC LIMIT 1`, [page.id])).rows[0];
    if (!version) throw errs.notFound();
    return { slug, version: version.version, title: version.title, content: version.content, html: renderWiki(version.content) };
  } finally {
    client.release();
  }
}

export async function putWikiPage(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const slug = rc.params.slug;
  const body = requireBody(rc);
  const title = typeof body.title === 'string' ? body.title : '';
  const content = typeof body.content === 'string' ? body.content : '';
  const baseVersion = typeof body.base_version === 'number' ? body.base_version : 0;
  if (title === '') throw errs.validation({ title: "Title can't be blank." });
  if (!/^[a-z0-9-/]+$/.test(slug) || slug === '') throw errs.validation({ slug: 'Slug must use a-z, 0-9, - and /.' });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const page = (await client.query<{ id: number }>(`SELECT id FROM wiki_pages WHERE project_id = $1 AND slug = $2`, [id, slug])).rows[0];
    const now = rc.ctx.now();
    if (!page) {
      if (baseVersion !== 0) {
        throw new AppError(409, 'stale_wiki', `Someone edited this page. Your base version ${baseVersion} is behind 1.`);
      }
      const newPage = await client.query<{ id: number }>(`INSERT INTO wiki_pages (project_id, slug) VALUES ($1, $2) RETURNING id`, [id, slug]);
      await client.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, 1, $2, $3, $4, $5)`,
        [newPage.rows[0].id, title, content, rc.user.username, now]);
      const seq = await rc.ctx.live(client, id, 'wiki', { slug, version: 1, event: 'created' });
      await client.query('COMMIT');
      return { slug, version: 1, title, content, html: renderWiki(content), seq };
    }
    const latest = (await client.query<{ version: number; author: string }>(`SELECT version, author FROM wiki_versions WHERE page_id = $1 ORDER BY version DESC LIMIT 1`, [page.id])).rows[0];
    if (baseVersion !== latest.version) {
      throw new AppError(409, 'stale_wiki', `${latest.author} edited this page. Your base version ${baseVersion} is behind ${latest.version}.`);
    }
    const nextVersion = latest.version + 1;
    await client.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [page.id, nextVersion, title, content, rc.user.username, now]);
    const seq = await rc.ctx.live(client, id, 'wiki', { slug, version: nextVersion, event: 'updated' });
    await client.query('COMMIT');
    return { slug, version: nextVersion, title, content, html: renderWiki(content), seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function wikiVersions(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const slug = rc.params.slug;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const page = (await client.query(`SELECT id FROM wiki_pages WHERE project_id = $1 AND slug = $2`, [id, slug])).rows[0];
    if (!page) throw errs.notFound();
    const versions = (await client.query(`SELECT version, title, content, author, created_at FROM wiki_versions WHERE page_id = $1 ORDER BY version DESC`, [page.id])).rows;
    return { versions };
  } finally {
    client.release();
  }
}

export async function restoreWikiVersion(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const slug = rc.params.slug;
  const body = requireBody(rc);
  const version = typeof body.version === 'number' ? body.version : null;
  if (version === null) throw errs.validation({ version: "Version can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const page = (await client.query<{ id: number }>(`SELECT id FROM wiki_pages WHERE project_id = $1 AND slug = $2`, [id, slug])).rows[0];
    if (!page) throw errs.notFound();
    const src = (await client.query(`SELECT title, content FROM wiki_versions WHERE page_id = $1 AND version = $2`, [page.id, version])).rows[0];
    if (!src) throw errs.notFound();
    const latest = (await client.query<{ version: number }>(`SELECT version FROM wiki_versions WHERE page_id = $1 ORDER BY version DESC LIMIT 1`, [page.id])).rows[0];
    const next = latest.version + 1;
    await client.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [page.id, next, src.title, src.content, rc.user.username, rc.ctx.now()]);
    const seq = await rc.ctx.live(client, id, 'wiki', { slug, version: next, event: 'restored' });
    await client.query('COMMIT');
    return { slug, version: next, title: src.title, content: src.content, html: renderWiki(src.content), seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function createWebhook(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const url = typeof body.url === 'string' ? body.url : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const events = Array.isArray(body.events) ? body.events.map(String) : [];
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    if (!isAllowedTarget(url, rc.ctx.settings.webhookAllow)) {
      throw new AppError(422, 'target_not_allowed', "This target isn't on the allow-list.", { fields: { url: "This target isn't on the allow-list." } });
    }
    const r = await client.query<{ id: number }>(`INSERT INTO webhooks (project_id, url, secret, events, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, url, secret, events, rc.ctx.now()]);
    return { id: r.rows[0].id };
  } finally {
    client.release();
  }
}

export function isAllowedTarget(url: string, allow: string[]): boolean {
  if (allow.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const hostPort = `${parsed.hostname}:${port}`;
  return allow.includes(hostPort);
}

export async function listDeliveries(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const webhookId = Number(rc.params.webhook_id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const hook = (await client.query(`SELECT id FROM webhooks WHERE id = $1 AND project_id = $2`, [webhookId, id])).rows[0];
    if (!hook) throw errs.notFound();
    const deliveries = (await client.query(`SELECT id, event, state, attempts, next_at, retry_step, created_at FROM deliveries WHERE webhook_id = $1 ORDER BY id DESC`, [webhookId])).rows;
    const out = [];
    for (const d of deliveries) {
      const attempts = (await client.query(`SELECT number, status_code, at FROM delivery_attempts WHERE delivery_id = $1 ORDER BY number`, [d.id])).rows;
      out.push({ id: d.id, event: d.event, state: d.state, attempts, next_at: d.next_at, attempts_count: d.attempts });
    }
    return { deliveries: out };
  } finally {
    client.release();
  }
}

export async function redeliver(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const deliveryId = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const delivery = (await client.query<{ id: number; webhook_id: number; event: string; payload: string }>(`SELECT id, webhook_id, event, payload FROM deliveries WHERE id = $1`, [deliveryId])).rows[0];
    if (!delivery) throw errs.notFound();
    const hook = (await client.query<{ project_id: number; url: string }>(`SELECT project_id, url FROM webhooks WHERE id = $1`, [delivery.webhook_id])).rows[0];
    if (!hook) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, hook.project_id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const r = await client.query<{ id: number }>(`INSERT INTO deliveries (webhook_id, event, payload, state, attempts, next_at, retry_step, created_at) VALUES ($1, $2, $3, 'pending', 0, $4, 0, $4) RETURNING id`,
      [delivery.webhook_id, delivery.event, delivery.payload, rc.ctx.now()]);
    const seq = await rc.ctx.live(client, hook.project_id, 'instance', { kind: 'delivery', id: r.rows[0].id });
    await client.query('COMMIT');
    return { id: r.rows[0].id, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function projectAudit(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (!(access.level >= ROLE_LEVEL.owner || access.permissions.has('read_audit'))) {
      throw errs.forbidden();
    }
    const events = (await client.query(`SELECT id, actor, action, target, before, after, at FROM audit_events WHERE project_id = $1 ORDER BY id DESC`, [id])).rows;
    return { events };
  } finally {
    client.release();
  }
}

export async function groupAudit(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const acc = await groupAccess(client, id, rc.user.id);
    if (!(acc.level >= ROLE_LEVEL.owner || acc.permissions.has('read_audit'))) {
      throw errs.forbidden();
    }
    const events = (await client.query(`SELECT id, actor, action, target, before, after, at FROM audit_events WHERE group_id = $1 ORDER BY id DESC`, [id])).rows;
    return { events };
  } finally {
    client.release();
  }
}

export async function search(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const scope = rc.query.get('scope') ?? 'code';
  const q = rc.query.get('q') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const results: unknown[] = [];
    if (scope === 'code') {
      const projects = (await client.query<{ id: number; path: string; default_branch: string }>(`SELECT id, path, default_branch FROM projects`)).rows;
      const { effectiveAccess } = await import('../domain/access.js');
      for (const p of projects) {
        const access = await effectiveAccess(client, p.id, rc.user!.id);
        if (!access.member && !access.implied) continue;
        const head = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [p.id, p.default_branch])).rows[0]?.commit_id;
        if (!head) continue;
        const { filesOf } = await import('../domain/merge-service.js');
        const files = await filesOf(client, rc.ctx, head);
        for (const [path, content] of [...files.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
          const lines = content.split('\n');
          lines.forEach((line, i) => {
            if (line.toLowerCase().includes(q.toLowerCase())) {
              results.push({ project: p.id, path, line: i + 1, text: line });
            }
          });
        }
      }
    } else if (scope === 'issues') {
      const projects = (await client.query<{ id: number }>(`SELECT id FROM projects`)).rows;
      const { effectiveAccess } = await import('../domain/access.js');
      for (const p of projects) {
        const access = await effectiveAccess(client, p.id, rc.user!.id);
        if (!access.member && !access.implied) continue;
        const issues = (await client.query(`SELECT iid, title, confidential, author_id FROM issues WHERE project_id = $1`, [p.id])).rows;
        for (const i of issues) {
          if (i.confidential) {
            const isAuthor = i.author_id === rc.user!.id;
            const isAssignee = (await client.query(`SELECT 1 FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [i.id, rc.user!.id]));
            void isAssignee;
            const member = access.member && access.level >= ROLE_LEVEL.reporter;
            if (!isAuthor && !member) continue;
          }
          if (i.title.toLowerCase().includes(q.toLowerCase())) {
            results.push({ project: p.id, iid: i.iid, title: i.title });
          }
        }
      }
    } else if (scope === 'requests') {
      const projects = (await client.query<{ id: number }>(`SELECT id FROM projects`)).rows;
      const { effectiveAccess } = await import('../domain/access.js');
      for (const p of projects) {
        const access = await effectiveAccess(client, p.id, rc.user!.id);
        if (!access.member && !access.implied) continue;
        const mrs = (await client.query(`SELECT iid, title FROM merge_requests WHERE project_id = $1`, [p.id])).rows;
        for (const m of mrs) {
          if (m.title.toLowerCase().includes(q.toLowerCase())) {
            results.push({ project: p.id, iid: m.iid, title: m.title });
          }
        }
      }
    } else if (scope === 'wiki') {
      const projects = (await client.query<{ id: number }>(`SELECT id FROM projects`)).rows;
      const { effectiveAccess } = await import('../domain/access.js');
      for (const p of projects) {
        const access = await effectiveAccess(client, p.id, rc.user!.id);
        if (!access.member && !access.implied) continue;
        const pages = (await client.query(`SELECT wp.slug, wv.title, wv.content FROM wiki_pages wp JOIN wiki_versions wv ON wv.page_id = wp.id WHERE wp.project_id = $1 AND wv.version = (SELECT max(version) FROM wiki_versions WHERE page_id = wp.id)`, [p.id])).rows;
        for (const pg of pages) {
          if (pg.content.toLowerCase().includes(q.toLowerCase()) || pg.title.toLowerCase().includes(q.toLowerCase())) {
            results.push({ project: p.id, slug: pg.slug, title: pg.title });
          }
        }
      }
    }
    return { count: results.length, results };
  } finally {
    client.release();
  }
}

export { ROLE_LEVEL, groupAccess, canReadGroup, groupById };
