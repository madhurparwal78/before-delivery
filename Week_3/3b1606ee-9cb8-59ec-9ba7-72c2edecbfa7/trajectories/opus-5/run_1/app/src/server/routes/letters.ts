import type { LetterClass } from '../../shared/types.js';
import { serverNow } from '../clock.js';
import { pool } from '../db.js';
import { loadBlob, loadConversation, loadLetter } from '../domain/access.js';
import { currentKey, isBlocked, sealStatus } from '../domain/conversations.js';
import { markDelivered, postLetter, retractLetter } from '../domain/delivery.js';
import {
  LETTER_COLUMNS,
  letterColumns,
  letterRecord,
  type LetterRow,
} from '../domain/letters.js';
import { retractWindowOpen } from '../domain/retract.js';
import { isIv, isSealedBody } from '../domain/sealed.js';
import {
  ApiError,
  conflict,
  invalidField,
  isUuidV4,
  notFound,
  requireInteger,
  sendJson,
  type RequestContext,
} from '../http.js';
import { pushConversation, pushLetter } from '../push.js';
import { deleteObject } from '../storage.js';
import { sweepReturns } from '../sweep.js';
import { confirmStoredBlob } from './blobs.js';

const UNIQUE_VIOLATION = '23505';
const CLASSES: LetterClass[] = ['letter', 'control'];

async function findLetter(letterId: string): Promise<LetterRow | null> {
  const result = await pool.query<LetterRow>(
    `select ${LETTER_COLUMNS} from letters where id = $1`,
    [letterId],
  );
  return result.rows[0] ?? null;
}

function sameBody(row: LetterRow, ctx: RequestContext): boolean {
  return (
    row.sender_id === ctx.accountId &&
    row.conversation_id === ctx.body['conversation_id'] &&
    row.letter_class === ctx.body['class'] &&
    row.ciphertext === (ctx.body['ciphertext'] ?? null) &&
    row.attachment_id === (ctx.body['attachment_id'] ?? null)
  );
}

export async function postLetterRoute(ctx: RequestContext): Promise<void> {
  const conversationId = ctx.body['conversation_id'];
  if (!isUuidV4(conversationId)) throw notFound();
  const { side, peerId } = await loadConversation(pool, conversationId, ctx.accountId);

  const attachmentValue = ctx.body['attachment_id'] ?? null;
  let attachmentId: string | null = null;
  if (attachmentValue !== null) {
    if (!isUuidV4(attachmentValue)) throw notFound();
    const blob = await loadBlob(pool, attachmentValue);
    if (blob.owner_id !== ctx.accountId) throw notFound();
    if (blob.kind === 'photo') throw invalidField('attachment_id', 'invalid');
    attachmentId = blob.id;
  }

  const letterId = ctx.body['id'];
  if (typeof letterId === 'string') {
    const existing = await findLetter(letterId);
    if (existing !== null) {
      if (!sameBody(existing, ctx)) throw conflict('letter_id_conflict');
      sendJson(ctx.res, 200, letterRecord(existing, ctx.accountId, serverNow()));
      return;
    }
  }

  if (!side.accepted) throw conflict('request_not_accepted');
  if (await isBlocked(pool, ctx.accountId, peerId)) throw conflict('contact_blocked');
  const peerKey = await currentKey(pool, peerId);
  if ((await sealStatus(pool, ctx.accountId, peerId, peerKey.key_id)) === 'changed') {
    throw conflict('seal_change_unaccepted');
  }
  if (ctx.body['recipient_key_id'] !== peerKey.key_id) {
    throw conflict('recipient_key_changed', { key_id: peerKey.key_id });
  }
  if (attachmentId !== null) {
    const blob = await loadBlob(pool, attachmentId);
    if (blob.state !== 'stored') throw conflict('attachment_not_stored');
    const inUse = await pool.query('select 1 from letters where attachment_id = $1', [
      attachmentId,
    ]);
    if (inUse.rows.length > 0) throw conflict('attachment_in_use');
  }

  if (!isUuidV4(letterId)) throw invalidField('id', 'invalid');
  const letterClass = ctx.body['class'];
  if (!CLASSES.includes(letterClass as LetterClass)) throw invalidField('class', 'invalid');
  const iv = ctx.body['iv'];
  const ciphertext = ctx.body['ciphertext'];
  if (!isIv(iv)) throw invalidField('iv', 'invalid');
  if (!isSealedBody(ciphertext)) throw invalidField('ciphertext', 'invalid');
  if (attachmentId !== null && letterClass !== 'letter') {
    throw invalidField('attachment_id', 'invalid');
  }

  if (attachmentId !== null) await confirmStoredBlob(ctx.accountId, attachmentId);

  const now = serverNow();
  let row: LetterRow;
  try {
    row = await postLetter(pool, {
      id: letterId,
      conversationId,
      senderId: ctx.accountId,
      recipientId: peerId,
      letterClass: letterClass as LetterClass,
      senderKeyId: (await currentKey(pool, ctx.accountId)).key_id,
      recipientKeyId: peerKey.key_id,
      iv,
      ciphertext,
      attachmentId,
      dropped: await isBlocked(pool, peerId, ctx.accountId),
      now,
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const raced = await findLetter(letterId);
      if (raced === null) throw error;
      if (!sameBody(raced, ctx)) throw conflict('letter_id_conflict');
      sendJson(ctx.res, 200, letterRecord(raced, ctx.accountId, now));
      return;
    }
    throw error;
  }

  await pushLetter(row);
  sendJson(ctx.res, 201, letterRecord(row, ctx.accountId, now));
}

export async function getLetter(ctx: RequestContext): Promise<void> {
  await sweepReturns();
  const letterId = ctx.params['id'] ?? '';
  if (!isUuidV4(letterId)) throw notFound();
  const letter = await loadLetter(pool, letterId, ctx.accountId);
  sendJson(ctx.res, 200, letterRecord(letter, ctx.accountId, serverNow()));
}

export async function postRetract(ctx: RequestContext): Promise<void> {
  const letterId = ctx.params['id'] ?? '';
  if (!isUuidV4(letterId)) throw notFound();
  const letter = await loadLetter(pool, letterId, ctx.accountId);
  const now = serverNow();
  if (letter.sender_id !== ctx.accountId) throw new ApiError(403, 'not_sender');
  if (letter.retracted_at !== null) {
    sendJson(ctx.res, 200, letterRecord(letter, ctx.accountId, now));
    return;
  }
  if (!retractWindowOpen(letter.held_at, now)) throw conflict('retract_window_closed');

  const retracted = await retractLetter(pool, letterId, now);
  if (retracted.attachment_id !== null) {
    await deleteObject(retracted.sender_id, retracted.attachment_id);
  }
  await pushLetter(retracted);
  sendJson(ctx.res, 200, letterRecord(retracted, ctx.accountId, now));
}

export async function getInbox(ctx: RequestContext): Promise<void> {
  await sweepReturns();
  const rows = await pool.query<LetterRow>(
    `select ${letterColumns('l')}
       from letters l
       join conversation_sides s
         on s.conversation_id = l.conversation_id and s.account_id = l.recipient_id
      where l.recipient_id = $1 and l.state = 'sent' and not l.dropped
        and l.retracted_at is null and l.seq > s.hide_seq
      order by l.seq asc`,
    [ctx.accountId],
  );
  const now = serverNow();
  sendJson(ctx.res, 200, {
    letters: rows.rows.map((row) => letterRecord(row, ctx.accountId, now)),
  });
}

export async function postInboxAck(ctx: RequestContext): Promise<void> {
  const throughSeq = requireInteger(ctx.body['through_seq'], 'through_seq');
  if (throughSeq < 0) throw invalidField('through_seq', 'invalid');
  const now = serverNow();
  const delivered = await markDelivered(pool, ctx.accountId, throughSeq, now);
  const conversations = new Set<string>();
  for (const letter of delivered) {
    await pushLetter(letter);
    conversations.add(letter.conversation_id);
  }
  for (const conversationId of conversations) {
    await pushConversation(conversationId, [ctx.accountId]);
  }
  sendJson(ctx.res, 200, { delivered: delivered.length });
}
