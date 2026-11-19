import type pg from 'pg';
import { ApiError } from '../shared/errors.ts';
import type { MapDoc, VersionInfo } from '../shared/model.ts';
import { snapshotOf, type Snapshot } from '../shared/snapshot.ts';
import { serverNow, toIso } from './clock.ts';
import { config, instanceId } from './config.ts';
import { database, query, withMapLock, type Db } from './db.ts';
import { Effects, emitEvent } from './groups.ts';
import { randomId } from './ids.ts';
import { loadMap, type MapRow } from './mapStore.ts';
import { ownerName } from './members.ts';
import { StorageError, getObject, putObject } from './s3.ts';
import { onTick } from './tick.ts';

/** What the version list calls a version nobody named. */
const AUTOMATIC_NAME = 'Automatic version';

interface NewVersion {
  mapId: string;
  name: string;
  kind: VersionInfo['kind'];
  by: string;
  doc: MapDoc;
  revision: number;
  /** The open transaction and its effects when the caller holds the map lock; the version is then announced live. */
  tx?: { client: pg.PoolClient; fx: Effects };
}

interface VersionRow extends Omit<VersionInfo, 'created_at'> {
  created_at: Date;
}

const VERSION_COLUMNS = 'id, number, name, kind, by_name AS "by", revision, created_at';

const describeVersion = (row: VersionRow): VersionInfo => ({ ...row, created_at: toIso(row.created_at.getTime()) });

const snapshotKey = (mapId: string, versionId: string): string => `versions/${mapId}/${versionId}.json`;

export async function listVersions(db: Db, mapId: string): Promise<VersionInfo[]> {
  const rows = await query<VersionRow>(db, `SELECT ${VERSION_COLUMNS} FROM versions WHERE map_id = $1 ORDER BY number`, [mapId]);
  return rows.map(describeVersion);
}

export async function findVersion(db: Db, mapId: string, versionId: string): Promise<VersionInfo> {
  const rows = await query<VersionRow>(db, `SELECT ${VERSION_COLUMNS} FROM versions WHERE map_id = $1 AND id = $2`, [mapId, versionId]);
  const row = rows[0];
  if (!row) throw new ApiError('not_found', 'That version no longer exists.');
  return describeVersion(row);
}

/** Read a version's snapshot object back from the object store. */
export async function readSnapshot(mapId: string, versionId: string): Promise<Snapshot> {
  return JSON.parse(new TextDecoder().decode(await getObject(snapshotKey(mapId, versionId)))) as Snapshot;
}

/**
 * Record a version: the snapshot object is written first and the version row only after the write succeeded,
 * so a failed write leaves no version. Recording a version also restarts the automatic version interval.
 */
export async function saveVersion(args: NewVersion): Promise<VersionInfo> {
  const db: Db = args.tx?.client ?? database();
  const id = randomId();
  const number = (await query<{ next: number }>(db, 'SELECT coalesce(max(number), 0) + 1 AS next FROM versions WHERE map_id = $1', [args.mapId]))[0]?.next ?? 1;
  const snapshot = snapshotOf(args.doc, { mapId: args.mapId, version: number, revision: args.revision });
  await putObject(snapshotKey(args.mapId, id), new TextEncoder().encode(JSON.stringify(snapshot)), 'application/json');
  const version: VersionInfo = { id, number, name: args.name, kind: args.kind, by: args.by, revision: args.revision, created_at: toIso(serverNow()) };
  await query(db, 'INSERT INTO versions (id, map_id, number, name, kind, by_name, revision, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
    id,
    args.mapId,
    number,
    version.name,
    version.kind,
    version.by,
    version.revision,
    version.created_at,
  ]);
  await query(db, 'UPDATE maps SET version_baseline = $2 WHERE id = $1', [args.mapId, version.created_at]);
  if (args.tx) await emitEvent(args.tx.client, args.mapId, { type: 'version', version }, 'all', null, args.tx.fx);
  return version;
}

/** Cut an automatic version of a map whose interval has run out, or just restart the interval. */
async function cutAutomaticVersion(mapId: string): Promise<void> {
  const fx = new Effects();
  await withMapLock(mapId, async (client) => {
    const map = (await loadMap(client, mapId, true)) as MapRow;
    if (serverNow() - map.version_baseline.getTime() < config.versionIntervalMs) return;
    const latest = (await query<{ revision: number }>(client, 'SELECT revision FROM versions WHERE map_id = $1 ORDER BY number DESC LIMIT 1', [mapId]))[0];
    if (map.revision !== (latest?.revision ?? 1)) {
      const last = (await query<{ author: string }>(client, 'SELECT author FROM ops_log WHERE map_id = $1 ORDER BY revision DESC LIMIT 1', [mapId]))[0];
      try {
        await saveVersion({
          mapId,
          name: AUTOMATIC_NAME,
          kind: 'auto',
          by: last?.author ?? (await ownerName(client, map.owner_id)),
          doc: map.doc,
          revision: map.revision,
          tx: { client, fx },
        });
        return;
      } catch (error) {
        if (!(error instanceof StorageError)) throw error;
      }
    }
    await query(client, 'UPDATE maps SET version_baseline = $2 WHERE id = $1', [mapId, toIso(serverNow())]);
  });
  fx.run();
}

onTick(async () => {
  const due = await query<{ id: string }>(database(), 'SELECT id FROM maps WHERE home = $2 AND version_baseline <= $1', [toIso(serverNow() - config.versionIntervalMs), instanceId]);
  for (const map of due) await cutAutomaticVersion(map.id);
});
