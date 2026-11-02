import { createHash, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { WRITE_ROLES } from '../../shared/permissions';
import { cpLen, type Role, type Tag, type Transform } from '../../shared/domain';
import { readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import { authorityFor, lockGraph, loadLightColumns } from './tags';
import { changedColumns } from '../derived';
import { loadCatalog } from '../catalog';
import { derive as deriveFn, assetDetail } from '../derived';
import { isAssetIdValid, isColumnNameValid } from '../types';

/** POST /api/assets and the lineage edge routes (DP-77, DP-78, DP-79). */
export function ingestionRoutes(svc: AppServices) {
  const registerRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) {
        // 404 would not apply here; the asset id is new, so 403 is the answer for a refused role
        throw ERR.forbidden();
      }
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id : '';
      const kind = typeof body.kind === 'string' ? body.kind : '';
      const description = typeof body.description === 'string' ? body.description : '';
      const ownerId = typeof body.owner_id === 'string' ? body.owner_id : '';
      const columnsRaw = Array.isArray(body.columns) ? body.columns : [];

      const fields: Record<string, string> = {};
      if (!isAssetIdValid(id)) fields.id = 'Use schema.table in lowercase letters, digits and underscores.';
      if (!['table', 'view', 'dashboard'].includes(kind)) fields.kind = 'Kind must be table, view or dashboard.';
      const descTrim = description.trim();
      if (cpLen(descTrim) < 1 || cpLen(descTrim) > 500) fields.description = 'Use 1 to 500 characters.';
      const owner = await svc.db.queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [ownerId]);
      if (!owner) fields.owner_id = 'Unknown user.';
      const columns: Array<{ name: string; data_type: string; samples: string[] }> = [];
      const perColumnFields: Record<string, string> = {};
      for (let i = 0; i < columnsRaw.length; i++) {
        const c = columnsRaw[i] as Record<string, unknown>;
        const name = typeof c.name === 'string' ? c.name : '';
        const dataType = typeof c.data_type === 'string' ? c.data_type : '';
        const samples = Array.isArray(c.samples) ? c.samples.map((s) => String(s)) : [];
        const ok =
          isColumnNameValid(name) &&
          cpLen(dataType) >= 1 &&
          cpLen(dataType) <= 40 &&
          samples.length <= 5 &&
          samples.every((s) => cpLen(s) <= 200);
        if (!ok) {
          perColumnFields[`columns[${i}]`] = 'Check this column\u2019s name, type and samples.';
        }
        columns.push({ name, data_type: dataType, samples });
      }
      const names = columns.map((c) => c.name);
      if (columns.length < 1 || columns.length > 200 || new Set(names).size !== names.length) {
        fields.columns = 'Give 1 to 200 columns with unique names.';
      }
      Object.assign(fields, perColumnFields);
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);

      const existing = await svc.db.queryOne<{ id: string }>(`SELECT id FROM assets WHERE id = $1`, [id]);
      if (existing) throw ERR.conflict('asset_exists', `${id} is already registered.`);

      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const existing2 = await tx.queryOne<{ id: string }>(`SELECT id FROM assets WHERE id = $1`, [id]);
        if (existing2) throw ERR.conflict('asset_exists', `${id} is already registered.`);
        const audit = await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'asset.register',
          targetType: 'asset',
          targetId: id,
          before: null,
          after: { kind, owner_id: ownerId, columns: names },
        });
        await tx.query(
          `INSERT INTO assets (id, kind, description, owner_id, state, verified_at, created_at)
           VALUES ($1,$2,$3,$4,'draft',NULL,$5)`,
          [id, kind, descTrim, ownerId, Date.now()]
        );
        let position = 0;
        for (const c of columns) {
          const colId = `${id}.${c.name}`;
          await tx.query(`INSERT INTO columns_ (id, asset, name, data_type, position) VALUES ($1,$2,$3,$4,$5)`, [
            colId,
            id,
            c.name,
            c.data_type,
            position++,
          ]);
          for (let i = 0; i < c.samples.length; i++) {
            await tx.query(`INSERT INTO column_samples (column_id, position, value) VALUES ($1,$2,$3)`, [colId, i, c.samples[i]!]);
          }
        }
        void audit;
      });
      const data = await loadCatalog(svc.db, null);
      const d = deriveFn(data);
      const detail = assetDetail(data, d, id, req.sessionUser!.role);
      res.status(201).json(detail);
    }),
  ];

  const edgeRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const edgesRaw = Array.isArray(body.edges) ? body.edges : [];
      const fields: Record<string, string> = {};
      if (edgesRaw.length < 1 || edgesRaw.length > 1000) fields.edges = 'Send 1 to 1,000 edges.';
      const parsed: Array<{ from: string; to: string; transform: Transform }> = [];
      const columns = new Set(
        (await svc.db.query<{ id: string }>(`SELECT id FROM columns_`)).map((r) => r.id)
      );
      for (let i = 0; i < edgesRaw.length; i++) {
        const e = edgesRaw[i] as Record<string, unknown>;
        const from = typeof e.from === 'string' ? e.from : '';
        const to = typeof e.to === 'string' ? e.to : '';
        const transform = e.transform;
        if (!columns.has(from)) fields[`edges[${i}].from`] = 'Unknown column.';
        if (!columns.has(to)) fields[`edges[${i}].to`] = 'Unknown column.';
        if (from === to && from !== '') fields[`edges[${i}].to`] = 'An edge cannot point to its own column.';
        if (
          typeof transform !== 'string' ||
          !['copy', 'rename', 'cast', 'filter', 'join', 'concat', 'hash', 'aggregate'].includes(transform)
        ) {
          fields[`edges[${i}].transform`] =
            'Transform must be one of copy, rename, cast, filter, join, concat, hash, aggregate.';
        } else {
          parsed.push({ from, to, transform: transform as Transform });
        }
      }
      // A pair repeated at a lower index in the same batch is a conflict.
      const seen = new Map<string, number>();
      parsed.forEach((e, idx) => {
        const key = `${e.from}|${e.to}`;
        const prev = seen.get(key);
        if (prev !== undefined) fields[`edges[${idx}].to`] = 'An edge cannot point to its own column.';
        seen.set(key, prev === undefined ? idx : prev);
      });
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);

      const before = await loadLightColumns(svc.db);
      const stored: Array<{ id: string; from: string; to: string; transform: Transform }> = [];
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        for (let i = 0; i < parsed.length; i++) {
          const e = parsed[i]!;
          const existing = await tx.queryOne<{ id: string }>(`SELECT id FROM edges WHERE from_col = $1 AND to_col = $2`, [e.from, e.to]);
          if (existing) {
            throw ERR.conflict('edge_exists', `An edge from ${e.from} to ${e.to} already exists.`);
          }
        }
        for (const e of parsed) {
          const id = createHash('sha256').update(`${e.from}|${e.to}`).digest('hex').slice(0, 24) + '-' + randomUUID().slice(0, 8);
          await tx.query(`INSERT INTO edges (id, from_col, to_col, transform) VALUES ($1,$2,$3,$4)`, [id, e.from, e.to, e.transform]);
          stored.push({ id, from: e.from, to: e.to, transform: e.transform });
        }
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'lineage.add',
          targetType: 'lineage',
          targetId: stored[0]?.id ?? '',
          before: null,
          after: { edges: stored.map((e) => ({ id: e.id, from: e.from, to: e.to, transform: e.transform })) },
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      res.status(201).json({ edges: stored.map((e) => ({ id: e.id, from: e.from, to: e.to, transform: e.transform })), changed_columns: changed });
    }),
  ];

  const edgeDeleteRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const edgeId = String(req.params.edgeId);
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const before = await loadLightColumns(svc.db);
      let removed: { id: string; from_col: string; to_col: string; transform: Transform } | null = null;
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const edge = await tx.queryOne<{ id: string; from_col: string; to_col: string; transform: Transform }>(
          `SELECT id, from_col, to_col, transform FROM edges WHERE id = $1`,
          [edgeId]
        );
        if (!edge) throw ERR.notFound();
        await tx.query(`DELETE FROM edges WHERE id = $1`, [edgeId]);
        removed = edge;
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'lineage.remove',
          targetType: 'lineage',
          targetId: edgeId,
          before: { edge: { id: edge.id, from: edge.from_col, to: edge.to_col, transform: edge.transform } },
          after: null,
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      void removed;
      res.json({ changed_columns: changed });
    }),
  ];

  return { registerRoute, edgeRoute, edgeDeleteRoute };
}

export type { Tag };
