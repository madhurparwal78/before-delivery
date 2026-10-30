import { Express } from 'express';
import { CommentDto } from '../../../shared/api';
import { query } from '../../db/pool';
import { getScene, graphAt } from '../../domain/scenes';
import { toIso } from '../../domain/time';
import { writeAudit } from '../../domain/workspace';
import { publish } from '../../realtime/bus';
import { mirror } from '../../services/pocketbase';
import { randomId } from '../../util/crypto';
import { fail } from '../errors';
import {
  body,
  param,
  requireCaller,
  requirePermission,
  requireString,
  requireWritableWorkspace,
} from '../context';
import { route } from '../route';

interface CommentRow {
  id: string;
  workspace_id: string;
  scene_id: string;
  node_id: string;
  body: string;
  author_kind: 'member' | 'agent';
  author_id: string;
  author_name: string;
  mentions: string[];
  resolved: boolean;
  created_at: Date;
}

async function mentionNames(
  workspaceId: string,
  ids: string[],
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  return query<{ id: string; name: string }>(
    `SELECT id, name FROM members WHERE workspace_id = $1 AND id = ANY($2::text[]) ORDER BY name`,
    [workspaceId, ids],
  );
}

async function commentDto(row: CommentRow): Promise<CommentDto> {
  return {
    id: row.id,
    nodeId: row.node_id,
    body: row.body,
    author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
    mentions: await mentionNames(row.workspace_id, row.mentions),
    resolved: row.resolved,
    createdAt: toIso(row.created_at),
  };
}

export function registerCommentRoutes(app: Express): void {
  app.get(
    '/api/scenes/:sceneId/comments',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await getScene(param(req, 'sceneId'), context.workspace.id);
      if (!scene) throw fail.notFound();
      requirePermission(context, 'scene.read');
      const rows = await query<CommentRow>(
        `SELECT * FROM comments WHERE scene_id = $1 ORDER BY created_at`,
        [scene.id],
      );
      res.json({ comments: await Promise.all(rows.map(commentDto)) });
    }),
  );

  app.post(
    '/api/scenes/:sceneId/comments',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const scene = await getScene(param(req, 'sceneId'), context.workspace.id);
      if (!scene) throw fail.notFound();
      const nodeId = typeof input.nodeId === 'string' ? input.nodeId : null;
      if (nodeId === null) throw fail.validation({ nodeId: 'Must be a node ID' });
      const graph = await graphAt(scene, scene.latest_seq);
      if (!graph.nodes.some((node) => node.id === nodeId)) throw fail.notFound();
      const mentionsRaw = input.mentions;
      const mentions: string[] = [];
      if (mentionsRaw !== undefined) {
        if (!Array.isArray(mentionsRaw)) throw fail.validation({ mentions: 'Must be an array' });
        for (const entry of mentionsRaw) {
          if (typeof entry !== 'string') throw fail.validation({ mentions: 'Must be member IDs' });
          mentions.push(entry);
        }
      }
      if (mentions.length > 0) {
        const found = await query<{ id: string }>(
          `SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND id = ANY($2::text[])`,
          [context.workspace.id, mentions],
        );
        if (found.length !== new Set(mentions).size) throw fail.notFound();
      }
      requirePermission(context, 'comment.write');
      requireWritableWorkspace(context);
      const commentBody = requireString(input, 'body', { min: 1, max: 2000 });
      const rows = await query<CommentRow>(
        `INSERT INTO comments (id, workspace_id, scene_id, node_id, body, author_kind, author_id, author_name, mentions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [
          randomId('cmt'),
          context.workspace.id,
          scene.id,
          nodeId,
          commentBody,
          context.author.kind,
          context.author.id,
          context.author.name,
          JSON.stringify(mentions),
        ],
      );
      const row = rows[0] as CommentRow;
      const dto = await commentDto(row);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'comment.posted',
        target: { type: 'comment', id: row.id },
      });
      mirror.comment({
        workspaceId: context.workspace.id,
        sceneId: scene.id,
        commentId: row.id,
        nodeId,
        body: commentBody,
        authorId: context.author.id,
        authorName: context.author.name,
        mentions,
        resolved: false,
      });
      publish(scene.id, { event: 'comment', data: dto });
      res.status(201).json(dto);
    }),
  );

  app.patch(
    '/api/comments/:commentId',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      const rows = await query<CommentRow>(
        `SELECT * FROM comments WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'commentId'), context.workspace.id],
      );
      const existing = rows[0];
      if (!existing) throw fail.notFound();
      requirePermission(context, 'comment.write');
      requireWritableWorkspace(context);
      if (typeof input.resolved !== 'boolean') {
        throw fail.validation({ resolved: 'Must be true or false' });
      }
      const resolved = input.resolved;
      const updated = await query<CommentRow>(
        `UPDATE comments SET resolved = $2 WHERE id = $1 RETURNING *`,
        [existing.id, resolved],
      );
      const row = updated[0] as CommentRow;
      const dto = await commentDto(row);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: resolved ? 'comment.resolved' : 'comment.reopened',
        target: { type: 'comment', id: row.id },
      });
      mirror.comment({
        workspaceId: context.workspace.id,
        sceneId: row.scene_id,
        commentId: row.id,
        nodeId: row.node_id,
        body: row.body,
        authorId: row.author_id,
        authorName: row.author_name,
        mentions: row.mentions,
        resolved,
      });
      publish(row.scene_id, { event: 'comment', data: dto });
      res.json(dto);
    }),
  );

  app.get(
    '/api/scenes/:sceneId/mentionable',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const scene = await getScene(param(req, 'sceneId'), context.workspace.id);
      if (!scene) throw fail.notFound();
      requirePermission(context, 'workspace.read');
      const raw = req.query.q;
      const q = typeof raw === 'string' ? raw : '';
      const pattern = `%${q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
      const rows = await query<{ id: string; name: string; role: string }>(
        `SELECT id, name, role FROM members
         WHERE workspace_id = $1 AND removed_at IS NULL AND name ILIKE $2
         ORDER BY name LIMIT 20`,
        [scene.workspace_id, pattern],
      );
      res.json({ members: rows });
    }),
  );
}
