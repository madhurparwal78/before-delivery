import { Express } from 'express';
import { query } from '../../db/pool';
import { checkPngBody, checkUpload } from '../../domain/uploads';
import { writeAudit } from '../../domain/workspace';
import { getVersion } from '../../domain/versions';
import { MissingObjectError, getObject, putObject, storageKeys } from '../../services/storage';
import { randomId } from '../../util/crypto';
import { parseMultipart } from '../../util/multipart';
import { fail } from '../errors';
import {
  param,
  requireCaller,
  requirePermission,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

interface AssetRow {
  id: string;
  workspace_id: string;
  kind: 'model' | 'texture';
  name: string;
  bytes: number;
  content_type: string;
  uploaded_by_kind: 'member' | 'agent';
  uploaded_by_id: string;
  uploaded_by_name: string;
}

export function registerAssetRoutes(app: Express): void {
  app.post(
    '/api/assets',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'scene.create');
      requireWritableWorkspace(context);
      const parts = parseMultipart(req.rawBody, req.headers['content-type'] ?? '');
      const kindPart = parts.find((part) => part.name === 'kind');
      const filePart = parts.find((part) => part.name === 'file');
      if (!filePart) throw fail.validation({ file: 'A file is required' });
      const accepted = checkUpload({
        kind: kindPart ? kindPart.bytes.toString('utf8').trim() : '',
        fileName: filePart.fileName ?? '',
        bytes: filePart.bytes,
      });
      const id = randomId('ast');
      await putObject(
        storageKeys.asset(context.workspace.id, id),
        accepted.bytes,
        accepted.contentType,
      );
      await query(
        `INSERT INTO assets (id, workspace_id, kind, name, bytes, content_type, uploaded_by_kind, uploaded_by_id, uploaded_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          context.workspace.id,
          accepted.kind,
          accepted.fileName,
          accepted.bytes.length,
          accepted.contentType,
          context.author.kind,
          context.author.id,
          context.author.name,
        ],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'asset.uploaded',
        target: { type: 'asset', id },
      });
      res.status(201).json({
        id,
        kind: accepted.kind,
        name: accepted.fileName,
        bytes: accepted.bytes.length,
        contentType: accepted.contentType,
      });
    }),
  );

  app.get(
    '/api/assets',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'scene.read');
      const rows = await query<AssetRow>(
        `SELECT * FROM assets WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [context.workspace.id],
      );
      res.json({
        assets: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          name: row.name,
          bytes: row.bytes,
          contentType: row.content_type,
          uploadedBy: {
            kind: row.uploaded_by_kind,
            id: row.uploaded_by_id,
            name: row.uploaded_by_name,
          },
        })),
      });
    }),
  );

  app.get(
    '/api/assets/:assetId/file',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<AssetRow>(
        `SELECT * FROM assets WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'assetId'), context.workspace.id],
      );
      const asset = rows[0];
      if (!asset) throw fail.notFound();
      requirePermission(context, 'scene.read');
      try {
        const bytes = await getObject(storageKeys.asset(context.workspace.id, asset.id));
        res.type(asset.content_type).send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );

  app.put(
    '/api/versions/:versionId/thumbnail',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'scene.create');
      requireWritableWorkspace(context);
      const invalid = checkPngBody(req.rawBody);
      if (invalid) throw invalid;
      await putObject(
        storageKeys.thumbnail(context.workspace.id, version.scene_id, version.id),
        req.rawBody,
        'image/png',
      );
      await query(`UPDATE versions SET thumbnail_stored = true WHERE id = $1`, [version.id]);
      res.status(204).end();
    }),
  );

  app.get(
    '/api/versions/:versionId/thumbnail',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'scene.read');
      try {
        const bytes = await getObject(
          storageKeys.thumbnail(context.workspace.id, version.scene_id, version.id),
        );
        res.type('image/png').send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );
}
