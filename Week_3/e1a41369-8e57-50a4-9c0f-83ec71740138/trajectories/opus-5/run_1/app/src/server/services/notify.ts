import type { Client } from '../db.js';
import type { ChatMessage, StrikeEvent } from '../../shared/types.js';
import { sendToUser, sendToUsers } from '../live.js';
import { loadInvites, memberIds, partyJson } from './party.js';
import { loadNotices, loadUser, partyIdOf, playerJson } from './player.js';
import { loadTaskLists } from './tasks.js';
import { questJson } from './quest.js';

export async function publishPlayer(client: Client, userId: string): Promise<void> {
  const user = await loadUser(client, userId);
  if (!user) return;
  sendToUser(userId, 'player', await playerJson(client, user));
}

export async function publishTasks(client: Client, userId: string): Promise<void> {
  const user = await loadUser(client, userId);
  if (!user) return;
  sendToUser(userId, 'tasks', await loadTaskLists(client, userId, user.open_date));
}

export async function publishParty(client: Client, partyId: string, extraUserIds: readonly string[] = []): Promise<void> {
  const party = await partyJson(client, partyId);
  const members = await memberIds(client, partyId);
  if (party) sendToUsers(members, 'party', party);
  for (const userId of extraUserIds) {
    const stillIn = await partyIdOf(client, userId);
    sendToUser(userId, 'party', stillIn ? ((await partyJson(client, stillIn)) ?? { party: null }) : { party: null });
  }
}

export async function publishQuest(client: Client, questId: string): Promise<void> {
  const quest = await questJson(client, questId);
  if (!quest) return;
  const members = await memberIds(client, quest.partyId);
  sendToUsers(members, 'quest', quest);
}

export async function publishStrike(client: Client, questId: string, event: StrikeEvent): Promise<void> {
  const quest = await questJson(client, questId);
  if (!quest) return;
  const members = await memberIds(client, quest.partyId);
  sendToUsers(members, 'strike', { ...event, questId });
}

export async function publishChat(client: Client, partyId: string, message: ChatMessage): Promise<void> {
  const members = await memberIds(client, partyId);
  sendToUsers(members, 'chat', { ...message, partyId });
}

export async function publishBanner(client: Client, partyId: string, bannerUrl: string | null): Promise<void> {
  const members = await memberIds(client, partyId);
  sendToUsers(members, 'banner', { partyId, bannerUrl });
}

export async function publishInvites(client: Client, userId: string): Promise<void> {
  sendToUser(userId, 'invite', { invites: await loadInvites(client, userId) });
}

export async function noticeWatermark(client: Client, userId: string): Promise<string> {
  const found = await client.query<{ mark: string }>(
    'select coalesce(max(seq), 0)::text as mark from notices where user_id = $1',
    [userId],
  );
  return found.rows[0]?.mark ?? '0';
}

export async function publishNoticesSince(client: Client, userId: string, watermark: string): Promise<void> {
  const found = await client.query<{ id: string }>(
    'select id from notices where user_id = $1 and seq > $2 order by seq',
    [userId, watermark],
  );
  if (found.rowCount === 0) return;
  const notices = await loadNotices(client, userId);
  const fresh = new Set(found.rows.map((row) => row.id));
  for (const notice of notices) {
    if (fresh.has(notice.id)) sendToUser(userId, 'notice', notice);
  }
}
