import type { Request, Response } from 'express';
import { loadCatalog } from '../catalog';
import { derive, columnBody, changedColumns, type LightColumn } from '../derived';
import { ERR, asyncRoute } from '../errors';
import { recheckAuthority, type AppServices } from '../session';
import { WRITE_ROLES } from '../../shared/permissions';
import { cpLen, isTag, type Role, type Tag } from '../../shared/domain';
import { readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import type { Transaction } from '../querier';

/** Graph writes serialise on this advisory lock, so every race ends in commit order (DP-36). */
export const GRAPH_LOCK = 728_314_772;

export async function loadLightColumns(db: AppServices['db']): Promise<Map<string, LightColumn>> {
  const data = await loadCatalog(db, null);
  const d = derive(data);
  const out = new Map<string, LightColumn>();
  for (const id of data.columns.keys()) {
    out.set(id, {
      effective: d.eff.effectiveOf(id),
      suppressed: [...(data.suppressions.get(id)?.keys() ?? [])].sort(),
      sources: d.eff.sourcesOf(id) as Record<string, string[]>,
    });
  }
  return out;
}

export function requireTag(value: unknown): Tag {
  if (!isTag(value)) throw ERR.validation({ tag: 'Tag must be PII or Confidential.' });
  return value;
}

export async function lockGraph(tx: Transaction): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock($1)`, [GRAPH_LOCK]);
}

/**
 * The commit-time authority recheck (DP-09): session and role read again
 * inside the committing transaction. A live session with the wrong role is 403.
 */
export async function authorityFor(
  tx: Transaction,
  req: Request,
  roles: readonly Role[]
): Promise<{ id: string; role: Role }> {
  const authority = await recheckAuthority(tx, req.sessionTokenHash, roles);
  if (!authority) {
    const alive = req.sessionTokenHash
      ? await tx.queryOne<{ user_id: string }>(`SELECT user_id FROM sessions WHERE token_hash = $1`, [req.sessionTokenHash])
      : null;
    if (alive) throw ERR.forbidden();
    throw ERR.unauthenticated();
  }
  return authority;
}

/** The pre-checks shared by graph writes: 404, then 403, in the published order. */
export async function requireColumnWrite(svc: AppServices, columnId: string, role: Role): Promise<void> {
  const exists = await svc.db.queryOne<{ id: string }>(`SELECT id FROM columns_ WHERE id = $1`, [columnId]);
  if (!exists) throw ERR.notFound();
  if (!(WRITE_ROLES as readonly string[]).includes(role)) throw ERR.forbidden();
}

export function tagRoutes(svc: AppServices) {
  /** POST /api/columns/{id}/tags */
  const addRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const columnId = String(req.params.id);
      await requireColumnWrite(svc, columnId, req.sessionUser!.role);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tag = requireTag(body.tag);
      const before = await loadLightColumns(svc.db);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const existing = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (existing) throw ERR.conflict('tag_exists', `${columnId} already carries ${tag} directly.`);
        const sup = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM suppressions WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (sup) throw ERR.conflict('tag_suppressed', `${tag} is suppressed on ${columnId}; lift the suppression first.`);
        const tagsBefore = (
          await tx.query<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 ORDER BY tag`, [columnId])
        ).map((r) => r.tag);
        await tx.query(`INSERT INTO direct_tags (column_id, tag) VALUES ($1,$2)`, [columnId, tag]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'tag.add',
          targetType: 'column',
          targetId: columnId,
          before: { direct_tags: tagsBefore },
          after: { direct_tags: [...tagsBefore, tag].sort() },
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.status(201).json({ column: columnBody(data, d, columnId, req.sessionUser!.role), changed_columns: changed });
    }),
  ];

  /** DELETE /api/columns/{id}/tags/{tag} */
  const withdrawRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const columnId = String(req.params.id);
      await requireColumnWrite(svc, columnId, req.sessionUser!.role);
      const tag = requireTag(String(req.params.tag));
      const before = await loadLightColumns(svc.db);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const direct = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (!direct) {
          const inherited = before.get(columnId)?.effective.includes(tag) ?? false;
          if (inherited) throw ERR.conflict('tag_inherited', `${tag} on ${columnId} is inherited; withdraw it at its source.`);
          throw ERR.conflict('tag_absent', `${columnId} does not carry ${tag}.`);
        }
        const tagsBefore = (
          await tx.query<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 ORDER BY tag`, [columnId])
        ).map((r) => r.tag);
        await tx.query(`DELETE FROM direct_tags WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'tag.withdraw',
          targetType: 'column',
          targetId: columnId,
          before: { direct_tags: tagsBefore },
          after: { direct_tags: tagsBefore.filter((t) => t !== tag) },
        });
      });
      const after = await loadLightColumns(svc.db);
      const stillReaching = countStillReaching(before, after, columnId, tag);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.json({
        column: columnBody(data, d, columnId, req.sessionUser!.role),
        changed_columns: changed,
        still_reaching: stillReaching,
      });
    }),
  ];

  /** POST /api/columns/{id}/suppressions */
  const suppressRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const columnId = String(req.params.id);
      await requireColumnWrite(svc, columnId, req.sessionUser!.role);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tag = requireTag(body.tag);
      const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
      if (cpLen(justification) < 10 || cpLen(justification) > 500) {
        throw ERR.validation({ justification: 'Give a justification of 10 to 500 characters.' });
      }
      const before = await loadLightColumns(svc.db);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const existing = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM suppressions WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (existing) throw ERR.conflict('suppression_exists', `${tag} is already suppressed on ${columnId}.`);
        const direct = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (direct) throw ERR.conflict('tag_not_inherited', `${tag} on ${columnId} is not inherited; withdraw it instead.`);
        const light = before.get(columnId);
        if (!light || !light.effective.includes(tag)) {
          throw ERR.conflict('tag_absent', `${columnId} does not carry ${tag}.`);
        }
        await tx.query(`INSERT INTO suppressions (column_id, tag, justification, at, by) VALUES ($1,$2,$3,$4,$5)`, [
          columnId,
          tag,
          justification,
          new Date().toISOString(),
          authority.id,
        ]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'tag.suppress',
          targetType: 'column',
          targetId: columnId,
          before: { suppressed_tags: light.suppressed },
          after: { suppressed_tags: [...light.suppressed, tag].sort(), justification },
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.status(201).json({ column: columnBody(data, d, columnId, req.sessionUser!.role), changed_columns: changed });
    }),
  ];

  /** DELETE /api/columns/{id}/suppressions/{tag} */
  const liftRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const columnId = String(req.params.id);
      await requireColumnWrite(svc, columnId, req.sessionUser!.role);
      const tag = requireTag(String(req.params.tag));
      const before = await loadLightColumns(svc.db);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const sup = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM suppressions WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        if (!sup) throw ERR.notFound();
        const beforeTags = [...(before.get(columnId)?.suppressed ?? [])];
        await tx.query(`DELETE FROM suppressions WHERE column_id = $1 AND tag = $2`, [columnId, tag]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'tag.unsuppress',
          targetType: 'column',
          targetId: columnId,
          before: { suppressed_tags: beforeTags },
          after: { suppressed_tags: beforeTags.filter((t) => t !== tag) },
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.json({ column: columnBody(data, d, columnId, req.sessionUser!.role), changed_columns: changed });
    }),
  ];

  return { addRoute, withdrawRoute, suppressRoute, liftRoute };
}

/**
 * still_reaching after a withdrawal (DP-32): columns that held the tag with the
 * withdrawn column among their sources just before, and still hold it after.
 */
export function countStillReaching(
  before: Map<string, LightColumn>,
  after: Map<string, LightColumn>,
  withdrawnId: string,
  tag: Tag
): number {
  let n = 0;
  for (const [id, b] of before) {
    if (id === withdrawnId) continue;
    if (!b.effective.includes(tag)) continue;
    if (!(b.sources[tag] ?? []).includes(withdrawnId)) continue;
    if (after.get(id)?.effective.includes(tag)) n += 1;
  }
  return n;
}
