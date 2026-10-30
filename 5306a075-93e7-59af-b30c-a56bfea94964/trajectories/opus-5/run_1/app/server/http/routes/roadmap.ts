import { monthLabel } from '../../../shared/format';
import {
  lockRelease,
  lockWorkspaceBoard,
  newId,
  newToken,
  withTransaction,
  type Queryable,
} from '../../db';
import { AppError, NO_SUCH_RECORD, conflict, forbidden, notFound } from '../../errors';
import {
  SHARE_LINK_MAX_SECONDS,
  SHARE_LINK_MIN_SECONDS,
  SHARE_LINK_TOKEN_BYTES,
  shareLinkStatus,
} from '../../domain/sharelinks';
import { releaseTransitionError, releaseShippedError } from '../../domain/transitions';
import { isCalendarDate, toInstant } from '../../domain/zone';
import { loadFeatureWorld, rankedFeatures, type FeatureRecord } from '../../repo/features';
import {
  findReleaseRow,
  listReleaseRows,
  releaseFeatureIds,
  toRelease,
  writeReleaseOrder,
  type ReleaseRow,
} from '../../repo/releases';
import { recordAudit } from '../../repo/session';
import { enqueueEmail, renderShipEmail } from '../../services/mail';
import { writeScopeSnapshot } from '../../services/scope';
import { env } from '../../env';
import { Router, requirePrincipal, type RequestContext } from '../kernel';
import { FieldErrors, failField, hasKey, inRange } from '../validate';

const LIFETIME_MESSAGE = 'Lifetime must be a whole number of seconds from 30 to 31536000.';

async function resolveRelease(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const release = await findReleaseRow(ctx.db, principal.workspaceId, ctx.params.id);
  if (!release) throw notFound();
  return { principal, release };
}

function validateReleaseFields(
  errors: FieldErrors,
  body: Record<string, unknown>,
  current: ReleaseRow | null,
): { name: string; targetDate: string; isPublic: boolean } {
  let name = current?.name ?? '';
  if (current === null || hasKey(body, 'name')) {
    const raw = typeof body.name === 'string' ? body.name.trim() : '';
    if (raw === '' || raw.length > 120) errors.add('name', 'Add a release name of up to 120 characters.');
    else name = raw;
  }
  let targetDate = current?.target_date ?? '';
  if (current === null || hasKey(body, 'targetDate')) {
    const raw = typeof body.targetDate === 'string' ? body.targetDate : '';
    if (!isCalendarDate(raw)) errors.add('targetDate', 'Use a calendar date like 2027-03-15.');
    else targetDate = raw;
  }
  let isPublic = current?.is_public ?? false;
  if (current === null || hasKey(body, 'isPublic')) {
    if (typeof body.isPublic !== 'boolean') errors.add('isPublic', 'Choose public or internal.');
    else isPublic = body.isPublic;
  }
  return { name, targetDate, isPublic };
}

export function registerRoadmapRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/roadmap',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const releaseRows = await listReleaseRows(ctx.db, principal.workspaceId);
      const releases = await Promise.all(releaseRows.map((row) => toRelease(ctx.db, row)));

      const months = new Map<string, typeof releases>();
      for (const release of releases) {
        const list = months.get(release.targetMonth) ?? [];
        list.push(release);
        months.set(release.targetMonth, list);
      }

      return {
        status: 200,
        json: {
          timeZone: principal.timeZone,
          unscheduled: rankedFeatures(world)
            .filter(
              (feature) =>
                feature.releaseId === null &&
                (feature.status === 'planned' || feature.status === 'in_progress'),
            )
            .map((feature) => ({ id: feature.id, name: feature.name, status: feature.status })),
          columns: [...months.keys()]
            .sort()
            .map((month) => ({
              month,
              label: monthLabel(month),
              releases: (months.get(month) ?? []).map((release) => ({
                ...release,
                features: release.featureIds.map((featureId, index) => {
                  const feature = world.features.get(featureId) as FeatureRecord;
                  return {
                    id: feature.id,
                    name: feature.name,
                    status: feature.status,
                    position: index + 1,
                  };
                }),
              })),
            })),
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/releases',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const fields = validateReleaseFields(errors, ctx.body, null);
      errors.throwIfAny();
      const id = newId();
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO releases (id, workspace_id, name, target_date, is_public, status)
           VALUES ($1, $2, $3, $4, $5, 'open')`,
          [id, principal.workspaceId, fields.name, fields.targetDate, fields.isPublic],
        );
        await recordAudit(client, principal.workspaceId, principal.memberId, 'release.create', 'release', id);
      });
      const row = await findReleaseRow(ctx.db, principal.workspaceId, id);
      return { status: 201, json: { release: await toRelease(ctx.db, row as ReleaseRow) } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/releases/:id',
    access: 'member',
    resolve: resolveRelease,
    handle: async (ctx, { release }) => ({
      status: 200,
      json: { release: await toRelease(ctx.db, release) },
    }),
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/releases/:id',
    access: 'member',
    roles: ['head_of_product'],
    resolve: resolveRelease,
    handle: async (ctx, { principal, release }) => {
      if (release.status === 'shipped') throw releaseShippedError();
      const errors = new FieldErrors();
      const fields = validateReleaseFields(errors, ctx.body, release);
      errors.throwIfAny();
      await withTransaction(async (client) => {
        await client.query(
          'UPDATE releases SET name = $1, target_date = $2, is_public = $3 WHERE id = $4',
          [fields.name, fields.targetDate, fields.isPublic, release.id],
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'release.update',
          'release',
          release.id,
        );
      });
      const row = await findReleaseRow(ctx.db, principal.workspaceId, release.id);
      return { status: 200, json: { release: await toRelease(ctx.db, row as ReleaseRow) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/roadmap/moves',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();

      const featureId = typeof ctx.body.featureId === 'string' ? ctx.body.featureId : '';
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const feature = world.features.get(featureId);
      if (!feature || feature.parentFeatureId !== null) errors.add('featureId', NO_SUCH_RECORD);

      const rawTarget = ctx.body.toReleaseId;
      let toReleaseId: string | null = null;
      if (typeof rawTarget === 'string' && rawTarget !== '') {
        const target = await findReleaseRow(ctx.db, principal.workspaceId, rawTarget);
        if (!target) errors.add('toReleaseId', NO_SUCH_RECORD);
        else toReleaseId = rawTarget;
      } else if (rawTarget !== null && rawTarget !== undefined) {
        errors.add('toReleaseId', NO_SUCH_RECORD);
      }

      const toIndex = ctx.body.toIndex;
      if (!Number.isInteger(toIndex) || (toIndex as number) < 0) {
        errors.add('toIndex', 'Position must be a whole number from 0 upwards.');
      }

      const rawVersions = ctx.body.expectedOrderVersions;
      const expected = new Map<string, number>();
      if (rawVersions === null || typeof rawVersions !== 'object' || Array.isArray(rawVersions)) {
        errors.add('expectedOrderVersions', 'Name the order version of every release this move touches.');
      } else {
        for (const [releaseId, value] of Object.entries(rawVersions as Record<string, unknown>)) {
          const row = await findReleaseRow(ctx.db, principal.workspaceId, releaseId);
          if (!row) {
            errors.add('expectedOrderVersions', NO_SUCH_RECORD);
            break;
          }
          if (!Number.isInteger(value)) {
            errors.add('expectedOrderVersions', 'Order versions must be whole numbers.');
            break;
          }
          expected.set(releaseId, value as number);
        }
      }
      errors.throwIfAny();

      const source = (feature as FeatureRecord).releaseId;
      const touched = [...new Set([source, toReleaseId].filter((id): id is string => id !== null))];

      const result = await withTransaction(async (client) => {
        await lockWorkspaceBoard(client, principal.workspaceId);
        for (const releaseId of [...touched].sort()) await lockRelease(client, releaseId);

        const rows = new Map<string, ReleaseRow>();
        for (const releaseId of touched) {
          const row = await findReleaseRow(client, principal.workspaceId, releaseId);
          rows.set(releaseId, row as ReleaseRow);
        }

        const membershipChange = source !== toReleaseId;
        if (membershipChange && principal.role !== 'head_of_product') {
          for (const row of rows.values()) if (row.status === 'frozen') throw forbidden();
        }
        for (const row of rows.values()) if (row.status === 'shipped') throw releaseShippedError();

        const current = world.features.get(featureId) as FeatureRecord;
        if (
          toReleaseId !== null &&
          membershipChange &&
          current.status !== 'planned' &&
          current.status !== 'in_progress'
        ) {
          throw conflict('feature_not_planned', `${current.name} must be planned before it joins a release.`);
        }

        const stale = touched.some(
          (releaseId) =>
            expected.has(releaseId) && expected.get(releaseId) !== (rows.get(releaseId) as ReleaseRow).order_version,
        );
        if (stale) {
          throw conflict('order_conflict', 'The board changed while you were moving this feature.', {
            current: await Promise.all(
              touched.map(async (id) => ({
                releaseId: id,
                orderVersion: (rows.get(id) as ReleaseRow).order_version,
                featureIds: await releaseFeatureIds(client, id),
              })),
            ),
          });
        }
        if (touched.some((releaseId) => !expected.has(releaseId))) {
          failField('expectedOrderVersions', 'Name the order version of every release this move touches.');
        }

        const sourceOrder = source === null ? [] : await releaseFeatureIds(client, source);
        const targetOrder =
          toReleaseId === null
            ? []
            : source === toReleaseId
              ? sourceOrder.filter((id) => id !== featureId)
              : (await releaseFeatureIds(client, toReleaseId)).filter((id) => id !== featureId);

        if (toReleaseId !== null && (toIndex as number) > targetOrder.length) {
          failField('toIndex', `Position must be a whole number from 0 to ${targetOrder.length}.`);
        }

        const touchedResults: { releaseId: string; orderVersion: number; featureIds: string[] }[] = [];

        if (toReleaseId === null) {
          await client.query('UPDATE features SET release_id = NULL, board_position = 0 WHERE id = $1', [
            featureId,
          ]);
          if (source !== null) {
            const remaining = sourceOrder.filter((id) => id !== featureId);
            const orderVersion = await writeReleaseOrder(client, source, remaining);
            touchedResults.push({ releaseId: source, orderVersion, featureIds: remaining });
          }
        } else {
          const next = [...targetOrder];
          next.splice(toIndex as number, 0, featureId);
          if (source !== null && source !== toReleaseId) {
            const remaining = sourceOrder.filter((id) => id !== featureId);
            const orderVersion = await writeReleaseOrder(client, source, remaining);
            touchedResults.push({ releaseId: source, orderVersion, featureIds: remaining });
          }
          const orderVersion = await writeReleaseOrder(client, toReleaseId, next);
          touchedResults.push({ releaseId: toReleaseId, orderVersion, featureIds: next });
        }

        if (membershipChange) {
          for (const releaseId of touched) {
            const row = rows.get(releaseId) as ReleaseRow;
            if (row.status !== 'frozen') continue;
            const snapshotVersion = row.snapshot_version + 1;
            await writeScopeSnapshot(client, row, snapshotVersion, toInstant(new Date()) as string);
            await client.query('UPDATE releases SET snapshot_version = $1 WHERE id = $2', [
              snapshotVersion,
              releaseId,
            ]);
          }
        }

        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'roadmap.move',
          'feature',
          featureId,
          { toReleaseId, toIndex },
        );
        return touchedResults;
      });

      return { status: 200, json: { releases: result } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/releases/:id/freeze',
    access: 'member',
    roles: ['head_of_product'],
    resolve: resolveRelease,
    handle: async (ctx, { principal, release }) => {
      const updated = await withTransaction(async (client) => {
        await lockRelease(client, release.id);
        const row = (await findReleaseRow(client, principal.workspaceId, release.id)) as ReleaseRow;
        if (row.status !== 'open') throw releaseTransitionError(row.status, 'frozen');
        const frozenAt = toInstant(new Date()) as string;
        await writeScopeSnapshot(client, row, 1, frozenAt);
        await client.query(
          "UPDATE releases SET status = 'frozen', snapshot_version = 1, frozen_at = $1 WHERE id = $2",
          [frozenAt, release.id],
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'release.freeze',
          'release',
          release.id,
        );
        return (await findReleaseRow(client, principal.workspaceId, release.id)) as ReleaseRow;
      });
      return { status: 200, json: { release: await toRelease(ctx.db, updated) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/releases/:id/ship',
    access: 'member',
    roles: ['head_of_product'],
    resolve: resolveRelease,
    handle: async (ctx, { principal, release }) => {
      const rawKey = ctx.headers['idempotency-key'];
      const key = typeof rawKey === 'string' ? rawKey : '';
      if (key.length < 1 || key.length > 200 || !/^[\x20-\x7e]+$/u.test(key)) {
        failField('Idempotency-Key', 'Send an Idempotency-Key of 1 to 200 printable ASCII characters.');
      }

      const { rows: stored } = await ctx.db.query<{
        target_id: string;
        response_status: number;
        response_body: unknown;
      }>('SELECT target_id, response_status, response_body FROM idempotency_keys WHERE workspace_id = $1 AND key = $2', [
        principal.workspaceId,
        key,
      ]);
      if (stored[0] && stored[0].target_id === release.id) {
        return { status: stored[0].response_status, json: stored[0].response_body };
      }

      const reply = await withTransaction(async (client) => {
        await lockRelease(client, release.id);
        const row = (await findReleaseRow(client, principal.workspaceId, release.id)) as ReleaseRow;
        if (row.status === 'shipped') throw releaseShippedError();
        if (row.status !== 'frozen') throw releaseTransitionError(row.status, 'shipped');
        if (stored[0]) {
          throw new AppError(
            422,
            'idempotency_key_reused',
            'This idempotency key was already used for another release.',
          );
        }

        const featureIds = await releaseFeatureIds(client, row.id);
        const shippedAt = toInstant(new Date()) as string;
        await client.query("UPDATE releases SET status = 'shipped', shipped_at = $1 WHERE id = $2", [
          shippedAt,
          row.id,
        ]);
        if (featureIds.length > 0) {
          await client.query(
            "UPDATE features SET status = 'released', prior_status = NULL WHERE id = ANY($1::text[])",
            [featureIds],
          );
        }

        const emailsQueued = await queueShipEmails(client, principal.workspaceId, row, featureIds, {
          workspaceName: principal.workspaceName,
        });
        await recordAudit(client, principal.workspaceId, principal.memberId, 'release.ship', 'release', row.id, {
          emailsQueued,
        });

        const fresh = (await findReleaseRow(client, principal.workspaceId, row.id)) as ReleaseRow;
        const body = { release: await toRelease(client, fresh), emailsQueued };
        await client.query(
          `INSERT INTO idempotency_keys (workspace_id, key, scope, target_id, response_status, response_body)
           VALUES ($1, $2, 'release.ship', $3, 200, $4::jsonb)`,
          [principal.workspaceId, key, row.id, JSON.stringify(body)],
        );
        return body;
      });
      return { status: 200, json: reply };
    },
  });

  registerShareLinkRoutes(router);
}

async function queueShipEmails(
  client: Queryable,
  workspaceId: string,
  release: ReleaseRow,
  featureIds: readonly string[],
  context: { workspaceName: string },
): Promise<number> {
  if (featureIds.length === 0) return 0;
  const { rows } = await client.query<{
    contact_id: string;
    contact_name: string;
    contact_email: string;
    feature_id: string;
    feature_name: string;
    public_description: string;
    board_position: number;
  }>(
    `SELECT contacts.id AS contact_id, contacts.name AS contact_name, contacts.email AS contact_email,
            features.id AS feature_id, features.name AS feature_name,
            features.public_description, features.board_position
       FROM insights
       JOIN notes ON notes.id = insights.note_id
       JOIN contacts ON contacts.id = notes.contact_id
       JOIN features ON features.id = insights.feature_id
      WHERE insights.feature_id = ANY($1::text[])
      GROUP BY contacts.id, contacts.name, contacts.email, features.id, features.name,
               features.public_description, features.board_position
      ORDER BY features.board_position, features.id`,
    [featureIds],
  );
  const byContact = new Map<
    string,
    { name: string; email: string; features: { name: string; publicDescription: string }[] }
  >();
  for (const row of rows) {
    const entry =
      byContact.get(row.contact_id) ??
      { name: row.contact_name, email: row.contact_email, features: [] };
    entry.features.push({ name: row.feature_name, publicDescription: row.public_description });
    byContact.set(row.contact_id, entry);
  }
  for (const entry of byContact.values()) {
    await enqueueEmail(
      client,
      workspaceId,
      release.id,
      { name: entry.name, email: entry.email },
      renderShipEmail({
        contactName: entry.name,
        workspaceName: context.workspaceName,
        releaseName: release.name,
        targetMonth: release.target_date.slice(0, 7),
        features: entry.features,
      }),
    );
  }
  return byContact.size;
}

function registerShareLinkRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/roadmap/share-links',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const { rows } = await ctx.db.query<ShareLinkRow>(
        `SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at FROM share_links
          WHERE workspace_id = $1 ORDER BY created_at DESC, sequence DESC`,
        [principal.workspaceId],
      );
      return { status: 200, json: { shareLinks: rows.map(toShareLink) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/roadmap/share-links',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const raw = ctx.body.expiresInSeconds;
      let expiresInSeconds: number | null = null;
      if (raw !== undefined && raw !== null) {
        if (!Number.isInteger(raw) || !inRange(raw as number, SHARE_LINK_MIN_SECONDS, SHARE_LINK_MAX_SECONDS)) {
          failField('expiresInSeconds', LIFETIME_MESSAGE);
        }
        expiresInSeconds = raw as number;
      }
      const id = newId();
      const { rows } = await ctx.db.query<ShareLinkRow>(
        `INSERT INTO share_links (id, workspace_id, token, created_at, expires_in_seconds, expires_at)
         VALUES ($1, $2, $3, date_trunc('second', now()), $4,
                 CASE WHEN $4::integer IS NULL THEN NULL
                      ELSE date_trunc('second', now()) + make_interval(secs => $4::integer) END)
         RETURNING id, token, created_at, expires_in_seconds, expires_at, revoked_at`,
        [id, principal.workspaceId, newToken(SHARE_LINK_TOKEN_BYTES), expiresInSeconds],
      );
      return { status: 201, json: { shareLink: toShareLink(rows[0]) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/roadmap/share-links/:id/regenerate',
    access: 'member',
    roles: ['head_of_product'],
    resolve: resolveShareLink,
    handle: async (ctx, { link }) => {
      if (link.revoked_at !== null) throw conflict('link_revoked', 'A revoked link can never be regenerated.');
      const { rows } = await ctx.db.query<ShareLinkRow>(
        `UPDATE share_links
            SET token = $2, created_at = date_trunc('second', now()),
                expires_at = CASE WHEN expires_in_seconds IS NULL THEN NULL
                                  ELSE date_trunc('second', now())
                                       + make_interval(secs => expires_in_seconds) END
          WHERE id = $1
          RETURNING id, token, created_at, expires_in_seconds, expires_at, revoked_at`,
        [link.id, newToken(SHARE_LINK_TOKEN_BYTES)],
      );
      return { status: 200, json: { shareLink: toShareLink(rows[0]) } };
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/roadmap/share-links/:id',
    access: 'member',
    roles: ['head_of_product'],
    resolve: resolveShareLink,
    handle: async (ctx, { link }) => {
      await ctx.db.query('UPDATE share_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
        link.id,
      ]);
      return { status: 204 };
    },
  });
}

async function resolveShareLink(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const { rows } = await ctx.db.query<ShareLinkRow>(
    `SELECT id, token, created_at, expires_in_seconds, expires_at, revoked_at FROM share_links
      WHERE workspace_id = $1 AND id = $2`,
    [principal.workspaceId, ctx.params.id],
  );
  if (rows.length === 0) throw notFound();
  return { principal, link: rows[0] };
}

export interface ShareLinkRow {
  id: string;
  token: string;
  created_at: Date;
  expires_in_seconds: number | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

function toShareLink(row: ShareLinkRow) {
  return {
    id: row.id,
    token: row.token,
    url: `${env.baseUrl}/r/${row.token}`,
    createdAt: toInstant(row.created_at) as string,
    expiresInSeconds: row.expires_in_seconds,
    expiresAt: toInstant(row.expires_at),
    revokedAt: toInstant(row.revoked_at),
    status: shareLinkStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at }, new Date()),
  };
}

export interface PublicRoadmapColumn {
  month: string;
  label: string;
  releases: { name: string; targetMonth: string; features: { name: string; publicDescription: string }[] }[];
}

/** The public view: only public releases and only published fields. */
export async function loadPublicRoadmap(
  db: Queryable,
  token: string,
): Promise<{ workspaceName: string; columns: PublicRoadmapColumn[] } | null> {
  const { rows: linkRows } = await db.query<ShareLinkRow & { workspace_id: string; workspace_name: string }>(
    `SELECT share_links.id, share_links.token, share_links.created_at, share_links.expires_in_seconds,
            share_links.expires_at, share_links.revoked_at, share_links.workspace_id,
            workspaces.name AS workspace_name
       FROM share_links
       JOIN workspaces ON workspaces.id = share_links.workspace_id
      WHERE share_links.token = $1`,
    [token],
  );
  const link = linkRows[0];
  if (!link) return null;
  if (shareLinkStatus({ expiresAt: link.expires_at, revokedAt: link.revoked_at }, new Date()) !== 'active') {
    return null;
  }

  const { rows } = await db.query<{
    release_id: string;
    release_name: string;
    target_date: string;
    feature_name: string | null;
    public_description: string | null;
    board_position: number | null;
  }>(
    `SELECT releases.id AS release_id, releases.name AS release_name, releases.target_date,
            features.name AS feature_name, features.public_description, features.board_position
       FROM releases
       LEFT JOIN features ON features.release_id = releases.id AND features.status <> 'archived'
      WHERE releases.workspace_id = $1 AND releases.is_public = true
      ORDER BY releases.target_date, releases.created_at, releases.id,
               features.board_position, features.id`,
    [link.workspace_id],
  );

  const byRelease = new Map<
    string,
    { name: string; targetMonth: string; features: { name: string; publicDescription: string }[] }
  >();
  const order: string[] = [];
  for (const row of rows) {
    if (!byRelease.has(row.release_id)) {
      byRelease.set(row.release_id, {
        name: row.release_name,
        targetMonth: row.target_date.slice(0, 7),
        features: [],
      });
      order.push(row.release_id);
    }
    if (row.feature_name !== null) {
      (byRelease.get(row.release_id) as { features: { name: string; publicDescription: string }[] }).features.push(
        { name: row.feature_name, publicDescription: row.public_description ?? '' },
      );
    }
  }

  const months = new Map<string, PublicRoadmapColumn>();
  for (const releaseId of order) {
    const release = byRelease.get(releaseId) as {
      name: string;
      targetMonth: string;
      features: { name: string; publicDescription: string }[];
    };
    const column = months.get(release.targetMonth) ?? {
      month: release.targetMonth,
      label: monthLabel(release.targetMonth),
      releases: [],
    };
    column.releases.push(release);
    months.set(release.targetMonth, column);
  }
  return {
    workspaceName: link.workspace_name,
    columns: [...months.keys()].sort().map((month) => months.get(month) as PublicRoadmapColumn),
  };
}
