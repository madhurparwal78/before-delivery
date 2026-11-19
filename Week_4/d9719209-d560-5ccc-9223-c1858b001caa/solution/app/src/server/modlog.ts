import type { Db } from './db.js';
import { now } from './clock.js';
import type { ModAction } from '../shared/types.js';

export interface LogEntry {
  communityId: string;
  action: ModAction;
  target: { type: 'post' | 'comment' | 'user'; id: string };
  publicReason?: string | null;
  privateNote?: string | null;
  moderatorId: string;
}

/** Appends one mod log entry; always called in the same transaction as the action it records. */
export async function logAction(db: Db, entry: LogEntry): Promise<void> {
  await db.query(
    `INSERT INTO mod_log (community_id, action, target_type, target_id, public_reason, private_note, moderator_id, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.communityId, entry.action, entry.target.type, entry.target.id, entry.publicReason ?? null,
      entry.privateNote ?? null, entry.moderatorId, now()]);
}
