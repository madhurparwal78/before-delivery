import { queryOne, withTransaction, type Transaction } from '../db/pool.js';
import { generatedCourierName, newCourierId, newModerationRef, newSessionId } from '../db/ids.js';
import { STARTING_SATCHEL_ID } from '../db/seed.js';
import type { CourierRow, Role } from './couriers.js';

export interface Actor {
  sessionId: string;
  courier: CourierRow;
}

export function roleOf(actor: Actor): Role {
  return actor.courier.role;
}

/** A session that has ended or been replaced counts as no session. */
export async function resolveActor(sessionId: string | null): Promise<Actor | null> {
  if (sessionId === null) return null;
  const row = await queryOne<CourierRow & { session_id: string }>(
    `select s.session_id, c.courier_id, c.email, c.display_name, c.role, c.worn_satchel_id,
            c.name_locked, c.muted, c.emote, c.emote_at, c.moderation_ref, c.guest_claimed
     from sessions s join couriers c on c.courier_id = s.courier_id
     where s.session_id = $1 and s.ended_at is null`,
    [sessionId],
  );
  if (!row) return null;
  const { session_id: id, ...courier } = row;
  return { sessionId: id, courier };
}

export async function startSessionFor(tx: Transaction, courierId: string): Promise<string> {
  const sessionId = newSessionId();
  await tx.query('insert into sessions (session_id, courier_id) values ($1, $2)', [
    sessionId,
    courierId,
  ]);
  return sessionId;
}

/** Opening the game without a session creates a guest courier whose save lives on the server. */
export async function createGuest(): Promise<{ actor: Actor; sessionId: string }> {
  return withTransaction(async (tx) => {
    const courierId = newCourierId();
    const courier = await tx.one<CourierRow>(
      `insert into couriers (courier_id, display_name, role, worn_satchel_id, moderation_ref)
       values ($1, $2, 'guest', $3, $4)
       returning courier_id, email, display_name, role, worn_satchel_id, name_locked, muted,
                 emote, emote_at, moderation_ref, guest_claimed`,
      [courierId, generatedCourierName(), STARTING_SATCHEL_ID, newModerationRef()],
    );
    await tx.query('insert into satchels_owned (courier_id, satchel_id) values ($1, $2)', [
      courierId,
      STARTING_SATCHEL_ID,
    ]);
    const sessionId = await startSessionFor(tx, courierId);
    return { actor: { sessionId, courier: courier! }, sessionId };
  });
}

/** Ends a session and removes its heartbeats in the same step. */
export async function endSession(tx: Transaction, sessionId: string): Promise<void> {
  await tx.query('update sessions set ended_at = now() where session_id = $1', [sessionId]);
  await tx.query('delete from heartbeats where session_id = $1', [sessionId]);
}

/**
 * Issues a new session for a courier and ends the one the browser held, carrying that browser's
 * heartbeat and presence streams across in the same step.
 */
export async function rotateSession(
  tx: Transaction,
  courierId: string,
  previousSessionId: string | null,
): Promise<string> {
  const sessionId = await startSessionFor(tx, courierId);
  if (previousSessionId !== null) {
    await tx.query('update sessions set ended_at = now() where session_id = $1', [
      previousSessionId,
    ]);
    await tx.query(
      'update heartbeats set session_id = $1, courier_id = $2 where session_id = $3',
      [sessionId, courierId, previousSessionId],
    );
  }
  return sessionId;
}
