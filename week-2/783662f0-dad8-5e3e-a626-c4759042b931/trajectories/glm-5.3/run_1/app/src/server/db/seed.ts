/** Schema apply (idempotent) and seeding. Two instances starting at once must not duplicate anything. */

import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Pool } from "./pool.js";
import { advisoryLock, withTx } from "./pool.js";
import { SeedServers, SeedTables, SeedUsers, StarterStacks, starterLayout } from "../../shared/data.js";

function hashPasscode(passcode: string): string {
  return createHash("sha256").update(`plotwright:${passcode}`).digest("hex");
}

function newId(): string {
  return randomBytes(10).toString("hex");
}

export async function applySchema(pool: Pool): Promise<void> {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await withTx(pool, async (tx) => {
    await advisoryLock(tx, "schema-apply");
    await tx.query(sql);
  });
}

/** Seeds when absent. Safe to run concurrently on multiple instances. */
export async function seed(pool: Pool): Promise<void> {
  await withTx(pool, async (tx) => {
    await advisoryLock(tx, "seed");
    const done = await tx.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'seeded'");
    if (done.rows.length > 0 && done.rows[0]!.value === "1") return;

    for (const u of SeedUsers) {
      await tx.query(
        `INSERT INTO users (id, handle, display_name, email, passcode_hash)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (handle) DO NOTHING`,
        [newId(), u.handle, u.display_name, `${u.handle}@plotwright.test`, hashPasscode(u.passcode)]
      );
    }
    const users = await tx.query<{ id: string; handle: string }>("SELECT id, handle FROM users");
    const userByHandle = new Map(users.rows.map((r) => [r.handle, r.id]));

    for (const s of SeedServers) {
      const existing = await tx.query<{ id: string }>("SELECT id FROM servers WHERE slug = $1", [s.slug]);
      if (existing.rows.length > 0) continue;
      const serverId = newId();
      const tableTiles = SeedTables.map((t) => ({ x: t.x, y: t.y }));
      const tiles = starterLayout(tableTiles).join("\n");
      await tx.query(
        `INSERT INTO servers (id, slug, name, owner_id, status, plan, time_zone, weather_seed)
         VALUES ($1,$2,$3,$4,'pending_approval',$5,$6,$7)`,
        [serverId, s.slug, s.name, userByHandle.get(s.owner)!, s.plan, s.time_zone, s.weather_seed]
      );
      await tx.query("INSERT INTO members (server_id, user_id) VALUES ($1,$2)", [serverId, userByHandle.get(s.owner)!]);
      for (const m of s.members) {
        await tx.query("INSERT INTO members (server_id, user_id) VALUES ($1,$2)", [serverId, userByHandle.get(m)!]);
      }
      await tx.query("INSERT INTO seasons (server_id, n) VALUES ($1, 1)", [serverId]);

      const worldId = newId();
      await tx.query("INSERT INTO worlds (id, server_id, slug, name, tiles) VALUES ($1,$2,$3,$4,$5)", [
        worldId,
        serverId,
        s.world.slug,
        s.world.name,
        tiles,
      ]);

      for (const t of SeedTables) {
        await tx.query(
          `INSERT INTO tables_ (id, server_id, world_id, name, game, x, y, state, stake, turn_seconds, etag)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'open',10,30,$8)`,
          [newId(), serverId, worldId, t.name, t.game, t.x, t.y, newId()]
        );
      }

      const charIds = new Map<string, string>();
      for (const c of s.characters) {
        const cid = newId();
        charIds.set(c.name, cid);
        await tx.query(
          `INSERT INTO characters (id, server_id, user_id, world_id, name, appearance, x, y, etag)
           VALUES ($1,$2,$3,$4,$5,'surveyor',$6,$7,$8)`,
          [cid, serverId, userByHandle.get(c.user)!, worldId, c.name, c.x, c.y, newId()]
        );
        for (let slot = 1; slot <= 24; slot++) {
          const stack = StarterStacks.find((st) => st.slot === slot);
          await tx.query("INSERT INTO inventory_slots (character_id, slot, kind, count) VALUES ($1,$2,$3,$4)", [
            cid,
            slot,
            stack?.kind ?? null,
            stack?.count ?? 0,
          ]);
        }
        await tx.query(`INSERT INTO ledger_entries (id, server_id, kind, lines) VALUES ($1,$2,'grant',$3)`, [
          newId(),
          serverId,
          JSON.stringify([
            { account: "house", amount: -500 },
            { account: cid, amount: 500 },
          ]),
        ]);
      }

      for (const v of s.vehicles) {
        await tx.query(
          `INSERT INTO vehicles (id, server_id, world_id, name, kind, owner_character_id, x, y)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newId(), serverId, worldId, v.name, v.kind, charIds.get(v.owner)!, v.x, v.y]
        );
      }
    }

    await tx.query("INSERT INTO app_meta (key, value) VALUES ('seeded','1') ON CONFLICT (key) DO NOTHING");
  });
}

export { hashPasscode, newId };

export function randomWeatherSeed(): number {
  return randomInt(0, 4);
}
