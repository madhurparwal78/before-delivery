import { randomUUID } from 'node:crypto';
import { codePointLength } from '../../shared/domain.ts';
import { appendAudit, recheckAuthority, reserveSeq } from '../commit.ts';
import { type Queryable, withCommitOrder, withReadTransaction } from '../db.ts';
import { assertTransition } from '../domain/certification.ts';
import { allows } from '../domain/roles.ts';
import { nearestDeprecatedUpstream } from '../domain/deprecation.ts';
import { acceptEvidence, storageKeyFor } from '../domain/evidence.ts';
import { buildNoticeDrafts } from '../domain/notices.ts';
import { type Snapshot, loadCurrentSnapshot } from '../domain/snapshot.ts';
import { assetDetail } from '../domain/views.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { claimIdempotency, fingerprintOf, requireValidKey } from '../idempotency.ts';
import { EvidenceStoreUnavailable, evidenceStore } from '../services/storage.ts';
import { markEvidenceDown } from '../services/status.ts';

function upstreamDeprecated(assetId: string, upstreamId: string): never {
  throw errors.conflict(
    'upstream_deprecated',
    `Verification blocked: upstream ${upstreamId} is deprecated.`,
  );
}

async function requireAsset(client: Queryable, assetId: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM assets WHERE id = $1', [assetId]);
  if ((result.rowCount ?? 0) === 0) throw errors.notFound();
}

async function writeCertification(
  client: Queryable,
  assetId: string,
  seq: number,
  state: string,
  verifiedAt: string | null,
  evidenceId: string | null,
  deprecation: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO asset_certification (asset_id, from_seq, state, verified_at, evidence_id, deprecation)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [assetId, seq, state, verifiedAt, evidenceId, deprecation === null ? null : JSON.stringify(deprecation)],
  );
}

function assetOrThrow(snapshot: Snapshot, assetId: string) {
  const asset = snapshot.assets.get(assetId);
  if (!asset) throw errors.notFound();
  return asset;
}

export function registerCertificationRoutes(router: Router): void {
  router.add('POST', '/api/assets/:id/verify', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    const assetId = ctx.params.id;
    const key = ctx.header('idempotency-key') ?? null;
    requireValidKey(key);
    const multipart = ctx.multipart();
    const file = multipart.files.get('evidence');
    const note = multipart.fields.get('note') ?? '';
    const claim = await claimIdempotency({
      actorId: actor.userId,
      route: 'verify',
      assetId,
      key,
      fingerprint: fingerprintOf([file?.bytes ?? Buffer.alloc(0), file?.filename ?? '', note]),
    });
    if ('replay' in claim) return { status: claim.replay.status, json: claim.replay.body };

    try {
      // Checks before the upload: existence, role, the published 409s, then the evidence rules.
      const prepared = await withReadTransaction(async (client) => {
        await requireAsset(client, assetId);
        if (!allows(actor.role, 'certification.write')) throw errors.forbidden();
        if ('conflict' in claim) throw errors.idempotencyConflict();
        const snapshot = await loadCurrentSnapshot(client);
        const asset = assetOrThrow(snapshot, assetId);
        assertTransition(assetId, asset.state, 'verify');
        const deprecatedUpstream = nearestDeprecatedUpstream(snapshot, assetId);
        if (deprecatedUpstream !== null) upstreamDeprecated(assetId, deprecatedUpstream);
        return acceptEvidence(file, note);
      });

      const evidenceId = randomUUID();
      const storageKey = storageKeyFor(assetId, evidenceId);
      try {
        await evidenceStore.put(storageKey, prepared.bytes, prepared.contentType);
      } catch (error) {
        if (error instanceof EvidenceStoreUnavailable) {
          markEvidenceDown();
          throw errors.evidenceUnavailable();
        }
        throw error;
      }

      let reply: Reply;
      try {
        reply = await withCommitOrder(async (client) => {
          const current = await recheckAuthority(client, actor, 'certification.write');
          const snapshot = await loadCurrentSnapshot(client);
          const asset = assetOrThrow(snapshot, assetId);
          assertTransition(assetId, asset.state, 'verify');
          const deprecatedUpstream = nearestDeprecatedUpstream(snapshot, assetId);
          if (deprecatedUpstream !== null) upstreamDeprecated(assetId, deprecatedUpstream);
          const seq = await reserveSeq(client);
          // verified_at, uploaded_at and uploaded_by are the audit row's own at and actor.
          const row = await appendAudit(client, seq, {
            actorId: current.userId,
            actorRole: current.role,
            action: 'certification.verify',
            targetType: 'asset',
            targetId: assetId,
            before: { state: 'draft' },
            after: {
              state: 'verified',
              evidence_sha256: prepared.sha256,
              filename: prepared.filename,
              content_type: prepared.contentType,
              size_bytes: prepared.bytes.length,
            },
          });
          await client.query(
            `INSERT INTO evidence_records
               (id, asset_id, storage_key, filename, content_type, size_bytes, sha256, note, uploaded_at, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              evidenceId,
              assetId,
              storageKey,
              prepared.filename,
              prepared.contentType,
              prepared.bytes.length,
              prepared.sha256,
              prepared.note,
              row.at,
              current.userId,
            ],
          );
          await writeCertification(client, assetId, seq, 'verified', row.at, evidenceId, null);
          const after = await loadCurrentSnapshot(client);
          return { status: 200, json: assetDetail(after, assetOrThrow(after, assetId), current.role) };
        });
      } catch (error) {
        await evidenceStore.delete(storageKey);
        throw error;
      }
      if ('handle' in claim) await claim.handle.succeed(reply.status, reply.json);
      return reply;
    } catch (error) {
      if ('handle' in claim) await claim.handle.release();
      throw error;
    }
  });

  router.add('POST', '/api/assets/:id/deprecate', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    const assetId = ctx.params.id;
    const key = ctx.header('idempotency-key') ?? null;
    requireValidKey(key);
    const body = ctx.json();
    const rawReason = typeof body.reason === 'string' ? body.reason : '';
    const claim = await claimIdempotency({
      actorId: actor.userId,
      route: 'deprecate',
      assetId,
      key,
      fingerprint: fingerprintOf([rawReason]),
    });
    if ('replay' in claim) return { status: claim.replay.status, json: claim.replay.body };

    try {
      const reply = await withCommitOrder(async (client) => {
        await requireAsset(client, assetId);
        const current = await recheckAuthority(client, actor, 'certification.write');
        if ('conflict' in claim) throw errors.idempotencyConflict();
        const snapshot = await loadCurrentSnapshot(client);
        const asset = assetOrThrow(snapshot, assetId);
        assertTransition(assetId, asset.state, 'deprecate');
        const reason = rawReason.trim();
        const length = codePointLength(reason);
        if (length < 1 || length > 500) {
          throw errors.validation({ reason: 'Give a reason of 1 to 500 characters.' });
        }
        const seq = await reserveSeq(client);
        const row = await appendAudit(client, seq, {
          actorId: current.userId,
          actorRole: current.role,
          action: 'certification.deprecate',
          targetType: 'asset',
          targetId: assetId,
          before: { state: asset.state },
          after: { state: 'deprecated', reason },
        });
        await writeCertification(client, assetId, seq, 'deprecated', null, null, {
          reason,
          at: row.at,
          by: current.userId,
        });
        const eventId = randomUUID();
        await client.query(
          'INSERT INTO deprecation_events (id, asset_id, at_seq, reason, actor_id, at) VALUES ($1,$2,$3,$4,$5,$6)',
          [eventId, assetId, seq, reason, current.userId, row.at],
        );
        // Notices name the nearest deprecated upstream as it stands after this deprecation.
        const deprecated = await loadCurrentSnapshot(client);
        const drafts = buildNoticeDrafts(deprecated, assetId, current.name, reason);
        for (const draft of drafts) {
          await client.query(
            `INSERT INTO notices
               (id, event_id, asset_id, owner_id, recipient_name, recipient_email, subject, body, state)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued')`,
            [
              randomUUID(),
              eventId,
              assetId,
              draft.ownerId,
              draft.recipientName,
              draft.recipientEmail,
              draft.subject,
              draft.body,
            ],
          );
        }
        const unsent = await client.query<{ count: string }>(
          `SELECT count(*) AS count FROM notices WHERE state IN ('queued','claimed')`,
        );
        return {
          status: 200,
          json: {
            asset: assetDetail(deprecated, assetOrThrow(deprecated, assetId), current.role),
            notices_queued: drafts.length,
            queued_notices: Number(unsent.rows[0].count),
          },
        };
      });
      if ('handle' in claim) await claim.handle.succeed(reply.status, reply.json);
      return reply;
    } catch (error) {
      if ('handle' in claim) await claim.handle.release();
      throw error;
    }
  });

  router.add('POST', '/api/assets/:id/reinstate', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    const assetId = ctx.params.id;
    return withCommitOrder(async (client) => {
      await requireAsset(client, assetId);
      const current = await recheckAuthority(client, actor, 'certification.reinstate');
      const snapshot = await loadCurrentSnapshot(client);
      const asset = assetOrThrow(snapshot, assetId);
      assertTransition(assetId, asset.state, 'reinstate');
      const seq = await reserveSeq(client);
      await writeCertification(client, assetId, seq, 'draft', null, null, null);
      const cancelled = await client.query(
        `UPDATE notices SET state = 'cancelled', claim_expires_at = NULL
          WHERE asset_id = $1
            AND (state = 'queued' OR (state = 'claimed' AND claim_expires_at < now()))
          RETURNING id`,
        [assetId],
      );
      const notices_cancelled = cancelled.rowCount ?? 0;
      await appendAudit(client, seq, {
        actorId: current.userId,
        actorRole: current.role,
        action: 'certification.reinstate',
        targetType: 'asset',
        targetId: assetId,
        before: { state: 'deprecated' },
        after: { state: 'draft', notices_cancelled },
      });
      const unsent = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM notices WHERE state IN ('queued','claimed')`,
      );
      const after = await loadCurrentSnapshot(client);
      return {
        status: 200,
        json: {
          asset: assetDetail(after, assetOrThrow(after, assetId), current.role),
          notices_cancelled,
          queued_notices: Number(unsent.rows[0].count),
        },
      };
    });
  });
}
