import { Router } from 'express';
import { query } from '../db.js';
import { businessMs } from '../clock.js';
import { errors, newId } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { withIdempotency } from '../idempotency.js';
import { pushTo } from '../live.js';
import { sendMail } from '../mail.js';
import { blockedWith, getMemberById, connectionStateFor } from '../domain/profile-shared.js';
import { config } from '../config.js';

const PAGE_SIZE = 50;
const MAX_MESSAGE = 8000;

const findConversation = async (a: string, b: string): Promise<string | null> => {
  const result = await query<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversation_members WHERE member_id = $1 AND other_id = $2`,
    [a, b]);
  return result.rows[0]?.conversation_id ?? null;
};

const conversationVisible = async (viewerId: string, conversationId: string): Promise<string | null> => {
  const result = await query<{ other_id: string }>(
    `SELECT other_id FROM conversation_members WHERE conversation_id = $1 AND member_id = $2`,
    [conversationId, viewerId]);
  if (result.rows.length === 0) return null;
  const blocked = await blockedWith(viewerId);
  if (blocked.has(result.rows[0].other_id)) return null;
  return result.rows[0].other_id;
};

export const messagingRouter = (): Router => {
  const router = Router();
  router.use('/conversations', requireSession);

  router.get('/conversations', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const blocked = await blockedWith(viewerId);
    const rows = await query<{
      conversation_id: string; other_id: string; other_name: string; other_handle: string;
      other_photo: string | null; text: string | null; sent_at: Date | null; sender_id: string | null;
    }>(
      `SELECT cm.conversation_id, cm.other_id, m.name AS other_name, m.handle AS other_handle,
              m.photo_id AS other_photo,
              (SELECT text FROM messages WHERE conversation_id = cm.conversation_id ORDER BY sent_at DESC LIMIT 1) AS text,
              (SELECT sent_at FROM messages WHERE conversation_id = cm.conversation_id ORDER BY sent_at DESC LIMIT 1) AS sent_at,
              (SELECT sender_id FROM messages WHERE conversation_id = cm.conversation_id ORDER BY sent_at DESC LIMIT 1) AS sender_id
       FROM conversation_members cm JOIN members m ON m.id = cm.other_id
       WHERE cm.member_id = $1`, [viewerId]);
    const visible = rows.rows.filter((row) => !blocked.has(row.other_id));
    const conversations = [];
    for (const row of visible) {
      const unread = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM messages
         WHERE conversation_id = $1 AND sender_id = $2 AND read_at IS NULL`,
        [row.conversation_id, row.other_id]);
      conversations.push({
        id: row.conversation_id,
        other: {
          id: row.other_id, name: row.other_name, handle: row.other_handle,
          photo_url: row.other_photo ? `/media/photos/${row.other_photo}` : null,
        },
        last_message: row.text ? { text: row.text, sent_at: row.sent_at?.toISOString() ?? '', sender_id: row.sender_id ?? '' } : null,
        unread_count: Number(unread.rows[0].n),
      });
    }
    conversations.sort((a, b) => (b.last_message?.sent_at ?? '').localeCompare(a.last_message?.sent_at ?? ''));
    res.json({ conversations });
  }));

  router.post('/conversations', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { member_id } = (req.body ?? {}) as { member_id?: string };
    if (!member_id) throw errors.notFound();
    const other = await getMemberById(member_id);
    if (!other) throw errors.notFound();
    const blocked = await blockedWith(viewerId);
    if (blocked.has(member_id)) throw errors.notFound();
    const state = await connectionStateFor(viewerId, member_id);
    if (state !== 'connected') throw errors.notConnected();
    const existing = await findConversation(viewerId, member_id);
    if (existing) { res.status(200).json({ id: existing }); return; }
    const id = newId();
    await query(`INSERT INTO conversations (id, created_at) VALUES ($1, $2)`, [id, new Date(businessMs())]);
    await query(
      `INSERT INTO conversation_members (conversation_id, member_id, other_id) VALUES ($1, $2, $3), ($1, $3, $2)`,
      [id, viewerId, member_id]);
    res.status(201).json({ id });
  }));

  router.get('/conversations/:id/messages', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const otherId = await conversationVisible(viewerId, req.params.id);
    if (!otherId) throw errors.notFound();
    const before = typeof req.query.before === 'string' && req.query.before !== ''
      ? (() => { try { return new Date(Buffer.from(req.query.before, 'base64url').toString('utf8')); } catch { return null; } })()
      : null;
    if (req.query.before && !before) throw errors.validation({ before: 'This cursor is not valid.' });
    const all = await query<{ id: string; sender_id: string; text: string; sent_at: Date; read_at: Date | null }>(
      `SELECT id, sender_id, text, sent_at, read_at FROM messages
       WHERE conversation_id = $1 ORDER BY sent_at DESC`, [req.params.id]);
    let rows = all.rows;
    if (before) rows = rows.filter((r) => r.sent_at < before);
    const page = rows.slice(0, PAGE_SIZE).reverse();
    const nextCursor = rows.length > PAGE_SIZE
      ? Buffer.from(rows[PAGE_SIZE - 1].sent_at.toISOString()).toString('base64url')
      : null;
    res.json({
      messages: page.map((m) => ({
        id: m.id, sender_id: m.sender_id, text: m.text,
        sent_at: m.sent_at.toISOString(), read_at: m.read_at ? m.read_at.toISOString() : null,
      })),
      next_cursor: nextCursor,
    });
  }));

  router.post('/conversations/:id/messages', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    await withIdempotency(req, res, '/api/messages', async () => {
      const conversationId = req.params.id;
      const otherId = await conversationVisible(viewerId, conversationId);
      if (!otherId) throw errors.notFound();
      const state = await connectionStateFor(viewerId, otherId);
      if (state !== 'connected') throw errors.notConnected();
      const { text } = (req.body ?? {}) as { text?: string };
      const textStr = typeof text === 'string' ? text : '';
      const fields: Record<string, string> = {};
      if (textStr.trim().length === 0) fields.text = 'Write something first.';
      if ([...textStr].length > MAX_MESSAGE) fields.text = 'Messages can be up to 8000 characters.';
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const existingMessages = await query(`SELECT 1 FROM messages WHERE conversation_id = $1 LIMIT 1`, [conversationId]);
      const isFirst = existingMessages.rows.length === 0;
      const id = newId();
      await query(
        `INSERT INTO messages (id, conversation_id, sender_id, text, sent_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, conversationId, viewerId, textStr, new Date(businessMs())]);
      if (isFirst) {
        const other = await getMemberById(otherId);
        const sender = await getMemberById(viewerId);
        if (other && sender) sendMail(other.email, `${sender.name} sent you a message`, textStr);
      }
      pushTo(otherId, 'message', { conversation_id: conversationId, from: viewerId });
      const created = await query<{ id: string; sender_id: string; text: string; sent_at: Date; read_at: Date | null }>(
        `SELECT id, sender_id, text, sent_at, read_at FROM messages WHERE id = $1`, [id]);
      const m = created.rows[0];
      return {
        status: 201,
        body: {
          id: m.id, sender_id: m.sender_id, text: m.text,
          sent_at: m.sent_at.toISOString(), read_at: m.read_at ? m.read_at.toISOString() : null,
        },
      };
    });
  }));

  router.post('/conversations/:id/read', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const conversationId = req.params.id;
    const otherId = await conversationVisible(viewerId, conversationId);
    if (!otherId) throw errors.notFound();
    const { up_to } = (req.body ?? {}) as { up_to?: string };
    if (up_to) {
      await query(
        `UPDATE messages SET read_at = $1
         WHERE conversation_id = $2 AND sender_id = $3 AND read_at IS NULL AND sent_at <= (SELECT sent_at FROM messages WHERE id = $4)`,
        [new Date(businessMs()), conversationId, otherId, up_to]);
    } else {
      await query(
        `UPDATE messages SET read_at = $1 WHERE conversation_id = $2 AND sender_id = $3 AND read_at IS NULL`,
        [new Date(businessMs()), conversationId, otherId]);
    }
    const unread = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND read_at IS NULL`,
      [conversationId, otherId]);
    pushTo(otherId, 'read', { conversation_id: conversationId });
    res.json({ unread_count: Number(unread.rows[0].n) });
  }));

  router.post('/conversations/:id/typing', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const otherId = await conversationVisible(viewerId, req.params.id);
    if (!otherId) throw errors.notFound();
    const state = await connectionStateFor(viewerId, otherId);
    if (state !== 'connected') throw errors.notConnected();
    await query(
      `INSERT INTO typing_signals (kind, scope, member_id, field, at) VALUES ('message', $1, $2, '', $3)
       ON CONFLICT (kind, scope, member_id, field) DO UPDATE SET at = $3`,
      [req.params.id, viewerId, new Date(businessMs())]);
    pushTo(otherId, 'typing', { conversation_id: req.params.id, member_id: viewerId, timeout_ms: config.typingTimeoutMs });
    res.status(204).end();
  }));

  return router;
};
