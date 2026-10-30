import { Express } from 'express';
import { query } from '../../db/pool';
import {
  REVIEW_LINK_MAX_SECONDS,
  REVIEW_LINK_MIN_SECONDS,
  toIso,
  withinWindow,
} from '../../domain/time';
import { VersionRow, getVersion } from '../../domain/versions';
import { writeAudit } from '../../domain/workspace';
import { MissingObjectError, getObject, storageKeys } from '../../services/storage';
import { randomId, sha256Hex, urlSafeToken } from '../../util/crypto';
import { fail } from '../errors';
import {
  body,
  param,
  parseIsoTime,
  requireCaller,
  requirePermission,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

interface ReviewLinkRow {
  id: string;
  workspace_id: string;
  version_id: string;
  token_sha256: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_by_kind: 'member' | 'agent';
  created_by_id: string;
  created_by_name: string;
}

const REVIEWABLE_STATES = ['draft', 'in_review', 'scheduled'];

function linkStatus(row: ReviewLinkRow): 'active' | 'expired' | 'revoked' {
  if (row.revoked_at !== null) return 'revoked';
  return row.expires_at.getTime() <= Date.now() ? 'expired' : 'active';
}

export function registerReviewRoutes(app: Express): void {
  app.get(
    '/api/versions/:versionId/review-links',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      const rows = await query<ReviewLinkRow>(
        `SELECT * FROM review_links WHERE version_id = $1 ORDER BY created_at DESC`,
        [version.id],
      );
      res.json({
        links: rows.map((row) => ({
          id: row.id,
          expiresAt: toIso(row.expires_at),
          status: linkStatus(row),
          createdBy: { kind: row.created_by_kind, id: row.created_by_id, name: row.created_by_name },
        })),
      });
    }),
  );

  app.post(
    '/api/versions/:versionId/review-links',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const version = await getVersion(param(req, 'versionId'), context.workspace.id);
      if (!version) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      if (!context.workspace.review_links_enabled) throw fail.conflict('review_links_disabled');
      if (!REVIEWABLE_STATES.includes(version.state)) throw fail.conflict('version_not_reviewable');
      const expiresAt = parseIsoTime(input.expiresAt, 'expiresAt');
      if (!withinWindow(expiresAt, REVIEW_LINK_MIN_SECONDS, REVIEW_LINK_MAX_SECONDS, new Date())) {
        throw fail.validation({ expiresAt: 'Must be between 10 seconds and 30 days from now' });
      }
      const token = urlSafeToken(32);
      const id = randomId('rvl');
      await query(
        `INSERT INTO review_links (id, workspace_id, version_id, token_sha256, expires_at,
                                   created_by_kind, created_by_id, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          context.workspace.id,
          version.id,
          sha256Hex(token),
          expiresAt,
          context.author.kind,
          context.author.id,
          context.author.name,
        ],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'review_link.created',
        target: { type: 'review_link', id },
      });
      res.status(201).json({
        id,
        token,
        url: `/review/${token}`,
        expiresAt: toIso(expiresAt),
      });
    }),
  );

  app.post(
    '/api/review-links/:linkId/regenerate',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<ReviewLinkRow>(
        `SELECT * FROM review_links WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'linkId'), context.workspace.id],
      );
      const link = rows[0];
      if (!link) throw fail.notFound();
      requirePermission(context, 'version.manage');
      requireWritableWorkspace(context);
      const token = urlSafeToken(32);
      await query(
        `UPDATE review_links SET token_sha256 = $2, revoked_at = NULL WHERE id = $1`,
        [link.id, sha256Hex(token)],
      );
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'review_link.regenerated',
        target: { type: 'review_link', id: link.id },
      });
      res.json({
        id: link.id,
        token,
        url: `/review/${token}`,
        expiresAt: toIso(link.expires_at),
      });
    }),
  );

  app.delete(
    '/api/review-links/:linkId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<ReviewLinkRow>(
        `SELECT * FROM review_links WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'linkId'), context.workspace.id],
      );
      const link = rows[0];
      if (!link) throw fail.notFound();
      requirePermission(context, 'version.manage');
      await query(`UPDATE review_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
        link.id,
      ]);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'review_link.revoked',
        target: { type: 'review_link', id: link.id },
      });
      res.status(204).end();
    }),
  );

  app.get(
    '/api/review/:token',
    route(async (req, res) => {
      const rows = await query<
        ReviewLinkRow & {
          review_links_enabled: boolean;
          version_state: string;
          scene_name: string;
          number: number;
          label: string;
          graph: VersionRow['graph'];
        }
      >(
        `SELECT l.*, w.review_links_enabled, v.state AS version_state, v.number, v.label, v.graph,
                s.name AS scene_name
         FROM review_links l
         JOIN versions v ON v.id = l.version_id
         JOIN scenes s ON s.id = v.scene_id
         JOIN workspaces w ON w.id = l.workspace_id
         WHERE l.token_sha256 = $1`,
        [sha256Hex(param(req, 'token'))],
      );
      const link = rows[0];
      if (!link) throw fail.notFound();
      if (link.revoked_at !== null) throw fail.notFound();
      if (!link.review_links_enabled) throw fail.notFound();
      if (!REVIEWABLE_STATES.includes(link.version_state)) throw fail.notFound();
      if (link.expires_at.getTime() <= Date.now()) throw fail.linkExpired();
      res.json({
        scene: { name: link.scene_name },
        version: { number: link.number, label: link.label, state: link.version_state },
        graph: link.graph,
      });
    }),
  );

  app.get(
    '/api/review/:token/thumbnail.png',
    route(async (req, res) => {
      const rows = await query<ReviewLinkRow & { scene_id: string; thumbnail_stored: boolean }>(
        `SELECT l.*, v.scene_id, v.thumbnail_stored
         FROM review_links l JOIN versions v ON v.id = l.version_id
         WHERE l.token_sha256 = $1 AND l.revoked_at IS NULL AND l.expires_at > now()`,
        [sha256Hex(param(req, 'token'))],
      );
      const link = rows[0];
      if (!link || !link.thumbnail_stored) throw fail.notFound();
      try {
        const bytes = await getObject(
          storageKeys.thumbnail(link.workspace_id, link.scene_id, link.version_id),
        );
        res.type('image/png').send(bytes);
      } catch (error) {
        if (error instanceof MissingObjectError) throw fail.notFound();
        throw error;
      }
    }),
  );
}
