import { randomBytes, randomUUID } from 'node:crypto';
import { creatureById } from '../shared/creatures.js';
import { MAIN_WORLD } from './config.js';
import { query, transaction, type Queryable } from './db.js';
import { createPlayer, hashPassword, slugOf } from './domain/players.js';
import { recordFilmChange } from './domain/film.js';
import { encodePng } from './png.js';
import { putPhoto } from './storage.js';

export async function ensureMainWorld(): Promise<void> {
  await query(
    `INSERT INTO worlds (id, tick, frozen, base_tick, started_at) VALUES ($1, 6000, false, 6000, now())
     ON CONFLICT (id) DO NOTHING`,
    [MAIN_WORLD],
  );
  const ranger = await query('SELECT id FROM players WHERE email = $1', ['ranger@hushfoot.example']);
  if (ranger.rowCount === 0) {
    await transaction((db) =>
      createPlayer(db, {
        worldId: MAIN_WORLD,
        name: 'Sal Marram',
        email: 'ranger@hushfoot.example',
        password: 'Harbour-Ranger-1',
        confirmed: true,
        ranger: true,
      }),
    ).catch(() => undefined);
  }
}

function parts(total: number): { size: number; centring: number; facing: number; sharpness: number } {
  const caps = [30, 25, 25, 20];
  let left = total;
  const out = caps.map((cap) => {
    const taken = Math.max(0, Math.min(cap, left));
    left -= taken;
    return taken;
  });
  return { size: out[0], centring: out[1], facing: out[2], sharpness: out[3] };
}

function photoImage(creatureId: string): Buffer {
  const seed = [...creatureId].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return encodePng(16, 16, (x, y) => [(x * 13 + seed) % 256, (y * 17 + seed) % 256, (x * y + seed) % 256]);
}

type SeedPlayer = { id: string; name: string; handle: string; email: string; password: string };

async function seedPlayer(
  db: Queryable,
  worldId: string,
  role: string,
  name: string,
  options: { confirmed: boolean; ranger: boolean; film: number },
): Promise<SeedPlayer> {
  const id = randomUUID();
  const suffix = randomBytes(4).toString('hex');
  const email = `${role}-${suffix}@example.test`;
  const handle = `${slugOf(name)}-${suffix}`;
  const password = `Grading-${suffix}`;
  await db.query(
    `INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger, island, tile_x, tile_y, heading, music, effects, graphics)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 3, 12, 'E', 60, 80, 'full')`,
    [id, worldId, name, handle, email, hashPassword(password), options.confirmed, options.ranger],
  );
  await db.query('INSERT INTO halls (player_id, public) VALUES ($1, false)', [id]);
  await recordFilmChange(db, id, 36, 'start');
  if (options.film !== 36) await recordFilmChange(db, id, options.film - 36, 'photo');
  return { id, name, handle, email, password };
}

async function seedPhoto(
  db: Queryable,
  options: { playerId: string; worldId: string; creature: string; island: number; total: number; tick: number },
): Promise<string> {
  const id = randomUUID();
  const key = `photos/${id}.png`;
  await putPhoto(key, photoImage(options.creature), 'image/png');
  const score = parts(options.total);
  await db.query(
    `INSERT INTO photos (id, player_id, world_id, creature_id, island, tick, total, size, centring, facing, sharpness, measures, image_key, content_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'image/png')`,
    [
      id,
      options.playerId,
      options.worldId,
      options.creature,
      options.island,
      options.tick,
      options.total,
      score.size,
      score.centring,
      score.facing,
      score.sharpness,
      JSON.stringify({
        distance: 4,
        best_distance: 4,
        offset: 0,
        focus_error: 0,
        creature_facing: 'toward',
      }),
      key,
    ],
  );
  return id;
}

export type GradingWorld = {
  world: { id: string; tick: number };
  explorer: SeedPlayer;
  friend: SeedPlayer;
  rival: SeedPlayer;
  ranger: SeedPlayer;
  ranger2: SeedPlayer;
  newcomer: SeedPlayer;
  photos: Record<string, string>;
  safari: { code: string };
  notes: Record<string, string>;
};

function safariCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return out;
}

export async function createGradingWorld(tick: number): Promise<GradingWorld> {
  const worldId = `grading-${randomBytes(6).toString('hex')}`;
  return transaction(async (db) => {
    await db.query('INSERT INTO worlds (id, tick, frozen, base_tick) VALUES ($1, $2, true, $2)', [worldId, tick]);

    const explorer = await seedPlayer(db, worldId, 'explorer', 'Marram Wick', {
      confirmed: true,
      ranger: false,
      film: 30,
    });
    const friend = await seedPlayer(db, worldId, 'friend', 'Pell Hushfoot', {
      confirmed: true,
      ranger: false,
      film: 36,
    });
    const rival = await seedPlayer(db, worldId, 'rival', 'Bryn Tidecall', {
      confirmed: true,
      ranger: false,
      film: 36,
    });
    const ranger = await seedPlayer(db, worldId, 'ranger', 'Sal Marram', {
      confirmed: true,
      ranger: true,
      film: 36,
    });
    const ranger2 = await seedPlayer(db, worldId, 'ranger2', 'Enid Gale', {
      confirmed: true,
      ranger: true,
      film: 36,
    });
    const newcomer = await seedPlayer(db, worldId, 'newcomer', 'Wren Cobble', {
      confirmed: false,
      ranger: false,
      film: 36,
    });

    const heron = await seedPhoto(db, {
      playerId: explorer.id,
      worldId,
      creature: 'reedpipe-heron',
      island: 1,
      total: 74,
      tick: 5200,
    });
    const moth = await seedPhoto(db, {
      playerId: explorer.id,
      worldId,
      creature: 'gloamfin-moth',
      island: 1,
      total: 81,
      tick: 5300,
    });
    const lark = await seedPhoto(db, {
      playerId: explorer.id,
      worldId,
      creature: 'puddle-lark',
      island: 1,
      total: 66,
      tick: 5400,
    });
    const friendHeron = await seedPhoto(db, {
      playerId: friend.id,
      worldId,
      creature: 'reedpipe-heron',
      island: 1,
      total: 74,
      tick: 5100,
    });
    const rivalLark = await seedPhoto(db, {
      playerId: rival.id,
      worldId,
      creature: 'puddle-lark',
      island: 1,
      total: 66,
      tick: 5300,
    });
    const rivalPrivate = await seedPhoto(db, {
      playerId: rival.id,
      worldId,
      creature: 'mossback-newt',
      island: 1,
      total: 55,
      tick: 5000,
    });

    for (const [photoId, creature, total] of [
      [heron, 'reedpipe-heron', 74],
      [moth, 'gloamfin-moth', 81],
      [lark, 'puddle-lark', 66],
    ] as const) {
      await db.query(
        'INSERT INTO album_pages (player_id, island, creature_id, photo_id, total) VALUES ($1, 1, $2, $3, $4)',
        [explorer.id, creature, photoId, total],
      );
      if (!creatureById(creature)) throw new Error(`unknown seed creature ${creature}`);
    }
    await db.query('INSERT INTO stamps (player_id, island) VALUES ($1, 2), ($1, 3)', [explorer.id]);

    await db.query('UPDATE halls SET public = true WHERE player_id = $1', [explorer.id]);
    await db.query(
      `INSERT INTO hall_frames (player_id, frame, photo_id, caption) VALUES ($1, 1, $2, ''), ($1, 2, $3, ''), ($1, 3, $4, '')`,
      [explorer.id, heron, moth, lark],
    );
    await db.query('INSERT INTO hall_frames (player_id, frame, photo_id, caption) VALUES ($1, 1, $2, $3)', [
      rival.id,
      rivalPrivate,
      '',
    ]);

    await db.query('INSERT INTO board_entries (world_id, island, player_id, photo_id) VALUES ($1, 1, $2, $3)', [
      worldId,
      rival.id,
      rivalLark,
    ]);

    const approved = randomUUID();
    const pending = randomUUID();
    await db.query(
      `INSERT INTO notes (id, world_id, author_id, text, status, decided_by)
       VALUES ($1, $2, $3, 'Fresh water at the harbour tap.', 'approved', $4)`,
      [approved, worldId, explorer.id, ranger.id],
    );
    await db.query(
      `INSERT INTO notes (id, world_id, author_id, text, status) VALUES ($1, $2, $3, 'Seal pups on the dock at low tide.', 'pending')`,
      [pending, worldId, friend.id],
    );

    const safariId = randomUUID();
    const code = safariCode();
    await db.query(
      "INSERT INTO safaris (id, world_id, code, status, host_id) VALUES ($1, $2, $3, 'open', $4)",
      [safariId, worldId, code, explorer.id],
    );
    await db.query('INSERT INTO sightings (id, safari_id, island, x, y, by_id) VALUES ($1, $2, 1, 12, 6, $3)', [
      randomUUID(),
      safariId,
      explorer.id,
    ]);

    return {
      world: { id: worldId, tick },
      explorer,
      friend,
      rival,
      ranger,
      ranger2,
      newcomer,
      photos: {
        heron,
        moth,
        lark,
        friend_heron: friendHeron,
        rival_lark: rivalLark,
        rival_private: rivalPrivate,
      },
      safari: { code },
      notes: { pending, approved },
    };
  });
}
