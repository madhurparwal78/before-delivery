import { one, rows, query } from './db.js';
import { sha256Hex } from './crypto.js';
import { fail, notFound } from './errors.js';
import { downloadHeaders } from './api-objects.js';
import { loadPlaintext, recordUsage, versionById } from './objects.js';
import { tx } from './db.js';
import type { Router } from './http.js';

interface LinkRow {
  id: string; token_hash: string; bucket_name: string; key: string; version_id: string;
  workspace_slug: string; created_by: string; expires_at: Date; state: string;
}

function recipientPage(kind: 'expired' | 'revoked' | 'unknown' | 'suspended' | 'rate', seconds?: number): string {
  const copy = {
    expired: 'This link has expired.',
    revoked: 'This link was revoked.',
    unknown: "This link doesn't exist.",
    suspended: 'This link is paused.',
    rate: `Too many downloads right now. Try again in ${seconds} seconds.`,
  }[kind];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Farshore</title><link rel="stylesheet" href="/assets/app.css"></head><body class="link-page"><main class="panel link-panel"><p>${copy}</p></main></body></html>`;
}

function linkErrorPage(res: import('node:http').ServerResponse, status: number, kind: 'expired' | 'revoked' | 'unknown' | 'suspended' | 'rate', seconds?: number, wantsHtml: boolean = false): void {
  const body = wantsHtml
    ? recipientPage(kind, seconds)
    : JSON.stringify({ error: kind === 'expired' ? 'link_expired' : kind === 'revoked' ? 'link_revoked' : 'not_found', message: headingFor(kind, seconds) });
  res.writeHead(status, wantsHtml ? { 'Content-Type': 'text/html; charset=utf-8', ...(seconds !== undefined ? { 'Retry-After': String(seconds) } : {}) }
    : { 'Content-Type': 'application/json; charset=utf-8', ...(seconds !== undefined ? { 'Retry-After': String(seconds) } : {}) });
  res.end(body);
}

function headingFor(kind: 'expired' | 'revoked' | 'unknown' | 'suspended' | 'rate', seconds?: number): string {
  return {
    expired: 'This link has expired.',
    revoked: 'This link was revoked.',
    unknown: "This link doesn't exist.",
    suspended: 'This link is paused.',
    rate: `Too many downloads right now. Try again in ${seconds} seconds.`,
  }[kind];
}

export function registerLinkRoutes(links: Router): void {
  const serve = async (req: import('./http.js').Req, res: import('node:http').ServerResponse, head: boolean): Promise<void> => {
    const token = req.params['token'];
    const wantsHtml = (req.headers['accept'] ?? '').includes('text/html');
    if (req.rawPath.split('/').length > 3) {
      if (wantsHtml) { linkErrorPage(res, 404, 'unknown', undefined, true); return; }
      throw notFound();
    }
    const link = await one<LinkRow>(
      `SELECT id, token_hash, bucket_name, key, version_id, workspace_slug, created_by, expires_at, state FROM share_links WHERE token_hash = $1`,
      [sha256Hex(token)]
    );
    if (!link || link.state === 'revoked') {
      if (wantsHtml) { linkErrorPage(res, link ? 410 : 404, link ? 'revoked' : 'unknown', undefined, true); return; }
      if (link) throw fail(410, 'link_revoked', 'This link was revoked.');
      throw notFound();
    }
    if (link.expires_at.getTime() <= Date.now()) {
      await query(`UPDATE share_links SET state = 'expired' WHERE id = $1`, [link.id]);
      if (wantsHtml) { linkErrorPage(res, 410, 'expired', undefined, true); return; }
      throw fail(410, 'link_expired', 'This link has expired.');
    }
    const ws = await one<{ status: string }>(`SELECT status FROM workspaces WHERE slug = $1`, [link.workspace_slug]);
    if (!ws || ws.status === 'suspended') {
      if (wantsHtml) { linkErrorPage(res, 403, 'suspended', undefined, true); return; }
      throw fail(403, 'workspace_suspended', 'This link is paused.');
    }
    // Rate limit: 30 requests per rolling 60 seconds.
    await query(`DELETE FROM link_hits WHERE link_id = $1 AND at < now() - interval '60 seconds'`, [link.id]);
    const hits = await one<{ c: string }>(`SELECT count(*)::text AS c FROM link_hits WHERE link_id = $1`, [link.id]);
    if (Number(hits!.c) >= 30) {
      const oldest = await one<{ at: Date }>(`SELECT at FROM link_hits WHERE link_id = $1 ORDER BY at ASC LIMIT 1`, [link.id]);
      const retry = Math.max(1, Math.ceil((oldest!.at.getTime() + 60_000 - Date.now()) / 1000));
      if (wantsHtml) { linkErrorPage(res, 429, 'rate', retry, true); return; }
      const body = JSON.stringify({ error: 'rate_limited', message: headingFor('rate', retry) });
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(retry) });
      res.end(body);
      return;
    }
    await query(`INSERT INTO link_hits (link_id) VALUES ($1)`, [link.id]);

    const v = await versionById(link.version_id);
    if (!v || v.state === 'removed') {
      await query(`UPDATE share_links SET state = 'revoked' WHERE id = $1`, [link.id]);
      if (wantsHtml) { linkErrorPage(res, 410, 'revoked', undefined, true); return; }
      throw fail(410, 'link_revoked', 'This link was revoked.');
    }
    const bytes = await loadPlaintext(v);
    await tx(async client => { await recordUsage(client, link.workspace_slug, link.bucket_name, 'egress-gb', bytes.length, new Date()); });
    await tx(async client => { await recordUsage(client, link.workspace_slug, link.bucket_name, 'request-units', 1, new Date()); });
    const headers = downloadHeaders(link.key, v.content_type);
    res.writeHead(200, {
      ...headers,
      'Content-Length': bytes.length,
      'ETag': v.etag,
      'Last-Modified': v.acknowledged_at.toUTCString(),
    });
    res.end(head ? undefined : bytes);
  };
  links.get('/l/{token}', async (req, res) => serve(req, res, false));
  links.head('/l/{token}', async (req, res) => serve(req, res, true));
  void rows;
}
