import type { Request, Response } from 'express';
import { loadCatalog } from '../catalog';
import { assetDetail, compareFolded, derive } from '../derived';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { WRITE_ROLES } from '../../shared/permissions';
import { cpLen, type Role } from '../../shared/domain';
import { readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import { authorityFor, lockGraph } from './tags';

/** Term-name normalisation: trimmed, whitespace collapsed, case-folded for comparison (DP-73). */
export function normaliseTermName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function termKey(name: string): string {
  return normaliseTermName(name).toLowerCase();
}

/** POST/GET /api/terms, PATCH /api/terms/{id}, term links (DP-73, DP-74). */
export function glossaryRoutes(svc: AppServices) {
  const listRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const data = await loadCatalog(svc.db, null);
      const terms = [...data.terms.values()]
        .sort((a, b) => compareFolded(a.name, b.name) || (a.id < b.id ? -1 : 1))
        .map((t) => ({
          id: t.id,
          name: t.name,
          definition: t.definition,
          revision: t.revision,
          assets: [...data.assetTerms.entries()]
            .filter(([, set]) => set.has(t.id))
            .map(([asset]) => ({ id: asset }))
            .sort((a, b) => (a.id < b.id ? -1 : 1)),
        }));
      res.json({ terms });
    }),
  ];

  const createRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? normaliseTermName(body.name) : '';
      const definition = typeof body.definition === 'string' ? body.definition : '';
      const fields: Record<string, string> = {};
      if (cpLen(name) < 1 || cpLen(name) > 80) fields.name = 'Use 1 to 80 characters.';
      if (cpLen(definition) < 1 || cpLen(definition) > 1000) fields.definition = 'Use 1 to 1,000 characters.';
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);
      const existing = await findTermByKey(svc, name);
      if (existing) throw ERR.conflict('term_exists', `A term named ${existing} already exists.`);
      const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const dup = await tx.queryOne<{ name: string }>(
          `SELECT name FROM terms WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1`,
          [name.toLowerCase()]
        );
        if (dup) throw ERR.conflict('term_exists', `A term named ${dup.name} already exists.`);
        await tx.query(`INSERT INTO terms (id, name, definition, revision) VALUES ($1,$2,$3,1)`, [id, name, definition]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'term.create',
          targetType: 'term',
          targetId: id,
          before: null,
          after: { name, definition, revision: 1 },
        });
      });
      const data = await loadCatalog(svc.db, null);
      const t = data.terms.get(id)!;
      const term = {
        id,
        name: t.name,
        definition: t.definition,
        revision: t.revision,
        assets: [...data.assetTerms.entries()]
          .filter(([, set]) => set.has(id))
          .map(([asset]) => ({ id: asset }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      };
      res.status(201).json({ term });
    }),
  ];

  const updateRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const termId = String(req.params.id);
      const existingTerm = await svc.db.queryOne<{ id: string; name: string }>(`SELECT id, name FROM terms WHERE id = $1`, [termId]);
      if (!existingTerm) throw ERR.notFound();
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const revision = body.revision;
      const name = body.name === undefined ? null : typeof body.name === 'string' ? normaliseTermName(body.name) : null;
      const definition = body.definition === undefined ? null : typeof body.definition === 'string' ? body.definition : null;

      const fields: Record<string, string> = {};
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
        fields.revision = 'Send the revision you edited.';
      }
      if (name !== null && (cpLen(name) < 1 || cpLen(name) > 80)) fields.name = 'Use 1 to 80 characters.';
      if (definition !== null && (cpLen(definition) < 1 || cpLen(definition) > 1000)) {
        fields.definition = 'Use 1 to 1,000 characters.';
      }
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);

      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const current = await tx.queryOne<{ name: string; definition: string; revision: number }>(
          `SELECT name, definition, revision FROM terms WHERE id = $1`,
          [termId]
        );
        if (!current) throw ERR.notFound();
        if (revision !== current.revision) {
          throw ERR.conflict('term_stale', 'This term changed since you opened it. Reload and try again.');
        }
        if (name !== null && termKey(name) !== termKey(current.name)) {
          const dup = await tx.queryOne<{ name: string }>(
            `SELECT name FROM terms WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1 AND id <> $2`,
            [termKey(name), termId]
          );
          if (dup) throw ERR.conflict('term_exists', `A term named ${dup.name} already exists.`);
        }
        const newName = name ?? current.name;
        const newDefinition = definition ?? current.definition;
        const before: Record<string, unknown> = { revision: current.revision };
        const after: Record<string, unknown> = { revision: current.revision + 1 };
        if (name !== null) {
          before.name = current.name;
          after.name = newName;
        }
        if (definition !== null) {
          before.definition = current.definition;
          after.definition = newDefinition;
        }
        await tx.query(`UPDATE terms SET name = $2, definition = $3, revision = $4 WHERE id = $1`, [
          termId,
          newName,
          newDefinition,
          current.revision + 1,
        ]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'term.update',
          targetType: 'term',
          targetId: termId,
          before,
          after,
        });
      });
      const data = await loadCatalog(svc.db, null);
      const t = data.terms.get(termId)!;
      const term = {
        id: termId,
        name: t.name,
        definition: t.definition,
        revision: t.revision,
        assets: [...data.assetTerms.entries()]
          .filter(([, set]) => set.has(termId))
          .map(([asset]) => ({ id: asset }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      };
      res.json({ term });
    }),
  ];

  const linkRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const asset = await svc.db.queryOne<{ id: string }>(`SELECT id FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const termId = typeof body.term_id === 'string' ? body.term_id : '';
      const term = await svc.db.queryOne<{ id: string; name: string }>(`SELECT id, name FROM terms WHERE id = $1`, [termId]);
      if (!term) throw ERR.validation({ term_id: 'Unknown term.' });
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const linked = await tx.queryOne<{ term_id: string }>(`SELECT term_id FROM asset_terms WHERE asset = $1 AND term_id = $2`, [
          assetId,
          termId,
        ]);
        if (linked) throw ERR.conflict('term_linked', `${term.name} is already linked.`);
        const before = (await tx.query<{ term_id: string }>(`SELECT term_id FROM asset_terms WHERE asset = $1 ORDER BY term_id`, [assetId])).map(
          (r) => r.term_id
        );
        await tx.query(`INSERT INTO asset_terms (asset, term_id) VALUES ($1,$2)`, [assetId, termId]);
        const after = [...before, termId].sort();
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'term.link',
          targetType: 'asset',
          targetId: assetId,
          before: { terms: before },
          after: { terms: after },
        });
      });
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.json(assetDetail(data, d, assetId, req.sessionUser!.role));
    }),
  ];

  const unlinkRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const termId = String(req.params.termId);
      const asset = await svc.db.queryOne<{ id: string }>(`SELECT id FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const linked = await tx.queryOne<{ term_id: string }>(`SELECT term_id FROM asset_terms WHERE asset = $1 AND term_id = $2`, [
          assetId,
          termId,
        ]);
        if (!linked) throw ERR.notFound();
        const before = (await tx.query<{ term_id: string }>(`SELECT term_id FROM asset_terms WHERE asset = $1 ORDER BY term_id`, [assetId])).map(
          (r) => r.term_id
        );
        await tx.query(`DELETE FROM asset_terms WHERE asset = $1 AND term_id = $2`, [assetId, termId]);
        const after = before.filter((t) => t !== termId);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'term.unlink',
          targetType: 'asset',
          targetId: assetId,
          before: { terms: before },
          after: { terms: after },
        });
      });
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      res.json(assetDetail(data, d, assetId, req.sessionUser!.role));
    }),
  ];

  return { listRoute, createRoute, updateRoute, linkRoute, unlinkRoute };
}

async function findTermByKey(svc: AppServices, name: string): Promise<string | null> {
  const row = await svc.db.queryOne<{ name: string }>(
    `SELECT name FROM terms WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1`,
    [name.toLowerCase()]
  );
  return row?.name ?? null;
}
