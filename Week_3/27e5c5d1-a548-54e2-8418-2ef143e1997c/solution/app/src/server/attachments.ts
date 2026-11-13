import { randomUUID } from 'node:crypto';
import { isWriter, type Attachment } from '../shared/types.ts';
import { downloadDisposition, filenameProblem } from './attachment-rules.ts';
import { boardAccess } from './access.ts';
import type { Actor } from './auth.ts';
import { boardWrite, type BoardTx } from './board-tx.ts';
import { canSee, loadCard, type CardRec } from './cards-data.ts';
import { database, type Row, only } from './db.ts';
import { ApiError, conflict, notFound, validation } from './errors.ts';
import type { Handler } from './http-types.ts';
import { getObject, objectKey, objectSize, putObject, removeObject } from './storage.ts';
import { isId } from './validate.ts';

/** Attachments are not part of an observer's view: every attachment route answers them 404. */
async function attachmentWrite<T>(
  actor: Actor,
  cardId: string,
  run: (tx: BoardTx, card: CardRec) => Promise<T>,
): Promise<T> {
  if (!isId(cardId)) throw notFound();
  const found = await database().query<Row>('SELECT board_id FROM cards WHERE id = $1', [cardId]);
  if (!found.rows[0]) throw notFound();
  return boardWrite(actor, found.rows[0]['board_id'] as string, async (tx) => {
    const card = await loadCard(tx.client, cardId);
    if (!card || card.boardId !== tx.access.board.id || !canSee(card, tx.viewer) || !isWriter(tx.access.role)) throw notFound();
    return run(tx, card);
  });
}

export const uploadAttachment: Handler = async ({ actor, params, upload }) => {
  const attachment = await attachmentWrite(actor, params[0], async (tx, card) => {
    if (card.status === 'archived') throw conflict('archived');
    if (!upload) throw validation({ file: 'Choose a file to attach.' });
    const problem = filenameProblem(upload.filename);
    if (problem) throw validation({ file: problem });
    const id = randomUUID();
    const key = objectKey(tx.access.board.workspaceId, card.id, id);
    try {
      await putObject(key, upload.bytes, upload.contentType);
      if ((await objectSize(key)) !== upload.bytes.length) throw new Error('stored size differs');
    } catch (error) {
      await removeObject(key).catch(() => undefined);
      throw error instanceof ApiError ? error : validation({ file: 'The file could not be stored.' });
    }
    try {
      const { rows } = await tx.client.query<Row>(
        `INSERT INTO attachments (id, card_id, workspace_id, filename, content_type, size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING uploaded_at`,
        [id, card.id, tx.access.board.workspaceId, upload.filename, upload.contentType, upload.bytes.length, actor.userId],
      );
      tx.intents.push({ type: 'card', cardId: card.id });
      const stored: Attachment = {
        id,
        filename: upload.filename,
        contentType: upload.contentType,
        size: upload.bytes.length,
        uploadedAt: (only(rows)['uploaded_at'] as Date).toISOString(),
        uploadedBy: { displayName: actor.displayName },
      };
      return stored;
    } catch (error) {
      await removeObject(key).catch(() => undefined);
      throw error;
    }
  });
  return { status: 201, body: { attachment } };
};

export const downloadAttachment: Handler = async ({ actor, params }) => {
  const id = params[0];
  if (!isId(id)) throw notFound();
  const { rows } = await database().query<Row>(
    'SELECT card_id, workspace_id, filename, content_type FROM attachments WHERE id = $1',
    [id],
  );
  const row = rows[0];
  const card = row ? await loadCard(database(), row['card_id'] as string) : null;
  const access = card ? await boardAccess(database(), actor.userId, card.boardId) : null;
  if (!row || !card || !access || !isWriter(access.role) || !canSee(card, { userId: actor.userId, role: access.role })) throw notFound();
  const stored = await getObject(objectKey(row['workspace_id'] as string, card.id, id));
  return {
    status: 200,
    raw: stored.bytes,
    headers: {
      'Content-Type': row['content_type'] as string,
      'Content-Length': String(stored.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': downloadDisposition(row['filename'] as string),
    },
  };
};

export const deleteAttachment: Handler = async ({ actor, params }) => {
  const id = params[0];
  if (!isId(id)) throw notFound();
  const { rows } = await database().query<Row>('SELECT card_id, workspace_id FROM attachments WHERE id = $1', [id]);
  const stored = rows[0];
  if (!stored) throw notFound();
  await attachmentWrite(actor, stored['card_id'] as string, async (tx, card) => {
    if (!card.attachments.some((file) => file.id === id)) throw notFound();
    if (card.status === 'archived') throw conflict('archived');
    await removeObject(objectKey(stored['workspace_id'] as string, card.id, id));
    await tx.client.query('DELETE FROM attachments WHERE id = $1', [id]);
    tx.intents.push({ type: 'card', cardId: card.id });
  });
  return { status: 204 };
};

