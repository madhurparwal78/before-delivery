import { pool, isUuid } from "./db";
import { notFound, StorageUnavailable } from "./errors";
import type { Reply } from "./http";
import { getObject, rasterKey, strokeKey } from "./storage";
import {
  OBSERVATION_SELECT,
  SESSION_SELECT,
  observationRow,
  observationView,
  sessionView,
  type ObservationRow,
  type SessionRow,
} from "./views";
import { loadPrograms, programViews } from "./views";

export async function listObjects(): Promise<Reply> {
  const { rows } = await pool.query("SELECT id, designation, name, kind FROM catalogue_objects ORDER BY position");
  return { status: 200, body: { objects: rows } };
}

export async function objectHistory(accountId: string, objectId: string): Promise<Reply> {
  const object = (await pool.query("SELECT id, designation, name, kind FROM catalogue_objects WHERE id = $1", [objectId])).rows[0];
  if (!object) throw notFound();
  const { rows } = await pool.query<ObservationRow>(
    `${OBSERVATION_SELECT} WHERE o.account_id = $1 AND o.object_id = $2 AND NOT o.deleted
     ORDER BY o.observed_at DESC NULLS LAST, o.created_seq DESC`,
    [accountId, objectId],
  );
  return { status: 200, body: { object, observations: rows.map(observationView) } };
}

export async function listSessions(accountId: string): Promise<Reply> {
  const { rows } = await pool.query<SessionRow>(`${SESSION_SELECT} WHERE s.account_id = $1 ORDER BY s.started_at DESC, s.seq DESC`, [accountId]);
  return { status: 200, body: { sessions: rows.map(sessionView) } };
}

export async function getSession(accountId: string, id: string): Promise<Reply> {
  if (!isUuid(id)) throw notFound();
  const session = (await pool.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1 AND s.account_id = $2`, [id, accountId])).rows[0];
  if (!session) throw notFound();
  const { rows } = await pool.query<ObservationRow>(
    `${OBSERVATION_SELECT} WHERE o.session_id = $1 AND NOT o.deleted ORDER BY o.created_seq`,
    [id],
  );
  return { status: 200, body: { ...sessionView(session), observations: rows.map(observationView) } };
}

async function ownedObservation(accountId: string, id: string): Promise<ObservationRow> {
  if (!isUuid(id)) throw notFound();
  const row = await observationRow(pool, id, accountId);
  if (!row || row.deleted) throw notFound();
  return row;
}

export async function getObservation(accountId: string, id: string): Promise<Reply> {
  return { status: 200, body: observationView(await ownedObservation(accountId, id)) };
}

export async function getStrokes(accountId: string, id: string): Promise<Reply> {
  const row = await ownedObservation(accountId, id);
  if (!row.sketch) throw notFound();
  const data = await getObject(strokeKey(accountId, row.id, row.sketch.strokes_sha256));
  if (!data) throw new StorageUnavailable();
  return { status: 200, raw: { data, type: "application/json" } };
}

export async function getRaster(accountId: string, id: string): Promise<Reply> {
  const row = await ownedObservation(accountId, id);
  if (!row.sketch?.has_raster || !row.raster_sha) throw notFound();
  const data = await getObject(rasterKey(accountId, row.id, row.raster_sha));
  if (!data) throw new StorageUnavailable();
  return { status: 200, raw: { data, type: "image/png" } };
}

export async function listPrograms(accountId: string): Promise<Reply> {
  const views = await programViews(pool, accountId);
  return { status: 200, body: { programs: views.map(({ objects: _objects, ...program }) => program) } };
}

export async function getProgram(accountId: string, id: string): Promise<Reply> {
  const program = (await programViews(pool, accountId)).find((p) => p.id === id);
  if (!program) throw notFound();
  return { status: 200, body: program };
}

export async function setFollow(accountId: string, id: string, following: boolean): Promise<Reply> {
  if (!(await loadPrograms(pool, id)).length) throw notFound();
  if (following) {
    await pool.query("INSERT INTO follows (account_id, program_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [accountId, id]);
  } else {
    await pool.query("DELETE FROM follows WHERE account_id = $1 AND program_id = $2", [accountId, id]);
  }
  return { status: 200, body: { following } };
}
