import type { ConversationStatus, MuteDuration } from '../../shared/types.js';
import { serverNow } from '../clock.js';
import { pool, transaction } from '../db.js';
import { loadConversation } from '../domain/access.js';
import {
  conversationRecordById,
  currentKey,
  findOrCreateConversation,
  listConversations,
  recordSeal,
  sealStatus,
} from '../domain/conversations.js';
import { markRead } from '../domain/delivery.js';
import { LETTER_COLUMNS, letterRecord, type LetterRow } from '../domain/letters.js';
import {
  conflict,
  invalidField,
  isUuidV4,
  notFound,
  requireBoolean,
  requireInteger,
  requireString,
  sendJson,
  sendNoContent,
  type RequestContext,
} from '../http.js';
import { pushConversation, pushLetter } from '../push.js';
import { sweepReturns } from '../sweep.js';

const MUTE_DURATIONS: Record<MuteDuration, number | null> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  always: null,
  off: null,
};

export async function postConversation(ctx: RequestContext): Promise<void> {
  const peerId = ctx.body['peer_id'];
  if (!isUuidV4(peerId)) throw notFound();
  if (peerId === ctx.accountId) throw invalidField('peer_id', 'self');
  const peer = await pool.query('select 1 from accounts where id = $1', [peerId]);
  if (peer.rows.length === 0) throw notFound();

  const now = serverNow();
  const { id, created } = await transaction(async (client) => {
    const result = await findOrCreateConversation(client, ctx.accountId, peerId, now);
    if (!result.created) {
      const side = await client.query<{ visible: boolean }>(
        'select visible from conversation_sides where conversation_id = $1 and account_id = $2',
        [result.id, ctx.accountId],
      );
      // Writing first to a conversation that never showed for you counts as starting it.
      if (side.rows[0]?.visible === false) {
        await client.query(
          `update conversation_sides set visible = true, accepted = true
            where conversation_id = $1 and account_id = $2`,
          [result.id, ctx.accountId],
        );
        await recordSeal(client, ctx.accountId, peerId);
      }
    }
    return result;
  });

  sendJson(ctx.res, created ? 201 : 200, await conversationRecordById(pool, id, ctx.accountId, now));
}

export async function getConversations(ctx: RequestContext): Promise<void> {
  await sweepReturns();
  const requested = ctx.url.searchParams.get('status') ?? 'accepted';
  if (requested !== 'accepted' && requested !== 'request') throw invalidField('status', 'invalid');
  const status: ConversationStatus = requested;
  sendJson(ctx.res, 200, { conversations: await listConversations(pool, ctx.accountId, status) });
}

export async function getConversation(ctx: RequestContext): Promise<void> {
  await sweepReturns();
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  sendJson(ctx.res, 200, await conversationRecordById(pool, id, ctx.accountId, serverNow()));
}

export async function acceptConversation(ctx: RequestContext): Promise<void> {
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  const { side, peerId } = await loadConversation(pool, id, ctx.accountId);
  if (side.accepted) throw conflict('not_a_request');

  const now = serverNow();
  await pool.query(
    'update conversation_sides set accepted = true where conversation_id = $1 and account_id = $2',
    [id, ctx.accountId],
  );
  await pool.query('update conversations set updated_at = $2 where id = $1', [id, now]);
  await pushConversation(id, [ctx.accountId, peerId]);
  sendJson(ctx.res, 200, await conversationRecordById(pool, id, ctx.accountId, now));
}

export async function deleteConversation(ctx: RequestContext): Promise<void> {
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  const { side } = await loadConversation(pool, id, ctx.accountId);
  if (side.accepted) throw conflict('not_a_request');
  await hideConversation(id, ctx.accountId);
  sendNoContent(ctx.res);
}

/** Hiding a request keeps its letters out of sight; later letters bring it back. */
export async function hideConversation(
  conversationId: string,
  accountId: string,
): Promise<void> {
  const highest = await pool.query<{ seq: string | null }>(
    'select max(seq) as seq from letters where conversation_id = $1',
    [conversationId],
  );
  const seq = highest.rows[0]?.seq ?? '0';
  await pool.query(
    `update conversation_sides set visible = false, hide_seq = $3, read_seq = greatest(read_seq, $3)
      where conversation_id = $1 and account_id = $2`,
    [conversationId, accountId, seq ?? '0'],
  );
}

export async function postRead(ctx: RequestContext): Promise<void> {
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  const { peerId } = await loadConversation(pool, id, ctx.accountId);
  const throughSeq = requireInteger(ctx.body['through_seq'], 'through_seq');
  if (throughSeq < 0) throw invalidField('through_seq', 'invalid');

  const now = serverNow();
  await pool.query(
    `update conversation_sides set read_seq = greatest(read_seq, $3)
      where conversation_id = $1 and account_id = $2`,
    [id, ctx.accountId, throughSeq],
  );
  const changed = await markRead(pool, id, ctx.accountId, now);
  for (const letter of changed) await pushLetter(letter);
  await pushConversation(id, [ctx.accountId, peerId]);
  sendJson(ctx.res, 200, await conversationRecordById(pool, id, ctx.accountId, now));
}

export async function putMute(ctx: RequestContext): Promise<void> {
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  await loadConversation(pool, id, ctx.accountId);
  const duration = requireString(ctx.body['duration'], 'duration') as MuteDuration;
  if (!(duration in MUTE_DURATIONS)) throw invalidField('duration', 'invalid');

  const now = serverNow();
  const span = MUTE_DURATIONS[duration];
  const until = span === null ? null : new Date(now.getTime() + span);
  await pool.query(
    `update conversation_sides set muted_until = $3, muted_always = $4
      where conversation_id = $1 and account_id = $2`,
    [id, ctx.accountId, until, duration === 'always'],
  );
  sendJson(ctx.res, 200, await conversationRecordById(pool, id, ctx.accountId, now));
}

export async function getLetters(ctx: RequestContext): Promise<void> {
  await sweepReturns();
  const id = ctx.params['id'] ?? '';
  if (!isUuidV4(id)) throw notFound();
  const { side } = await loadConversation(pool, id, ctx.accountId);

  const beforeRaw = ctx.url.searchParams.get('before_seq');
  const limitRaw = ctx.url.searchParams.get('limit');
  let before: number | null = null;
  if (beforeRaw !== null) {
    before = Number.parseInt(beforeRaw, 10);
    if (!Number.isInteger(before) || before < 0) throw invalidField('before_seq', 'invalid');
  }
  let limit = 50;
  if (limitRaw !== null) {
    limit = Number.parseInt(limitRaw, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw invalidField('limit', 'invalid');
    }
  }

  const rows = await pool.query<LetterRow>(
    `select ${LETTER_COLUMNS} from letters
      where conversation_id = $1 and seq > $2
        and not (dropped and recipient_id = $3)
        and ($4::bigint is null or seq < $4)
      order by seq desc limit $5`,
    [id, side.hide_seq, ctx.accountId, before, limit],
  );
  const now = serverNow();
  const letters = rows.rows
    .slice()
    .reverse()
    .map((row) => letterRecord(row, ctx.accountId, now));
  sendJson(ctx.res, 200, { letters });
}

export async function putSeal(ctx: RequestContext): Promise<void> {
  const contactId = ctx.params['account_id'] ?? '';
  if (!isUuidV4(contactId)) throw notFound();
  const shared = await pool.query<{ conversation_id: string }>(
    `select mine.conversation_id from conversation_sides mine
       join conversation_sides theirs on theirs.conversation_id = mine.conversation_id
      where mine.account_id = $1 and theirs.account_id = $2 and mine.visible`,
    [ctx.accountId, contactId],
  );
  const conversationId = shared.rows[0]?.conversation_id;
  if (conversationId === undefined) throw notFound();

  const keyId = requireString(ctx.body['key_id'], 'key_id');
  const verified = requireBoolean(ctx.body['verified'], 'verified');
  const key = await currentKey(pool, contactId);
  if (keyId !== key.key_id) throw conflict('stale_key', { key_id: key.key_id });

  await pool.query(
    `insert into seals (viewer_id, contact_id, accepted_key_id, verified) values ($1, $2, $3, $4)
     on conflict (viewer_id, contact_id) do update set accepted_key_id = $3, verified = $4`,
    [ctx.accountId, contactId, keyId, verified],
  );
  await pushConversation(conversationId, [ctx.accountId]);
  sendJson(ctx.res, 200, {
    account_id: contactId,
    key_id: keyId,
    seal: await sealStatus(pool, ctx.accountId, contactId, keyId),
  });
}
