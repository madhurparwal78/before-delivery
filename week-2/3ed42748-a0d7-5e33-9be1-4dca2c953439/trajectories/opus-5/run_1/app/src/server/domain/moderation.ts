import { query, withTransaction } from '../db/pool.js';
import { generatedCourierName } from '../db/ids.js';
import { fail } from '../http/errors.js';
import { isStaff, loadCourierByModerationRef, type Role } from './couriers.js';
import { isoTime } from './time.js';
import type { Actor } from './sessions.js';

export type ModerationAction = 'mute' | 'unmute' | 'rename';

export interface AuditEntry {
  entry_id: string;
  action: ModerationAction;
  actor_role: 'helper' | 'founder';
  actor_display_name: string;
  moderation_ref: string;
  target_name_before: string;
  target_name_after: string;
  at: string;
}

export interface ModerationOutcome {
  display_name: string;
  muted: boolean;
  name_locked: boolean;
}

/** Mute, unmute and rename, each with its one audit entry, in the action's own transaction. */
export async function moderate(
  actor: Actor,
  moderationRef: string,
  action: ModerationAction,
  now: Date,
): Promise<ModerationOutcome> {
  return withTransaction(async (tx) => {
    const target = await loadCourierByModerationRef(tx, moderationRef);
    if (target === null) throw fail('not_found');
    if (isStaff(target.role)) throw fail('cannot_moderate_staff');

    if (action === 'mute' && target.muted) throw fail('already_muted');
    if (action === 'unmute' && !target.muted) throw fail('not_muted');

    const before = target.display_name;
    let after = before;
    let muted = target.muted;
    let nameLocked = target.name_locked;

    if (action === 'mute') {
      await tx.query(
        'update couriers set muted = true, emote = null, emote_at = null where courier_id = $1',
        [target.courier_id],
      );
      muted = true;
    } else if (action === 'unmute') {
      await tx.query('update couriers set muted = false where courier_id = $1', [
        target.courier_id,
      ]);
      muted = false;
    } else {
      after = generatedCourierName();
      await tx.query(
        'update couriers set display_name = $2, name_locked = true where courier_id = $1',
        [target.courier_id, after],
      );
      nameLocked = true;
    }

    await tx.query(
      `insert into moderation_audit (action, actor_role, actor_display_name, moderation_ref,
                                     target_name_before, target_name_after, at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [action, actor.courier.role, actor.courier.display_name, moderationRef, before, after, now],
    );
    return { display_name: after, muted, name_locked: nameLocked };
  });
}

export async function auditEntries(): Promise<AuditEntry[]> {
  const rows = await query<{
    entry_id: string;
    action: ModerationAction;
    actor_role: Role;
    actor_display_name: string;
    moderation_ref: string;
    target_name_before: string;
    target_name_after: string;
    at: Date;
  }>(
    `select entry_id::text as entry_id, action, actor_role, actor_display_name, moderation_ref,
            target_name_before, target_name_after, at
     from moderation_audit order by at desc, entry_id desc`,
  );
  return rows.map((row) => ({
    entry_id: row.entry_id,
    action: row.action,
    actor_role: row.actor_role as 'helper' | 'founder',
    actor_display_name: row.actor_display_name,
    moderation_ref: row.moderation_ref,
    target_name_before: row.target_name_before,
    target_name_after: row.target_name_after,
    at: isoTime(row.at),
  }));
}
