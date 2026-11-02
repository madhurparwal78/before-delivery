import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { loadCatalog } from '../catalog';
import { derive, assetDetail } from '../derived';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { CERT_ROLES } from '../../shared/permissions';
import { cpLen, type Role } from '../../shared/domain';
import { readMultipart, readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import { authorityFor, lockGraph } from './tags';
import { beginIdempotent, releaseIdempotentKey, storeIdempotentResult, validIdempotencyKey } from '../idempotency';
import { noticeTargets, composeNotice } from '../notices';
import type { DeprecateResponse, ReinstateResponse } from '../../shared/api';

const EVIDENCE_KEY = (assetId: string, evidenceId: string) => `evidence/${assetId}/${evidenceId}`;

export function certificationRoutes(svc: AppServices) {
  /** POST /api/assets/{id}/verify */
  const verifyRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const asset = await svc.db.queryOne<{ id: string; state: string }>(`SELECT id, state FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (!(CERT_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const key = validIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
      const keyVal = key === 'invalid' ? null : key;

      const { fields, file } = await readMultipart(req);
      const filename = file?.filename ?? '';
      const bytes = file?.data ?? Buffer.alloc(0);
      const noteText = typeof fields.note === 'string' ? fields.note : '';

      // 409s in the API order, then the 422s, then 503.
      const evidenceFields: Record<string, string> = {};
      const allFields: Record<string, string> = {};
      if (asset.state !== 'draft') {
        throw ERR.invalidTransition(assetId, asset.state, 'verified');
      }
      const upstreamDep = await nearestDeprecatedUpstream(svc, assetId);
      if (upstreamDep !== null) {
        throw ERR.conflict('upstream_deprecated', `Verification blocked: upstream ${upstreamDep} is deprecated.`);
      }
      if (bytes.length === 0) evidenceFields.evidence = 'Attach a PDF or text sign-off.';
      else if (bytes.length > 5_000_000) evidenceFields.evidence = 'Evidence must be 5,000,000 bytes or smaller.';
      else if (cpLen(filename) > 200) evidenceFields.evidence = 'Evidence filename must be 200 characters or fewer.';
      else if (filename.includes('/') || filename.includes('\\')) evidenceFields.evidence = 'Evidence filename cannot contain / or \\.';
      else if (hasControlChars(filename)) evidenceFields.evidence = 'Evidence filename cannot contain control characters.';
      else if (!/\.pdf$/i.test(filename) && !/\.txt$/i.test(filename)) evidenceFields.evidence = 'Evidence must be a .pdf or .txt file.';
      if (cpLen(noteText) > 500) allFields.note = 'Note must be 500 characters or fewer.';
      if (Object.keys(evidenceFields).length > 0) allFields.evidence = evidenceFields.evidence!;
      if (key === 'invalid') allFields.idempotency_key = 'Use 1 to 100 letters, digits, hyphens or underscores.';
      if (Object.keys(allFields).length > 0) throw ERR.validation(allFields);

      const contentType = /\.txt$/i.test(filename) ? 'text/plain; charset=utf-8' : 'application/pdf';
      const sha256 = require('crypto').createHash('sha256').update(bytes).digest('hex') as string;
      const evidenceId = randomUUID();
      const objectKey = EVIDENCE_KEY(assetId, evidenceId);
      const fingerprint = JSON.stringify({ sha256, filename, note: noteText });

      if (keyVal !== null) {
        const outcome = await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          return beginIdempotent(tx, keyVal, req.sessionUser!.id, 'verify', assetId, fingerprint);
        });
        if (!outcome.inserted && outcome.record) {
          res.status(outcome.record.status ?? 200).json(JSON.parse(outcome.record.body ?? '{}'));
          return;
        }
      }

      // Store the evidence; the store must confirm within 10 seconds.
      try {
        await withTimeoutOf(svc.evidence.put(objectKey, bytes, contentType), 10_000);
      } catch {
        svc.evidence.available = false;
        if (keyVal !== null) {
          await svc.db.transaction(async (tx) => {
            await releaseIdempotentKey(tx, keyVal, req.sessionUser!.id, 'verify', assetId);
          });
        }
        throw ERR.unavailable(
          'evidence_unavailable',
          'Evidence storage is unreachable. The asset stays in draft; try again shortly.'
        );
      }

      try {
        await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          const authority = await authorityFor(tx, req, CERT_ROLES as readonly Role[]);
          const fresh = await tx.queryOne<{ state: string }>(`SELECT state FROM assets WHERE id = $1`, [assetId]);
          if (fresh?.state !== 'draft') throw ERR.invalidTransition(assetId, fresh?.state ?? 'draft', 'verified');
          const upstream = await nearestDeprecatedUpstreamInTx(tx, assetId);
          if (upstream !== null) {
            throw ERR.conflict('upstream_deprecated', `Verification blocked: upstream ${upstream} is deprecated.`);
          }
          const audit = await writeAuditRow(tx, {
            actorId: authority.id,
            actorRole: authority.role,
            action: 'certification.verify',
            targetType: 'asset',
            targetId: assetId,
            before: { state: 'draft' },
            after: {
              state: 'verified',
              evidence_sha256: sha256,
              filename,
              content_type: contentType,
              size_bytes: bytes.length,
            },
          });
          await tx.query(
            `INSERT INTO evidence (asset, evidence_id, filename, content_type, size_bytes, sha256, object_key, uploaded_at, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [assetId, evidenceId, filename, contentType, bytes.length, sha256, objectKey, audit.at, authority.id]
          );
          await tx.query(`UPDATE assets SET state = 'verified', verified_at = $2 WHERE id = $1`, [assetId, audit.at]);
        });
      } catch (err) {
        // A failure after the upload leaves no object, record or audit row.
        await svc.evidence.delete(objectKey).catch(() => undefined);
        if (keyVal !== null) {
          await svc.db.transaction(async (tx) => {
            await releaseIdempotentKey(tx, keyVal, req.sessionUser!.id, 'verify', assetId);
          });
        }
        throw err;
      }

      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      const detail = assetDetail(data, d, assetId, req.sessionUser!.role);
      if (keyVal !== null) {
        await svc.db.transaction(async (tx) => {
          await storeIdempotentResult(tx, keyVal, req.sessionUser!.id, 'verify', assetId, 200, JSON.stringify(detail));
        });
      }
      res.json(detail);
    }),
  ];

  /** POST /api/assets/{id}/deprecate */
  const deprecateRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const asset = await svc.db.queryOne<{ id: string; state: string }>(`SELECT id, state FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (!(CERT_ROLES as readonly string[]).includes(req.sessionUser!.role)) throw ERR.forbidden();
      const key = validIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const keyVal = key === 'invalid' ? null : key;
      const fingerprint = JSON.stringify({ reason });

      if (asset.state !== 'draft' && asset.state !== 'verified') {
        throw ERR.invalidTransition(assetId, asset.state, 'deprecated');
      }
      const fields: Record<string, string> = {};
      if (cpLen(reason) < 1 || cpLen(reason) > 500) fields.reason = 'Give a reason of 1 to 500 characters.';
      if (key === 'invalid') fields.idempotency_key = 'Use 1 to 100 letters, digits, hyphens or underscores.';
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);

      if (keyVal !== null) {
        const outcome = await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          return beginIdempotent(tx, keyVal, req.sessionUser!.id, 'deprecate', assetId, fingerprint);
        });
        if (!outcome.inserted && outcome.record) {
          res.status(outcome.record.status ?? 200).json(JSON.parse(outcome.record.body ?? '{}'));
          return;
        }
      }

      let response: DeprecateResponse;
      try {
        response = await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          const authority = await authorityFor(tx, req, CERT_ROLES as readonly Role[]);
          const fresh = await tx.queryOne<{ state: string }>(`SELECT state FROM assets WHERE id = $1`, [assetId]);
          if (fresh?.state !== 'draft' && fresh?.state !== 'verified') {
            throw ERR.invalidTransition(assetId, fresh?.state ?? 'draft', 'deprecated');
          }
          const audit = await writeAuditRow(tx, {
            actorId: authority.id,
            actorRole: authority.role,
            action: 'certification.deprecate',
            targetType: 'asset',
            targetId: assetId,
            before: { state: fresh?.state ?? 'draft' },
            after: { state: 'deprecated', reason },
          });
          const eventId = randomUUID();
          await tx.query(`INSERT INTO deprecation_events (id, asset, reason, at, by) VALUES ($1,$2,$3,$4,$5)`, [
            eventId,
            assetId,
            reason,
            audit.at,
            authority.id,
          ]);
          await tx.query(`UPDATE assets SET state = 'deprecated' WHERE id = $1`, [assetId]);

          // One notice per distinct owner of a transitive downstream asset.
          const data = await loadCatalogInTx(tx);
          const d = derive(data);
          const actorRow = await tx.queryOne<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [authority.id]);
          const targets = noticeTargets(data, d, assetId);
          let queued = 0;
          for (const [ownerId, affected] of targets) {
            const owner = data.users.get(ownerId);
            if (!owner) continue;
            const noticeId = randomUUID();
            const content = composeNotice({
              noticeId,
              ownerName: owner.name,
              ownerEmail: owner.email,
              asset: assetId,
              reason,
              actorName: actorRow?.name ?? '',
              affected,
            });
            void content;
            await tx.query(
              `INSERT INTO notices (id, event_id, asset, owner_id, state, attempts, message_id)
               VALUES ($1,$2,$3,$4,'queued',0,$5)`,
              [noticeId, eventId, assetId, ownerId, `<notice-${noticeId}@strata.quarrystone.test>`]
            );
            queued += 1;
          }
          const unsent = await tx.queryOne<{ n: string }>(
            `SELECT count(*) AS n FROM notices WHERE state IN ('queued','claimed')`
          );
          const after = await loadCatalog(svc.db, null);
          void after;
          return {
            asset: null as never,
            notices_queued: queued,
            queued_notices: Number(unsent?.n ?? 0),
          };
        });
        const data = await loadCatalog(svc.db, null);
        const d = derive(data);
        response.asset = assetDetail(data, d, assetId, req.sessionUser!.role)!;
      } catch (err) {
        if (keyVal !== null) {
          await svc.db.transaction(async (tx) => {
            await releaseIdempotentKey(tx, keyVal, req.sessionUser!.id, 'deprecate', assetId);
          });
        }
        throw err;
      }
      if (keyVal !== null) {
        await svc.db.transaction(async (tx) => {
          await storeIdempotentResult(tx, keyVal, req.sessionUser!.id, 'deprecate', assetId, 200, JSON.stringify(response));
        });
      }
      res.json(response);
    }),
  ];

  /** POST /api/assets/{id}/reinstate */
  const reinstateRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const assetId = String(req.params.id);
      const asset = await svc.db.queryOne<{ id: string; state: string }>(`SELECT id, state FROM assets WHERE id = $1`, [assetId]);
      if (!asset) throw ERR.notFound();
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      await readJsonBody(req);
      if (asset.state !== 'deprecated') throw ERR.invalidTransition(assetId, asset.state, 'draft');
      let cancelled = 0;
      let queuedAfter = 0;
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, ['Admin'] as readonly Role[]);
        const fresh = await tx.queryOne<{ state: string }>(`SELECT state FROM assets WHERE id = $1`, [assetId]);
        if (fresh?.state !== 'deprecated') throw ERR.invalidTransition(assetId, fresh?.state ?? 'deprecated', 'draft');
        const cancelledRows = await tx.query<{ id: string }>(
          `UPDATE notices SET state = 'cancelled'
           WHERE asset = $1 AND (state = 'queued' OR (state = 'claimed' AND claim_expires_at <= $2))
           RETURNING id`,
          [assetId, Date.now()]
        );
        cancelled = cancelledRows.length;
        await tx.query(`DELETE FROM evidence WHERE asset = $1`, [assetId]);
        await tx.query(`UPDATE assets SET state = 'draft', verified_at = NULL WHERE id = $1`, [assetId]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'certification.reinstate',
          targetType: 'asset',
          targetId: assetId,
          before: { state: 'deprecated' },
          after: { state: 'draft', notices_cancelled: cancelled },
        });
        const unsent = await tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM notices WHERE state IN ('queued','claimed')`);
        queuedAfter = Number(unsent?.n ?? 0);
      });
      const data = await loadCatalog(svc.db, null);
      const d = derive(data);
      const response: ReinstateResponse = {
        asset: assetDetail(data, d, assetId, req.sessionUser!.role)!,
        notices_cancelled: cancelled,
        queued_notices: queuedAfter,
      };
      res.json(response);
    }),
  ];

  return { verifyRoute, deprecateRoute, reinstateRoute };
}

function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

function withTimeoutOf<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** The nearest deprecated transitive upstream of an asset, read outside a transaction. */
async function nearestDeprecatedUpstream(svc: AppServices, assetId: string): Promise<string | null> {
  const data = await loadCatalog(svc.db, null);
  const d = derive(data);
  return d.deprecatedUpstream.get(assetId) ?? null;
}

import type { Transaction } from '../querier';
import type { PoolClient } from 'pg';
import type { Database } from '../db';

/** The same check inside the committing transaction, from tables re-read there. */
async function nearestDeprecatedUpstreamInTx(tx: Transaction, assetId: string): Promise<string | null> {
  const edges = await tx.query<{ from_col: string; to_col: string }>(`SELECT from_col, to_col FROM edges`);
  const columns = await tx.query<{ id: string; asset: string }>(`SELECT id, asset FROM columns_`);
  const colAsset = new Map(columns.map((c) => [c.id, c.asset]));
  const downstream = new Map<string, Set<string>>();
  for (const e of edges) {
    const fa = colAsset.get(e.from_col);
    const ta = colAsset.get(e.to_col);
    if (!fa || !ta || fa === ta) continue;
    const set = downstream.get(fa) ?? new Set<string>();
    set.add(ta);
    downstream.set(fa, set);
  }
  const deprecated = (
    await tx.query<{ id: string }>(`SELECT id FROM assets WHERE state = 'deprecated' ORDER BY id`)
  ).map((r) => r.id);
  const nearest = new Map<string, string | null>();
  for (const dep of deprecated) {
    const seen = new Set<string>([dep]);
    let frontier = [dep];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const a of frontier) {
        for (const ds of downstream.get(a) ?? []) {
          if (seen.has(ds)) continue;
          seen.add(ds);
          next.push(ds);
          const existing = nearest.get(ds);
          if (existing === null || existing === undefined || dep < existing) nearest.set(ds, dep);
        }
      }
      frontier = next;
    }
  }
  return nearest.get(assetId) ?? null;
}

/** Loads the catalog inside an open transaction for notice targeting. */
async function loadCatalogInTx(tx: Transaction): Promise<ReturnType<typeof loadCatalog>> {
  const dbLike = txAsDb(tx);
  return loadCatalog(dbLike, null);
}

/** A Transaction is a valid query source for the catalog loader. */
function txAsDb(tx: Transaction): import('../db').Database {
  return tx as unknown as import('../db').Database;
}

export type { PoolClient, Database };
