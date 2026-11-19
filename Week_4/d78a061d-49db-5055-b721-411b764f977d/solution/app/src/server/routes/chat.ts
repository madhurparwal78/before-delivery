import { errors } from '../errors.js';
import { readJsonBody, requireAccount, type Ctx, type Reply } from '../http.js';
import { listMessages, postUserMessage, renderMessage } from '../chat.js';
import { partyIdOf } from '../domain/party.js';
import { sessionRecord } from '../sessions/engine.js';
import { UUID_RE } from '../../shared/constants.js';

async function assertChannelAccess(channel: string, accountId: string): Promise<void> {
  if (channel === 'lobby') return;
  if (channel.startsWith('party-')) {
    const partyId = channel.slice('party-'.length);
    if ((await partyIdOf(accountId)) !== partyId) throw errors.notFound();
    return;
  }
  if (channel.startsWith('session-')) {
    const sessionId = channel.slice('session-'.length);
    if (!UUID_RE.test(sessionId)) throw errors.notFound();
    const record = await sessionRecord(sessionId);
    if (record === null || record.status === 'ended') throw errors.notFound();
    if (!record.members.some((member) => member.account_id === accountId)) throw errors.notFound();
    return;
  }
  throw errors.notFound();
}

export async function getChatMessages(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const channel = ctx.params.channel;
  await assertChannelAccess(channel, account.id);
  const raw = ctx.url.searchParams.get('after_seq') ?? '0';
  if (!/^\d+$/.test(raw)) throw errors.invalidField('after_seq', { key: 'fb.generic' });
  const rows = await listMessages(channel, Number.parseInt(raw, 10));
  return {
    status: 200,
    body: { messages: rows.map((row) => renderMessage(row, ctx.locale)) },
  };
}

export async function postChatMessage(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const channel = ctx.params.channel;
  await assertChannelAccess(channel, account.id);
  const input = (await readJsonBody(ctx.req)) as Record<string, unknown>;
  const result = await postUserMessage({
    accountId: account.id,
    channel,
    clientMessageId: input.client_message_id,
    body: input.body,
  });
  return { status: 201, body: { message: renderMessage(result.row, ctx.locale) } };
}
