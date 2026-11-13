import type { ServiceName, ServiceStatus } from '../shared/types';
import { pool } from './db';
import { broadcastServices, flushBoard, keepAlive, recordEvent } from './events';
import { checkMail } from './mail';
import { publishApprovalPush, checkPush } from './push';
import { checkStorage, deletePrefix } from './storage';

const status: ServiceStatus = { storage: true, mail: true, push: true };

export const serviceStatus = (): ServiceStatus => ({ ...status });

export const markService = (service: ServiceName, up: boolean): void => {
  if (status[service] === up) return;
  status[service] = up;
  broadcastServices(serviceStatus());
};

export const runServiceChecks = async (): Promise<void> => {
  const [storage, mail, push] = await Promise.all([checkStorage(), checkMail(), checkPush()]);
  markService('storage', storage);
  markService('mail', mail);
  markService('push', push);
};

/** Sends the one approval push for a held post and keeps its push state in step. */
export const deliverApprovalPush = async (
  boardId: string,
  boardTitle: string,
  postId: string,
  postTitle: string,
): Promise<void> => {
  const accepted = await publishApprovalPush(boardId, boardTitle, postTitle);
  markService('push', accepted);
  if (!accepted) return;
  const result = await pool.query(
    "update posts set push_state = 'sent' where id = $1 and push_state = 'pending' returning id",
    [postId],
  );
  if (result.rowCount === 0) return;
  await recordEvent(pool, boardId, { kind: 'post_push', post_id: postId, push: 'sent' }, 'held');
  await flushBoard(boardId);
};

const retryPendingPushes = async (): Promise<void> => {
  const result = await pool.query<{ id: string; title: string; board_id: string; board_title: string }>(
    `select p.id, p.title, p.board_id, b.title as board_title
     from posts p join boards b on b.id = p.board_id
     where p.state = 'awaiting_approval' and p.push_state = 'pending'`,
  );
  for (const row of result.rows) {
    await deliverApprovalPush(row.board_id, row.board_title, row.id, row.title);
  }
};

const queueObjectCleanup = async (prefix: string): Promise<void> => {
  await pool.query('insert into object_cleanups (prefix) values ($1)', [prefix]);
};

/** Removes a post's or board's objects now, leaving a retry behind when storage is down. */
export const removeObjects = async (prefix: string): Promise<void> => {
  try {
    await deletePrefix(prefix);
    markService('storage', true);
  } catch {
    markService('storage', false);
    await queueObjectCleanup(prefix);
  }
};

const retryObjectCleanups = async (): Promise<void> => {
  const result = await pool.query<{ id: string; prefix: string }>('select id, prefix from object_cleanups order by id');
  for (const row of result.rows) {
    try {
      await deletePrefix(row.prefix);
      await pool.query('delete from object_cleanups where id = $1', [row.id]);
      markService('storage', true);
    } catch {
      markService('storage', false);
    }
  }
};

export const startBackgroundWork = (): void => {
  const tick = async (): Promise<void> => {
    await runServiceChecks();
    await retryPendingPushes();
    await retryObjectCleanups();
  };
  setInterval(() => void tick(), 10000);
  setInterval(() => keepAlive(), 15000);
};
