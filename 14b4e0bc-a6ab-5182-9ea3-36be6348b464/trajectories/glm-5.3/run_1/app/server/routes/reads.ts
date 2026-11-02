import type { Request, Response } from 'express';
import type { Database } from '../db';
import type { DbRow } from '../querier';
import { loadCatalog } from '../catalog';
import {
  derive,
  assetSummary,
  assetDetail,
  columnBody,
  lineageBody,
  matchAsset,
  facetsFor,
  assetHasTag,
  assetHasState,
  assetHasTerm,
  compareFolded,
} from '../derived';
import { cpLen, type Role, type Tag } from '../../shared/domain';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import type { SearchResponse } from '../../shared/api';

/** Resolves as_of_seq / as_of_time (DP-86) with the published validation. */
export async function resolvePointInTime(
  db: Database,
  query: Record<string, unknown>
): Promise<{ asOfSeq: number | null; asOfAt: string | null }> {
  const seqParam = query.as_of_seq;
  const timeParam = query.as_of_time;
  if (seqParam === undefined && timeParam === undefined) return { asOfSeq: null, asOfAt: null };
  if (seqParam !== undefined && timeParam !== undefined) {
    throw ERR.validation({ as_of_time: 'Send as_of_seq or as_of_time, not both.' });
  }
  const latestRow = await db.queryOne<{ max: string | null }>(`SELECT max(seq) AS max FROM audit_log`);
  const latest = Number(latestRow?.max ?? 0);
  if (seqParam !== undefined) {
    const n = Number(seqParam);
    if (!Number.isInteger(n) || n < 0 || n > latest || String(n) !== String(seqParam).trim()) {
      throw ERR.validation({ as_of_seq: 'Use an audit seq from 0 to the latest seq.' });
    }
    return { asOfSeq: n, asOfAt: await atOfSeq(db, n) };
  }
  const instant = parseRfc3339(String(timeParam));
  if (instant === null) throw ERR.validation({ as_of_time: 'Use an RFC 3339 time with an offset.' });
  const rows = await db.query<{ seq: number; at: string }>(`SELECT seq, at FROM audit_log ORDER BY seq ASC`);
  let resolved = 0;
  let resolvedAt: string | null = null;
  for (const row of rows) {
    if (Date.parse(row.at) <= instant) {
      resolved = row.seq;
      resolvedAt = row.at;
    } else {
      break;
    }
  }
  return { asOfSeq: resolved, asOfAt: resolvedAt };
}

export async function atOfSeq(db: Database, seq: number): Promise<string | null> {
  if (seq === 0) return null;
  const row = await db.queryOne<{ at: string }>(`SELECT at FROM audit_log WHERE seq = $1`, [seq]);
  return row?.at ?? null;
}

/** RFC 3339 with `Z` or an explicit offset; no local times. */
export function parseRfc3339(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return null;
  const ms = m[7] ? Math.round(Number.parseFloat(m[7]) * 1000) : 0;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
  if (Number.isNaN(base)) return null;
  const off = m[8]!;
  if (off === 'Z' || off === 'z') return base;
  const om = /^([+-])(\d{2}):(\d{2})$/.exec(off);
  if (!om) return null;
  const minutes = Number(om[2]) * 60 + Number(om[3]);
  const signed = om[1] === '-' ? -1 : 1;
  return base - signed * minutes * 60_000;
}

export function roleOf(req: Request): Role {
  const u = req.sessionUser;
  if (!u) throw ERR.unauthenticated();
  return u.role;
}

export async function readCatalogFor(svc: AppServices, query: Record<string, unknown>) {
  const { asOfSeq } = await resolvePointInTime(svc.db, query);
  const data = await loadCatalog(svc.db, asOfSeq);
  const d = derive(data);
  return { data, d, asOfSeq };
}

/** GET /api/search */
export function searchRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (cpLen(q) > 200) throw ERR.validation({ q: 'Search text must be 200 characters or fewer.' });
    const tag = req.query.tag === undefined ? null : String(req.query.tag);
    if (tag !== null && tag !== 'PII' && tag !== 'Confidential') throw ERR.validation({ tag: 'Tag must be PII or Confidential.' });
    const owner = req.query.owner === undefined ? null : String(req.query.owner);
    const state = req.query.state === undefined ? null : String(req.query.state);
    if (state !== null && !['draft', 'verified', 'deprecated'].includes(state)) {
      throw ERR.validation({ state: 'State must be draft, verified or deprecated.' });
    }
    const term = req.query.term === undefined ? null : String(req.query.term);
    const { asOfSeq, asOfAt } = await resolvePointInTime(svc.db, req.query as Record<string, unknown>);
    const data = await loadCatalog(svc.db, asOfSeq);
    const d = derive(data);

    const selected = { tag, owner, state, term };
    const matchesAll = (over: typeof selected): string[] => {
      const out: string[] = [];
      for (const id of data.assets.keys()) {
        if (!matchAsset(data, id, q)) continue;
        if (over.tag && !assetHasTag(d, id, over.tag as Tag)) continue;
        if (over.owner && data.assets.get(id)?.owner_id !== over.owner) continue;
        if (over.state && !assetHasState(data, id, over.state)) continue;
        if (over.term && !assetHasTerm(data, id, over.term)) continue;
        out.push(id);
      }
      return out;
    };
    const ids = matchesAll(selected).sort();
    const results = ids.slice(0, 100).map((id) => assetSummary(data, d, id)!);
    const facets = facetsFor(data, d, { q, tag, ownerId: owner, state, termId: term }, selected);
    const body: SearchResponse = { results, total: ids.length, facets };
    if (asOfSeq !== null) {
      body.as_of_seq = asOfSeq;
      body.as_of_at = asOfAt;
    }
    res.json(body);
  });
}

/** GET /api/assets/{id} */
export function assetReadRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const role = roleOf(req);
    const id = String(req.params.id);
    const { asOfSeq, asOfAt } = await resolvePointInTime(svc.db, req.query as Record<string, unknown>);
    const data = await loadCatalog(svc.db, asOfSeq);
    const d = derive(data);
    if (!data.assets.has(id)) throw ERR.notFound();
    const detail = assetDetail(data, d, id, role);
    if (asOfSeq === null) {
      res.json(detail);
      return;
    }
    res.json({ as_of_seq: asOfSeq, as_of_at: asOfAt, asset: detail });
  });
}

/** GET /api/columns/{id} */
export function columnReadRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const role = roleOf(req);
    const id = String(req.params.id);
    const { asOfSeq, asOfAt } = await resolvePointInTime(svc.db, req.query as Record<string, unknown>);
    const data = await loadCatalog(svc.db, asOfSeq);
    const d = derive(data);
    if (!data.columns.has(id)) throw ERR.notFound();
    const body = columnBody(data, d, id, role);
    const assetId = data.columns.get(id)!.asset;
    const asset = data.assets.get(assetId);
    const payload = {
      ...body,
      asset: { id: assetId, state: (asset?.state ?? 'draft') as 'draft' | 'verified' | 'deprecated' },
    };
    if (asOfSeq === null) {
      res.json(payload);
      return;
    }
    res.json({ ...payload, as_of_seq: asOfSeq, as_of_at: asOfAt });
  });
}

/** GET /api/graph */
export function graphRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const { data, d, asOfSeq } = await readCatalogFor(svc, req.query as Record<string, unknown>);
    const columns = [...data.columns.keys()].sort().map((id) => ({
      id,
      asset: data.columns.get(id)!.asset,
      direct_tags: [...(data.directTags.get(id) ?? new Set<Tag>())].sort(),
      effective_tags: d.eff.effectiveOf(id),
      suppressed_tags: [...(data.suppressions.get(id)?.keys() ?? [])].sort(),
      tag_sources: d.eff.sourcesOf(id),
    }));
    const edges = data.edges
      .map((e) => ({ id: e.id, from: e.from, to: e.to, transform: e.transform }))
      .sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1));
    if (asOfSeq === null) {
      res.json({ columns, edges });
      return;
    }
    const asOfAt = await atOfSeq(svc.db, asOfSeq);
    res.json({ columns, edges, as_of_seq: asOfSeq, as_of_at: asOfAt });
  });
}

/** GET /api/columns/{id}/lineage */
export function lineageRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const direction = req.query.direction === undefined ? 'downstream' : String(req.query.direction);
    if (direction !== 'downstream' && direction !== 'upstream') {
      throw ERR.validation({ direction: 'Direction must be downstream or upstream.' });
    }
    const { data, d, asOfSeq } = await readCatalogFor(svc, req.query as Record<string, unknown>);
    if (!data.columns.has(id)) throw ERR.notFound();
    const body = lineageBody(data, d, id, direction, asOfSeq);
    if (asOfSeq !== null) {
      const asOfAt = await atOfSeq(svc.db, asOfSeq);
      res.json({ ...body, as_of_seq: asOfSeq, as_of_at: asOfAt });
      return;
    }
    res.json(body);
  });
}

/** GET /api/terms */
export function termsRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    const data = await loadCatalog(svc.db, null);
    const terms = [...data.terms.values()]
      .sort((a, b) => compareFolded(a.name, b.name) || (a.id < b.id ? -1 : 1))
      .map((t) => {
        const assets = [...data.assetTerms.entries()]
          .filter(([, set]) => set.has(t.id))
          .map(([asset]) => ({ id: asset }))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        return { id: t.id, name: t.name, definition: t.definition, revision: t.revision, assets };
      });
    res.json({ terms });
  });
}

/** GET /api/status */
export function statusRoute(svc: AppServices) {
  return asyncRoute(async (req: Request, res: Response) => {
    void req;
    const queued = await svc.db.queryOne<{ n: string }>(`SELECT count(*) AS n FROM notices WHERE state IN ('queued','claimed')`);
    res.json({
      evidence: svc.evidence.available ? 'up' : 'down',
      mail: svc.mail.available ? 'up' : 'down',
      queued_notices: Number(queued?.n ?? 0),
    });
  });
}

export interface AuditRoleRow extends DbRow {
  seq: number;
  action: string;
  target_id: string;
  before: unknown;
  after: unknown;
}

/** The caller's role as it stood right after each audit row (DP-84). */
export async function roleTimeline(
  db: Database,
  userId: string,
  currentRole: Role
): Promise<{ initial: Role; changes: Array<{ seq: number; role: Role }> }> {
  const rows = await db.query<AuditRoleRow>(
    `SELECT seq, action, target_id, before, after FROM audit_log WHERE action IN ('user.role_change','user.create') AND target_id = $1 ORDER BY seq ASC`,
    [userId]
  );
  let initial: Role | null = null;
  const changes: Array<{ seq: number; role: Role }> = [];
  for (const row of rows) {
    if (row.action === 'user.create') {
      const after = (row.after ?? {}) as Record<string, unknown>;
      initial = String(after.role) as Role;
    } else {
      if (initial === null) {
        const before = (row.before ?? {}) as Record<string, unknown>;
        initial = String(before.role) as Role;
      }
      const after = (row.after ?? {}) as Record<string, unknown>;
      changes.push({ seq: row.seq, role: String(after.role) as Role });
    }
  }
  if (initial === null) initial = currentRole;
  return { initial, changes };
}

export function roleAtSeq(timeline: { initial: Role; changes: Array<{ seq: number; role: Role }> }, seq: number): Role {
  let role = timeline.initial;
  for (const change of timeline.changes) {
    if (change.seq <= seq) role = change.role;
    else break;
  }
  return role;
}

/** A row the caller's stream may show (DP-81, DP-84). */
export function streamVisible(role: Role, row: { action: string; target_id: string }, callerId: string): boolean {
  if (role === 'Admin') return true;
  if (row.action === 'user.role_change' && row.target_id === callerId) return true;
  if (row.action.startsWith('user.') || row.action === 'evidence.download') return false;
  return true;
}
