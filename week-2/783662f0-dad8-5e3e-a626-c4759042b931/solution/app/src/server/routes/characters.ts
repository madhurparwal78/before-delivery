import { Router } from 'express';
import { lockKey, one, query, tx, withLock } from '../db/pool.js';
import { fail } from '../errors.js';
import { requireIfMatch, setEtag } from '../http/conditional.js';
import { requireUser } from '../http/session.js';
import * as copy from '../../shared/copy.js';
import { COPY, FIELD_COPY } from '../../shared/copy.js';
import {
  APPEARANCES,
  INVENTORY_SLOTS,
  LOADOUT_ITEMS,
  MAX_CHARACTERS_PER_USER,
  SPAWN,
  type ItemKind,
} from '../../shared/domain.js';
import { giveStartingInventory, grantCoins } from '../db/seed.js';
import { unlock } from '../domain/achievements.js';
import {
  characterEtag,
  characterObject,
  requireCharacterOnServer,
  requireOwnCharacter,
} from '../domain/characters.js';
import {
  addItem,
  heldItems,
  inventoryObject,
  moveSlots,
  recipeById,
  setSlots,
  slotsOf,
  takeItems,
} from '../domain/inventory.js';
import { walletLines, walletOf } from '../domain/ledger.js';
import { planOf, requirePlayable, scopeByServerId, scopeBySlug } from '../domain/servers.js';
import { instant, newId } from '../util.js';
import { FieldErrors, checkCharacterName, onlyFields, requireInteger } from '../validate.js';
import { body, created, ok, route } from './helpers.js';

export const characterRoutes = Router();

characterRoutes.post(
  '/servers/:slug/characters',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    onlyFields(body(req), ['name', 'appearance', 'loadout']);

    const errors = new FieldErrors();
    const name = checkCharacterName(errors, body(req).name);
    const appearance = APPEARANCES.find((known) => known === body(req).appearance) ?? null;
    if (appearance === null) {
      errors.add('appearance', FIELD_COPY.appearanceRequired);
    }
    const rawLoadout = body(req).loadout;
    const loadout: ItemKind[] = [];
    if (!Array.isArray(rawLoadout)) {
      errors.add('loadout', FIELD_COPY.loadoutTooMany);
    } else {
      const seen = new Set<ItemKind>();
      for (const item of rawLoadout) {
        const known = LOADOUT_ITEMS.find((candidate) => candidate === item);
        if (known === undefined) {
          errors.add('loadout', FIELD_COPY.loadoutTooMany);
          break;
        }
        if (!seen.has(known)) {
          seen.add(known);
          loadout.push(known);
        }
      }
      if (loadout.length > 3) errors.add('loadout', FIELD_COPY.loadoutTooMany);
    }
    errors.throwIfAny();
    if (appearance === null) throw fail('validation');

    const mine = await one<{ count: string }>(
      'SELECT count(*) AS count FROM characters WHERE server_id = $1 AND user_id = $2',
      [scope.server.id, user.id],
    );
    if (Number(mine?.count ?? 0) >= MAX_CHARACTERS_PER_USER) throw fail('roster_full');

    const limit = planOf(scope.server).characters;
    const total = await one<{ count: string }>(
      'SELECT count(*) AS count FROM characters WHERE server_id = $1',
      [scope.server.id],
    );
    if (Number(total?.count ?? 0) >= limit) {
      throw fail('character_limit', { message: copy.characterLimit(limit) });
    }

    const clash = await one<{ id: string }>(
      'SELECT id FROM characters WHERE server_id = $1 AND lower(name) = lower($2)',
      [scope.server.id, name],
    );
    if (clash !== null) {
      throw fail('validation', { fields: { name: FIELD_COPY.characterNameTaken } });
    }

    const world = await one<{ id: string }>(
      'SELECT id FROM worlds WHERE server_id = $1 ORDER BY created_at LIMIT 1',
      [scope.server.id],
    );
    if (world === null) throw fail('not_found');

    const id = newId();
    const ordered = LOADOUT_ITEMS.filter((item) => loadout.includes(item));
    await tx(async (client) => {
      await client.query(
        `INSERT INTO characters (id, server_id, user_id, world_id, name, appearance, loadout, x, y)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          scope.server.id,
          user.id,
          world.id,
          name,
          appearance,
          JSON.stringify(ordered),
          SPAWN.x,
          SPAWN.y,
        ],
      );
      await giveStartingInventory(client, scope.server.id, id, ordered);
      await grantCoins(client, scope.server.id, id);
    });

    const character = await requireOwnCharacter(scope.server.id, id, user.id);
    created(res, { character: await characterObject(character) });
  }),
);

characterRoutes.get(
  '/characters/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    setEtag(res, characterEtag(character.row));
    ok(res, await characterObject(character.row));
  }),
);

characterRoutes.patch(
  '/characters/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    if (character.row.user_id !== user.id) throw fail('not_your_character');
    onlyFields(body(req), ['appearance']);
    requireIfMatch(req, characterEtag(character.row));
    const errors = new FieldErrors();
    const appearance = APPEARANCES.find((known) => known === body(req).appearance) ?? null;
    if (appearance === null) errors.add('appearance', FIELD_COPY.appearanceRequired);
    errors.throwIfAny();
    await query(
      'UPDATE characters SET appearance = $2, revision = revision + 1 WHERE id = $1',
      [character.row.id, appearance],
    );
    const updated = await requireCharacterOnServer(character.serverId, character.row.id);
    setEtag(res, characterEtag(updated));
    ok(res, await characterObject(updated));
  }),
);

characterRoutes.get(
  '/characters/:id/wallet',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    const scope = await scopeByServerId(character.serverId, user);
    if (character.row.user_id !== user.id && !scope.isOwner) throw fail('not_your_character');
    const wallet = await walletOf(character.row.id);
    ok(res, {
      character_id: character.row.id,
      balance: wallet.balance,
      available: wallet.available,
      lines: await walletLines(character.row.id),
    });
  }),
);

characterRoutes.get(
  '/characters/:id/inventory',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    if (character.row.user_id !== user.id) throw fail('not_your_character');
    ok(res, await inventoryObject(character.row.id));
  }),
);

characterRoutes.post(
  '/characters/:id/inventory/moves',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    if (character.row.user_id !== user.id) throw fail('not_your_character');
    onlyFields(body(req), ['from', 'to']);

    const errors = new FieldErrors();
    const from = requireInteger(errors, 'from', body(req).from);
    const to = requireInteger(errors, 'to', body(req).to);
    if (from < 1 || from > INVENTORY_SLOTS) errors.add('from', 'Use a slot from 1 to 24.');
    if (to < 1 || to > INVENTORY_SLOTS) errors.add('to', 'Use a slot from 1 to 24.');
    errors.throwIfAny();

    const inventory = await inventoryObject(character.row.id);
    const source = inventory.slots[from - 1];
    const target = inventory.slots[to - 1];
    if (source.kind === null) throw fail('empty_slot');
    if (source.held > 0 || target.held > 0) throw fail('slot_held');

    const slots = await slotsOf(character.row.id);
    const moved = moveSlots(slots, from, to);
    await tx(async (client) => {
      await setSlots(client, character.row.id, character.serverId, moved.slots);
    });
    ok(res, await inventoryObject(character.row.id));
  }),
);

characterRoutes.post(
  '/characters/:id/crafts',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    if (character.row.user_id !== user.id) throw fail('not_your_character');
    const scope = await scopeByServerId(character.serverId, user);
    requirePlayable(scope.server);
    onlyFields(body(req), ['recipe']);

    const recipe = recipeById(String(body(req).recipe ?? ''));
    if (recipe === null) {
      throw fail('validation', { fields: { recipe: 'Choose a published recipe.' } });
    }

    /* One craft at a time per character across instances, so parallel crafts never spend the same ingredients twice. */
    await withLock(lockKey(`inventory:${character.row.id}`), async () => {
      const held = await heldItems(character.row.id);
      let slots = await slotsOf(character.row.id);
      for (const input of recipe.inputs) {
        const taken = takeItems(slots, held, input.kind, input.count);
        if (taken === null) {
          throw fail('missing_ingredients', { message: copy.missingIngredients(recipe.name) });
        }
        slots = taken;
      }
      const added = addItem(slots, recipe.output.kind, recipe.output.count);
      if (added === null) throw fail('inventory_full', { message: COPY.inventoryFull });

      await tx(async (client) => {
        await setSlots(client, character.row.id, character.serverId, added);
        await unlock(client, character.serverId, character.row.id, user.id, 'maker');
      });
    });

    created(res, {
      inventory: await inventoryObject(character.row.id),
      crafted: { kind: recipe.output.kind, count: recipe.output.count },
    });
  }),
);

characterRoutes.get(
  '/characters/:id/achievements',
  route(async (req, res) => {
    const user = await requireUser(req);
    const character = await resolveCharacter(req.params.id, user.id);
    const rows = await query<{ achievement_id: string; name: string; unlocked_at: Date }>(
      'SELECT achievement_id, name, unlocked_at FROM achievements WHERE character_id = $1 ORDER BY unlocked_at',
      [character.row.id],
    );
    ok(res, {
      achievements: rows.map((row) => ({
        id: row.achievement_id,
        name: row.name,
        unlocked_at: instant(row.unlocked_at),
      })),
    });
  }),
);

interface Resolved {
  readonly row: Awaited<ReturnType<typeof requireCharacterOnServer>>;
  readonly serverId: string;
}

/** Resolves a character and refuses it as unknown to non-members. */
async function resolveCharacter(id: string, userId: string): Promise<Resolved> {
  const found = await one<{ server_id: string }>('SELECT server_id FROM characters WHERE id = $1', [
    id,
  ]);
  if (found === null) throw fail('not_found');
  const member = await one<{ user_id: string }>(
    'SELECT user_id FROM members WHERE server_id = $1 AND user_id = $2',
    [found.server_id, userId],
  );
  if (member === null) throw fail('not_found');
  return {
    row: await requireCharacterOnServer(found.server_id, id),
    serverId: found.server_id,
  };
}
