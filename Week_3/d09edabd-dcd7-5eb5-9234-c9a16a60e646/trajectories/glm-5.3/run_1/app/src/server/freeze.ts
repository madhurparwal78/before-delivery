import { pool } from './db.js';
import { uid, uid32 } from './ids.js';
import { getObject, putObject, deleteObject, minioAvailable } from './minio.js';
import { chainSorted, nodeJson, placementJson, roomNodes, roomPlacements, roomStats } from './room-service.js';
import { lengthJson } from '../shared/units.js';
import { config } from './config.js';
import type { Version } from '../shared/types.js';

interface Freezer {
  id: string;
  displayName: string;
}

export interface FreezeResult {
  ok: boolean;
  version?: Version;
  superseded?: Version | null;
}

/**
 * The freeze's all-or-nothing write: version records, placement/node copies,
 * the snapshot object, byte-for-byte copies of each placed prop file and the
 * build-pack link together, or none of them.
 */
export async function freezeRoom(roomId: string, _freezer: Freezer, label: string): Promise<FreezeResult> {
  if (!minioAvailable()) return { ok: false };

  const client = await pool.connect();
  const writtenObjects: string[] = [];
  const versionId = uid();
  let createdVersion = false;
  try {
    await client.query('BEGIN');

    // Gap-free numbering under concurrency: lock the room row.
    await client.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
    const maxRow = await client.query(`SELECT coalesce(max(number),0) AS n FROM versions WHERE room_id = $1`, [roomId]);
    const number = Number(maxRow.rows[0].n) + 1;

    const [roomRow, rawPlacements, rawNodes] = await Promise.all([
      client.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]),
      roomPlacements(roomId),
      roomNodes(roomId),
    ]);
    // rows to the published json shape
    const placements = (rawPlacements as unknown as Array<Record<string, unknown>>).map((r) => placementJson(r));
    const nodes = rawNodes as unknown as Array<Record<string, unknown>>;
    const room = roomRow.rows[0];
    const stats = await roomStats(roomId);

    await client.query(
      `INSERT INTO versions (id, room_id, number, label, state, stats) VALUES ($1,$2,$3,$4,'frozen',$5)`,
      [versionId, roomId, number, label, JSON.stringify(stats)]
    );
    createdVersion = true;

    // supersede the previous frozen version (n-1 gets successor n)
    const prev = await client.query(
      `SELECT id FROM versions WHERE room_id = $1 AND state = 'frozen' AND id <> $2`,
      [roomId, versionId]
    );
    let supersededVersion: Version | null = null;
    if (prev.rows.length) {
      await client.query(`UPDATE versions SET state = 'superseded', superseded_by = $2 WHERE id = $1`, [prev.rows[0].id, number]);
      const supRow = await client.query(
        `SELECT v.*, NULL AS pack_token FROM versions v WHERE v.id = $1`,
        [prev.rows[0].id]
      );
      const tokenRow = await client.query(`SELECT token FROM build_tokens WHERE version_id = $1 AND revoked = false`, [prev.rows[0].id]);
      if (tokenRow.rows.length) supRow.rows[0].pack_token = tokenRow.rows[0].token;
      supersededVersion = versionFrom(supRow.rows[0]);
    }

    for (const p of placements) {
      await client.query(
        `INSERT INTO version_placements (version_id, placement_id, data) VALUES ($1,$2,$3)`,
        [versionId, p.id, JSON.stringify(p)]
      );
    }
    const orderedNodes = chainSorted(nodes as unknown as Record<string, unknown>[]).map((n) => nodeJson(n as unknown as Record<string, unknown>));
    for (const n of orderedNodes) {
      await client.query(
        `INSERT INTO version_nodes (version_id, node_id, data) VALUES ($1,$2,$3)`,
        [versionId, n.id, JSON.stringify(n)]
      );
    }
    await client.query(
      `INSERT INTO version_scene (version_id, scene_order, room_json) VALUES ($1,$2,$3)`,
      [versionId, room.scene_order, JSON.stringify({ name: room.name, widthMm: room.width_mm, depthMm: room.depth_mm, heightMm: room.height_mm })]
    );

    // snapshot object (build-pack JSON)
    const placementsData = placements.map((p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      propId: p.propId,
      entry: p.entry,
      x: lengthJson(p.xMm), y: lengthJson(p.yMm), z: lengthJson(p.zMm),
      width: lengthJson(p.widthMm), depth: lengthJson(p.depthMm), height: lengthJson(p.heightMm),
      rotationDeg: p.rotationDeg,
    }));
    const titleOf = new Map<string, string>(orderedNodes.map((n) => [n.id, n.title]));
    const nodesData = orderedNodes.map((n) => ({
      title: n.title,
      kind: n.kind,
      needs: n.prerequisites.map((p: string) => titleOf.get(p) ?? p),
      linkedPlacement: placements.find((p) => p.id === n.placementId)?.label ?? null,
      answer: n.answer,
    }));
    const propIds = [...new Set(placements.filter((p) => p.propId).map((p) => p.propId as string))];
    const propRows = propIds.length
      ? await client.query(`SELECT * FROM props WHERE id = ANY($1)`, [propIds])
      : { rows: [] as Record<string, unknown>[] };
    const propsData = propRows.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      bytes: Number(r.bytes),
      sha256: r.sha256 as string,
      downloadPath: '',
    }));

    // link token (created before commit so packUrl is complete)
    const token = uid32();
    await client.query(`INSERT INTO build_tokens (token, version_id) VALUES ($1,$2)`, [token, versionId]);

    const snapshot = {
      version: { number, label, state: 'frozen', frozenAt: new Date().toISOString(), supersededBy: null },
      room: { name: room.name, width: lengthJson(room.width_mm), depth: lengthJson(room.depth_mm), height: lengthJson(room.height_mm) },
      placements: placementsData,
      nodes: nodesData,
      props: propsData.map((p) => ({ ...p, downloadPath: `/api/pack/${token}/props/${p.id}` })),
      stats,
    };

    await client.query('COMMIT');

    // MinIO writes after commit; on failure, roll the DB back by deleting what we wrote.
    try {
      await putObject(`versions/${versionId}/snapshot.json`, Buffer.from(JSON.stringify(snapshot)), 'application/json');
      writtenObjects.push(`versions/${versionId}/snapshot.json`);
      for (const r of propRows.rows) {
        const ext = (r.content_type as string) === 'model/gltf-binary' ? 'glb' : 'gltf';
        const bytes = await getObject(`props/${r.id}.${ext}`);
        if (bytes === null) throw new Error('missing prop object');
        await putObject(`versions/${versionId}/props/${r.id}.${ext}`, bytes, r.content_type as string);
        writtenObjects.push(`versions/${versionId}/props/${r.id}.${ext}`);
      }
    } catch {
      for (const key of writtenObjects) await deleteObject(key);
      await client.query('BEGIN');
      await client.query(`DELETE FROM versions WHERE id = $1`, [versionId]);
      if (supersededVersion) {
        await client.query(`UPDATE versions SET state = 'frozen', superseded_by = NULL WHERE id = $1`, [supersededVersion.id]);
      }
      await client.query('COMMIT');
      return { ok: false };
    }

    const vRow = await pool.query(`SELECT v.*, $2 AS pack_token FROM versions v WHERE v.id = $1`, [versionId, token]);
    return { ok: true, version: versionFrom(vRow.rows[0]), superseded: supersededVersion };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    for (const key of writtenObjects) await deleteObject(key);
    if (createdVersion) {
      await pool.query(`DELETE FROM versions WHERE id = $1`, [versionId]).catch(() => undefined);
    }
    return { ok: false };
  } finally {
    try { client.release(); } catch { /* already released */ }
  }
}

function versionFrom(row: Record<string, unknown>): Version {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    number: Number(row.number),
    label: row.label as string,
    state: row.state as Version['state'],
    supersededBy: row.superseded_by === null || row.superseded_by === undefined ? null : Number(row.superseded_by),
    frozenAt: new Date(row.frozen_at as Date).toISOString(),
    stats: row.stats as Version['stats'],
    packUrl: row.pack_token ? `${config.publicUrl}/pack/${row.pack_token}` : null,
  };
}
