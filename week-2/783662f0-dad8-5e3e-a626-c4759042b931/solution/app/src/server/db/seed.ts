import type { PoolClient } from 'pg';
import { query, tx, withLock } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import { STARTER_TABLES, rowsToTiles, starterTiles } from '../domain/world.js';
import { writeEntry } from '../domain/ledger.js';
import { hashPasscode, newId } from '../util.js';
import type { PlanId } from '../../shared/domain.js';

interface SeedUser {
  readonly handle: string;
  readonly displayName: string;
  readonly passcode: string;
}

const USERS: readonly SeedUser[] = [
  { handle: 'mara', displayName: 'Mara Quill', passcode: 'mara-plots-01' },
  { handle: 'tobias', displayName: 'Tobias Wren', passcode: 'tobias-plots-02' },
  { handle: 'ines', displayName: 'Ines Varga', passcode: 'ines-plots-03' },
  { handle: 'kofi', displayName: 'Kofi Ansel', passcode: 'kofi-plots-04' },
  { handle: 'juno', displayName: 'Juno Hart', passcode: 'juno-plots-05' },
  { handle: 'oskar', displayName: 'Oskar Lind', passcode: 'oskar-plots-06' },
  { handle: 'priya', displayName: 'Priya Sorrel', passcode: 'priya-plots-07' },
  { handle: 'rowan', displayName: 'Rowan Ashby', passcode: 'rowan-plots-08' },
  { handle: 'sefa', displayName: 'Sefa Okoro', passcode: 'sefa-plots-09' },
  { handle: 'dara', displayName: 'Dara Finch', passcode: 'dara-plots-10' },
  { handle: 'eli', displayName: 'Eli Brandt', passcode: 'eli-plots-11' },
];

interface SeedServer {
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly members: readonly string[];
  readonly plan: PlanId;
  readonly timeZone: string;
  readonly weatherSeed: number;
  readonly world: { readonly slug: string; readonly name: string };
}

const SERVERS: readonly SeedServer[] = [
  {
    slug: 'larkspur-commons',
    name: 'Larkspur Commons',
    owner: 'mara',
    members: ['ines', 'kofi', 'juno', 'oskar'],
    plan: 'borough',
    timeZone: 'UTC',
    weatherSeed: 0,
    world: { slug: 'meadow', name: 'Meadow Survey' },
  },
  {
    slug: 'fennel-reach',
    name: 'Fennel Reach',
    owner: 'tobias',
    members: ['priya', 'ines'],
    plan: 'hamlet',
    timeZone: 'America/Chicago',
    weatherSeed: 2,
    world: { slug: 'saltmarsh', name: 'Saltmarsh Survey' },
  },
];

interface SeedCharacter {
  readonly server: string;
  readonly name: string;
  readonly user: string;
  readonly x: number;
  readonly y: number;
}

const CHARACTERS: readonly SeedCharacter[] = [
  { server: 'larkspur-commons', name: 'Quarry Mara', user: 'mara', x: 19, y: 7 },
  { server: 'larkspur-commons', name: 'Inkfinch', user: 'ines', x: 12, y: 7 },
  { server: 'larkspur-commons', name: 'Kestrel', user: 'kofi', x: 13, y: 7 },
  { server: 'larkspur-commons', name: 'Junebug', user: 'juno', x: 12, y: 9 },
  { server: 'larkspur-commons', name: 'Oxbow', user: 'oskar', x: 21, y: 7 },
  { server: 'fennel-reach', name: 'Tinderwren', user: 'tobias', x: 12, y: 7 },
  { server: 'fennel-reach', name: 'Pennyroyal', user: 'priya', x: 13, y: 7 },
  { server: 'fennel-reach', name: 'Kesh', user: 'priya', x: 20, y: 7 },
  { server: 'fennel-reach', name: 'Inkwell', user: 'ines', x: 21, y: 7 },
];

interface SeedVehicle {
  readonly server: string;
  readonly name: string;
  readonly kind: 'car' | 'plane';
  readonly owner: string;
  readonly x: number;
  readonly y: number;
}

const VEHICLES: readonly SeedVehicle[] = [
  { server: 'larkspur-commons', name: 'Blue Hatchback', kind: 'car', owner: 'Kestrel', x: 5, y: 10 },
  { server: 'larkspur-commons', name: 'Paper Kite', kind: 'plane', owner: 'Inkfinch', x: 31, y: 2 },
  { server: 'larkspur-commons', name: 'Moth', kind: 'plane', owner: 'Junebug', x: 33, y: 2 },
  { server: 'fennel-reach', name: 'Rust Pickup', kind: 'car', owner: 'Pennyroyal', x: 2, y: 10 },
];

/** The starter stacks every new character begins with. */
const STARTER_STACKS: readonly { slot: number; kind: string; count: number }[] = [
  { slot: 1, kind: 'wood', count: 16 },
  { slot: 2, kind: 'stone', count: 16 },
  { slot: 3, kind: 'brick', count: 8 },
  { slot: 4, kind: 'glass', count: 4 },
];

const GRANT_COINS = 500;

/** A new character starts with the starter stacks, then its loadout items. */
export async function giveStartingInventory(
  client: PoolClient,
  serverId: string,
  characterId: string,
  loadout: readonly string[],
): Promise<void> {
  let slot = 1;
  for (const stack of STARTER_STACKS) {
    await client.query(
      `INSERT INTO inventory_slots (character_id, server_id, slot, kind, count)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (character_id, slot) DO NOTHING`,
      [characterId, serverId, stack.slot, stack.kind, stack.count],
    );
    slot = stack.slot + 1;
  }
  for (const kind of loadout) {
    await client.query(
      `INSERT INTO inventory_slots (character_id, server_id, slot, kind, count)
       VALUES ($1, $2, $3, $4, 1) ON CONFLICT (character_id, slot) DO NOTHING`,
      [characterId, serverId, slot, kind],
    );
    slot += 1;
  }
}

export async function grantCoins(
  client: PoolClient,
  serverId: string,
  characterId: string,
): Promise<void> {
  await writeEntry(client, {
    serverId,
    kind: 'grant',
    lines: [
      { account: 'house', amount: -GRANT_COINS },
      { account: characterId, amount: GRANT_COINS },
    ],
  });
}

/** Creates the four starter tables in a world. */
async function createStarterTables(
  client: PoolClient,
  serverId: string,
  worldId: string,
): Promise<void> {
  for (const table of STARTER_TABLES) {
    await client.query(
      `INSERT INTO game_tables (id, server_id, world_id, name, game, x, y, state, stake, turn_seconds)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'open', 10, 30
        WHERE NOT EXISTS (SELECT 1 FROM game_tables WHERE world_id = $3 AND name = $4)`,
      [newId(), serverId, worldId, table.name, table.game, table.x, table.y],
    );
  }
}

export async function createWorld(
  client: PoolClient,
  serverId: string,
  slug: string,
  name: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM worlds WHERE server_id = $1 AND slug = $2',
    [serverId, slug],
  );
  const found = existing.rows[0];
  if (found !== undefined) return found.id;
  const id = newId();
  await client.query(
    'INSERT INTO worlds (id, server_id, slug, name, tiles) VALUES ($1, $2, $3, $4, $5)',
    [id, serverId, slug, name, rowsToTiles(starterTiles())],
  );
  await createStarterTables(client, serverId, id);
  return id;
}

/**
 * The schema and seed are applied at every serve under an advisory lock, so
 * that two instances starting at once duplicate nothing.
 */
export async function applySchemaAndSeed(): Promise<void> {
  await withLock(728411, async () => {
    await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await query(SCHEMA_SQL);
    await seedRecords();
  });
}

async function seedRecords(): Promise<void> {
  await tx(async (client) => {
    const userIds = new Map<string, string>();
    for (const user of USERS) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE handle = $1',
        [user.handle],
      );
      const found = existing.rows[0];
      if (found !== undefined) {
        userIds.set(user.handle, found.id);
        continue;
      }
      const id = newId();
      await client.query(
        `INSERT INTO users (id, handle, display_name, email, passcode_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          user.handle,
          user.displayName,
          `${user.handle}@plotwright.test`,
          hashPasscode(user.passcode),
        ],
      );
      userIds.set(user.handle, id);
    }

    const serverIds = new Map<string, string>();
    for (const server of SERVERS) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM servers WHERE slug = $1',
        [server.slug],
      );
      const found = existing.rows[0];
      let serverId: string;
      if (found !== undefined) {
        serverId = found.id;
      } else {
        serverId = newId();
        await client.query(
          `INSERT INTO servers (id, slug, name, owner_id, plan, status, time_zone, weather_seed)
           VALUES ($1, $2, $3, $4, $5, 'pending_approval', $6, $7)`,
          [
            serverId,
            server.slug,
            server.name,
            userIds.get(server.owner),
            server.plan,
            server.timeZone,
            server.weatherSeed,
          ],
        );
      }
      serverIds.set(server.slug, serverId);

      await client.query(
        `INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'owner')
         ON CONFLICT (server_id, user_id) DO NOTHING`,
        [serverId, userIds.get(server.owner)],
      );
      for (const handle of server.members) {
        await client.query(
          `INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'member')
           ON CONFLICT (server_id, user_id) DO NOTHING`,
          [serverId, userIds.get(handle)],
        );
      }
      await createWorld(client, serverId, server.world.slug, server.world.name);
    }

    const characterIds = new Map<string, string>();
    for (const character of CHARACTERS) {
      const serverId = serverIds.get(character.server);
      if (serverId === undefined) continue;
      const world = await client.query<{ id: string }>(
        'SELECT id FROM worlds WHERE server_id = $1 ORDER BY created_at LIMIT 1',
        [serverId],
      );
      const worldId = world.rows[0]?.id;
      if (worldId === undefined) continue;

      const existing = await client.query<{ id: string }>(
        'SELECT id FROM characters WHERE server_id = $1 AND lower(name) = lower($2)',
        [serverId, character.name],
      );
      const found = existing.rows[0];
      if (found !== undefined) {
        characterIds.set(`${character.server}/${character.name}`, found.id);
        continue;
      }
      const id = newId();
      await client.query(
        `INSERT INTO characters (id, server_id, user_id, world_id, name, appearance, loadout, x, y)
         VALUES ($1, $2, $3, $4, $5, 'surveyor', '[]'::jsonb, $6, $7)`,
        [
          id,
          serverId,
          userIds.get(character.user),
          worldId,
          character.name,
          character.x,
          character.y,
        ],
      );
      await giveStartingInventory(client, serverId, id, []);
      await grantCoins(client, serverId, id);
      characterIds.set(`${character.server}/${character.name}`, id);
    }

    for (const vehicle of VEHICLES) {
      const serverId = serverIds.get(vehicle.server);
      const ownerId = characterIds.get(`${vehicle.server}/${vehicle.owner}`);
      if (serverId === undefined || ownerId === undefined) continue;
      const world = await client.query<{ id: string }>(
        'SELECT id FROM worlds WHERE server_id = $1 ORDER BY created_at LIMIT 1',
        [serverId],
      );
      const worldId = world.rows[0]?.id;
      if (worldId === undefined) continue;
      await client.query(
        `INSERT INTO vehicles (id, server_id, world_id, name, kind, owner_character_id, x, y)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
          WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE world_id = $3 AND name = $4)`,
        [newId(), serverId, worldId, vehicle.name, vehicle.kind, ownerId, vehicle.x, vehicle.y],
      );
    }
  });
}
