import { query, queryOne } from '../db';
import { unreadCountSql } from './counts';
import type { Channel, ChannelKind } from '../../shared/api';

interface ChannelRow {
  id: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
  unread_count: number;
  member_count: number;
  pinned_message_ids: string[];
}

const CHANNEL_COLUMNS = `
  c.id, c.name, c.kind, c.private,
  ${unreadCountSql('$1')} AS unread_count,
  (SELECT count(*)::int FROM channel_members mcm WHERE mcm.channel_id = c.id) AS member_count,
  COALESCE((
    SELECT array_agg(p.message_id ORDER BY p.pinned_at ASC, p.message_id ASC)
    FROM pins p WHERE p.channel_id = c.id), '{}'::uuid[]) AS pinned_message_ids`;

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    private: row.private,
    unread_count: row.unread_count,
    member_count: row.member_count,
    pinned_message_ids: row.pinned_message_ids,
  };
}

export async function listChannelsFor(userId: string): Promise<Channel[]> {
  const rows = await query<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS}
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     ORDER BY c.name ASC`,
    [userId],
  );
  return rows.map(toChannel);
}

export async function loadChannelFor(userId: string, channelId: string): Promise<Channel | null> {
  const row = await queryOne<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS}
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     WHERE c.id = $2`,
    [userId, channelId],
  );
  return row === null ? null : toChannel(row);
}

export interface ChannelRecord {
  id: string;
  workspace_id: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
}

/** A channel the caller currently belongs to, inside their own workspace. */
export async function memberChannel(
  userId: string,
  workspaceId: string,
  channelId: string,
): Promise<ChannelRecord | null> {
  return queryOne<ChannelRecord>(
    `SELECT c.id, c.workspace_id, c.name, c.kind, c.private
     FROM channels c
     JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     WHERE c.id = $2 AND c.workspace_id = $3`,
    [userId, channelId, workspaceId],
  );
}

export async function currentMemberIds(channelId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>('SELECT user_id FROM channel_members WHERE channel_id = $1', [
    channelId,
  ]);
  return rows.map((row) => row.user_id);
}
