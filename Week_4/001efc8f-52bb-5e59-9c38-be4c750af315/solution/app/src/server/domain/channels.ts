import { ApiError } from "../errors.js";
import { one, rows, type Queryable } from "../db.js";
import { unreadColumn } from "./counts.js";
import { isUuid } from "./ids.js";
import type { ChannelKind } from "./roles.js";

type ChannelJson = {
  id: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
  unread_count: number;
  member_count: number;
  pinned_message_ids: string[];
};

const CHANNEL_COLUMNS = (user: string) => `
  c.id, c.name, c.kind, c.private,
  ${unreadColumn("c", user)},
  (SELECT count(*)::int FROM memberships mc WHERE mc.channel_id = c.id) AS member_count,
  COALESCE((SELECT array_agg(p.id::text ORDER BY p.pinned_at, p.id::text) FROM messages p
             WHERE p.channel_id = c.id AND p.pinned_at IS NOT NULL AND p.deleted_at IS NULL), '{}') AS pinned_message_ids`;

export async function channelsFor(db: Queryable, userId: string): Promise<ChannelJson[]> {
  return rows<ChannelJson>(
    db,
    `SELECT ${CHANNEL_COLUMNS("$1")} FROM channels c JOIN memberships m ON m.channel_id = c.id AND m.user_id = $1 ORDER BY c.name`,
    [userId],
  );
}

export async function channelFor(db: Queryable, channelId: string, userId: string): Promise<ChannelJson> {
  const row = await one<ChannelJson>(db, `SELECT ${CHANNEL_COLUMNS("$2")} FROM channels c WHERE c.id = $1`, [channelId, userId]);
  if (!row) throw new ApiError("not_found");
  return row;
}

export type MemberChannel = { id: string; workspace_id: string; name: string; kind: ChannelKind; private: boolean };

// A channel the caller currently belongs to in their workspace; anything else is not_found.
export async function memberChannel(db: Queryable, viewer: { id: string; workspace: { id: string } }, channelId: string): Promise<MemberChannel> {
  if (!isUuid(channelId)) throw new ApiError("not_found");
  const row = await one<MemberChannel>(
    db,
    `SELECT c.id, c.workspace_id, c.name, c.kind, c.private FROM channels c
       JOIN memberships m ON m.channel_id = c.id AND m.user_id = $2
      WHERE c.id = $1 AND c.workspace_id = $3`,
    [channelId, viewer.id, viewer.workspace.id],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

// The channel as each current member (optionally but one) sees it, for channel.updated fan-out.
export async function channelForMembers(db: Queryable, channelId: string, exceptUserId: string | null): Promise<{ user_id: string; channel: ChannelJson }[]> {
  const found = await rows<ChannelJson & { member_id: string }>(
    db,
    `SELECT mb.user_id AS member_id, ${CHANNEL_COLUMNS("mb.user_id")}
       FROM channels c JOIN memberships mb ON mb.channel_id = c.id
      WHERE c.id = $1 AND ($2::uuid IS NULL OR mb.user_id <> $2::uuid)`,
    [channelId, exceptUserId],
  );
  return found.map(({ member_id, ...channel }) => ({ user_id: member_id, channel }));
}
