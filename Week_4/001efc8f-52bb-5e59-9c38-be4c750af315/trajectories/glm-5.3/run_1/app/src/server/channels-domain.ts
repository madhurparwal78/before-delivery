import type { Db } from './db';
import { ApiError } from './errors';
import type { Viewer } from './user-projection';
import type { ChannelRow } from './messages-domain';
import { unreadCountForViewer, pinnedIds } from './messages-domain';

/** The Channel shape: stats and pins are always derived, never stored (DP-23). */
export async function buildChannelView(db: Db, channel: ChannelRow, userId: string): Promise<Record<string, unknown>> {
  const unread = await unreadCountForViewer(db, channel.id, userId);
  const memberCount = await db.pool.query('SELECT count(*)::int AS n FROM memberships WHERE channel_id = $1', [channel.id]);
  const pins = await pinnedIds(db, channel.id);
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    private: channel.private,
    unread_count: unread,
    member_count: memberCount.rows[0].n,
    pinned_message_ids: pins,
  };
}
