// Inbox endpoints: list, read, settings and rules.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, operatorOnly } from '../errors.js';
import { clock } from '../db.js';
import { unreadCount } from '../inbox.js';

export async function inbox(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  if (path === '/api/inbox' && method === 'GET') return inboxList(route, user);
  const readMatch = /^\/api\/inbox\/(\d+)\/read$/.exec(path);
  if (readMatch && method === 'POST') return inboxReadOne(route, user, Number(readMatch[1]));
  if (path === '/api/inbox/read-all' && method === 'POST') return inboxReadAll(route, user);
  if (path === '/api/inbox/settings' && method === 'PUT') return inboxSettings(route, user);
  if (path === '/api/inbox-rules' && (method === 'GET' || method === 'PUT')) return inboxRules(route, user);

  return false;
}

async function inboxList(route: RouteContext, user: SessionUser): Promise<boolean> {
  const res = await route.ctx.db.query(
    `SELECT id, event, text, record, at, read FROM inbox_items WHERE username = $1 AND NOT held ORDER BY at DESC, id DESC`,
    [user.username],
  );
  const unread = await unreadCount(route.ctx.db, user.username);
  sendJson(route.res, 200, {
    items: res.rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      event: String(r.event),
      text: String(r.text),
      record: r.record === null ? null : String(r.record),
      at: new Date(r.at as Date).toISOString(),
      read: Boolean(r.read),
    })),
    unread,
  });
  return true;
}

async function inboxReadOne(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  await route.ctx.db.query(`UPDATE inbox_items SET read = TRUE WHERE id = $1 AND username = $2`, [id, user.username]);
  const unread = await unreadCount(route.ctx.db, user.username);
  sendJson(route.res, 200, { unread });
  return true;
}

async function inboxReadAll(route: RouteContext, user: SessionUser): Promise<boolean> {
  await route.ctx.db.query(`UPDATE inbox_items SET read = TRUE WHERE username = $1 AND NOT held`, [user.username]);
  const unread = await unreadCount(route.ctx.db, user.username);
  sendJson(route.res, 200, { unread });
  return true;
}

async function inboxSettings(route: RouteContext, user: SessionUser): Promise<boolean> {
  const digest = route.body.digest === 'daily' ? 'daily' : 'immediate';
  await route.ctx.db.query(`UPDATE people SET digest = $2 WHERE username = $1`, [user.username, digest]);
  sendJson(route.res, 200, { digest });
  return true;
}

async function inboxRules(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (methodIsGet(route.method)) {
    const res = await route.ctx.db.query(`SELECT event, roles, enabled FROM inbox_rules ORDER BY seq`);
    sendJson(route.res, 200, { rules: res.rows });
    return true;
  }
  if (!user.roles.includes('operator')) throw operatorOnly();
  const rules = (route.body.rules ?? []) as Array<{ event: string; roles: string[]; enabled: boolean }>;
  await route.ctx.db.query(`DELETE FROM inbox_rules`);
  for (const rule of rules) {
    await route.ctx.db.query(`INSERT INTO inbox_rules(event, roles, enabled) VALUES ($1,$2,$3)`, [rule.event, rule.roles ?? [], Boolean(rule.enabled)]);
  }
  sendJson(route.res, 200, { rules });
  return true;
}

function methodIsGet(method: string): boolean {
  return method === 'GET';
}
