import type { PoolClient } from 'pg';
import { one, pool, query } from '../db.ts';
import type { Notice, NoticeKind, NoticesView } from '../../shared/types.ts';
import { INBOX_OUTAGE } from '../../shared/copy.ts';
import {
  PocketBaseUnavailable,
  listNotices,
  markAllRead,
  writeNotice,
} from '../services/pocketbase.ts';
import { sendTo } from '../services/realtime.ts';
import { apiError } from '../http/errors.ts';

export interface QueuedNotice {
  managerId: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
  /** Keeps a notice to one record however many servers or retries meet the same cause. */
  dedupeKey: string | null;
}

export const queueNotice = async (
  client: PoolClient,
  notice: QueuedNotice,
): Promise<void> => {
  await client.query(
    `insert into notices (manager_id, kind, gameweek, message, dedupe_key)
     values ($1, $2, $3, $4, $5)
     on conflict (dedupe_key) do nothing`,
    [notice.managerId, notice.kind, notice.gameweek, notice.message, notice.dedupeKey],
  );
};

interface PendingNotice {
  id: string;
  manager_id: string;
  pb_user_id: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
  created_at: Date;
}

export const flushNotices = async (): Promise<void> => {
  const pending = await query<PendingNotice>(
    pool,
    `select n.id, n.manager_id, m.pb_user_id, n.kind, n.gameweek, n.message, n.created_at
       from notices n join managers m on m.id = n.manager_id
      where n.delivered = false
      order by n.created_at
      limit 100`,
  );
  for (const notice of pending) {
    const claimed = await query<{ id: string }>(
      pool,
      'update notices set delivered = true where id = $1 and delivered = false returning id',
      [notice.id],
    );
    if (claimed.length === 0) continue;
    try {
      const pbId = await writeNotice({
        manager: notice.pb_user_id,
        kind: notice.kind,
        gameweek: notice.gameweek,
        message: notice.message,
      });
      await query(pool, 'update notices set pb_id = $2 where id = $1', [notice.id, pbId]);
      const unread = (await listNotices(notice.pb_user_id)).filter((item) => !item.read).length;
      sendTo(notice.manager_id, {
        type: 'notice',
        notice: {
          id: pbId,
          kind: notice.kind,
          gameweek: notice.gameweek,
          message: notice.message,
          read: false,
          created: notice.created_at.toISOString(),
        },
        unread,
      });
    } catch {
      await query(pool, 'update notices set delivered = false where id = $1', [notice.id]);
      return;
    }
  }
};

const inboxUnavailable = (): never => {
  throw apiError(503, 'inbox_unavailable', INBOX_OUTAGE);
};

export const noticesView = async (pbUserId: string): Promise<NoticesView> => {
  try {
    const records = await listNotices(pbUserId);
    const notices: Notice[] = records.map((record) => ({
      id: record.id,
      kind: record.kind,
      gameweek: record.gameweek,
      message: record.message,
      read: record.read,
      created: new Date(record.created.replace(' ', 'T')).toISOString(),
    }));
    return { unread: notices.filter((notice) => !notice.read).length, notices };
  } catch (error) {
    if (error instanceof PocketBaseUnavailable) inboxUnavailable();
    throw error;
  }
};

export const readAllNotices = async (pbUserId: string): Promise<void> => {
  try {
    await markAllRead(pbUserId);
  } catch (error) {
    if (error instanceof PocketBaseUnavailable) inboxUnavailable();
    throw error;
  }
};

export const squadOwners = async (playerId: string): Promise<string[]> =>
  (
    await query<{ manager_id: string }>(
      pool,
      'select manager_id from squad_players where player_id = $1',
      [playerId],
    )
  ).map((entry) => entry.manager_id);

export const managerTeamName = async (managerId: string): Promise<string> =>
  (
    await one<{ team_name: string }>(pool, 'select team_name from managers where id = $1', [
      managerId,
    ])
  )!.team_name;
