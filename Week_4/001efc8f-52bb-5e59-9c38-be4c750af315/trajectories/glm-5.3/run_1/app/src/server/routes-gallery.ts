import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './errors';
import { requireViewer } from './auth';
import type { AppServices } from './context';
import { requireChannel } from './messages-domain';
import { isUuid } from './validate';
import { encodeCursor, parsePaging } from './paging';
import { isoInstant } from './messages-domain';
import { SEARCH_MAX_CHARS, SEARCH_MAX_TERMS, SEARCH_MIN_CHARS } from '../shared/terms';
import { fieldCopy } from './errors';

interface GalleryRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  uploaded_by: string;
  uploader_name: string;
  uploaded_at: Date;
}

export function registerGalleryRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/attachments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    const id = (request.params as Record<string, string>).id;
    if (!isUuid(id)) throw new ApiError('not_found');
    const res = await services.db.pool.query(
      `SELECT a.*, m.deleted FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1 AND a.state = 'stored'`,
      [id],
    );
    if (res.rowCount === 0 || res.rows[0].deleted) throw new ApiError('not_found');
    const row = res.rows[0];
    const member = await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [row.channel_id, viewer.id]);
    if (member.rowCount === 0) throw new ApiError('not_found');
    let bytes: Buffer;
    try {
      bytes = (await services.storage.get(row.original_key)) as Buffer;
    } catch {
      services.storage.setAvailable(false);
      throw new ApiError('storage_unavailable');
    }
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type(row.content_type);
    return bytes;
  });

  app.get('/api/attachments/:id/thumb', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    const id = (request.params as Record<string, string>).id;
    if (!isUuid(id)) throw new ApiError('not_found');
    const res = await services.db.pool.query(
      `SELECT a.*, m.deleted FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1 AND a.state = 'stored'`,
      [id],
    );
    if (res.rowCount === 0 || res.rows[0].deleted) throw new ApiError('not_found');
    const row = res.rows[0];
    const member = await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [row.channel_id, viewer.id]);
    if (member.rowCount === 0) throw new ApiError('not_found');
    let bytes: Buffer;
    try {
      bytes = (await services.storage.get(row.thumb_key)) as Buffer;
    } catch {
      services.storage.setAvailable(false);
      throw new ApiError('storage_unavailable');
    }
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type('image/jpeg');
    return bytes;
  });

  app.get('/api/channels/:id/gallery', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const channelId = (request.params as Record<string, string>).id;
    await requireChannel(services.db, channelId, viewer);
    const query = request.query as Record<string, string | undefined>;
    const { limit, cursor } = parsePaging(query);
    const params: unknown[] = [channelId];
    let where = `a.channel_id = $1 AND a.state = 'stored'`;
    if (cursor) {
      params.push(cursor.s, cursor.i);
      where += ` AND (a.uploaded_at < $${params.length - 1} OR (a.uploaded_at = $${params.length - 1} AND a.id < $${params.length}))`;
    }
    params.push(limit + 1);
    const res = await services.db.pool.query(
      `SELECT a.id, a.message_id, a.filename, a.content_type, a.bytes, a.uploaded_by, a.uploaded_at, u.name AS uploader_name
         FROM attachments a JOIN users u ON u.id = a.uploaded_by
        WHERE ${where} ORDER BY a.uploaded_at DESC, a.id DESC LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows as GalleryRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      photos: page.map((row) => ({
        attachment_id: row.id,
        message_id: row.message_id,
        filename: row.filename,
        content_type: row.content_type,
        bytes: row.bytes,
        uploaded_by: { id: row.uploaded_by, name: row.uploader_name },
        uploaded_at: isoInstant(row.uploaded_at),
        url: `/api/attachments/${row.id}`,
        thumb_url: `/api/attachments/${row.id}/thumb`,
      })),
      next_cursor: hasMore && page.length > 0
        ? encodeCursor({ s: isoInstant(page[page.length - 1].uploaded_at), i: page[page.length - 1].id })
        : null,
    };
  });

  app.get('/api/search', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit, cursor } = parsePaging(query);
    const qRaw = typeof query.q === 'string' ? query.q : '';
    const q = qRaw.trim();
    const errors: Record<string, string> = {};
    // Query caps, judged in the published order.
    if (q.length < SEARCH_MIN_CHARS) errors.q = fieldCopy('qTooShort');
    else if (q.length > SEARCH_MAX_CHARS) errors.q = fieldCopy('qTooLong');
    else if (q.split(/\s+/).filter((w) => w !== '').length > SEARCH_MAX_TERMS) errors.q = fieldCopy('qTooManyWords');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const terms = [...new Set(q.split(/\s+/).filter((w) => w !== ''))].map((t) => t.toLowerCase());
    const like = (term: string) => `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

    const memberChannels = await services.db.pool.query(
      `SELECT c.id, c.name FROM channels c JOIN memberships m ON m.channel_id = c.id
        WHERE c.workspace_id = $1 AND m.user_id = $2`,
      [viewer.workspaceId, viewer.id],
    );
    const channelIds = memberChannels.rows.map((r: { id: string }) => r.id);
    if (channelIds.length === 0) {
      return { query: q, total: 0, results: [], next_cursor: null };
    }

    // Literal matching: every distinct term appears in the text or file name.
    const messageWhere = terms.map((_, i) => `m.text ILIKE $${i + 3}`).join(' AND ');
    const fileWhere = terms.map((_, i) => `a.filename ILIKE $${i + 3}`).join(' AND ');

    const messageRes = await services.db.pool.query(
      `SELECT m.id, m.channel_id, c.name AS channel_name, m.thread_root_id, m.text, m.sent_at,
              u.name AS author_name
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN users u ON u.id = m.author_id
        WHERE m.workspace_id = $1 AND m.deleted = false AND m.channel_id = ANY($2::uuid[])
          AND ${messageWhere}
        ORDER BY m.sent_at DESC, m.id DESC`,
      [viewer.workspaceId, channelIds, ...terms.map((t) => like(t))],
    );
    const photoRes = await services.db.pool.query(
      `SELECT a.id AS attachment_id, a.message_id, a.channel_id, c.name AS channel_name, m.thread_root_id,
              a.filename, m.sent_at, u.name AS author_name
         FROM attachments a
         JOIN messages m ON m.id = a.message_id
         JOIN channels c ON c.id = a.channel_id
         JOIN users u ON u.id = m.author_id
        WHERE a.workspace_id = $1 AND a.state = 'stored' AND m.deleted = false AND a.channel_id = ANY($2::uuid[])
          AND ${fileWhere}
        ORDER BY m.sent_at DESC, a.id DESC`,
      [viewer.workspaceId, channelIds, ...terms.map((t) => like(t))],
    );

    interface ResultRow {
      kind: 'message' | 'photo';
      message_id: string;
      attachment_id: string | null;
      channel_id: string;
      channel_name: string;
      thread_root_id: string | null;
      author_name: string;
      snippet: string;
      sent_at: Date;
    }
    const rows: ResultRow[] = [];
    for (const m of messageRes.rows) {
      rows.push({
        kind: 'message',
        message_id: m.id,
        attachment_id: null,
        channel_id: m.channel_id,
        channel_name: m.channel_name,
        thread_root_id: m.thread_root_id,
        author_name: m.author_name,
        snippet: snippet(m.text),
        sent_at: m.sent_at,
      });
    }
    for (const p of photoRes.rows) {
      rows.push({
        kind: 'photo',
        message_id: p.message_id,
        attachment_id: p.attachment_id,
        channel_id: p.channel_id,
        channel_name: p.channel_name,
        thread_root_id: p.thread_root_id,
        author_name: p.author_name,
        snippet: snippet(p.filename),
        sent_at: p.sent_at,
      });
    }
    // Order: message's sent_at desc, id desc; a message row comes before its photo rows.
    rows.sort((a, b) => {
      const bySent = b.sent_at.getTime() - a.sent_at.getTime();
      if (bySent !== 0) return bySent;
      if (a.message_id !== b.message_id) return a.message_id < b.message_id ? 1 : -1;
      if (a.kind === 'message' && b.kind === 'photo') return -1;
      if (a.kind === 'photo' && b.kind === 'message') return 1;
      return (b.attachment_id ?? '') < (a.attachment_id ?? '') ? -1 : 1;
    });
    const total = rows.length;
    let startIndex = 0;
    if (cursor) {
      const idx = rows.findIndex((r) => r.message_id === cursor.i || r.attachment_id === cursor.i);
      startIndex = idx >= 0 ? idx + 1 : rows.length;
    }
    const page = rows.slice(startIndex, startIndex + limit);
    return {
      query: q,
      total,
      results: page.map((r) => ({
        kind: r.kind,
        message_id: r.message_id,
        attachment_id: r.attachment_id,
        channel: { id: r.channel_id, name: r.channel_name },
        thread_root_id: r.thread_root_id,
        author_name: r.author_name,
        snippet: r.snippet,
        sent_at: isoInstant(r.sent_at),
      })),
      next_cursor: startIndex + limit < total && page.length > 0
        ? encodeCursor({ s: isoInstant(page[page.length - 1].sent_at), i: page[page.length - 1].attachment_id ?? page[page.length - 1].message_id })
        : null,
    };
  });
}

function snippet(text: string): string {
  return text.length > 160 ? text.slice(0, 160) : text;
}
