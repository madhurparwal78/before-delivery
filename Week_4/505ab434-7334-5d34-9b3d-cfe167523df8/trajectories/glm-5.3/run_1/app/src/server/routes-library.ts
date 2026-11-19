import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { ApiError, forbidden, notFound, storageDownload } from './errors';
import { decideAvailability, localEndOfDay, IMPLICIT_GRANT_ID } from './availability';
import {
  assetById,
  implicitGrantApplies,
  loadViewer,
  openRequestsFor,
  pendingProofGrantsFor,
  grantsForCard,
  cardTarget,
  type Viewer,
} from './data';
import { query } from './db';
import { readClock } from './clock';
import type { Config } from './config';
import { CLASS_LABELS, type AssetClass, type Badge } from '../shared/domain';
import { appendAudit } from './audit';
import { withTransaction } from './db';
import { notify } from './pglisten';
import { randomToken, sha256, hmacHex } from './crypto';
import { auditDenied } from './audit-denied';
import { created } from './created';
import { formatTime } from './datetime';

interface LibraryFilters {
  className: string | null;
  availability: Badge[];
  q: string | null;
}

export function routeLibrary(router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void }, cfg: Config): void {
  router.add('GET', '/library', async (ctx) => {
    const principal = requireSession(ctx);
    const viewer = await loadViewer(principal);
    const now = await readClock(cfg);
    const filters = parseFilters(ctx);
    const cards = await buildCards(viewer, now, cfg, filters);
    return { count: cards.length, cards };
  });

  router.add('POST', '/derivatives/:id/link', async (ctx) => {
    const principal = requireSession(ctx);
    const viewer = await loadViewer(principal);
    const now = await readClock(cfg);
    const derivative = await query<{
      id: string;
      file_name: string;
      format: string;
      width: number;
      height: number;
      byte_size: string;
      asset_id: string;
      asset_name: string;
      variant_id: string | null;
      variant_label: string | null;
      licence_name: string;
      class_name: string;
    }>(
      `SELECT d.id, d.file_name, d.format, d.width, d.height, d.byte_size,
              a.id AS asset_id, a.name AS asset_name, v.id AS variant_id, v.label AS variant_label,
              l.name AS licence_name, a.class AS class_name
         FROM derivatives d
         JOIN assets a ON a.id = d.asset_id
         JOIN licences l ON l.id = a.licence_id
         LEFT JOIN variants v ON v.id = d.variant_id
        WHERE d.id = $1`,
      [ctx.params.id],
    );
    if (derivative.length === 0) throw notFound();
    const row = derivative[0];
    const cardName = row.variant_id ? `${row.asset_name} — ${row.variant_label}` : row.asset_name;
    const storageOk = await storageReachable();
    if (!storageOk) throw storageDownload();
    const decision = await decideFor(viewer, row.asset_id, row.variant_id, now, cfg);
    if (decision.badge !== 'Available') {
      await auditDenied(
        {
          actorId: viewer.principal.id,
          actorRole: viewer.principal.role,
          action: 'link.issued',
          resourceType: 'derivative',
          resourceId: row.id,
        },
        now,
      );
      throw new ApiError(403, 'download_not_allowed', decision.reason ?? 'Not available.');
    }
    const expiresAt = new Date(now.getTime() + cfg.downloadLinkTtlSeconds * 1000);
    const token = `${randomToken(18)}.${hmacHex(cfg.linkSigningSecret, randomToken(18))}`;
    const inserted = await withTransaction(async (tx) => {
      const res = await tx.query(
        `INSERT INTO download_links (token_hash, derivative_id, principal_id, grant_id, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING derivative_id`,
        [
          sha256(token),
          row.id,
          viewer.principal.id,
          decision.coveringGrant ? decision.coveringGrant.id : IMPLICIT_GRANT_ID,
          expiresAt,
          now,
        ],
      );
      await appendAudit(tx, {
        occurredAt: now,
        actorId: viewer.principal.id,
        actorRole: viewer.principal.role,
        action: 'link.issued',
        resourceType: 'derivative',
        resourceId: row.id,
        requestId: null,
        before: null,
        after: {
          expiresAt: expiresAt.toISOString(),
          grant: decision.coveringGrant ? decision.coveringGrant.id : IMPLICIT_GRANT_ID,
        },
        outcome: 'success',
      });
      await notify(tx, JSON.stringify({ type: 'library.updated' }));
      return res.rows[0];
    });
    void inserted;
    return created({ url: `/dl/${token}`, expiresAt: expiresAt.toISOString() });
  });
}

export async function decideFor(viewer: Viewer, assetId: string, variantId: string | null, now: Date, cfg: Config) {
  const asset = await assetById(assetId);
  if (!asset || asset.state === 'draft') throw notFound();
  const grants = await grantsForCard(assetId, variantId);
  const viewerGrants = grants.filter(
    (g) =>
      (g.holderType === 'principal' && g.holderPrincipalId === viewer.principal.id) ||
      (g.holderType === 'group' && viewer.context.groupIds.includes(g.holderGroupId ?? '')),
  );
  if (viewerGrants.length === 0 && implicitGrantApplies(asset.licence, viewer)) {
    viewerGrants.push({
      id: IMPLICIT_GRANT_ID,
      holderType: 'principal',
      holderPrincipalId: viewer.principal.id,
      holderGroupId: null,
      status: 'active',
      notBefore: null,
      notAfter: '2999-12-31',
      licenceId: asset.licenceId,
    });
  }
  const openRequests = await openRequestsFor(viewer, assetId, variantId);
  const pending = await pendingProofGrantsFor(viewer, assetId, variantId);
  return decideAvailability({
    asset: {
      id: asset.id,
      name: asset.name,
      state: asset.state,
      successorName: asset.successorName,
      licence: asset.licence,
    },
    grants: viewerGrants,
    viewer: viewer.context,
    openRequests,
    pendingProofGrants: pending,
    now,
    timeZone: cfg.appTimeZone,
  });
}

export interface CardOut {
  assetId: string;
  variantId: string | null;
  cardName: string;
  classLabel: string;
  licenceName: string;
  badge: Badge;
  reason: string | null;
  successorName: string | null;
  canRequest: boolean;
  requestReason: string | null;
  openRequestId: string | null;
  derivatives: { id: string; fileName: string; format: string; width: number; height: number }[];
  grant: { id: string; status: string; statusLabel: string; notBefore: string | null; notAfter: string; conditions: { kind: string; text: string }[] } | null;
}

export async function buildCards(
  viewer: Viewer,
  now: Date,
  cfg: Config,
  filters: LibraryFilters,
): Promise<CardOut[]> {
  const assets = await query<{
    id: string;
    name: string;
    state: string;
    class_name: string;
    licence_id: string;
    licence_name: string;
    successor_name: string | null;
  }>(
    `SELECT a.id, a.name, a.state, a.class AS class_name, a.licence_id, l.name AS licence_name,
            s.name AS successor_name
       FROM assets a
       JOIN licences l ON l.id = a.licence_id
       LEFT JOIN assets s ON s.id = a.successor_id
      WHERE a.state <> 'draft'
      ORDER BY a.name, a.id`,
  );
  const variants = await query<{ id: string; asset_id: string; label: string; position: number }>(
    'SELECT id, asset_id, label, position FROM variants ORDER BY asset_id, position',
  );
  const byAsset = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = byAsset.get(v.asset_id) ?? [];
    list.push(v);
    byAsset.set(v.asset_id, list);
  }
  const cards: CardOut[] = [];
  for (const asset of assets) {
    const assetVariants = byAsset.get(asset.id) ?? [];
    if (assetVariants.length === 0) {
      cards.push(await cardFor(viewer, asset, null, null, now, cfg));
    } else {
      for (const variant of assetVariants) {
        cards.push(await cardFor(viewer, asset, variant.id, variant.label, now, cfg));
      }
    }
  }
  const q = filters.q?.toLowerCase() ?? null;
  const filtered = cards.filter((card) => {
    const asset = assets.find((a) => a.id === card.assetId)!;
    if (filters.className && asset.class_name !== filters.className) return false;
    if (filters.availability.length > 0 && !filters.availability.includes(card.badge)) return false;
    if (q && !card.cardName.toLowerCase().includes(q) && !card.classLabel.toLowerCase().includes(q)) return false;
    return true;
  });
  return filtered.sort((a, b) => (a.cardName < b.cardName ? -1 : a.cardName > b.cardName ? 1 : 0));
}

async function cardFor(
  viewer: Viewer,
  asset: { id: string; name: string; state: string; class_name: string; licence_id: string; licence_name: string; successor_name: string | null },
  variantId: string | null,
  variantLabel: string | null,
  now: Date,
  cfg: Config,
): Promise<CardOut> {
  const decision = await decideFor(viewer, asset.id, variantId, now, cfg);
  const derivatives =
    decision.badge === 'Available'
      ? await query<{ id: string; file_name: string; format: string; width: number; height: number }>(
          `SELECT id, file_name, format, width, height FROM derivatives
            WHERE asset_id = $1 AND (variant_id = $2 OR ($2 IS NULL AND variant_id IS NULL))
            ORDER BY position`,
          [asset.id, variantId],
        )
      : [];
  const grantRow = await query<{
    id: string;
    status: string;
    not_before: string | null;
    not_after: string;
  }>(
    `SELECT g.id, g.status, g.not_before::text, g.not_after::text FROM grants g
      WHERE g.asset_id = $1 AND (g.variant_id = $2 OR ($2 IS NULL AND g.variant_id IS NULL))
        AND ((g.holder_type = 'principal' AND g.holder_principal_id = $3)
          OR (g.holder_type = 'group' AND g.holder_group_id = ANY($4)))
        AND g.status IN ('active','pending_proof')
      ORDER BY CASE g.status WHEN 'pending_proof' THEN 0 ELSE 1 END, g.not_after DESC
      LIMIT 1`,
    [asset.id, variantId, viewer.principal.id, viewer.context.groupIds],
  );
  const conditions = grantRow.length > 0 && grantRow[0].id !== IMPLICIT_GRANT_ID
    ? await query<{ kind: string; text: string }>(
        'SELECT kind, text FROM conditions WHERE request_id IN (SELECT request_id FROM grants WHERE id = $1) ORDER BY position',
        [grantRow[0].id],
      )
    : [];
  const statusLabel = grantRow.length > 0 ? grantStatusLabels[grantRow[0].status] ?? grantRow[0].status : null;
  return {
    assetId: asset.id,
    variantId,
    cardName: variantId ? `${asset.name} — ${variantLabel}` : asset.name,
    classLabel: CLASS_LABELS[asset.class_name as AssetClass] ?? asset.class_name,
    licenceName: asset.licence_name,
    badge: decision.badge,
    reason: decision.reason,
    successorName: asset.successor_name,
    canRequest: decision.canRequest,
    requestReason: decision.requestReason,
    openRequestId: decision.openRequestId,
    derivatives: derivatives.map((d) => ({
      id: d.id,
      fileName: d.file_name,
      format: d.format,
      width: d.width,
      height: d.height,
    })),
    grant:
      grantRow.length > 0
        ? {
            id: grantRow[0].id,
            status: grantRow[0].status,
            statusLabel: statusLabel ?? grantRow[0].status,
            notBefore: grantRow[0].not_before,
            notAfter: grantRow[0].not_after,
            conditions: conditions.map((c) => ({ kind: c.kind, text: c.text })),
          }
        : null,
  };
}

const grantStatusLabels: Record<string, string> = {
  active: 'Active',
  pending_proof: 'Pending proof',
  revoked: 'Revoked',
  expired: 'Expired',
  zero_length: 'Zero-length',
};

function parseFilters(ctx: Ctx): LibraryFilters {
  const className = ctx.url.searchParams.get('class');
  const availability = ctx.url.searchParams.getAll('availability');
  const q = ctx.url.searchParams.get('q');
  return {
    className: className && className.length > 0 ? className : null,
    availability: availability.filter((a): a is Badge =>
      ['Available', 'Request required', 'Restricted', 'Retired'].includes(a),
    ),
    q: q && q.length > 0 ? q : null,
  };
}

export async function storageReachable(): Promise<boolean> {
  const ep = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${ep}/minio/health/live`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export { formatTime, localEndOfDay, cardTarget };
