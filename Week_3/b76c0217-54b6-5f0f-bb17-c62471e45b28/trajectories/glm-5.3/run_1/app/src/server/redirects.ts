import { pool } from './db';
import { ApiError } from '../errors';
import { copy } from '../shared/copy';
import { withLeadingSlash } from '../shared/rules';
import type { NavigationJson } from './queries';

export type RedirectRow = { id: string; from_path: string; to_path: string; kind: string };

export async function listRedirects(versionId: string): Promise<RedirectRow[]> {
  const r = await pool.query('SELECT * FROM redirects WHERE version_id = $1 ORDER BY from_path', [versionId]);
  return r.rows;
}

export function detectLoop(
  from: string,
  to: string,
  redirects: Map<string, string>,
): string[] | null {
  const chain: string[] = [from];
  const seen = new Set([from]);
  let current = to;
  while (true) {
    if (current === from) {
      chain.push(current);
      return chain;
    }
    if (seen.has(current)) return null;
    seen.add(current);
    chain.push(current);
    const next = redirects.get(current);
    if (!next) return null;
    current = next;
  }
}

export async function addManualRedirect(versionId: string, fromPath: string, toPath: string): Promise<NavigationJson> {
  const from = normalize(fromPath);
  const to = normalize(toPath);
  if (!isOnSitePath(toPath)) throw new ApiError('redirect_off_site', copy.offSite, { fields: { to: copy.offSite } });
  const page = await pool.query<{ id: string }>(
    "SELECT id FROM pages WHERE version_id = $1 AND path = $2 AND state != 'removed'", [versionId, to],
  );
  if (page.rows.length === 0) throw new ApiError('redirect_target_missing', copy.targetMissing(withLeadingSlash(to)), { fields: { to: copy.targetMissing(withLeadingSlash(to)) } });

  const existing = await pool.query('SELECT id FROM redirects WHERE version_id = $1 AND from_path = $2', [versionId, from]);
  if (existing.rows.length > 0) throw new ApiError('redirect_exists', copy.redirectExists(withLeadingSlash(from)), { fields: { from: copy.redirectExists(withLeadingSlash(from)) } });

  const redirects = new Map((await listRedirects(versionId)).map((r) => [r.from_path, r.to_path]));
  const cycle = detectLoop(from, to, redirects);
  if (cycle) throw new ApiError('redirect_loop', copy.redirectLoop(cycle.map(withLeadingSlash)), { cycle: cycle.map(withLeadingSlash) });

  await pool.query(
    'INSERT INTO redirects (id, version_id, from_path, to_path, kind) VALUES ($1, $2, $3, $4, $5)',
    [newRedirectId(), versionId, from, to, 'manual'],
  );
  return navigationOf(versionId);
}

function newRedirectId(): string {
  const { newId } = require('./ids') as typeof import('./ids');
  return newId('red');
}

export async function removeRedirect(versionId: string, fromPath: string): Promise<NavigationJson> {
  await pool.query('DELETE FROM redirects WHERE version_id = $1 AND from_path = $2', [versionId, normalize(fromPath)]);
  return navigationOf(versionId);
}

async function navigationOf(versionId: string): Promise<NavigationJson> {
  const { navigationJson } = await import('./queries');
  return navigationJson(versionId);
}

function normalize(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isOnSitePath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) && !p.includes('://');
}
