import {
  AttachmentRow,
  MemberRow,
  MessageRow,
  findAttachment,
  findMember,
} from '../data';
import { newId, query, queryOne } from '../db';
import { attachmentStoreUnavailable, invalid, notFound } from '../http/errors';
import { Route, defineRoute, jsonBody, multipartParts, person } from '../http/kernel';
import { copy } from '../shared/copy';
import { instantToIso } from '../shared/time';
import { attachmentKind, cleanPhoto } from '../services/images';
import {
  ReportStoreUnavailable,
  attachmentCleanKey,
  attachmentOriginalKey,
  getObject,
  putObject,
} from '../services/s3';
import { enforceRateLimit, recordRateEvent } from './rateLimits';
import { requireMember, refuseWhenClosing } from './members';
import { messageView } from './views';
import { FieldErrors } from './validate';

const MESSAGE_BODY_LIMIT = 2000;
const MESSAGE_BODY_BYTES = { limit: 5100000, message: copy.tooLargeRequest };
const ATTACHMENT_PART = { attachment: { limit: 5000000, message: copy.tooLargeAttachment } };

async function messagesOf(memberId: string): Promise<unknown[]> {
  const rows = await query<MessageRow>(
    'select * from messages where member_id = $1 order by sent_at, id',
    [memberId],
  );
  const views = [];
  for (const message of rows) {
    const attachment = message.attachment_id ? await findAttachment(message.attachment_id) : null;
    views.push(messageView(message, attachment));
  }
  return views;
}

async function storeAttachment(member: MemberRow, bytes: Buffer): Promise<AttachmentRow> {
  const kind = attachmentKind(bytes);
  if (!kind) throw invalid({ attachment: copy.attachmentKind });
  const photoKind = kind === 'pdf' ? null : kind;
  const id = newId();
  const originalKey = attachmentOriginalKey(member.id, id);
  const cleanKey = kind === 'pdf' ? null : attachmentCleanKey(member.id, id);
  try {
    await putObject(originalKey, bytes, kind === 'pdf' ? 'application/pdf' : `image/${kind}`);
    if (cleanKey && photoKind) {
      await putObject(cleanKey, cleanPhoto(photoKind, bytes), `image/${photoKind}`);
    }
  } catch (error) {
    if (error instanceof ReportStoreUnavailable) throw attachmentStoreUnavailable();
    throw error;
  }
  await query(
    `insert into attachments (id, member_id, kind, byte_size, original_key, clean_key)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, member.id, kind, bytes.length, originalKey, cleanKey],
  );
  const stored = await findAttachment(id);
  if (!stored) throw new Error('Attachment vanished after store');
  return stored;
}

function readMessageBody(text: string | null): string {
  const errors = new FieldErrors();
  const body = text ?? '';
  const points = [...body].length;
  if (body.trim() === '') errors.add('body', copy.messageBodyRequired);
  else if (points > MESSAGE_BODY_LIMIT) errors.add('body', copy.messageBodyLength);
  errors.throwIfAny();
  return body;
}

async function touchThread(memberId: string, state: 'open' | 'handled'): Promise<void> {
  await query(
    `insert into threads (member_id, state, last_message_at) values ($1, $2, now())
     on conflict (member_id) do update set state = $2, last_message_at = now()`,
    [memberId, state],
  );
}

async function requireOwnAttachment(
  attachmentId: string,
  who: { role: string; id: string },
): Promise<AttachmentRow> {
  const attachment = await findAttachment(attachmentId);
  if (!attachment) throw notFound();
  if (who.role === 'member' && attachment.member_id !== who.id) throw notFound();
  const member = await findMember(attachment.member_id);
  if (!member || member.account_state === 'erased') throw notFound();
  return attachment;
}

export const messageRoutes: Route[] = [
  defineRoute({
    method: 'POST',
    path: '/api/me/messages',
    access: ['member'],
    bodyLimit: MESSAGE_BODY_BYTES,
    partLimits: ATTACHMENT_PART,
    rateLimit: (ctx) => enforceRateLimit(ctx, 'message'),
    handler: async (ctx) => {
      const member = await requireMember(person(ctx).id);
      const parts = multipartParts(ctx);
      const bodyPart = parts.parts.get('body');
      const body = readMessageBody(bodyPart ? bodyPart.bytes.toString('utf8') : null);
      refuseWhenClosing(member);
      const attachmentPart = parts.parts.get('attachment');
      const attachment =
        attachmentPart && attachmentPart.bytes.length > 0
          ? await storeAttachment(member, attachmentPart.bytes)
          : null;
      const id = newId();
      await query(
        `insert into messages (id, member_id, from_role, from_name, body, attachment_id)
         values ($1, $2, 'member', $3, $4, $5)`,
        [id, member.id, member.name ?? '', body, attachment?.id ?? null],
      );
      await touchThread(member.id, 'open');
      await recordRateEvent(member, 'message');
      const message = await queryOne<MessageRow>('select * from messages where id = $1', [id]);
      return {
        status: 201,
        json: { message: messageView(message as MessageRow, attachment) },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/messages',
    access: ['member'],
    handler: async (ctx) => ({
      status: 200,
      json: { messages: await messagesOf(person(ctx).id) },
    }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/message-threads',
    access: ['owner', 'specialist', 'coordinator'],
    handler: async () => {
      const rows = await query<{
        member_id: string;
        state: 'open' | 'handled';
        last_message_at: Date | null;
        name: string | null;
      }>(
        `select t.member_id, t.state, t.last_message_at, m.name
         from threads t join members m on m.id = t.member_id
         where m.account_state <> 'erased'
         order by case when t.state = 'open' then 0 else 1 end, t.last_message_at`,
      );
      return {
        status: 200,
        json: {
          threads: rows.map((row) => ({
            memberId: row.member_id,
            memberName: row.name ?? copy.erasedMember,
            state: row.state,
            lastMessageAt: row.last_message_at ? instantToIso(row.last_message_at) : null,
          })),
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members/:memberId/messages',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (_ctx, member) => ({
      status: 200,
      json: { messages: await messagesOf(member.id) },
    }),
  }),
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/messages',
    access: ['owner', 'specialist', 'coordinator'],
    bodyLimit: MESSAGE_BODY_BYTES,
    partLimits: ATTACHMENT_PART,
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (ctx, member) => {
      const parts = multipartParts(ctx);
      const bodyPart = parts.parts.get('body');
      const body = readMessageBody(bodyPart ? bodyPart.bytes.toString('utf8') : null);
      const attachmentPart = parts.parts.get('attachment');
      const attachment =
        attachmentPart && attachmentPart.bytes.length > 0
          ? await storeAttachment(member, attachmentPart.bytes)
          : null;
      const who = person(ctx);
      const id = newId();
      await query(
        `insert into messages (id, member_id, from_role, from_name, body, attachment_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, member.id, who.role, who.name, body, attachment?.id ?? null],
      );
      await touchThread(member.id, 'open');
      const message = await queryOne<MessageRow>('select * from messages where id = $1', [id]);
      return {
        status: 201,
        json: { message: messageView(message as MessageRow, attachment) },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/messages/handled',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (ctx, member) => {
      jsonBody<Record<string, unknown>>(ctx);
      await query(
        `insert into threads (member_id, state) values ($1, 'handled')
         on conflict (member_id) do update set state = 'handled'`,
        [member.id],
      );
      return { status: 200, json: { thread: { state: 'handled' } } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/attachments/:attachmentId',
    access: 'any',
    resolve: async (ctx) =>
      requireOwnAttachment(ctx.params.attachmentId as string, person(ctx)),
    handler: async (_ctx, attachment) => {
      const key = attachment.clean_key ?? attachment.original_key;
      const bytes = await getObject(key);
      if (!bytes) throw notFound();
      return {
        status: 200,
        bytes,
        contentType: attachment.kind === 'pdf' ? 'application/pdf' : `image/${attachment.kind}`,
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/attachments/:attachmentId/original',
    access: 'any',
    resolve: async (ctx) =>
      requireOwnAttachment(ctx.params.attachmentId as string, person(ctx)),
    handler: async (_ctx, attachment) => {
      const bytes = await getObject(attachment.original_key);
      if (!bytes) throw notFound();
      return {
        status: 200,
        bytes,
        contentType: attachment.kind === 'pdf' ? 'application/pdf' : `image/${attachment.kind}`,
      };
    },
  }),
];
