import type { PoolClient } from 'pg';
import type { SessionState } from '../../shared/wire';
import { one, run } from '../db';
import { nextState, type Move } from '../domain/lifecycle';
import { notFound } from '../errors';

/** Moves a session along a published edge inside a transaction; any other move answers its 409. */
export async function moveSession(client: PoolClient, sessionId: string, move: Move): Promise<SessionState> {
  const current = await one<{ state: SessionState }>(client, 'SELECT state FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
  if (!current) throw notFound();
  const state = nextState(current.state, move);
  await run(client, 'UPDATE sessions SET state = $2 WHERE id = $1', [sessionId, state]);
  return state;
}
