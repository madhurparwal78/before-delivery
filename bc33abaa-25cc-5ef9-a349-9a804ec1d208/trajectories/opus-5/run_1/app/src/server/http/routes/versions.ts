import { Express } from 'express';
import { formatLocalTime } from '../../../shared/format';
import { query } from '../../db/pool';
import { getScene, graphAt, hashGraph } from '../../domain/scenes';
import { PUBLISH_MAX_SECONDS, PUBLISH_MIN_SECONDS, withinWindow } from '../../domain/time';
import {
  VersionRow,
  announceVersion,
  assertTransition,
  buildExportBundle,
  getVersion,
  publishedPayload,
  referencedAssetIds,
  saveVersion,
  setVersionState,
  versionDto,
} from '../../domain/versions';
import { getSubscription, writeAudit } from '../../domain/workspace';
import { enqueueMail } from '../../services/mail';
import { MissingObjectError, getObject, putObject, storageKeys } from '../../services/storage';
import { randomId } from '../../util/crypto';
import { fail } from '../errors';
import {
  body,
  param,
  parseIsoTime,
  requireCaller,
  requirePermission,
  requireString,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

export function registerVersionRoutes(app: Express): void {
  app.get(
    '/api/scenes/:sceneId/versions',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await getScene(param(req, 'sceneId'), context.workspace.id);
      if (!scene) throw fail.notFound();
      requirePermission(context, 'scene.read');
      const rows = await query<VersionRow>(
        `SELECT * FROM versions WHERE scene_id = $1 ORDER BY number DESC`,
        [scene.id],
      );
      res.json({ versions: await Promise.all(rows.map(versionDto)) });
    }),
  );

  app.post(
    '/api/scenes/:sceneId/versions',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await getScene(param(req, 'sceneId'), context.workspace.id);
      if (!scene) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      const label = requireString(input, 'label', { min: 1, max: 60 });
      const graph = await graphAt(scene, scene.latest_seq);
      const version = await saveVersion({
        workspaceId: context.workspace.id,
        sceneId: scene.id,
        label,
        seq: scene.latest_seq,
        graph,
        hash: hashGraph(graph),
        author: context.author,
      });
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.saved',
        target: { type: 'version', id: version.id },
      });
      await announceVersion(version);
      res.status(201).json(await versionDto(version));
    }),
  );

  app.post(
    '/api/versions/:versionId/submit',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      assertTransition(version.state, 'in_review');
      const updated = await setVersionState(version.id, 'in_review');
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.submitted',
        target: { type: 'version', id: version.id },
      });
      await announceVersion(updated);
      res.json(await versionDto(updated));
    }),
  );

  app.post(
    '/api/versions/:versionId/approve',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.approve');
      if (
        context.caller.kind !== 'member' ||
        (version.created_by_kind === 'member' && version.created_by_id === context.caller.memberId)
      ) {
        throw fail.forbidden();
      }
      requireWritableWorkspace(context);
      if (version.state !== 'in_review') throw fail.conflict('not_in_review');
      await query(
        `INSERT INTO approvals (version_id, member_id, member_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (version_id, member_id) DO NOTHING`,
        [version.id, context.caller.memberId, context.caller.name],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.approved',
        target: { type: 'version', id: version.id },
      });
      const fresh = (await getVersion(version.id, context.workspace.id)) as VersionRow;
      await announceVersion(fresh);
      res.json(await versionDto(fresh));
    }),
  );

  app.post(
    '/api/versions/:versionId/schedule',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      assertTransition(version.state, 'scheduled');
      const approvals = await query<{ member_id: string }>(
        `SELECT member_id FROM approvals WHERE version_id = $1`,
        [version.id],
      );
      const otherApproval = approvals.some((approval) => approval.member_id !== version.created_by_id);
      if (!otherApproval) throw fail.conflict('approval_required');
      const scheduled = await query<{ id: string }>(
        `SELECT id FROM versions WHERE scene_id = $1 AND state = 'scheduled' AND id <> $2`,
        [version.scene_id, version.id],
      );
      if (scheduled.length > 0) throw fail.conflict('another_version_scheduled');
      const publishAt = parseIsoTime(input.publishAt, 'publishAt');
      if (!withinWindow(publishAt, PUBLISH_MIN_SECONDS, PUBLISH_MAX_SECONDS, new Date())) {
        throw fail.validation({
          publishAt: 'Must be between 5 seconds and 365 days from now',
        });
      }
      try {
        await getObject(storageKeys.snapshot(context.workspace.id, version.scene_id, version.id));
      } catch (error) {
        if (error instanceof MissingObjectError) {
          const graph = version.graph;
          await putObject(
            storageKeys.snapshot(context.workspace.id, version.scene_id, version.id),
            Buffer.from(JSON.stringify({ seq: version.seq, graph, hash: version.hash }), 'utf8'),
            'application/json',
          );
        } else {
          throw error;
        }
      }
      const updated = await setVersionState(version.id, 'scheduled', {
        publishAt,
        scheduledById: context.author.id,
      });
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.scheduled',
        target: { type: 'version', id: version.id },
      });
      const scene = await getScene(version.scene_id, context.workspace.id);
      if (scene && context.caller.kind === 'member') {
        const [member] = await query<{ email: string }>(`SELECT email FROM members WHERE id = $1`, [
          context.caller.memberId,
        ]);
        if (member) {
          const local = formatLocalTime(publishAt.toISOString(), context.workspace.time_zone);
          await enqueueMail({
            dedupeKey: `schedule:${version.id}:${publishAt.getTime()}`,
            workspaceId: context.workspace.id,
            to: [member.email],
            subject: `Scheduled: ${scene.name} v${version.number} goes live ${local}`,
            body: [
              `${scene.name} v${version.number} (${version.label}) is scheduled.`,
              '',
              `Goes live: ${local}`,
            ].join('\n'),
          });
        }
      }
      await announceVersion(updated);
      res.json(await versionDto(updated));
    }),
  );

  app.post(
    '/api/versions/:versionId/unschedule',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      assertTransition(version.state, 'in_review');
      const updated = await setVersionState(version.id, 'in_review', { publishAt: null });
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.unscheduled',
        target: { type: 'version', id: version.id },
      });
      await announceVersion(updated);
      res.json(await versionDto(updated));
    }),
  );

  app.post(
    '/api/versions/:versionId/withdraw',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      assertTransition(version.state, 'withdrawn');
      const updated = await setVersionState(version.id, 'withdrawn');
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'version.withdrawn',
        target: { type: 'version', id: version.id },
      });
      await announceVersion(updated);
      res.json(await versionDto(updated));
    }),
  );

  app.post(
    '/api/versions/:versionId/exports',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      if (version.state !== 'published') throw fail.conflict('not_published');
      const scene = await getScene(version.scene_id, context.workspace.id);
      if (!scene) throw fail.notFound();
      const assetIds = referencedAssetIds(version.graph);
      const assets =
        assetIds.length === 0
          ? []
          : await query<{ id: string; content_type: string }>(
              `SELECT id, content_type FROM assets WHERE workspace_id = $1 AND id = ANY($2::text[])`,
              [context.workspace.id, assetIds],
            );
      const bundle = await buildExportBundle(
        version,
        scene.name,
        assets.map((asset) => ({ id: asset.id, contentType: asset.content_type })),
      );
      const id = randomId('exp');
      await putObject(storageKeys.exportBundle(context.workspace.id, id), bundle, 'application/zip');
      await query(
        `INSERT INTO exports (id, workspace_id, version_id, bytes) VALUES ($1, $2, $3, $4)`,
        [id, context.workspace.id, version.id, bundle.length],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'export.created',
        target: { type: 'export', id },
      });
      res.status(201).json({ id, versionId: version.id, bytes: bundle.length });
    }),
  );

  app.get(
    '/api/exports/:exportId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<{ id: string }>(
        `SELECT id FROM exports WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'exportId'), context.workspace.id],
      );
      const bundle = rows[0];
      if (!bundle) throw fail.notFound();
      requirePermission(context, 'scene.read');
      try {
        const bytes = await getObject(storageKeys.exportBundle(context.workspace.id, bundle.id));
        res.type('application/zip').send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );

  app.get(
    '/api/embed/:embedId',
    route(async (req, res) => {
      const rows = await query<VersionRow & { scene_name: string }>(
        `SELECT v.*, s.name AS scene_name
         FROM versions v JOIN scenes s ON s.id = v.scene_id
         WHERE v.embed_id = $1 AND v.state = 'published'
         ORDER BY v.number DESC LIMIT 1`,
        [param(req, 'embedId')],
      );
      const version = rows[0];
      if (!version) {
        const known = await query<{ id: string }>(`SELECT id FROM scenes WHERE embed_id = $1`, [
          param(req, 'embedId'),
        ]);
        if (known.length > 0) throw fail.gone();
        throw fail.notFound();
      }
      const subscription = await getSubscription(version.workspace_id);
      if (subscription.state === 'cancelled') throw fail.gone();
      res.json(publishedPayload(version, version.scene_name));
    }),
  );

  app.get(
    '/api/embed/:embedId/thumbnail.png',
    route(async (req, res) => {
      const rows = await query<VersionRow>(
        `SELECT * FROM versions WHERE embed_id = $1 AND state = 'published' ORDER BY number DESC LIMIT 1`,
        [param(req, 'embedId')],
      );
      const version = rows[0];
      if (!version || !version.thumbnail_stored) throw fail.notFound();
      try {
        const bytes = await getObject(
          storageKeys.thumbnail(version.workspace_id, version.scene_id, version.id),
        );
        res.type('image/png').send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );

  app.get(
    '/api/embed/:embedId/assets/:assetId',
    route(async (req, res) => {
      const rows = await query<VersionRow>(
        `SELECT * FROM versions WHERE embed_id = $1 AND state = 'published' ORDER BY number DESC LIMIT 1`,
        [param(req, 'embedId')],
      );
      const version = rows[0];
      if (!version) throw fail.notFound();
      if (!referencedAssetIds(version.graph).includes(param(req, 'assetId'))) throw fail.notFound();
      const assets = await query<{ content_type: string }>(
        `SELECT content_type FROM assets WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'assetId'), version.workspace_id],
      );
      const asset = assets[0];
      if (!asset) throw fail.notFound();
      try {
        const bytes = await getObject(storageKeys.asset(version.workspace_id, param(req, 'assetId')));
        res.type(asset.content_type).send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );
}
