import { config } from '../core/config.js';
import { db, many, one, transaction, type Queryable } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { iso } from '../core/time.js';
import { copy, MOD_LOG_ACTION_TEXT } from '../shared/copy.js';
import type { Community } from './communities.js';
import { emitPostState } from './events.js';
import { lockState, type PostRow } from './posts.js';
import { publicUser, type Viewer } from './viewer.js';

export type ModAction = keyof typeof MOD_LOG_ACTION_TEXT;

export interface ModLogRow {
  id: string;
  action: ModAction;
  target_type: 'post' | 'comment' | 'user';
  target_id: string;
  public_reason: string | null;
  private_note: string | null;
  at: unknown;
  moderator_username: string;
  moderator_created_at: unknown;
}

export interface ModLogInsert {
  communityId: string;
  moderatorId: string;
  action: ModAction;
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  publicReason: string | null;
  privateNote: string | null;
}

/** The log is append-only and written in the same transaction as the action it records. */
export async function writeModLog(tx: Queryable, entry: ModLogInsert): Promise<void> {
  await tx.query(
    `insert into mod_log (community_id, moderator_id, action, target_type, target_id, public_reason, private_note)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.communityId,
      entry.moderatorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.publicReason,
      entry.privateNote,
    ],
  );
}

export function modLogProjection(
  row: ModLogRow,
  options: { isModerator: boolean; showModNames: boolean },
): Record<string, unknown> {
  const moderator = publicUser(row.moderator_username, row.moderator_created_at);
  const projection: Record<string, unknown> = {
    id: String(row.id),
    action: row.action,
    target: { type: row.target_type, id: row.target_id },
    publicReason: row.public_reason,
    at: iso(row.at),
    moderator: options.isModerator || options.showModNames ? moderator : null,
  };
  if (options.isModerator) projection.privateNote = row.private_note;
  return projection;
}

export async function modLogPage(
  communityId: string,
  beforeId: string | null,
  limit: number = config.pageSize,
): Promise<{ rows: ModLogRow[]; nextCursor: string | null }> {
  const values: unknown[] = [communityId];
  let condition = '';
  if (beforeId !== null) {
    values.push(beforeId);
    condition = ' and l.id < $2';
  }
  const rows = await many<ModLogRow>(
    db,
    `select l.id, l.action, l.target_type, l.target_id, l.public_reason, l.private_note, l.at,
            m.username as moderator_username, m.created_at as moderator_created_at
     from mod_log l join members m on m.id = l.moderator_id
     where l.community_id = $1${condition}
     order by l.id desc limit ${limit + 1}`,
    values,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > limit && last ? String(last.id) : null };
}

export interface RemovalInput {
  reason: 'rule' | 'spam' | 'other';
  ruleId: string | null;
  publicNote: string | null;
  privateNote: string | null;
}

export function parseRemovalInput(body: Record<string, unknown>, community: Community): RemovalInput {
  const reason = body.reason;
  const fields: Record<string, string> = {};
  if (reason !== 'rule' && reason !== 'spam' && reason !== 'other') {
    throw errors.validation(copy.moderation.reasonRequired, { reason: copy.moderation.reasonRequired });
  }
  const ruleId = typeof body.ruleId === 'string' ? body.ruleId : null;
  const publicNote = typeof body.publicNote === 'string' ? body.publicNote.trim() : null;
  const privateNote = typeof body.privateNote === 'string' ? body.privateNote : null;

  if (reason === 'rule' && (ruleId === null || !community.rules.some((rule) => String(rule.id) === ruleId))) {
    fields.ruleId = copy.moderation.reasonRequired;
  }
  if (reason === 'other' && (publicNote === null || publicNote.length < 1 || publicNote.length > 300)) {
    fields.publicNote = copy.moderation.publicNoteRequired;
  }
  if (privateNote !== null && privateNote.length > 1000) {
    fields.privateNote = 'Private notes are at most 1,000 characters';
  }
  if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

  return { reason, ruleId, publicNote, privateNote };
}

export function publicReasonFor(input: RemovalInput, community: Community): string {
  if (input.reason === 'spam') return 'Spam';
  if (input.reason === 'other') return input.publicNote ?? '';
  const rule = community.rules.find((candidate) => String(candidate.id) === input.ruleId);
  return rule ? rule.title : '';
}

export function currentState(row: PostRow): Record<string, unknown> {
  const { locked, lockedUntil } = lockState(row);
  return {
    version: Number(row.version),
    state: row.state,
    locked,
    lockedUntil,
    pinned: row.pinned_at !== null,
  };
}

function conflict(row: PostRow): ApiError {
  return new ApiError('CONFLICT', copy.moderation.raceLost, { current: currentState(row) });
}

export type PostMutation =
  | { kind: 'remove'; removal: RemovalInput; publicReason: string }
  | { kind: 'restore' }
  | { kind: 'lock'; duration: 'indefinite' | '1h' | '24h' | '7d' }
  | { kind: 'unlock' }
  | { kind: 'pin'; replacePostId: string | null }
  | { kind: 'unpin' };

const LOCK_HOURS: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168 };

/** A timed lock's public reason in the mod log. */
export const LOCK_REASON: Record<string, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' };

export interface MutationOutcome {
  post: PostRow;
  modLogEntries: ModLogInsert[];
}

/**
 * Every moderator action locks the post row and compares the version it saw, so of several
 * simultaneous conflicting actions exactly one succeeds and the others change nothing.
 */
export async function mutatePost(
  moderator: { id: string },
  community: Community,
  postId: string,
  version: number,
  mutation: PostMutation,
  reload: (source: Queryable, id: string) => Promise<PostRow | null>,
): Promise<MutationOutcome> {
  const outcome = await transaction(async (tx) => {
    const locked = await one<{ id: string; version: number; state: string; pinned_at: unknown }>(
      tx,
      'select id, version, state, pinned_at from posts where id = $1 for update',
      [postId],
    );
    if (!locked) throw errors.notFound('Post not found');

    const fresh = await reload(tx, postId);
    if (!fresh) throw errors.notFound('Post not found');
    if (Number(fresh.version) !== version) throw conflict(fresh);
    if (fresh.state === 'deleted') throw conflict(fresh);

    const entries: ModLogInsert[] = [];
    const lockNow = lockState(fresh);

    switch (mutation.kind) {
      case 'remove': {
        if (fresh.state !== 'published') throw conflict(fresh);
        await tx.query(
          `update posts set state = 'removed', removal_reason = $2, removal_at = now(),
             pinned_at = null, version = version + 1 where id = $1`,
          [postId, mutation.publicReason],
        );
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'remove_post',
          targetType: 'post',
          targetId: postId,
          publicReason: mutation.publicReason,
          privateNote: mutation.removal.privateNote,
        });
        break;
      }
      case 'restore': {
        if (fresh.state !== 'removed') throw conflict(fresh);
        await tx.query(
          `update posts set state = 'published', removal_reason = null, removal_at = null, version = version + 1
           where id = $1`,
          [postId],
        );
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'restore_post',
          targetType: 'post',
          targetId: postId,
          publicReason: null,
          privateNote: null,
        });
        break;
      }
      case 'lock': {
        if (fresh.state !== 'published' || lockNow.locked) throw conflict(fresh);
        const hours = LOCK_HOURS[mutation.duration];
        await tx.query(
          `update posts set locked_at = now(),
             locked_until = case when $2::integer is null then null
               else now() + make_interval(secs => $2::integer * $3::integer) end,
             version = version + 1
           where id = $1`,
          [postId, hours ?? null, config.limits.lockHourSeconds],
        );
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'lock',
          targetType: 'post',
          targetId: postId,
          publicReason: mutation.duration === 'indefinite' ? null : LOCK_REASON[mutation.duration],
          privateNote: null,
        });
        break;
      }
      case 'unlock': {
        if (fresh.state !== 'published' || !lockNow.locked) throw conflict(fresh);
        await tx.query(
          'update posts set locked_at = null, locked_until = null, version = version + 1 where id = $1',
          [postId],
        );
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'unlock',
          targetType: 'post',
          targetId: postId,
          publicReason: null,
          privateNote: null,
        });
        break;
      }
      case 'pin': {
        if (fresh.state !== 'published' || fresh.pinned_at !== null) throw conflict(fresh);
        // Pin slots are allocated per community, so the community row serialises concurrent pins.
        await tx.query('select 1 from communities where id = $1 for update', [community.id]);
        const pins = await many<{ id: string; title: string }>(
          tx,
          `select id, title from posts where community_id = $1 and state = 'published' and pinned_at is not null
           order by pinned_at asc, id asc`,
          [community.id],
        );
        if (pins.length >= 2) {
          if (mutation.replacePostId === null || !pins.some((pin) => String(pin.id) === mutation.replacePostId)) {
            throw new ApiError('SLOT_TAKEN', 'This community already has two pinned posts', {
              current: { pinned: pins.map((pin) => ({ id: String(pin.id), title: pin.title })) },
            });
          }
          await tx.query('update posts set pinned_at = null, version = version + 1 where id = $1', [
            mutation.replacePostId,
          ]);
          entries.push({
            communityId: String(community.id),
            moderatorId: moderator.id,
            action: 'unpin',
            targetType: 'post',
            targetId: mutation.replacePostId,
            publicReason: null,
            privateNote: null,
          });
        }
        await tx.query('update posts set pinned_at = now(), version = version + 1 where id = $1', [postId]);
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'pin',
          targetType: 'post',
          targetId: postId,
          publicReason: null,
          privateNote: null,
        });
        break;
      }
      case 'unpin': {
        if (fresh.state !== 'published' || fresh.pinned_at === null) throw conflict(fresh);
        await tx.query('update posts set pinned_at = null, version = version + 1 where id = $1', [postId]);
        entries.push({
          communityId: String(community.id),
          moderatorId: moderator.id,
          action: 'unpin',
          targetType: 'post',
          targetId: postId,
          publicReason: null,
          privateNote: null,
        });
        break;
      }
      default:
        break;
    }

    for (const entry of entries) await writeModLog(tx, entry);

    const updated = await reload(tx, postId);
    if (!updated) throw errors.notFound('Post not found');
    return { post: updated, modLogEntries: entries };
  });

  const { locked, lockedUntil } = lockState(outcome.post);
  await emitPostState({
    postId: String(outcome.post.id),
    communityName: outcome.post.community_name,
    state: outcome.post.state,
    publicReason: outcome.post.removal_reason,
    locked,
    lockedUntil,
    pinned: outcome.post.pinned_at !== null,
    version: Number(outcome.post.version),
  });

  return outcome;
}

export function modLogView(viewer: Viewer, community: Community): { isModerator: boolean; showModNames: boolean } {
  return {
    isModerator: viewer.moderatorOf.has(String(community.id)),
    showModNames: community.show_mod_names === true,
  };
}

/** A timed lock ends on the server's clock, with no client or moderator action and no log entry. */
export async function sweepExpiredLocks(): Promise<void> {
  const rows = await many<{ id: string; community_name: string; version: number; state: string; pinned_at: unknown }>(
    db,
    `update posts p set locked_at = null, locked_until = null
     where p.locked_at is not null and p.locked_until is not null and p.locked_until <= now()
     returning p.id, p.version, p.state, p.pinned_at,
       (select name from communities where id = p.community_id) as community_name`,
  );
  for (const row of rows) {
    await emitPostState({
      postId: String(row.id),
      communityName: row.community_name,
      state: row.state,
      publicReason: null,
      locked: false,
      lockedUntil: null,
      pinned: row.pinned_at !== null,
      version: Number(row.version),
    });
  }
}

