import { Router } from 'express';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { requireIfMatch, setEtag } from '../http/conditional.js';
import { requireUser } from '../http/session.js';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import { ITEM_NAMES, MATERIALS, type Material, isMaterial } from '../../shared/domain.js';
import { unlock, countBreak } from '../domain/achievements.js';
import {
  activeRunFor,
  appendWalk,
  markReached,
  nextCheckpointAt,
  chapterById,
  storeCheckpoint,
  loadRun,
} from '../domain/chapters.js';
import {
  characterObject,
  requireOwnCharacter,
  touchCharacter,
} from '../domain/characters.js';
import { appendEvent } from '../domain/events.js';
import { restoreWorld, savesOf, snapshotBytes, writeSave } from '../domain/exports.js';
import {
  addItem,
  findUnheldSlot,
  heldItems,
  setSlots,
  slotsOf,
  takeItems,
} from '../domain/inventory.js';
import { requireOwner, requirePlayable, scopeBySlug } from '../domain/servers.js';
import { weatherOf } from '../domain/weather.js';
import {
  type Direction,
  STEPS,
  STEP_LETTERS,
  occupancyAt,
  passable,
  planePath,
  replayTrip,
  requireWorld,
  shortestRoadPath,
  tileAt,
  touchWorld,
  withinOneTile,
  worldEtag,
  worldObject,
} from '../domain/world.js';
import { instant, newId } from '../util.js';
import { FieldErrors, checkMessage, checkWorldName, onlyFields, requireInteger } from '../validate.js';
import { body, created, ok, route } from './helpers.js';

export const worldRoutes = Router();

const DIRECTIONS: readonly Direction[] = ['north', 'east', 'south', 'west'];

async function publishWorld(serverId: string, worldId: string): Promise<void> {
  const world = await one<{ id: string }>('SELECT id FROM worlds WHERE id = $1', [worldId]);
  if (world === null) return;
  await appendEvent({
    serverId,
    stream: 'world',
    scopeId: worldId,
    kind: 'world',
    payload: { world_id: worldId },
  });
}

/* The world record. */

worldRoutes.get(
  '/servers/:slug/worlds/:world',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const world = await requireWorld(scope.server.id, req.params.world);
    setEtag(res, worldEtag(world));
    ok(res, await worldObject(world));
  }),
);

worldRoutes.patch(
  '/servers/:slug/worlds/:world',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), ['name']);
    requireIfMatch(req, worldEtag(world));
    const errors = new FieldErrors();
    const name = checkWorldName(errors, body(req).name);
    errors.throwIfAny();
    await query('UPDATE worlds SET name = $2, revision = revision + 1 WHERE id = $1', [
      world.id,
      name,
    ]);
    const updated = await requireWorld(scope.server.id, req.params.world);
    await publishWorld(scope.server.id, world.id);
    setEtag(res, worldEtag(updated));
    ok(res, await worldObject(updated));
  }),
);

/* Walking. */

worldRoutes.post(
  '/characters/:id/walk',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['direction']);
    const character = await loadOwnCharacter(req.params.id, user.id);
    const scope = await scopeBySlug(character.serverSlug, user);
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, character.worldSlug);

    const direction = DIRECTIONS.find((known) => known === body(req).direction);
    if (direction === undefined) {
      throw fail('validation', { fields: { direction: 'Choose north, east, south or west.' } });
    }
    const step = STEPS[direction];
    const x = character.row.x + step.dx;
    const y = character.row.y + step.dy;
    if (!(await passable(world, x, y))) throw fail('blocked', { message: COPY.blocked });

    const outcome = await tx(async (client) => {
      await client.query('UPDATE characters SET x = $2, y = $3, revision = revision + 1 WHERE id = $1', [
        character.row.id,
        x,
        y,
      ]);
      const run = await activeRunFor(client, character.row.id, world.id);
      if (run === null) return { checkpoint: null, run: null };
      await appendWalk(client, run.id, character.row.id, direction);
      const hit = await nextCheckpointAt(client, run.id, x, y);
      if (hit === null) return { checkpoint: null, run };
      await markReached(client, run.id, hit.n, hit.last);
      return { checkpoint: hit, run };
    });

    let announcement = copy.movedTo(x, y);
    let checkpointPayload: {
      run_id: string;
      n: number;
      name: string;
      stored: boolean;
    } | null = null;

    if (outcome.checkpoint !== null && outcome.run !== null) {
      const run = (await loadRun(outcome.run.id)) ?? outcome.run;
      const stored = await storeCheckpoint(run, outcome.checkpoint.n);
      checkpointPayload = {
        run_id: run.id,
        n: outcome.checkpoint.n,
        name: outcome.checkpoint.name,
        stored,
      };
      if (!stored) {
        announcement = copy.checkpointWaiting(outcome.checkpoint.name);
      } else if (outcome.checkpoint.last) {
        const chapter = chapterById(run.chapter_id);
        announcement = copy.chapterComplete(chapter?.title ?? run.chapter_id);
      } else {
        announcement = copy.checkpointReached(outcome.checkpoint.name);
      }
    }

    await publishWorld(scope.server.id, world.id);
    const updated = await requireOwnCharacter(scope.server.id, character.row.id, user.id);
    ok(res, {
      character: await characterObject(updated),
      announcement,
      checkpoint: checkpointPayload,
    });
  }),
);

interface OwnCharacter {
  readonly row: Awaited<ReturnType<typeof requireOwnCharacter>>;
  readonly serverSlug: string;
  readonly worldSlug: string;
}

/** A character route carries no server slug, so it is resolved from the record. */
async function loadOwnCharacter(id: string, userId: string): Promise<OwnCharacter> {
  const found = await one<{
    server_slug: string;
    world_slug: string;
    server_id: string;
  }>(
    `SELECT sv.slug AS server_slug, w.slug AS world_slug, sv.id AS server_id
       FROM characters c
       JOIN servers sv ON sv.id = c.server_id
       JOIN worlds w ON w.id = c.world_id
      WHERE c.id = $1`,
    [id],
  );
  if (found === null) throw fail('not_found');
  const member = await one<{ user_id: string }>(
    'SELECT user_id FROM members WHERE server_id = $1 AND user_id = $2',
    [found.server_id, userId],
  );
  if (member === null) throw fail('not_found');
  const row = await requireOwnCharacter(found.server_id, id, userId);
  return { row, serverSlug: found.server_slug, worldSlug: found.world_slug };
}

/* Blocks. */

worldRoutes.post(
  '/servers/:slug/worlds/:world/blocks',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), ['character_id', 'x', 'y', 'material']);

    const errors = new FieldErrors();
    const x = requireInteger(errors, 'x', body(req).x);
    const y = requireInteger(errors, 'y', body(req).y);
    const rawMaterial = body(req).material;
    const material = typeof rawMaterial === 'string' && isMaterial(rawMaterial) ? rawMaterial : null;
    if (material === null) {
      errors.add('material', `Choose one of ${MATERIALS.join(', ')}.`);
    }
    errors.throwIfAny();
    if (material === null) throw fail('validation');

    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const tile = tileAt(world.tiles, x, y);
    if (tile !== '.' && tile !== 's') throw fail('not_buildable', { message: COPY.notBuildable });
    if (!withinOneTile(character.x, character.y, x, y)) {
      throw fail('too_far', { message: COPY.tooFar });
    }
    const here = await occupancyAt(world.id, x, y);
    if (here.block || here.vehicle || here.character) {
      throw fail('tile_taken', { message: COPY.tileTaken });
    }

    const held = await heldItems(character.id);
    const slots = await slotsOf(character.id);
    if (findUnheldSlot(slots, held, material) === null) {
      throw fail('no_block_in_inventory', {
        message: copy.noBlockInInventory(ITEM_NAMES[material]),
      });
    }

    await tx(async (client) => {
      const taken = takeItems(slots, held, material, 1);
      if (taken === null) throw fail('no_block_in_inventory');
      await setSlots(client, character.id, scope.server.id, taken);
      await client.query(
        'INSERT INTO blocks (server_id, world_id, x, y, material) VALUES ($1, $2, $3, $4, $5)',
        [scope.server.id, world.id, x, y, material],
      );
      await touchWorld(world.id, client);
      await unlock(client, scope.server.id, character.id, user.id, 'first_stone');
    });

    await publishWorld(scope.server.id, world.id);
    created(res, {
      block: { x, y, material },
      announcement: copy.placedBlock(ITEM_NAMES[material].replace(' block', ''), x, y),
    });
  }),
);

worldRoutes.post(
  '/servers/:slug/worlds/:world/blocks/break',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), ['character_id', 'x', 'y']);

    const errors = new FieldErrors();
    const x = requireInteger(errors, 'x', body(req).x);
    const y = requireInteger(errors, 'y', body(req).y);
    errors.throwIfAny();

    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if (!withinOneTile(character.x, character.y, x, y)) {
      throw fail('too_far', { message: COPY.tooFar });
    }
    const block = await one<{ material: Material }>(
      'SELECT material FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3',
      [world.id, x, y],
    );
    if (block === null) throw fail('no_block', { message: COPY.noBlock });

    const slots = await slotsOf(character.id);
    const added = addItem(slots, block.material, 1);
    if (added === null) throw fail('inventory_full', { message: COPY.inventoryFull });

    await tx(async (client) => {
      await setSlots(client, character.id, scope.server.id, added);
      await client.query('DELETE FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3', [
        world.id,
        x,
        y,
      ]);
      await touchWorld(world.id, client);
      const broken = await countBreak(client, scope.server.id, character.id);
      if (broken >= 10) {
        await unlock(client, scope.server.id, character.id, user.id, 'groundbreaker');
      }
    });

    await publishWorld(scope.server.id, world.id);
    ok(res, {
      block: { x, y, material: block.material },
      announcement: copy.brokeBlock(ITEM_NAMES[block.material].replace(' block', ''), x, y),
    });
  }),
);

/* Parking. */

worldRoutes.post(
  '/vehicles/:id/park',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['x', 'y']);
    const vehicle = await one<{
      id: string;
      server_id: string;
      world_id: string;
      name: string;
      kind: 'car' | 'plane';
      owner_character_id: string;
      x: number;
      y: number;
      server_slug: string;
      world_slug: string;
    }>(
      `SELECT v.*, sv.slug AS server_slug, w.slug AS world_slug
         FROM vehicles v JOIN servers sv ON sv.id = v.server_id
         JOIN worlds w ON w.id = v.world_id
        WHERE v.id = $1`,
      [req.params.id],
    );
    if (vehicle === null) throw fail('not_found');
    const scope = await scopeBySlug(vehicle.server_slug, user);
    requirePlayable(scope.server);
    const owner = await one<{ user_id: string }>('SELECT user_id FROM characters WHERE id = $1', [
      vehicle.owner_character_id,
    ]);
    if (owner === null || owner.user_id !== user.id) throw fail('not_your_character');

    const errors = new FieldErrors();
    const x = requireInteger(errors, 'x', body(req).x);
    const y = requireInteger(errors, 'y', body(req).y);
    errors.throwIfAny();

    const world = await requireWorld(scope.server.id, vehicle.world_slug);
    const surface = vehicle.kind === 'car' ? 'road' : 'runway';
    const wanted = vehicle.kind === 'car' ? '=' : '#';

    if (x === vehicle.x && y === vehicle.y) throw fail('same_tile');
    if (tileAt(world.tiles, x, y) !== wanted) {
      throw fail('wrong_surface', {
        message: vehicle.kind === 'car' ? COPY.carWrongSurface : COPY.planeWrongSurface,
      });
    }
    if (vehicle.kind === 'plane' && weatherOf(scope.server.weather_seed).weather === 'storm') {
      throw fail('weather_grounded', { message: COPY.weatherGrounded });
    }
    const target = await one<{ id: string }>(
      'SELECT id FROM vehicles WHERE world_id = $1 AND x = $2 AND y = $3 AND id <> $4',
      [world.id, x, y, vehicle.id],
    );
    if (target !== null) throw fail('tile_taken', { message: COPY.tileTaken });

    let steps: Direction[];
    if (vehicle.kind === 'car') {
      const others = await query<{ x: number; y: number }>(
        'SELECT x, y FROM vehicles WHERE world_id = $1 AND id <> $2',
        [world.id, vehicle.id],
      );
      const blocked = new Set(others.map((other) => `${other.x},${other.y}`));
      const path = shortestRoadPath(
        world.tiles,
        blocked,
        { x: vehicle.x, y: vehicle.y },
        { x, y },
      );
      if (path === null) throw fail('no_route', { message: COPY.noRoute });
      steps = path;
    } else {
      steps = planePath({ x: vehicle.x, y: vehicle.y }, { x, y });
    }

    const tripId = newId();
    await tx(async (client) => {
      await client.query(
        `INSERT INTO trips (id, server_id, vehicle_id, from_x, from_y, to_x, to_y, steps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tripId,
          scope.server.id,
          vehicle.id,
          vehicle.x,
          vehicle.y,
          x,
          y,
          JSON.stringify(steps.map((step) => STEP_LETTERS[step])),
        ],
      );
      await client.query('UPDATE vehicles SET x = $2, y = $3 WHERE id = $1', [vehicle.id, x, y]);
      await touchWorld(world.id, client);
      if (vehicle.kind === 'plane') {
        await unlock(
          client,
          scope.server.id,
          vehicle.owner_character_id,
          user.id,
          'smooth_landing',
        );
      } else if (steps.length >= 10) {
        await unlock(client, scope.server.id, vehicle.owner_character_id, user.id, 'long_haul');
      }
    });

    await publishWorld(scope.server.id, world.id);
    created(res, {
      trip: {
        id: tripId,
        vehicle_id: vehicle.id,
        from: { x: vehicle.x, y: vehicle.y },
        to: { x, y },
        steps: steps.map((step) => STEP_LETTERS[step]),
      },
      vehicle: { id: vehicle.id, name: vehicle.name, kind: vehicle.kind, x, y },
      announcement: copy.parked(vehicle.name, surface, x, y),
    });
  }),
);

worldRoutes.get(
  '/trips/:id/replay',
  route(async (req, res) => {
    const user = await requireUser(req);
    const trip = await one<{
      id: string;
      server_id: string;
      from_x: number;
      from_y: number;
      to_x: number;
      to_y: number;
      steps: string[];
      server_slug: string;
    }>(
      `SELECT t.*, sv.slug AS server_slug FROM trips t JOIN servers sv ON sv.id = t.server_id
        WHERE t.id = $1`,
      [req.params.id],
    );
    if (trip === null) throw fail('not_found');
    await scopeBySlug(trip.server_slug, user);
    const replayed = replayTrip({ x: trip.from_x, y: trip.from_y }, trip.steps);
    ok(res, {
      trip_id: trip.id,
      stored: { x: trip.to_x, y: trip.to_y },
      replayed,
      match: replayed.x === trip.to_x && replayed.y === trip.to_y,
    });
  }),
);

/* Chat, stored and read per world. */

worldRoutes.get(
  '/servers/:slug/worlds/:world/chat',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const world = await requireWorld(scope.server.id, req.params.world);
    const rows = await query<{
      id: string;
      character_id: string;
      name: string;
      text: string;
      created_at: Date;
    }>(
      `SELECT m.id, m.character_id, c.name, m.text, m.created_at
         FROM chat_messages m JOIN characters c ON c.id = m.character_id
        WHERE m.world_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
      [world.id],
    );
    ok(res, {
      messages: rows.reverse().map((row) => ({
        id: row.id,
        character: { id: row.character_id, name: row.name },
        text: row.text,
        created_at: instant(row.created_at),
      })),
    });
  }),
);

worldRoutes.post(
  '/servers/:slug/worlds/:world/chat',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), ['character_id', 'text']);

    const errors = new FieldErrors();
    const text = checkMessage(errors, body(req).text);
    errors.throwIfAny();
    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const id = newId();
    const rows = await query<{ created_at: Date }>(
      `INSERT INTO chat_messages (id, server_id, world_id, character_id, text)
       VALUES ($1,$2,$3,$4,$5) RETURNING created_at`,
      [id, scope.server.id, world.id, character.id, text],
    );
    const message = {
      id,
      character: { id: character.id, name: character.name },
      text,
      created_at: instant(rows[0]?.created_at ?? new Date()),
    };
    await appendEvent({
      serverId: scope.server.id,
      stream: 'world',
      scopeId: world.id,
      kind: 'chat',
      payload: message,
    });
    created(res, { message });
  }),
);

/* Saves, restores and weather. */

worldRoutes.get(
  '/servers/:slug/worlds/:world/saves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const world = await requireWorld(scope.server.id, req.params.world);
    const saves = await savesOf(world.id);
    ok(res, {
      saves: saves.map((save) => ({
        id: save.id,
        number: save.number,
        created_at: instant(save.created_at),
        restored_from: save.restored_from,
        objects: [save.snapshot_key, save.manifest_key],
      })),
    });
  }),
);

worldRoutes.post(
  '/servers/:slug/worlds/:world/saves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), []);
    const snapshot = await snapshotBytes(world);
    const save = await writeSave(scope.server, world, snapshot, null);
    created(res, {
      save: {
        id: save.id,
        number: save.number,
        created_at: instant(save.createdAt),
        restored_from: save.restoredFrom,
        objects: [save.snapshotKey, save.manifestKey],
      },
    });
  }),
);

worldRoutes.post(
  '/servers/:slug/worlds/:world/restore',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = requireOwner(await scopeBySlug(req.params.slug, user));
    requirePlayable(scope.server);
    const world = await requireWorld(scope.server.id, req.params.world);
    onlyFields(body(req), ['save_id']);
    const saveId = String(body(req).save_id ?? '');
    const outcome = await restoreWorld(scope.server, world, saveId);
    const updated = await requireWorld(scope.server.id, req.params.world);
    await publishWorld(scope.server.id, world.id);
    ok(res, {
      world: await worldObject(updated),
      save: {
        id: outcome.save.id,
        number: outcome.save.number,
        created_at: instant(outcome.save.createdAt),
        restored_from: outcome.save.restoredFrom,
      },
    });
  }),
);

worldRoutes.get(
  '/servers/:slug/weather',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    ok(res, weatherOf(scope.server.weather_seed));
  }),
);
