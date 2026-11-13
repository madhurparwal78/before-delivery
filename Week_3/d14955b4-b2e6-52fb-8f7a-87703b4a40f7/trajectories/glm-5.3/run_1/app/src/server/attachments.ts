// Attachment status is final once failed; live frames announce each settle.
import { query } from './db';
import { publish } from './live';
import { serialiseAttachment, type AttachmentRow } from './serialise';

export async function settleAttachment(attachmentId: string, status: 'attached' | 'failed'): Promise<void> {
  const updated = await query<AttachmentRow & { thread_id: string; game_id: string }>(
    `UPDATE attachments SET status = $2, settled_at = now()
      WHERE id = $1 AND status = 'uploading'
      RETURNING id, message_id, filename, content_type, size, status,
        (SELECT m.thread_id FROM messages m WHERE m.id = attachments.message_id) AS thread_id,
        game_id`,
    [attachmentId, status],
  );
  if (updated.rows.length === 0) return;
  const row = updated.rows[0];
  publish({
    event: 'attachment',
    gameId: row.game_id,
    threadId: row.thread_id,
    payload: { attachment: serialiseAttachment(row), message_id: row.message_id, status: row.status },
  });
}

export async function loadAttachment(attachmentId: string): Promise<AttachmentRow | null> {
  const result = await query<AttachmentRow>('SELECT id, message_id, filename, content_type, size, status FROM attachments WHERE id = $1', [attachmentId]);
  return result.rows[0] ?? null;
}
