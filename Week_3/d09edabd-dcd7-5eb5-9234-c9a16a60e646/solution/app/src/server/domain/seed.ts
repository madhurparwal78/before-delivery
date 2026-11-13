import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db.js';
import type { StarterRoom } from '../../shared/starters.js';

/** Writes one room with its placements and nodes; the first door is the entry door. Returns the room id. */
export async function insertRoom(db: Queryable, workspaceId: string, room: StarterRoom): Promise<string> {
  const roomId = randomUUID();
  const ids = new Map<string, string>();
  const order: string[] = [];
  await db.query(
    `INSERT INTO rooms (id, workspace_id, name, starter, width_mm, depth_mm, height_mm, scene_order) VALUES ($1,$2,$3,$4,$5,$6,$7,'[]')`,
    [roomId, workspaceId, room.name, room.starter, ...room.size],
  );
  let entryGiven = false;
  for (const p of room.placements) {
    const id = randomUUID();
    ids.set(p.label, id);
    order.push(id);
    const entry: boolean = p.kind === 'door' && !entryGiven;
    if (entry) entryGiven = true;
    await db.query(
      `INSERT INTO placements (id, room_id, kind, label, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11)`,
      [id, roomId, p.kind, p.label, entry, p.x, p.z, p.rotation ?? 0, p.w, p.d, p.h],
    );
  }
  const nodeIds = new Map<string, string>();
  for (const n of room.nodes) {
    const id = randomUUID();
    nodeIds.set(n.title, id);
    await db.query(
      `INSERT INTO nodes (id, room_id, title, kind, placement_id, answer, prerequisites) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, roomId, n.title, n.kind, n.placement ? ids.get(n.placement) : null, n.answer ?? null, (n.needs ?? []).map((t) => nodeIds.get(t))],
    );
  }
  await db.query(`UPDATE rooms SET scene_order = $2 WHERE id = $1`, [roomId, JSON.stringify(order)]);
  return roomId;
}
