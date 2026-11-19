import { copy } from '../shared/copy.js';
import {
  connectionsFor,
  pendingPresenceRemovals,
  publish,
  sendTo,
  sendToAudience,
} from './bus.js';
import { now, nowMs, serverDate } from './clock.js';
import { db } from './db.js';
import { advanceExports } from './exports.js';
import { broadcastPresence, publishFollowers } from './live.js';
import { audiencePayload } from './routes/presentations.js';
import { loadMap } from './mapstore.js';
import { settings } from './settings.js';
import { endLinkSessions } from './routes/share.js';
import { cutAutomaticVersion } from './versions.js';
import { StorageError } from './storage.js';

let lastDate = serverDate();

async function expireSessions(): Promise<void> {
  const due = await db.query<{ id: string; username: string }>(
    `select s.id, u.username from sessions s join users u on u.id = s.user_id
      where s.expires_at <= $1 and not s.expired_sent`,
    [now()],
  );
  for (const row of due.rows) {
    await db.query('update sessions set expired_sent = true where id = $1', [row.id]);
    for (const mapId of await mapsWithActor(row.username)) {
      for (const conn of connectionsFor(mapId)) {
        if (conn.actorKey === row.username) {
          sendTo(conn, { seq: 0, type: 'session_expired', message: copy.sessionDialogText });
        }
      }
    }
  }
}

async function mapsWithActor(actorKey: string): Promise<string[]> {
  const result = await db.query<{ map_id: string }>(
    `select distinct map_id from (
        select m.id as map_id from maps m join users u on u.id = m.owner_id where u.username = $1
        union select map_id from members where username = $1
      ) owned`,
    [actorKey],
  );
  return result.rows.map((row) => row.map_id);
}

async function expireLinks(): Promise<void> {
  const due = await db.query<{ id: string; map_id: string }>(
    "select id, map_id from share_links where state = 'active' and expires_at is not null and expires_at <= $1",
    [now()],
  );
  for (const row of due.rows) {
    await db.query("update share_links set state = 'expired' where id = $1", [row.id]);
    await endLinkSessions(row.map_id, row.id, 'link_expired');
  }
}

async function pausePresenters(): Promise<void> {
  const due = await db.query<{ id: string; map_id: string; code: string; slide_index: number; presenter: string }>(
    `select id, map_id, code, slide_index, presenter from presentations
      where state = 'live' and disconnected_at is not null and disconnected_at <= $1`,
    [new Date(nowMs() - settings.presenterGraceMs)],
  );
  for (const row of due.rows) {
    const stillHere = connectionsFor(row.map_id).some(
      (conn) => conn.actorName === row.presenter,
    );
    if (stillHere) {
      await db.query('update presentations set disconnected_at = null where id = $1', [row.id]);
      continue;
    }
    await db.query("update presentations set state = 'paused' where id = $1", [row.id]);
    await publishFollowers(row.code);
    sendToAudience(row.code, { seq: 0, type: 'presentation', ...(await audiencePayload(row.code)) });
  }
}

async function cutVersions(): Promise<void> {
  const due = await db.query<{ map_id: string; last_revision: number }>(
    'select map_id, last_revision from version_baselines where baseline <= $1',
    [new Date(nowMs() - settings.versionIntervalMs)],
  );
  for (const row of due.rows) {
    const map = await loadMap(db, row.map_id);
    if (!map) continue;
    if (map.revision === row.last_revision) {
      await db.query('update version_baselines set baseline = $2 where map_id = $1', [
        row.map_id,
        now(),
      ]);
      continue;
    }
    try {
      await cutAutomaticVersion(map);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      await db.query('update version_baselines set baseline = $2 where map_id = $1', [
        row.map_id,
        now(),
      ]);
    }
  }
}

async function removePresence(): Promise<void> {
  for (const gone of pendingPresenceRemovals(settings.presenceTimeoutMs)) {
    await broadcastPresence(gone.mapId);
  }
}

async function announceDateChange(): Promise<void> {
  const today = serverDate();
  if (today === lastDate) return;
  lastDate = today;
  const maps = await db.query<{ id: string }>('select id from maps');
  for (const row of maps.rows) {
    await publish(row.id, { type: 'derived', payload: { server_date: today } });
  }
}

/** Re-evaluates every deadline on server time. */
export async function tick(): Promise<void> {
  await expireSessions();
  await expireLinks();
  await pausePresenters();
  await cutVersions();
  await removePresence();
  await advanceExports();
  await announceDateChange();
}

export function startTicker(): void {
  setInterval(() => {
    void tick().catch((error: unknown) => {
      process.stderr.write(`tick failed: ${String(error)}\n`);
    });
  }, 1000);
}
