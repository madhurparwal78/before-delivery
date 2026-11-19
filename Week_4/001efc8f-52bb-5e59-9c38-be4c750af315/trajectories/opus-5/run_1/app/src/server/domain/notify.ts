import { currentMemberIds } from './channels';
import { publish, type EventInput } from './events';
import { loadMessageForDelivery } from './messages';
import type { MessageOrPlaceholder } from '../../shared/api';

function badgeEvents(workspaceId: string, channelId: string, userIds: readonly string[]): EventInput[] {
  return userIds.map((userId) => ({
    workspaceId,
    channelId,
    targetUserId: userId,
    type: 'channel.updated' as const,
    payload: {},
  }));
}

export async function notifyMessageCreated(
  workspaceId: string,
  channelId: string,
  authorId: string,
  message: MessageOrPlaceholder,
): Promise<void> {
  const members = await currentMemberIds(channelId);
  await publish([
    { workspaceId, channelId, type: 'message.created', payload: { message } },
    ...badgeEvents(
      workspaceId,
      channelId,
      members.filter((id) => id !== authorId),
    ),
  ]);
}

export async function notifyMessageUpdated(workspaceId: string, channelId: string, messageId: string): Promise<void> {
  const message = await loadMessageForDelivery(messageId);
  if (message === null) return;
  await publish([{ workspaceId, channelId, type: 'message.updated', payload: { message } }]);
}

export async function notifyMessageDeleted(
  workspaceId: string,
  channelId: string,
  messageId: string,
  threadRootId: string | null,
): Promise<void> {
  const members = await currentMemberIds(channelId);
  const events: EventInput[] = [
    { workspaceId, channelId, type: 'message.deleted', payload: { message_id: messageId, channel_id: channelId } },
    ...badgeEvents(workspaceId, channelId, members),
  ];
  await publish(events);
  if (threadRootId !== null) await notifyMessageUpdated(workspaceId, channelId, threadRootId);
}

export async function notifyReceipts(
  workspaceId: string,
  channelId: string,
  messageId: string,
  readerId: string | null,
): Promise<void> {
  const message = await loadMessageForDelivery(messageId);
  if (message === null || message.deleted) return;
  const events: EventInput[] = [
    {
      workspaceId,
      channelId,
      type: 'receipts.updated',
      payload: {
        message_id: messageId,
        channel_id: channelId,
        recipient_count: message.recipient_count,
        delivered_count: message.delivered_count,
        read_count: message.read_count,
      },
    },
  ];
  if (readerId !== null) events.push(...badgeEvents(workspaceId, channelId, [readerId]));
  await publish(events);
}

export async function notifyChannelAdded(workspaceId: string, channelId: string, userId: string): Promise<void> {
  const members = await currentMemberIds(channelId);
  await publish([
    { workspaceId, channelId, targetUserId: userId, type: 'channel.added', payload: {} },
    ...badgeEvents(
      workspaceId,
      channelId,
      members.filter((id) => id !== userId),
    ),
  ]);
}

export async function notifyChannelRevoked(workspaceId: string, channelId: string, userId: string): Promise<void> {
  const members = await currentMemberIds(channelId);
  await publish([
    { workspaceId, channelId, targetUserId: userId, type: 'channel.revoked', payload: { channel_id: channelId } },
    ...badgeEvents(workspaceId, channelId, members),
  ]);
}

export async function notifySessionEnded(workspaceId: string, userId: string): Promise<void> {
  await publish([{ workspaceId, targetUserId: userId, type: 'session.ended', payload: {} }]);
}
