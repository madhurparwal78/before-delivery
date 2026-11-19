import { inviteCooldownEnd, now, weekStart } from '../clock.js';
import { config } from '../config.js';
import { lockKey, maybeRow, oneRow, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { conflict, notFound, tooManyRequests, validation, type HttpError } from '../errors.js';
import { newId } from '../ids.js';
import { queueMail } from '../mail.js';
import { notify } from './notify.js';
import { memberVisibleTo, notBlockedWith } from './visibility.js';

export type ConnectionState = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'withdrawn' | 'ignored';

type Action = 'connect' | 'withdraw' | 'accept' | 'ignore' | 'remove';

/** Connect from the states it can act on: a connected pair is refused and a running cooldown is refused with its retry instant. */
const CONNECT: Record<'none' | 'pending_sent' | 'pending_received' | 'ignored', ConnectionState> = {
  none: 'pending_sent',
  pending_sent: 'pending_sent',
  pending_received: 'connected',
  ignored: 'connected',
};

/** The one table of the other moves. A state missing from an action's row is refused with that action's conflict. */
const TRANSITIONS: Record<Exclude<Action, 'connect'>, Partial<Record<ConnectionState, ConnectionState>>> = {
  withdraw: { pending_sent: 'withdrawn' },
  accept: { pending_received: 'connected' },
  ignore: { pending_received: 'ignored' },
  remove: { connected: 'none' },
};

type InvitationState = 'pending' | 'accepted' | 'withdrawn' | 'ignored' | 'cancelled';

interface Invitation {
  id: string;
  sender_id: string;
  receiver_id: string;
  state: InvitationState;
  created_at: Date;
  resolved_at: Date | null;
}

interface PairView {
  connected: boolean;
  /** The latest request from the other member to the viewer. */
  incoming?: Invitation;
  /** The latest request from the viewer to the other member. */
  outgoing?: Invitation;
}

type Described = { state: Exclude<ConnectionState, 'withdrawn'> } | { state: 'withdrawn'; retryAt: Date };

function describe(view: PairView, at: Date): Described {
  const settled = (state: Exclude<ConnectionState, 'withdrawn'>): Described => ({ state });
  if (view.connected) return settled('connected');
  if (view.incoming?.state === 'pending') return settled('pending_received');
  if (view.incoming?.state === 'ignored') return settled('ignored');
  const outgoing = view.outgoing;
  if (outgoing?.state === 'pending' || outgoing?.state === 'ignored') return settled('pending_sent');
  if (outgoing?.state === 'withdrawn' && outgoing.resolved_at) {
    const retryAt = inviteCooldownEnd(outgoing.resolved_at);
    if (at < retryAt) return { state: 'withdrawn', retryAt };
  }
  return settled('none');
}

async function pairViews(db: Db, viewerId: string, otherIds: string[]): Promise<Map<string, PairView>> {
  const views = new Map<string, PairView>(otherIds.map((id) => [id, { connected: false }]));
  const connected = await rows<{ other: string }>(
    db,
    `SELECT CASE WHEN member_lo = $1 THEN member_hi ELSE member_lo END AS other
       FROM connections WHERE (member_lo = $1 AND member_hi = ANY($2)) OR (member_hi = $1 AND member_lo = ANY($2))`,
    [viewerId, otherIds],
  );
  for (const row of connected) {
    const view = views.get(row.other);
    if (view) view.connected = true;
  }
  const latest = await rows<Invitation>(
    db,
    `SELECT DISTINCT ON (sender_id, receiver_id) id, sender_id, receiver_id, state, created_at, resolved_at
       FROM invitations
      WHERE (sender_id = $1 AND receiver_id = ANY($2)) OR (receiver_id = $1 AND sender_id = ANY($2))
      ORDER BY sender_id, receiver_id, created_at DESC, id DESC`,
    [viewerId, otherIds],
  );
  for (const invitation of latest) {
    const outgoing = invitation.sender_id === viewerId;
    const view = views.get(outgoing ? invitation.receiver_id : invitation.sender_id);
    if (view) view[outgoing ? 'outgoing' : 'incoming'] = invitation;
  }
  return views;
}

/** The viewer's connection state to each member (the members must not be blocked with the viewer). */
export async function connectionStates(db: Db, viewerId: string, otherIds: string[]): Promise<Map<string, ConnectionState>> {
  const at = now();
  const views = await pairViews(db, viewerId, otherIds);
  return new Map(otherIds.map((id) => [id, describe(views.get(id) as PairView, at).state]));
}

export interface Requested {
  id: string;
  at: Date;
}

/** Members with an open request to the viewer (received) and members the viewer has an open request to (sent), outside blocks. */
export async function openRequests(db: Db, viewerId: string): Promise<{ received: Requested[]; sent: Requested[] }> {
  const involved = await rows<{ id: string }>(
    db,
    `SELECT DISTINCT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS id FROM invitations
      WHERE (sender_id = $1 OR receiver_id = $1)
        AND ${notBlockedWith('$1', 'CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END')}`,
    [viewerId],
  );
  const views = await pairViews(db, viewerId, involved.map((member) => member.id));
  const at = now();
  const received: Requested[] = [];
  const sent: Requested[] = [];
  for (const [id, view] of views) {
    const { state } = describe(view, at);
    if (state === 'pending_received' && view.incoming) received.push({ id, at: view.incoming.created_at });
    if (state === 'pending_sent' && view.outgoing) sent.push({ id, at: view.outgoing.created_at });
  }
  return { received, sent };
}

interface Counterpart {
  id: string;
  name: string;
  email: string;
}

/** The other member of an action: 404 when they do not exist or the viewer may not see them. */
async function counterpart(db: Db, viewerId: string, otherId: string): Promise<Counterpart> {
  const other = await maybeRow<Counterpart>(db, `SELECT m.id, m.name, m.email FROM members m WHERE m.id = $2 AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`, [viewerId, otherId]);
  if (!other) throw notFound();
  return other;
}

async function describePair(db: Db, viewerId: string, otherId: string): Promise<Described> {
  const view = (await pairViews(db, viewerId, [otherId])).get(otherId) as PairView;
  return describe(view, now());
}

/** Serialises everything that changes or depends on one pair of members: requests, blocks, follows, messages. */
export async function lockPair(db: Tx, a: string, b: string): Promise<void> {
  await lockKey(db, `pair:${[a, b].sort().join(':')}`);
}

async function lockPairs(tx: Tx, viewerId: string, otherIds: string[]): Promise<void> {
  const sorted = [...otherIds].sort();
  for (const other of sorted) await lockPair(tx, viewerId, other);
}

function announce(tx: Tx, a: string, b: string): void {
  publishAfterCommit(tx, 'all', { type: 'graph' });
  publishAfterCommit(tx, [a, b], { type: 'network' });
}

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

interface Actor {
  id: string;
  name: string;
  handle: string;
}

async function actorOf(db: Db, viewerId: string): Promise<Actor> {
  return oneRow<Actor>(db, 'SELECT id, name, handle FROM members WHERE id = $1', [viewerId]);
}

/** Turns the other member's open request into a connection; the original sender is told. */
async function acceptRequest(tx: Tx, sender: Counterpart, accepter: Actor): Promise<void> {
  const at = now();
  const [lo, hi] = pairOf(sender.id, accepter.id);
  await tx.query(`UPDATE invitations SET state = 'accepted', resolved_at = $3 WHERE sender_id = $1 AND receiver_id = $2 AND state IN ('pending', 'ignored')`, [sender.id, accepter.id, at]);
  await tx.query('INSERT INTO connections (member_lo, member_hi, connected_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [lo, hi, at]);
  await queueMail(tx, {
    to: sender.email,
    subject: `${accepter.name} accepted your invitation`,
    text: `${accepter.name} accepted your invitation to connect on Plainwork.\n\nYou are now connected.\n`,
  });
  await notify(tx, { memberId: sender.id, kind: 'invitation_accepted', actorId: accepter.id });
  publishAfterCommit(tx, [sender.id], { type: 'connected', member: { id: accepter.id, name: accepter.name, handle: accepter.handle } });
  announce(tx, sender.id, accepter.id);
}

interface ConnectResult {
  status: 200 | 201;
  state: ConnectionState;
}

/** Connect: a new request, a repeat, or the acceptance of the other member's request. */
export async function connect(tx: Tx, viewerId: string, otherId: string): Promise<ConnectResult> {
  await lockPairs(tx, viewerId, [otherId]);
  const other = await counterpart(tx, viewerId, otherId);
  const described = await describePair(tx, viewerId, other.id);
  if (described.state === 'connected') throw conflict('already_connected');
  if (described.state === 'withdrawn') throw conflict('invite_cooldown', { retry_at: described.retryAt.toISOString() });
  if (other.id === viewerId) throw validation({ member_id: "You can't connect with yourself." });
  const state = described.state;
  const next = CONNECT[state];
  if (state === 'pending_sent') return { status: 200, state: next };
  const viewer = await actorOf(tx, viewerId);
  if (next === 'connected') {
    await acceptRequest(tx, other, viewer);
    return { status: 200, state: next };
  }
  // The weekly count spans every receiver, so requests from one sender to different members queue here too.
  await lockKey(tx, `invites:${viewerId}`);
  const at = now();
  const sentThisWeek = await oneRow<{ count: number }>(tx, 'SELECT count(*)::int AS count FROM invitations WHERE sender_id = $1 AND created_at > $2', [viewerId, weekStart(at)]);
  if (sentThisWeek.count >= config.weeklyInvites) throw tooManyRequests('weekly_invite_limit', { limit: config.weeklyInvites });
  await tx.query(`INSERT INTO invitations (id, sender_id, receiver_id, state, created_at) VALUES ($1, $2, $3, 'pending', $4)`, [newId(), viewerId, other.id, at]);
  await queueMail(tx, {
    to: other.email,
    subject: `${viewer.name} wants to connect on Plainwork`,
    text: `${viewer.name} wants to connect with you on Plainwork.\n\nOpen My network to accept or ignore the invitation.\n`,
  });
  await notify(tx, { memberId: other.id, kind: 'invitation_received', actorId: viewerId });
  announce(tx, viewerId, other.id);
  return { status: 201, state: next };
}

/** The move an action makes from the pair's current state, or the action's own conflict. */
function moveFor(action: Exclude<Action, 'connect'>, state: ConnectionState): ConnectionState {
  const next = TRANSITIONS[action][state];
  if (next === undefined) throw conflict(action === 'remove' ? 'no_connection' : 'no_pending_request');
  return next;
}

interface Withdrawn {
  member_id: string;
  state: ConnectionState;
  retry_at: string;
}

/**
 * Withdraws the viewer's request to each named member at one business-clock instant, or to none of them. `refuse`
 * builds the conflict for the first member without a pending request.
 */
export async function withdraw(tx: Tx, viewerId: string, otherIds: string[], refuse: (memberId: string) => HttpError): Promise<Withdrawn[]> {
  await lockPairs(tx, viewerId, otherIds);
  const others: Counterpart[] = [];
  for (const otherId of otherIds) others.push(await counterpart(tx, viewerId, otherId));
  const at = now();
  const moves: Withdrawn[] = [];
  for (const other of others) {
    const { state } = await describePair(tx, viewerId, other.id);
    const next = TRANSITIONS.withdraw[state];
    if (next === undefined) throw refuse(other.id);
    moves.push({ member_id: other.id, state: next, retry_at: inviteCooldownEnd(at).toISOString() });
  }
  for (const move of moves) {
    await tx.query(`UPDATE invitations SET state = 'withdrawn', resolved_at = $3 WHERE sender_id = $1 AND receiver_id = $2 AND state IN ('pending', 'ignored')`, [viewerId, move.member_id, at]);
    announce(tx, viewerId, move.member_id);
  }
  return moves;
}

export async function accept(tx: Tx, viewerId: string, otherId: string): Promise<ConnectionState> {
  await lockPairs(tx, viewerId, [otherId]);
  const other = await counterpart(tx, viewerId, otherId);
  const next = moveFor('accept', (await describePair(tx, viewerId, other.id)).state);
  await acceptRequest(tx, other, await actorOf(tx, viewerId));
  return next;
}

export async function ignore(tx: Tx, viewerId: string, otherId: string): Promise<ConnectionState> {
  await lockPairs(tx, viewerId, [otherId]);
  const other = await counterpart(tx, viewerId, otherId);
  const next = moveFor('ignore', (await describePair(tx, viewerId, other.id)).state);
  await tx.query(`UPDATE invitations SET state = 'ignored', resolved_at = $3 WHERE sender_id = $2 AND receiver_id = $1 AND state = 'pending'`, [viewerId, other.id, now()]);
  announce(tx, viewerId, other.id);
  return next;
}

export async function remove(tx: Tx, viewerId: string, otherId: string): Promise<ConnectionState> {
  await lockPairs(tx, viewerId, [otherId]);
  const other = await counterpart(tx, viewerId, otherId);
  const next = moveFor('remove', (await describePair(tx, viewerId, other.id)).state);
  const [lo, hi] = pairOf(viewerId, other.id);
  await tx.query('DELETE FROM connections WHERE member_lo = $1 AND member_hi = $2', [lo, hi]);
  announce(tx, viewerId, other.id);
  return next;
}

/**
 * Block, from any state: ends the connection, cancels open requests both ways (the sender's weekly count is not
 * refunded) and deletes follows both ways, in the caller's transaction. Returns false when already blocked.
 */
export async function block(tx: Tx, viewerId: string, otherId: string): Promise<boolean> {
  await lockPairs(tx, viewerId, [otherId]);
  if (await maybeRow(tx, 'SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [viewerId, otherId])) return false;
  const other = await counterpart(tx, viewerId, otherId);
  if (other.id === viewerId) throw validation({ member_id: "You can't block yourself." });
  const at = now();
  const [lo, hi] = pairOf(viewerId, other.id);
  await tx.query('DELETE FROM connections WHERE member_lo = $1 AND member_hi = $2', [lo, hi]);
  await tx.query(
    `UPDATE invitations SET state = 'cancelled', resolved_at = $3
      WHERE state IN ('pending', 'ignored') AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
    [viewerId, other.id, at],
  );
  await tx.query('DELETE FROM follows WHERE (follower_id = $1 AND target_id = $2) OR (follower_id = $2 AND target_id = $1)', [viewerId, other.id]);
  await tx.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3)', [viewerId, other.id, at]);
  announce(tx, viewerId, other.id);
  return true;
}

/** Unblock returns the pair to no connection; the blocker may unblock a member who is otherwise invisible. */
export async function unblock(tx: Tx, viewerId: string, otherId: string): Promise<void> {
  if (!(await maybeRow(tx, 'SELECT 1 FROM members WHERE id = $1', [otherId]))) throw notFound();
  await lockPairs(tx, viewerId, [otherId]);
  const removed = await tx.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [viewerId, otherId]);
  if (removed.rowCount) announce(tx, viewerId, otherId);
}

/** The members the viewer blocked, newest first. */
export async function blockedMembers(db: Db, viewerId: string): Promise<Array<{ id: string; name: string; handle: string; blocked_at: Date }>> {
  return rows(
    db,
    `SELECT m.id, m.name, m.handle, b.created_at AS blocked_at FROM blocks b JOIN members m ON m.id = b.blocked_id
      WHERE b.blocker_id = $1 ORDER BY b.created_at DESC, m.id`,
    [viewerId],
  );
}
