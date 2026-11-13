import { withDb } from './db.js';
import { SCHEMA } from './schema-loader.js';
import { hashPassword } from './ids.js';
import { seedUsers, starterRooms } from './seed-data.js';

/**
 * Apply schema and seed data idempotently. Safe when several instances run
 * it at once: every write is guarded by fixed ids or ON CONFLICT.
 */
export async function migrate(): Promise<void> {
  await withDb(async (c) => {
    await c.query(SCHEMA);

    for (const u of seedUsers) {
      const wsId = 'ws_' + (u.venue === 'Lantern Lane Escapes' ? 'lantern' : 'brasskey');
      await c.query(
        `INSERT INTO workspaces (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
        [wsId, u.venue]
      );
      const hash = hashPassword(u.password);
      await c.query(
        `INSERT INTO users (id, workspace_id, email, email_lower, password_hash, display_name, role)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        ['user_' + u.displayName.split(' ')[0].toLowerCase(), wsId, u.email, u.email.toLowerCase(), hash, u.displayName, u.role]
      );
    }

    const owner = await c.query(`SELECT id, workspace_id FROM users WHERE email_lower = 'ines@brasskey.test'`);
    const brassWs = owner.rows[0].workspace_id as string;

    // Brass Key Rooms: one draft room
    await c.query(
      `INSERT INTO rooms (id, workspace_id, name, starter, width_mm, depth_mm, height_mm, scene_order)
       VALUES ($1,$2,'Clocktower Draft',false,3000,3000,2400,$3) ON CONFLICT (id) DO NOTHING`,
      ['room_clocktower', brassWs, ['place_clocktower_door']]
    );
    await c.query(
      `INSERT INTO placements (id, room_id, kind, label, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
       VALUES ('place_clocktower_door','room_clocktower','door','Entry door',true,1050,0,0,0,900,80,2000)
       ON CONFLICT (id) DO NOTHING`
    );
    await c.query(
      `INSERT INTO trigger_nodes (id, room_id, title, kind, placement_id, prerequisites)
       VALUES ('node_clocktower_pendulum','room_clocktower','Pendulum','puzzle',NULL,'{}')
       ON CONFLICT (id) DO NOTHING`
    );

    // Lantern Lane: the five starter rooms (draft Clockmaker's Study included)
    const lanternWs = (
      await c.query(`SELECT workspace_id FROM users WHERE email_lower = 'mara@lanternlane.test'`)
    ).rows[0].workspace_id as string;
    for (const r of starterRooms()) {
      const roomId = 'room_' + r.name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/_$/, '');
      await c.query(
        `INSERT INTO rooms (id, workspace_id, name, starter, width_mm, depth_mm, height_mm, scene_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [roomId, lanternWs, r.name, r.starter, r.widthMm, r.depthMm, r.heightMm, r.placements.map((p) => `${roomId}_${p.id}`)]
      );
      for (const p of r.placements) {
        await c.query(
          `INSERT INTO placements (id, room_id, kind, label, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [`${roomId}_${p.id}`, roomId, p.kind, p.label, p.id === 'p1' && p.kind === 'door', p.x, p.y, p.z, p.rotation ?? 0, p.w, p.d, p.h]
        );
      }
              for (const n of r.nodes) {
        await c.query(
          `INSERT INTO trigger_nodes (id, room_id, title, kind, placement_id, answer, prerequisites)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [`${roomId}_${n.id}`, roomId, n.title, n.kind, n.placementId ? `${roomId}_${n.placementId}` : null, n.answer, n.needs.map((x) => `${roomId}_${x}`)]
        );
      }
    }
  });
}
