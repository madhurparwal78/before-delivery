import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { loadCatalog } from '../catalog';
import { derive, columnBody, changedColumns } from '../derived';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { WRITE_ROLES } from '../../shared/permissions';
import { readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import { authorityFor, lockGraph, loadLightColumns, requireTag } from './tags';
import { beginIdempotent, releaseIdempotentKey, storeIdempotentResult, validIdempotencyKey } from '../idempotency';
import type { BulkTagResponse, ColumnBody, UndoResponse } from '../../shared/api';
import type { Role, Tag } from '../../shared/domain';

/** POST /api/assets/{id}/tags/bulk and POST /api/tag-batches/{batch id}/undo (DP-06). */
export function bulkRoutes(svc: AppServices) {
  const bulkRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const key = validIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tag = requireTag(body.tag);
      const columnIds = Array.isArray(body.columns) ? body.columns.map((c) => String(c)) : [];

      // 404 before 403 before 409/422, in the published order.
      const asset = await svc.db.queryOne<{ id: string }>(`SELECT id FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();

      const data0 = await loadCatalog(svc.db, null);
      const fields: Record<string, string> = {};
      if (columnIds.length === 0 || columnIds.length > 200 || new Set(columnIds).size !== columnIds.length) {
        fields.columns = 'Select 1 to 200 columns of this asset.';
      }
      for (let i = 0; i < columnIds.length; i++) {
        if (data0.columns.get(columnIds[i])?.asset !== assetId) fields[`columns[${i}]`] = 'Unknown column of this asset.';
      }
      if (key === 'invalid') fields.idempotency_key = 'Use 1 to 100 letters, digits, hyphens or underscores.';
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);
      const keyVal = key === 'invalid' ? null : key;

      const fingerprint = JSON.stringify({ tag, columns: columnIds });
      if (keyVal !== null) {
        const outcome = await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          return beginIdempotent(tx, keyVal, req.sessionUser!.id, 'bulk', assetId, fingerprint);
        });
        if (!outcome.inserted && outcome.record) {
          res.status(outcome.record.status ?? 200).json(JSON.parse(outcome.record.body ?? '{}'));
          return;
        }
      }

      const before = await loadLightColumns(svc.db);
      const rows: Array<{
        columnId: string;
        directTagsBefore: Tag[];
        outcome: 'applied' | 'already_present' | 'refused';
        error: { code: string; message: string } | null;
      }> = [];
      let batchId: string | null = null;

      try {
        const result = await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
          for (const columnId of columnIds) {
            const tagsBefore = (
              await tx.query<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 ORDER BY tag`, [columnId])
            ).map((r) => r.tag);
            const suppressed = await tx.queryOne<{ tag: Tag }>(`SELECT tag FROM suppressions WHERE column_id = $1 AND tag = $2`, [
              columnId,
              tag,
            ]);
            if (tagsBefore.includes(tag)) {
              rows.push({ columnId, directTagsBefore: tagsBefore, outcome: 'already_present', error: null });
            } else if (suppressed) {
              rows.push({
                columnId,
                directTagsBefore: tagsBefore,
                outcome: 'refused',
                error: { code: 'tag_suppressed', message: `${tag} is suppressed on ${columnId}; lift the suppression first.` },
              });
            } else {
              await tx.query(`INSERT INTO direct_tags (column_id, tag) VALUES ($1,$2)`, [columnId, tag]);
              rows.push({ columnId, directTagsBefore: tagsBefore, outcome: 'applied', error: null });
            }
          }
          const applied = rows.filter((r) => r.outcome === 'applied');
          if (applied.length === 0) return { batchId: null as string | null };
          const batch = randomUUID();
          await tx.query(`INSERT INTO tag_batches (id, asset, tag, audit_seq, created_at, undone) VALUES ($1,$2,$3,0,$4,false)`, [
            batch,
            assetId,
            tag,
            Date.now(),
          ]);
          let position = 0;
          for (const r of applied) {
            await tx.query(`INSERT INTO tag_batch_columns (batch_id, column_id, direct_tags, position) VALUES ($1,$2,$3,$4)`, [
              batch,
              r.columnId,
              JSON.stringify(r.directTagsBefore),
              position++,
            ]);
          }
          const beforeMap: Record<string, Tag[]> = {};
          const afterMap: Record<string, Tag[]> = {};
          for (const r of applied) {
            beforeMap[r.columnId] = r.directTagsBefore;
            afterMap[r.columnId] = [...r.directTagsBefore, tag].sort();
          }
          const audit = await writeAuditRow(tx, {
            actorId: authority.id,
            actorRole: authority.role,
            action: 'tag.bulk_add',
            targetType: 'asset',
            targetId: assetId,
            before: { direct_tags: beforeMap },
            after: { batch_id: batch, tag, direct_tags: afterMap },
          });
          await tx.query(`UPDATE tag_batches SET audit_seq = $2 WHERE id = $1`, [batch, audit.seq]);
          return { batchId: batch };
        });
        batchId = result.batchId;
      } catch (err) {
        if (keyVal !== null) {
          await svc.db.transaction(async (tx) => {
            await releaseIdempotentKey(tx, keyVal, req.sessionUser!.id, 'bulk', assetId);
          });
        }
        throw err;
      }

      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      const response: BulkTagResponse = {
        batch_id: batchId,
        tag,
        requested: columnIds.length,
        applied: rows.filter((r) => r.outcome === 'applied').length,
        results: rows.map((r) => ({ column: r.columnId, outcome: r.outcome, error: r.error })),
        columns: columnIds.map((id) => columnBody(data, d, id, req.sessionUser!.role)!).filter((c) => c !== null),
        changed_columns: changed,
      };
      if (keyVal !== null && batchId !== null) {
        await svc.db.transaction(async (tx) => {
          await storeIdempotentResult(tx, keyVal, req.sessionUser!.id, 'bulk', assetId, 200, JSON.stringify(response));
        });
      } else if (keyVal !== null) {
        await svc.db.transaction(async (tx) => {
          await releaseIdempotentKey(tx, keyVal, req.sessionUser!.id, 'bulk', assetId);
        });
      }
      res.json(response);
    }),
  ];

  const undoRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const batchId = String(req.params.batchId);
      await readJsonBody(req);
      if (!(WRITE_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const before = await loadLightColumns(svc.db);
      let restored = 0;
      const undoneIds: string[] = [];
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, WRITE_ROLES as readonly Role[]);
        const batch = await tx.queryOne<{ id: string; asset: string; audit_seq: string; undone: boolean }>(
          `SELECT id, asset, audit_seq, undone FROM tag_batches WHERE id = $1`,
          [batchId]
        );
        if (!batch) throw ERR.notFound();
        if (batch.undone) throw ERR.conflict('batch_undone', 'This bulk tag apply was already undone.');
        const rows = await tx.query<{ column_id: string; direct_tags: string }>(
          `SELECT column_id, direct_tags FROM tag_batch_columns WHERE batch_id = $1 ORDER BY position`,
          [batchId]
        );
        const changes = await tx.query<{
          seq: string;
          action: string;
          target_id: string;
          before: unknown;
          after: unknown;
        }>(
          `SELECT seq, action, target_id, before, after FROM audit_log WHERE seq > $1 AND action IN
             ('tag.add','tag.withdraw','tag.suppress','tag.unsuppress','tag.bulk_add','tag.bulk_undo') ORDER BY seq ASC`,
          [batch.audit_seq]
        );
        const changedIds = new Set<string>();
        for (const row of changes) {
          for (const id of affectedColumnsOf(row)) changedIds.add(id);
        }
        const offenders = rows.map((r) => r.column_id).filter((id) => changedIds.has(id)).sort();
        if (offenders.length > 0) {
          throw ERR.conflict('batch_changed', `Undo refused: ${offenders[0]} changed after the bulk apply.`);
        }
        const beforeMap: Record<string, Tag[]> = {};
        const afterMap: Record<string, Tag[]> = {};
        for (const r of rows) {
          const current = (
            await tx.query<{ tag: Tag }>(`SELECT tag FROM direct_tags WHERE column_id = $1 ORDER BY tag`, [r.column_id])
          ).map((x) => x.tag);
          const restore = JSON.parse(r.direct_tags) as Tag[];
          await tx.query(`DELETE FROM direct_tags WHERE column_id = $1`, [r.column_id]);
          for (const t of restore) {
            await tx.query(`INSERT INTO direct_tags (column_id, tag) VALUES ($1,$2)`, [r.column_id, t]);
          }
          beforeMap[r.column_id] = current;
          afterMap[r.column_id] = restore;
          undoneIds.push(r.column_id);
        }
        restored = rows.length;
        await tx.query(`UPDATE tag_batches SET undone = true WHERE id = $1`, [batchId]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'tag.bulk_undo',
          targetType: 'asset',
          targetId: batch.asset,
          before: { batch_id: batchId, direct_tags: beforeMap },
          after: { direct_tags: afterMap },
        });
      });
      const after = await loadLightColumns(svc.db);
      const changed = changedColumns(before, after);
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      const response: UndoResponse = {
        batch_id: batchId,
        restored,
        columns: undoneIds.map((id) => columnBody(data, d, id, req.sessionUser!.role)!).filter((c) => c !== null),
        changed_columns: changed,
      };
      res.json(response);
    }),
  ];

  return { bulkRoute, undoRoute };
}

/** The columns a committed tag row changed, for the undo change check. */
function affectedColumnsOf(row: { action: string; target_id: string; before: unknown; after: unknown }): string[] {
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case 'tag.add':
    case 'tag.withdraw':
    case 'tag.suppress':
    case 'tag.unsuppress':
      return [row.target_id];
    case 'tag.bulk_add':
    case 'tag.bulk_undo': {
      const per = (after.direct_tags as Record<string, string[]>) ?? {};
      const perBefore = (before.direct_tags as Record<string, string[]>) ?? {};
      return [...Object.keys(per), ...Object.keys(perBefore)];
    }
    default:
      return [];
  }
}

export type { ColumnBody };
