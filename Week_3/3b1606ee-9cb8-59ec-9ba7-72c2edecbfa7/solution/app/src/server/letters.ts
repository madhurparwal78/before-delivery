import { requireConversation, requireLetter, type ConversationAccess } from './access.js';
import { sha256 } from './auth.js';
import { now } from './clock.js';
import { isBlocked } from './blocks.js';
import { discardBlobs, liveBlob, objectConfirmed } from './blobs.js';
import { visibleTo } from './conversation_view.js';
import { LETTER_LOCK, one, pool, query, transaction, type Queryable } from './db.js';
import { deliverThrough, holdLetter, retractWindowOpen } from './delivery.js';
import { announceLetters, applyReturns } from './events.js';
import { ApiError, authed, invalid, type Reply } from './http.js';
import { letterRecord } from './records.js';
import type { AccountRow, BlobRow, LetterRow } from './rows.js';
import { isUuid, jsonBody, validCiphertext, validIv } from './validate.js';

interface Posting {
  id: string;
  letterClass: 'letter' | 'control';
  recipientKeyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  attachment: BlobRow | null;
}

type Evaluation = { replay: LetterRow } | { posting: Posting; access: ConversationAccess };

function contentDigest(input: Record<string, unknown>): Buffer {
  const parts = ['conversation_id', 'class', 'recipient_key_id', 'iv', 'ciphertext', 'attachment_id'].map((key) => input[key] ?? null);
  return sha256(Buffer.from(JSON.stringify(parts)));
}

async function attachmentFor(db: Queryable, account: AccountRow, value: unknown): Promise<BlobRow | null> {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw invalid({ attachment_id: 'invalid' });
  const blob = await liveBlob(db, value);
  if (!blob || blob.owner_id !== account.id) throw new ApiError(404, 'not_found');
  return blob;
}

/** Error order of the brief: 404, replay, 409 state conflicts in their stated order, then 422 validation. */
async function evaluate(db: Queryable, account: AccountRow, input: Record<string, unknown>): Promise<Evaluation> {
  if (!isUuid(input.conversation_id)) throw invalid({ conversation_id: 'invalid' });
  const access = await requireConversation(db, account.id, input.conversation_id);
  const attachment = await attachmentFor(db, account, input.attachment_id);
  const digest = contentDigest(input);
  if (isUuid(input.id)) {
    const existing = await one<LetterRow>(db, 'SELECT * FROM letters WHERE id = $1', [input.id]);
    if (existing) {
      if (existing.sender_id === account.id && existing.content_digest.equals(digest)) return { replay: existing };
      throw new ApiError(409, 'letter_id_conflict');
    }
  }
  const { member, peer } = access;
  if (member.status !== 'accepted') throw new ApiError(409, 'request_not_accepted');
  if (await isBlocked(db, account.id, peer.id)) throw new ApiError(409, 'contact_blocked');
  const seal = await one<{ accepted_key_id: string }>(db, 'SELECT accepted_key_id FROM seals WHERE viewer_id = $1 AND contact_id = $2', [account.id, peer.id]);
  if (seal && seal.accepted_key_id !== peer.key_id) throw new ApiError(409, 'seal_change_unaccepted');
  if (typeof input.recipient_key_id === 'string' && input.recipient_key_id !== peer.key_id) {
    throw new ApiError(409, 'recipient_key_changed', { key_id: peer.key_id });
  }
  if (attachment) {
    if (attachment.state !== 'stored') throw new ApiError(409, 'attachment_not_stored');
    if (await one(db, 'SELECT 1 FROM letters WHERE attachment_id = $1', [attachment.id])) throw new ApiError(409, 'attachment_in_use');
  }
  const fields: Record<string, string> = {};
  if (!isUuid(input.id)) fields.id = 'invalid';
  if (input.class !== 'letter' && input.class !== 'control') fields.class = 'invalid';
  if (typeof input.recipient_key_id !== 'string' || input.recipient_key_id === '') fields.recipient_key_id = 'invalid';
  const iv = validIv(input.iv);
  const ciphertext = validCiphertext(input.ciphertext);
  if (!iv) fields.iv = 'invalid';
  if (!ciphertext) fields.ciphertext = 'invalid';
  if (attachment && (input.class !== 'letter' || attachment.kind === 'photo')) fields.attachment_id = 'invalid';
  if (Object.keys(fields).length > 0) throw invalid(fields);
  return {
    posting: {
      id: input.id as string,
      letterClass: input.class as 'letter' | 'control',
      recipientKeyId: input.recipient_key_id as string,
      iv: iv!,
      ciphertext: ciphertext!,
      attachment,
    },
    access,
  };
}

async function hold(db: Queryable, account: AccountRow, posting: Posting, access: ConversationAccess, input: Record<string, unknown>): Promise<LetterRow> {
  const at = now();
  const dropped = await isBlocked(db, access.peer.id, account.id);
  const row = await holdLetter(
    db,
    {
      id: posting.id,
      conversationId: access.conversation.id,
      senderId: account.id,
      recipientId: access.peer.id,
      letterClass: posting.letterClass,
      senderKeyId: account.key_id,
      recipientKeyId: posting.recipientKeyId,
      iv: dropped ? null : posting.iv,
      ciphertext: dropped ? null : posting.ciphertext,
      attachmentId: posting.attachment?.id ?? null,
      contentDigest: contentDigest(input),
    },
    at,
  );
  if (!dropped) {
    if (posting.letterClass === 'letter') {
      await query(
        db,
        `UPDATE conversation_members
         SET visible_from_seq = CASE WHEN status = 'deleted' THEN $3 ELSE visible_from_seq END, status = 'request'
         WHERE conversation_id = $1 AND account_id = $2 AND status IN ('unseen', 'deleted')`,
        [access.conversation.id, access.peer.id, row.seq],
      );
    }
    await query(db, 'UPDATE conversations SET updated_at = $2 WHERE id = $1', [access.conversation.id, at]);
  }
  return row;
}

function intParam(value: string | null, fallback: number, min: number, max: number, field: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid({ [field]: 'invalid' });
  return parsed;
}

export function registerLetterRoutes(): void {
  authed('POST', '/api/letters', async ({ account, body }) => {
    const input = jsonBody(body);
    const replayReply = (row: LetterRow): Reply => ({ status: 200, body: letterRecord(row, account.id, now()) });
    if (input.attachment_id !== undefined && input.attachment_id !== null) {
      const early = await evaluate(pool, account, input);
      if ('replay' in early) return replayReply(early.replay);
      if (!(await objectConfirmed(early.posting.attachment!))) throw new ApiError(409, 'attachment_not_stored');
    }
    const outcome = await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [LETTER_LOCK]);
      const result = await evaluate(db, account, input);
      if ('replay' in result) return { created: false, row: result.replay };
      return { created: true, row: await hold(db, account, result.posting, result.access, input) };
    });
    if (!outcome.created) return replayReply(outcome.row);
    await announceLetters([outcome.row]);
    return { status: 201, body: letterRecord(outcome.row, account.id, now()) };
  });

  authed('GET', '/api/letters/:id', async ({ account, params }) => {
    await requireLetter(pool, account.id, params.id);
    await applyReturns();
    const row = await requireLetter(pool, account.id, params.id);
    return { status: 200, body: letterRecord(row, account.id, now()) };
  });

  authed('GET', '/api/conversations/:id/letters', async ({ account, params, query: search }) => {
    const { conversation, member } = await requireConversation(pool, account.id, params.id);
    const limit = intParam(search.get('limit'), 50, 1, 200, 'limit');
    const before = search.get('before_seq') === null ? null : intParam(search.get('before_seq'), 0, 0, Number.MAX_SAFE_INTEGER, 'before_seq');
    await applyReturns();
    const rows = await query<LetterRow>(
      pool,
      `SELECT * FROM (
         SELECT l.* FROM letters l
         WHERE l.conversation_id = $1 AND l.class = 'letter' AND l.seq >= $2 AND ($3::bigint IS NULL OR l.seq < $3)
           AND ${visibleTo('l', '$5')}
         ORDER BY l.seq DESC LIMIT $4) newest
       ORDER BY seq`,
      [conversation.id, member.visible_from_seq, before, limit, account.id],
    );
    const at = now();
    return { status: 200, body: { letters: rows.map((row) => letterRecord(row, account.id, at)) } };
  });

  authed('GET', '/api/inbox', async ({ account }) => {
    await applyReturns();
    const rows = await query<LetterRow>(pool, 'SELECT * FROM letters WHERE recipient_id = $1 AND ciphertext IS NOT NULL ORDER BY seq', [account.id]);
    const at = now();
    return { status: 200, body: { letters: rows.map((row) => letterRecord(row, account.id, at)) } };
  });

  authed('POST', '/api/inbox/ack', async ({ account, body }) => {
    const { through_seq: through } = jsonBody(body);
    if (typeof through !== 'number' || !Number.isSafeInteger(through) || through < 0) throw invalid({ through_seq: 'invalid' });
    await applyReturns();
    const delivered = await deliverThrough(pool, account.id, through, now());
    await announceLetters(delivered);
    return { status: 200, body: { delivered: delivered.length } };
  });

  authed('POST', '/api/letters/:id/retract', async ({ account, params }) => {
    await requireLetter(pool, account.id, params.id);
    await applyReturns();
    const letter = await requireLetter(pool, account.id, params.id);
    if (letter.sender_id !== account.id) throw new ApiError(403, 'not_sender');
    if (letter.retracted_at) return { status: 200, body: letterRecord(letter, account.id, now()) };
    const at = now();
    if (!retractWindowOpen(letter.held_at, at)) throw new ApiError(409, 'retract_window_closed');
    const [row] = await query<LetterRow>(
      pool,
      'UPDATE letters SET retracted_at = $2, iv = NULL, ciphertext = NULL WHERE id = $1 AND retracted_at IS NULL RETURNING *',
      [letter.id, at],
    );
    if (!row) return { status: 200, body: letterRecord((await requireLetter(pool, account.id, params.id)), account.id, at) };
    if (row.attachment_id) await discardBlobs(pool, [row.attachment_id], at);
    await announceLetters([row]);
    return { status: 200, body: letterRecord(row, account.id, at) };
  });
}
