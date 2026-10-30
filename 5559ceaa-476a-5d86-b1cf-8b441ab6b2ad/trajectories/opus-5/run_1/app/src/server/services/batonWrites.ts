import type { Session } from '../../shared/api.js';
import { tx, type Queryable } from '../db.js';
import { checkBatonChange } from '../domain/baton.js';
import { nextSessionState, type SessionAction } from '../domain/sessions.js';
import { forbidden, notFound, sessionAlreadyLive, validation } from '../http/errors.js';
import { sessionView, soleRow, type SessionRow } from '../repository.js';
import { publish } from './bus.js';

const SESSION_COLUMNS = 'id, project_id, title, state, scheduled_for, driver_id, version';

async function lockSession(client: Queryable, sessionId: string): Promise<SessionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw notFound();
  const { rows } = await client.query<SessionRow>(
    `select ${SESSION_COLUMNS} from project_sessions where id = $1 for update`,
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row;
}

async function store(
  client: Queryable,
  sessionId: string,
  patch: { state?: string; driverId?: string | null; bumpVersion: boolean },
): Promise<SessionRow> {
  const { rows } = await client.query<SessionRow>(
    `update project_sessions
        set state = coalesce($2, state),
            driver_id = case when $4 then $3 else driver_id end,
            version = version + case when $5 then 1 else 0 end
      where id = $1
      returning ${SESSION_COLUMNS}`,
    [
      sessionId,
      patch.state ?? null,
      patch.driverId ?? null,
      patch.driverId !== undefined,
      patch.bumpVersion,
    ],
  );
  return soleRow(rows);
}

async function announce(session: SessionRow): Promise<Session> {
  const view = sessionView(session);
  await publish({ project_id: session.project_id, frame: { type: 'session', session: view } });
  return view;
}

export async function moveSession(
  sessionId: string,
  mentorId: string,
  action: SessionAction,
): Promise<Session> {
  const updated = await tx(async (client) => {
    const current = await lockSession(client, sessionId);
    const to = nextSessionState(current.state, action);
    if (action === 'start') {
      const { rows } = await client.query<{ id: string }>(
        `select id from project_sessions
          where project_id = $1 and state in ('live', 'paused') and id <> $2 limit 1`,
        [current.project_id, sessionId],
      );
      const other = rows[0];
      if (other !== undefined) throw sessionAlreadyLive(other.id);
      return store(client, sessionId, { state: to, driverId: mentorId, bumpVersion: true });
    }
    if (action === 'end') {
      return store(client, sessionId, { state: to, driverId: null, bumpVersion: true });
    }
    return store(client, sessionId, { state: to, bumpVersion: false });
  });
  return announce(updated);
}

async function batonState(client: Queryable, sessionId: string) {
  const current = await lockSession(client, sessionId);
  const { rows } = await client.query<{ name: string }>('select name from users where id = $1', [
    current.driver_id,
  ]);
  const driverName = rows[0]?.name;
  return {
    current,
    baton: {
      state: current.state,
      version: current.version,
      driver:
        current.driver_id === null || driverName === undefined
          ? null
          : { id: current.driver_id, name: driverName },
    },
  };
}

export async function claimBaton(
  sessionId: string,
  claimantId: string,
  version: number,
): Promise<Session> {
  const updated = await tx(async (client) => {
    const { current, baton } = await batonState(client, sessionId);
    checkBatonChange(baton, version, claimantId);
    return store(client, current.id, { driverId: claimantId, bumpVersion: true });
  });
  return announce(updated);
}

export async function passBaton(
  sessionId: string,
  actorId: string,
  toUserId: string,
  version: number,
): Promise<Session> {
  const updated = await tx(async (client) => {
    const { current, baton } = await batonState(client, sessionId);
    const { rows } = await client.query<{ owner_id: string }>(
      'select owner_id from projects where id = $1',
      [current.project_id],
    );
    const ownerId = rows[0]?.owner_id;
    if (actorId !== ownerId && actorId !== current.driver_id) {
      throw forbidden('Only the mentor or the current driver may pass the baton.');
    }
    const target = await client.query<{ one: number }>(
      `select 1 as one from memberships where project_id = $1 and user_id = $2`,
      [current.project_id, toUserId],
    );
    if (target.rows.length === 0) {
      throw validation({ to_user_id: 'Pass the baton to a participant of this project.' });
    }
    checkBatonChange(baton, version, toUserId);
    return store(client, current.id, { driverId: toUserId, bumpVersion: true });
  });
  return announce(updated);
}

/** Returns the baton to the mentor when the holder loses their seat. */
export async function returnBatonToMentor(
  client: Queryable,
  projectId: string,
  leavingUserId: string,
): Promise<SessionRow | null> {
  const { rows } = await client.query<SessionRow>(
    `update project_sessions ps
        set driver_id = p.owner_id, version = ps.version + 1
       from projects p
      where p.id = ps.project_id and ps.project_id = $1
        and ps.state in ('live', 'paused') and ps.driver_id = $2
      returning ps.id, ps.project_id, ps.title, ps.state, ps.scheduled_for,
                ps.driver_id, ps.version`,
    [projectId, leavingUserId],
  );
  return rows[0] ?? null;
}

export async function announceSession(session: SessionRow): Promise<void> {
  await announce(session);
}
