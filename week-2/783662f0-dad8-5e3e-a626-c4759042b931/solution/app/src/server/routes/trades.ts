import type { PoolClient } from 'pg';
import { Router } from 'express';
import { one, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { type SessionUser, requireUser } from '../http/session.js';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import { type ItemKind, isItemKind } from '../../shared/domain.js';
import { requireCharacterOnServer, requireOwnCharacter } from '../domain/characters.js';
import { appendEvent } from '../domain/events.js';
import {
  addItem,
  heldItems,
  inventoryObject,
  setSlots,
  slotsOf,
  takeItems,
} from '../domain/inventory.js';
import { walletOf, writeEntry } from '../domain/ledger.js';
import { requirePlayable, scopeByServerId, scopeBySlug } from '../domain/servers.js';
import {
  type TradeRow,
  bothAccepted,
  changeOffer,
  clearAccepts,
  loadTrade,
  lockTrade,
  openTradeOf,
  publishTrade,
  recordAccept,
  sideOf,
  tradeObject,
} from '../domain/trade.js';
import { withinOneTile } from '../domain/world.js';
import { newId } from '../util.js';
import { FieldErrors, onlyFields } from '../validate.js';
import { body, created, ok, route } from './helpers.js';

export const tradeRoutes = Router();

interface Offer {
  readonly coins: number;
  readonly items: { kind: ItemKind; count: number }[];
}

/** Offered coins and items must be available, not held elsewhere. */
async function readOffer(input: Record<string, unknown>, characterId: string): Promise<Offer> {
  const wallet = await walletOf(characterId);
  const inventory = await inventoryObject(characterId);
  const errors = new FieldErrors();

  const rawCoins = input.coins ?? 0;
  if (
    typeof rawCoins !== 'number' ||
    !Number.isInteger(rawCoins) ||
    rawCoins < 0 ||
    rawCoins > wallet.available
  ) {
    errors.add('coins', copy.coinsToOfferRange(wallet.available));
  }

  const items: { kind: ItemKind; count: number }[] = [];
  const rawItems = input.items ?? [];
  if (!Array.isArray(rawItems)) {
    errors.add('items', 'Send a list of items.');
  } else {
    for (const entry of rawItems) {
      if (typeof entry !== 'object' || entry === null) {
        errors.add('items', 'Send a list of items.');
        break;
      }
      const record = entry as Record<string, unknown>;
      const kind = typeof record.kind === 'string' ? record.kind : '';
      if (!isItemKind(kind)) {
        errors.add('items', 'Send a list of items.');
        break;
      }
      const available = inventory.slots
        .filter((slot) => slot.kind === kind)
        .reduce((sum, slot) => sum + slot.count - slot.held, 0);
      const count = record.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > available) {
        errors.add(kind, copy.coinsToOfferRange(available));
        break;
      }
      if (count > 0) items.push({ kind, count });
    }
  }
  errors.throwIfAny();
  return { coins: typeof rawCoins === 'number' ? rawCoins : 0, items };
}

tradeRoutes.post(
  '/servers/:slug/trades',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    onlyFields(body(req), ['character_id', 'partner_id', 'coins', 'items']);

    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    const partner = await requireCharacterOnServer(
      scope.server.id,
      String(body(req).partner_id ?? ''),
    );

    if (
      partner.world_id !== character.world_id ||
      !withinOneTile(character.x, character.y, partner.x, partner.y)
    ) {
      throw fail('too_far', { message: copy.tradeTooFar(partner.name) });
    }
    if ((await openTradeOf(character.id)) !== null) {
      throw fail('trade_open', { message: copy.tradeAlreadyOpen(character.name) });
    }
    if ((await openTradeOf(partner.id)) !== null) {
      throw fail('trade_open', { message: copy.tradeAlreadyOpen(partner.name) });
    }

    const offer = await readOffer(body(req), character.id);
    const id = newId();
    const trade = await tx(async (client) => {
      await client.query(
        `INSERT INTO trades (id, server_id, a_char, b_char, a_coins, a_items)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, scope.server.id, character.id, partner.id, offer.coins, JSON.stringify(offer.items)],
      );
      const rows = await client.query<TradeRow>('SELECT * FROM trades WHERE id = $1', [id]);
      await publishTrade(client, rows.rows[0]);
      return rows.rows[0];
    });

    const partnerOwner = await one<{ user_id: string }>(
      'SELECT user_id FROM characters WHERE id = $1',
      [partner.id],
    );
    if (partnerOwner !== null) {
      await appendEvent({
        serverId: scope.server.id,
        stream: 'world',
        scopeId: character.world_id,
        kind: 'world',
        payload: { announcement: copy.tradeOffered(character.name) },
        audience: [partnerOwner.user_id],
      });
    }
    created(res, await tradeObject(trade));
  }),
);

tradeRoutes.get(
  '/trades/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locateTrade(req.params.id, user);
    ok(res, await tradeObject(located.trade));
  }),
);

tradeRoutes.post(
  '/trades/:id/offer',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['character_id', 'version', 'coins', 'items']);
    const located = await locateTrade(req.params.id, user);
    requirePlayable(located.server);
    const character = await requireOwnCharacter(
      located.trade.server_id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    const side = sideOf(located.trade, character.id);
    if (side === null) throw fail('not_trade_party');
    if (located.trade.state !== 'open') throw fail('trade_closed');
    if (body(req).version !== located.trade.version) {
      throw fail('trade_changed', { message: COPY.tradeChanged });
    }

    const offer = await readOffer(body(req), character.id);
    const updated = await tx(async (client) => {
      const locked = await lockTrade(client, located.trade.id);
      if (locked.state !== 'open') throw fail('trade_closed');
      if (locked.version !== located.trade.version) throw fail('trade_changed');
      const next = await changeOffer(client, locked, side, offer.coins, offer.items);
      await publishTrade(client, next);
      return next;
    });
    ok(res, await tradeObject(updated));
  }),
);

tradeRoutes.post(
  '/trades/:id/accept',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['character_id', 'version']);
    const located = await locateTrade(req.params.id, user);
    requirePlayable(located.server);
    const character = await requireOwnCharacter(
      located.trade.server_id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    const side = sideOf(located.trade, character.id);
    if (side === null) throw fail('not_trade_party');

    const outcome = await tx(async (client) => {
      const locked = await lockTrade(client, located.trade.id);
      if (locked.state !== 'open') throw fail('trade_closed');
      if (locked.version !== body(req).version) throw fail('trade_changed');

      const accepted = await recordAccept(client, locked, side);
      if (!bothAccepted(accepted)) {
        await publishTrade(client, accepted);
        return { trade: accepted, completed: false };
      }
      const completed = await complete(client, accepted);
      await publishTrade(client, completed);
      return { trade: completed, completed: true };
    });
    void outcome.completed;
    ok(res, await tradeObject(outcome.trade));
  }),
);

/**
 * Completion moves coins and items and writes one zero-sum entry, all in one
 * transaction. A full inventory clears both accepts and leaves the trade open.
 */
async function complete(client: PoolClient, trade: TradeRow): Promise<TradeRow> {
  const sides = [
    { character: trade.a_char, coins: trade.a_coins, items: trade.a_items, other: trade.b_char },
    { character: trade.b_char, coins: trade.b_coins, items: trade.b_items, other: trade.a_char },
  ];

  const slots = new Map<string, Awaited<ReturnType<typeof slotsOf>>>();
  for (const side of sides) slots.set(side.character, await slotsOf(side.character, client));

  for (const side of sides) {
    const held = await heldItems(side.character, client);
    for (const item of side.items) {
      const taken = takeItems(slots.get(side.character) ?? [], held, item.kind, item.count);
      if (taken === null) throw fail('inventory_full', { message: COPY.tradeInventoryFull });
      slots.set(side.character, taken);
    }
  }
  for (const side of sides) {
    for (const item of side.items) {
      const added = addItem(slots.get(side.other) ?? [], item.kind, item.count);
      if (added === null) {
        await clearAccepts(client, trade.id);
        throw fail('inventory_full', { message: COPY.tradeInventoryFull });
      }
      slots.set(side.other, added);
    }
  }

  for (const side of sides) {
    await setSlots(client, side.character, trade.server_id, slots.get(side.character) ?? []);
  }

  const net = trade.b_coins - trade.a_coins;
  if (net !== 0) {
    await writeEntry(client, {
      serverId: trade.server_id,
      kind: 'trade',
      tradeId: trade.id,
      lines: [
        { account: trade.a_char, amount: net },
        { account: trade.b_char, amount: -net },
      ],
    });
  }

  const rows = await client.query<TradeRow>(
    `UPDATE trades SET state = 'completed', updated_at = now() WHERE id = $1 RETURNING *`,
    [trade.id],
  );
  return rows.rows[0];
}

tradeRoutes.post(
  '/trades/:id/cancel',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['character_id']);
    const located = await locateTrade(req.params.id, user);
    const character = await requireOwnCharacter(
      located.trade.server_id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if (sideOf(located.trade, character.id) === null) throw fail('not_trade_party');

    const updated = await tx(async (client) => {
      const locked = await lockTrade(client, located.trade.id);
      if (locked.state !== 'open') throw fail('trade_closed');
      const rows = await client.query<TradeRow>(
        `UPDATE trades SET state = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
        [locked.id],
      );
      await publishTrade(client, rows.rows[0]);
      return rows.rows[0];
    });
    ok(res, await tradeObject(updated));
  }),
);

interface LocatedTrade {
  readonly trade: TradeRow;
  readonly server: Awaited<ReturnType<typeof scopeByServerId>>['server'];
}

async function locateTrade(id: string, user: SessionUser): Promise<LocatedTrade> {
  const trade = await loadTrade(id);
  if (trade === null) throw fail('not_found');
  const scope = await scopeByServerId(trade.server_id, user);
  const owns = await one<{ id: string }>(
    'SELECT id FROM characters WHERE id = ANY($1::text[]) AND user_id = $2 LIMIT 1',
    [[trade.a_char, trade.b_char], user.id],
  );
  if (owns === null) throw fail('not_trade_party');
  return { trade, server: scope.server };
}
