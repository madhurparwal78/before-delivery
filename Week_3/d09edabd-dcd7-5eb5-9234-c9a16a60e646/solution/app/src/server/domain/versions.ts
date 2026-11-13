import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db.js';
import { config } from '../config.js';
import { notFound } from '../errors.js';
import { lengthOf } from '../../shared/units.js';
import type { Stats } from '../../shared/format.js';
import type { Pack, Placement, TriggerNode, Version } from '../../shared/types.js';
import { extensionOf, type PropRow } from './props.js';
import { listNodes, listPlacements, roomStats, type RoomRow } from './rooms.js';

export interface VersionRow {
  id: string;
  room_id: string;
  number: number;
  label: string;
  state: 'frozen' | 'superseded';
  superseded_by: number | null;
  frozen_at: Date;
  stats: Stats;
  content: Frozen;
  pack_token: string | null;
}

export interface FrozenProp {
  id: string;
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

/** What a freeze keeps: enough to restore the room, and the pack document readers see. */
export interface Frozen {
  room: { name: string; widthMm: number; depthMm: number; heightMm: number };
  placements: Placement[];
  nodes: (TriggerNode & { seq: number })[];
  sceneOrder: string[];
  props: FrozenProp[];
  snapshot: Snapshot;
}

type Snapshot = Omit<Pack, 'version' | 'props'> & {
  version: { number: number; label: string; frozenAt: string };
  props: { id: string; name: string; bytes: number; sha256: string }[];
};

export const newPackToken = (): string => randomBytes(24).toString('base64url');

export const toVersion = (row: VersionRow): Version => ({
  id: row.id, roomId: row.room_id, number: row.number, label: row.label, state: row.state, supersededBy: row.superseded_by,
  frozenAt: row.frozen_at.toISOString(), stats: row.stats, packUrl: row.pack_token ? `${config.publicOrigin}/pack/${row.pack_token}` : null,
});

export const snapshotKey = (versionId: string): string => `versions/${versionId}/snapshot.json`;
export const copyKey = (versionId: string, prop: Pick<FrozenProp, 'id' | 'contentType'>): string => `versions/${versionId}/props/${prop.id}.${extensionOf(prop.contentType)}`;

/** Gathers the room as it stands now. */
export async function freezeRoom(db: Queryable, room: RoomRow, number: number, label: string, frozenAt: Date): Promise<Frozen> {
  const placements = await listPlacements(db, room.id);
  const chain = await listNodes(db, room.id);
  const seqs = await db.query<{ id: string; seq: string }>(`SELECT id, seq FROM nodes WHERE room_id = $1`, [room.id]);
  const seqOf = new Map(seqs.rows.map((row) => [row.id, Number(row.seq)]));
  const propIds = [...new Set(placements.flatMap((p) => (p.propId ? [p.propId] : [])))];
  const propRows = propIds.length ? (await db.query<PropRow>(`SELECT * FROM props WHERE id = ANY($1::uuid[])`, [propIds])).rows : [];
  const props: FrozenProp[] = propRows.map((p) => ({ id: p.id, name: p.name, contentType: p.content_type, bytes: p.bytes, sha256: p.sha256 }));
  const stats = await roomStats(db, room.id);
  const byId = new Map(placements.map((p) => [p.id, p]));
  const titles = new Map(chain.map((n) => [n.id, n.title]));
  return {
    room: { name: room.name, widthMm: room.width_mm, depthMm: room.depth_mm, heightMm: room.height_mm },
    placements,
    nodes: chain.map((n) => ({ ...n, seq: seqOf.get(n.id) ?? 0 })),
    sceneOrder: room.scene_order,
    props,
    snapshot: {
      version: { number, label, frozenAt: frozenAt.toISOString() },
      room: { name: room.name, width: lengthOf(room.width_mm), depth: lengthOf(room.depth_mm), height: lengthOf(room.height_mm) },
      placements: placements.map((p) => ({
        id: p.id, kind: p.kind, label: p.label, propId: p.propId, entry: p.entry,
        x: lengthOf(p.xMm), y: lengthOf(p.yMm), z: lengthOf(p.zMm), width: lengthOf(p.widthMm), depth: lengthOf(p.depthMm), height: lengthOf(p.heightMm),
        rotationDeg: p.rotationDeg,
      })),
      nodes: chain.map((n) => ({
        title: n.title, kind: n.kind, needs: n.prerequisites.map((id) => titles.get(id) ?? ''),
        linkedPlacement: n.placementId ? (byId.get(n.placementId)?.label ?? null) : null, answer: n.answer,
      })),
      props: props.map((p) => ({ id: p.id, name: p.name, bytes: p.bytes, sha256: p.sha256 })),
      stats,
    },
  };
}

/** The pack readers see: the frozen snapshot, plus the version's state and this link's download paths. */
export function packOf(row: VersionRow): Pack {
  const { snapshot } = row.content;
  return {
    version: { number: row.number, label: row.label, state: row.state, frozenAt: snapshot.version.frozenAt, supersededBy: row.superseded_by },
    room: snapshot.room,
    placements: snapshot.placements,
    nodes: snapshot.nodes,
    props: snapshot.props.map((p) => ({ ...p, downloadPath: `/api/pack/${row.pack_token}/props/${p.id}` })),
    stats: snapshot.stats,
  };
}

export async function findVersion(db: Queryable, workspaceId: string, versionId: string, lock = false): Promise<VersionRow & { workspace_id: string }> {
  const found = await db.query<VersionRow & { workspace_id: string }>(
    `SELECT v.*, r.workspace_id FROM versions v JOIN rooms r ON r.id = v.room_id WHERE v.id = $1 AND r.workspace_id = $2${lock ? ' FOR UPDATE OF v' : ''}`,
    [versionId, workspaceId],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export async function findByToken(db: Queryable, token: string): Promise<VersionRow> {
  const found = await db.query<VersionRow>(`SELECT * FROM versions WHERE pack_token = $1`, [token]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}
