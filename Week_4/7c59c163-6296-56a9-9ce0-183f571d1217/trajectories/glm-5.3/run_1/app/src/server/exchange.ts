import type { AppConfig } from './config.js';
import type { Pool, PoolClient } from './db.js';
import { AppError, conflict, notFound, validationError } from './errors.js';
import {
  EVENT_ESCROW_PER_CONTRACT,
  canCancelOrder,
  eventCrosses,
  feeForFill,
  fromYesPrice,
  holdForOrder,
  maintenanceRequirement,
  marketCanTransition,
  orderStatusAfterFill,
  pnlForReduction,
  positionEquity,
  positionReduction,
  toYesPrice,
  type MarketKind,
  type MarketStatus,
  type OrderMode,
  type OrderSide,
  type Outcome,
  type OrderStatus,
  type PositionSide,
} from './domain.js';
import {
  escrowAccount,
  marginLendingAccount,
  memberAccount,
  memberBalancesWithClient,
  postJournalEntry,
  venueAccount,
} from './ledger.js';
import { enqueue } from './queue.js';

export interface MarketRecord {
  id: string;
  venue_id: string;
  kind: MarketKind;
  symbol: string;
  title: string;
  status: MarketStatus;
  closes_at: Date | null;
  outcome: Outcome | null;
  last_price: number | null;
  seed_last_price: number | null;
  created_at: Date;
}

export interface OrderRecord {
  id: string;
  venue_id: string;
  market_id: string;
  member_id: string;
  mode: OrderMode;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  status: OrderStatus;
  hold_cents: number;
  reserved_units: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  created_at: Date;
  sequence: string;
}

export interface FillRecord {
  id: string;
  order_id: string;
  market_id: string;
  member_id: string;
  mode: OrderMode;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: 'maker' | 'taker';
  filled_at: string;
}

export interface PositionRecord {
  id: string;
  market_id: string;
  member_id: string;
  side: PositionSide;
  quantity: number;
  cost_cents: number;
  collateral_cents: number;
  status: 'open' | 'closed' | 'liquidated';
}

export interface BookLevel {
  price: number;
  quantity: number;
  spot_quantity?: number;
  margin_quantity?: number;
}

export interface BookSnapshot {
  market_id: string;
  sequence: number;
  last_price: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface MarketFees {
  taker: number;
  maker: number;
}

export class Exchange {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly notify: (client: PoolClient, venueId: string, payload: Record<string, unknown>) => Promise<void>
  ) {}

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async loadMarket(client: PoolClient, venueId: string, marketId: string): Promise<MarketRecord> {
    const res = await client.query(`SELECT * FROM markets WHERE id = $1 AND venue_id = $2`, [marketId, venueId]);
    const row = res.rows[0] as MarketRecord | undefined;
    if (!row) throw notFound();
    return row;
  }

  async loadMarketAny(client: PoolClient, marketId: string): Promise<MarketRecord | null> {
    const res = await client.query(`SELECT * FROM markets WHERE id = $1`, [marketId]);
    return (res.rows[0] as MarketRecord | undefined) ?? null;
  }

  effectiveStatus(market: MarketRecord, now: Date): MarketStatus {
    if (market.kind === 'event' && market.status === 'trading' && market.closes_at && market.closes_at.getTime() <= now.getTime()) {
      return 'closed';
    }
    return market.status;
  }

  async placeOrder(input: {
    venueId: string;
    memberId: string;
    marketId: string;
    mode: OrderMode;
    side: OrderSide;
    outcome: Outcome | null;
    price: number;
    quantity: number;
  }): Promise<{ order: OrderRecord; fills: FillRecord[] }> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [input.marketId]);
      const market = await this.loadMarket(client, input.venueId, input.marketId);
      const status = this.effectiveStatus(market, new Date());
      if (status !== 'trading') {
        throw conflict('market_not_trading', { status });
      }
      return this.matchIncoming(client, market, input.memberId, {
        mode: input.mode,
        side: input.side,
        outcome: input.outcome,
        price: input.price,
        quantity: input.quantity,
      });
    });
  }

  async cancelOrder(venueId: string, memberId: string, orderId: string): Promise<OrderRecord> {
    return this.withTransaction(async (client) => {
      const order = await this.loadOrderForUpdate(client, venueId, memberId, orderId);
      if (!canCancelOrder(order.status)) {
        throw conflict('invalid_transition', { from: order.status, to: 'cancelled' });
      }
      await this.releaseOrderHold(client, venueId, order);
      await client.query(`UPDATE orders SET status = 'cancelled', hold_cents = 0 WHERE id = $1`, [orderId]);
      if (order.reserved_units > 0) {
        await client.query(
          `UPDATE spot_holdings SET reserved = reserved - $3 WHERE member_id = $1 AND market_id = $2`,
          [memberId, order.market_id, order.reserved_units]
        );
        await client.query(`UPDATE orders SET reserved_units = 0 WHERE id = $1`, [orderId]);
      }
      const updated = await this.loadOrder(client, orderId);
      await this.publishMarketSnapshot(client, order.market_id);
      await this.publishMemberSnapshot(client, venueId, memberId);
      await this.publishMemberOrder(client, venueId, memberId, updated);
      return updated;
    });
  }

  private async matchIncoming(
    client: PoolClient,
    market: MarketRecord,
    memberId: string,
    input: { mode: OrderMode; side: OrderSide; outcome: Outcome | null; price: number; quantity: number }
  ): Promise<{ order: OrderRecord; fills: FillRecord[] }> {
    const fees = await this.marketFees(client, market.venue_id);
    const position = market.kind === 'pair' && input.mode === 'margin'
      ? await this.openPosition(client, market.id, memberId)
      : null;
    const reduces = position !== null &&
      ((position.side === 'long' && input.side === 'sell') || (position.side === 'short' && input.side === 'buy'));

    if (reduces) {
      const reducingResting = await this.sumReducingResting(client, market.id, memberId, input.side);
      if (input.quantity > position.quantity - reducingResting) {
        throw validationError({ quantity: 'exceeds_position' });
      }
    }

    const holdCents = holdForOrder({
      price: input.price,
      quantity: input.quantity,
      takerFeeBps: fees.taker,
      kind: market.kind,
      mode: market.kind === 'pair' ? input.mode : null,
      side: input.side,
      reducesPosition: reduces,
    });

    const balances = await memberBalancesWithClient(client, market.venue_id, memberId);
    if (holdCents > balances.available) {
      throw validationError({ quantity: 'insufficient_funds' });
    }

    let reservedUnits = 0;
    if (market.kind === 'pair' && input.mode === 'spot' && input.side === 'sell') {
      const holding = await this.spotHolding(client, market.id, memberId);
      if (holding.quantity - holding.reserved < input.quantity) {
        throw validationError({ quantity: 'insufficient_holdings' });
      }
      reservedUnits = input.quantity;
    }

    const orderId = crypto.randomUUID();
    const orderInsert = await client.query(
      `INSERT INTO orders (id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity, status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'resting',$10,$11,$12,$13)
       RETURNING *`,
      [orderId, market.venue_id, market.id, memberId, market.kind === 'pair' ? input.mode : null, input.side,
       market.kind === 'event' ? input.outcome : null, input.price, input.quantity,
       holdCents, reservedUnits, fees.taker, fees.maker]
    );
    const incoming = orderInsert.rows[0] as OrderRecord;

    if (holdCents > 0) {
      await postJournalEntry(client, market.venue_id, {
        kind: 'hold',
        referenceId: orderId,
        legs: [
          { account: memberAccount(memberId, 'available'), amountCents: -holdCents },
          { account: memberAccount(memberId, 'held'), amountCents: holdCents },
        ],
      });
    }
    if (reservedUnits > 0) {
      await client.query(
        `UPDATE spot_holdings SET reserved = reserved + $3 WHERE member_id = $1 AND market_id = $2`,
        [memberId, market.id, reservedUnits]
      );
    }

    const fills = await this.matchAgainst(client, market, incoming, position, fees);
    const finalOrder = await this.loadOrder(client, orderId);

    await this.publishMarketSnapshot(client, market.id);
    await this.publishMemberSnapshot(client, market.venue_id, memberId);
    await this.publishMemberOrder(client, market.venue_id, memberId, finalOrder);
    await this.scheduleMaintenanceCheck(client, market, fills);
    return { order: finalOrder, fills };
  }

  private async matchAgainst(
    client: PoolClient,
    market: MarketRecord,
    incoming: OrderRecord,
    position: PositionRecord | null,
    fees: MarketFees
  ): Promise<FillRecord[]> {
    const fills: FillRecord[] = [];
    let remaining = incoming.quantity;

    const candidates = await this.counterparties(client, market, incoming);
    for (const maker of candidates) {
      if (remaining <= 0) break;
      if (maker.member_id === incoming.member_id) continue;

      const execYes = market.kind === 'event'
        ? toYesPrice(maker.outcome ?? 'yes', maker.price)
        : maker.price;

      if (market.kind === 'event') {
        const incomingYes = toYesPrice(incoming.outcome ?? 'yes', incoming.price);
        const makerYes = toYesPrice(maker.outcome ?? 'yes', maker.price);
        const incomingNo = incoming.outcome === 'no' ? incoming.price : EVENT_ESCROW_PER_CONTRACT - incomingYes;
        const makerNo = maker.outcome === 'no' ? maker.price : EVENT_ESCROW_PER_CONTRACT - makerYes;
        if (incoming.outcome === 'yes') {
          if (!eventCrosses(incomingYes, makerYes)) continue;
        } else {
          if (!eventCrosses(makerYes, incomingYes)) continue;
        }
        void incomingNo; void makerNo;
      } else {
        if (incoming.side === 'buy' ? incoming.price < maker.price : incoming.price > maker.price) continue;
      }

      const qty = Math.min(remaining, maker.quantity - maker.filled_quantity);
      if (qty <= 0) continue;

      const fill = await this.executeFill(client, market, incoming, maker, qty, execYes, fees, position);
      fills.push(fill);
      remaining -= qty;
    }
    return fills;
  }

  private async counterparties(client: PoolClient, market: MarketRecord, incoming: OrderRecord): Promise<OrderRecord[]> {
    const params: unknown[] = [market.id];
    let where = `market_id = $1 AND status IN ('resting','partially_filled')`;
    let order: string;
    if (market.kind === 'event') {
      where += ` AND side = 'buy' AND outcome = $2`;
      params.push(incoming.outcome === 'yes' ? 'no' : 'yes');
      // best counterparty: highest YES price (for NO maker, highest price means lowest YES)
      order = incoming.outcome === 'yes'
        ? `ORDER BY (100 - price) ASC, sequence ASC`
        : `ORDER BY price DESC, sequence ASC`;
    } else {
      where += ` AND side = $2`;
      params.push(incoming.side === 'buy' ? 'sell' : 'buy');
      order = incoming.side === 'buy' ? `ORDER BY price ASC, sequence ASC` : `ORDER BY price DESC, sequence ASC`;
    }
    const res = await client.query(`SELECT * FROM orders WHERE ${where} ${order}`, params);
    return res.rows as OrderRecord[];
  }

  private async executeFill(
    client: PoolClient,
    market: MarketRecord,
    incoming: OrderRecord,
    maker: OrderRecord,
    qty: number,
    execYes: number,
    fees: MarketFees,
    incomingPosition: PositionRecord | null
  ): Promise<FillRecord> {
    const incomingExec = market.kind === 'event'
      ? fromYesPrice(incoming.outcome ?? 'yes', execYes)
      : execYes;
    const makerExec = market.kind === 'event'
      ? fromYesPrice(maker.outcome ?? 'yes', execYes)
      : execYes;

    const incomingNotional = incomingExec * qty;
    const makerNotional = makerExec * qty;
    const incomingFee = incoming.side === 'buy' && market.kind === 'event' && maker.side === 'buy'
      ? feeForFill(incomingNotional, fees.taker)
      : feeForFill(incomingNotional, fees.taker);
    const makerFee = feeForFill(makerNotional, fees.maker);

    const now = new Date();
    const incomingFillId = crypto.randomUUID();
    const makerFillId = crypto.randomUUID();

    const venueId = market.venue_id;
    await client.query(
      `INSERT INTO fills (id, venue_id, order_id, market_id, member_id, mode, side, outcome, price, quantity, notional_cents, fee_cents, liquidity, filled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'taker',$13)`,
      [incomingFillId, venueId, incoming.id, market.id, incoming.member_id, incoming.mode, incoming.side, incoming.outcome,
       incomingExec, qty, incomingNotional, incomingFee, now]
    );
    await client.query(
      `INSERT INTO fills (id, venue_id, order_id, market_id, member_id, mode, side, outcome, price, quantity, notional_cents, fee_cents, liquidity, filled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'maker',$13)`,
      [makerFillId, venueId, maker.id, market.id, maker.member_id, maker.mode, maker.side, maker.outcome,
       makerExec, qty, makerNotional, makerFee, now]
    );

    const incomingUpdated = await this.applyFillToOrder(client, incoming.id, qty, fees.taker, incoming.price, market);
    const makerUpdated = await this.applyFillToOrder(client, maker.id, qty, fees.maker, maker.price, market);

    await this.settleEventOrSpot(client, market, {
      incoming, maker, qty, incomingExec, makerExec, incomingFee, makerFee,
      incomingFillId, makerFillId,
    });
    if (market.kind === 'pair') {
      await this.settlePair(client, market, incoming, maker, qty, incomingExec, incomingFee, incomingPosition);
    }

    const markPrice = market.kind === 'event' ? execYes : incomingExec;
    await client.query(`UPDATE markets SET last_price = $2 WHERE id = $1`, [market.id, markPrice]);
    await client.query(
      `INSERT INTO trades (id, venue_id, market_id, price, quantity, at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), market.venue_id, market.id, markPrice, qty, now]
    );

    await enqueue(client, {
      kind: 'book',
      venueId,
      payload: { market_id: market.id, trade_price: market.kind === 'event' ? execYes : incomingExec, qty },
    });
    await this.enqueueOrderEvents(client, venueId, market, incoming.member_id, incoming.id, incomingFillId, {
      mode: incoming.mode, side: incoming.side, outcome: incoming.outcome,
      price: incomingExec, quantity: qty, fee_cents: incomingFee, liquidity: 'taker',
      order_status: incomingUpdated.status, filled_at: now.toISOString(),
    });
    await this.enqueueOrderEvents(client, venueId, market, maker.member_id, maker.id, makerFillId, {
      mode: maker.mode, side: maker.side, outcome: maker.outcome,
      price: makerExec, quantity: qty, fee_cents: makerFee, liquidity: 'maker',
      order_status: makerUpdated.status, filled_at: now.toISOString(),
    });

    return {
      id: incomingFillId,
      order_id: incoming.id,
      market_id: market.id,
      member_id: incoming.member_id,
      mode: incoming.mode,
      side: incoming.side,
      outcome: incoming.outcome,
      price: incomingExec,
      quantity: qty,
      notional_cents: incomingNotional,
      fee_cents: incomingFee,
      liquidity: 'taker',
      filled_at: now.toISOString(),
    };
  }

  private async applyFillToOrder(
    client: PoolClient,
    orderId: string,
    qty: number,
    feeBps: number,
    limitPrice: number,
    market: MarketRecord
  ): Promise<OrderRecord> {
    const res = await client.query(
      `UPDATE orders SET filled_quantity = filled_quantity + $2 WHERE id = $1 RETURNING *`,
      [orderId, qty]
    );
    const order = res.rows[0] as OrderRecord;
    const status = orderStatusAfterFill(order.filled_quantity, order.quantity);
    await client.query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, status]);

    const remaining = order.quantity - order.filled_quantity;
    const reduces = market.kind === 'pair' && order.mode === 'margin'
      ? await this.orderReduces(client, market.id, order.member_id, order.side)
      : false;
    const newHold = remaining > 0
      ? holdForOrder({
          price: limitPrice, quantity: remaining, takerFeeBps: feeBps, kind: market.kind,
          mode: order.mode, side: order.side, reducesPosition: reduces,
        })
      : 0;
    await client.query(`UPDATE orders SET hold_cents = $2 WHERE id = $1`, [orderId, newHold]);
    return { ...order, status, hold_cents: newHold };
  }

  private async orderReduces(client: PoolClient, marketId: string, memberId: string, side: OrderSide): Promise<boolean> {
    const position = await this.openPosition(client, marketId, memberId);
    if (!position) return false;
    return (position.side === 'long' && side === 'sell') || (position.side === 'short' && side === 'buy');
  }

  private async settleEventOrSpot(
    client: PoolClient,
    market: MarketRecord,
    input: {
      incoming: OrderRecord; maker: OrderRecord; qty: number;
      incomingExec: number; makerExec: number; incomingFee: number; makerFee: number;
      incomingFillId: string; makerFillId: string;
    }
  ): Promise<void> {
    const venueId = market.venue_id;
    if (market.kind === 'event') {
      const inc = input.incoming;
      const mk = input.maker;
      const incSpent = inc.side === 'buy' ? input.incomingExec * input.qty + input.incomingFee : input.incomingFee;
      const mkSpent = mk.side === 'buy' ? input.makerExec * input.qty + input.makerFee : input.makerFee;
      const incNotional = inc.side === 'buy' ? input.incomingExec * input.qty : 0;
      const mkNotional = mk.side === 'buy' ? input.makerExec * input.qty : 0;
      const escrowIn = incNotional + mkNotional;

      // The order held its limit-price maximum; the unspent difference returns
      // from held to available in the same entry as the fill.
      const incHoldDelta = inc.side === 'buy' ? input.incoming.price * input.qty + input.incomingFee - incSpent : 0;
      const incLegs = incSpent > 0 ? [
        { account: memberAccount(inc.member_id, 'held'), amountCents: -incSpent },
        ...(incNotional > 0 ? [{ account: escrowAccount(market.id), amountCents: incNotional }] : []),
        ...(input.incomingFee > 0 ? [{ account: venueAccount('fees'), amountCents: input.incomingFee }] : []),
        ...(incHoldDelta > 0 ? [
          { account: memberAccount(inc.member_id, 'held'), amountCents: -incHoldDelta },
          { account: memberAccount(inc.member_id, 'available'), amountCents: incHoldDelta },
        ] : []),
      ] : [];
      if (incLegs.length > 0) {
        await postJournalEntry(client, venueId, { kind: 'fill', referenceId: input.incomingFillId, legs: incLegs });
      }
      const mkHoldDelta = mk.side === 'buy' ? input.maker.price * input.qty + input.makerFee - mkSpent : 0;
      const mkLegs = mkSpent > 0 ? [
        { account: memberAccount(mk.member_id, 'held'), amountCents: -mkSpent },
        ...(mkNotional > 0 ? [{ account: escrowAccount(market.id), amountCents: mkNotional }] : []),
        ...(input.makerFee > 0 ? [{ account: venueAccount('fees'), amountCents: input.makerFee }] : []),
        ...(mkHoldDelta > 0 ? [
          { account: memberAccount(mk.member_id, 'held'), amountCents: -mkHoldDelta },
          { account: memberAccount(mk.member_id, 'available'), amountCents: mkHoldDelta },
        ] : []),
      ] : [];
      if (mkLegs.length > 0) {
        await postJournalEntry(client, venueId, { kind: 'fill', referenceId: input.makerFillId, legs: mkLegs });
      }
      void escrowIn;

      await this.adjustEventHolding(client, market.id, inc.member_id, inc.outcome ?? 'yes', input.qty);
      await this.adjustEventHolding(client, market.id, mk.member_id, mk.outcome ?? 'yes', input.qty);
      await this.netEventHoldings(client, market, inc.member_id);
      await this.netEventHoldings(client, market, mk.member_id);
    } else if (input.incoming.mode === 'spot' || input.maker.mode === 'spot') {
      await this.settleSpotPairFill(client, market, input);
    }
  }

  private async settleSpotPairFill(
    client: PoolClient,
    market: MarketRecord,
    input: {
      incoming: OrderRecord; maker: OrderRecord; qty: number;
      incomingExec: number; makerExec: number; incomingFee: number; makerFee: number;
      incomingFillId: string; makerFillId: string;
    }
  ): Promise<void> {
    const venueId = market.venue_id;
    const buyer = input.incoming.side === 'buy' ? input.incoming : input.maker;
    const seller = input.incoming.side === 'buy' ? input.maker : input.incoming;
    const buyerFee = input.incoming.side === 'buy' ? input.incomingFee : input.makerFee;
    const sellerFee = input.incoming.side === 'buy' ? input.makerFee : input.incomingFee;
    const buyerFillId = input.incoming.side === 'buy' ? input.incomingFillId : input.makerFillId;
    const sellerFillId = input.incoming.side === 'buy' ? input.makerFillId : input.incomingFillId;
    const exec = input.incomingExec;
    const notional = exec * input.qty;
    const isMarginSeller = seller.mode === 'margin';
    const isMarginBuyer = buyer.mode === 'margin';

    if (!isMarginBuyer) {
      const buyerOrder = input.incoming.side === 'buy' ? input.incoming : input.maker;
      // Release the unspent part of the buyer's hold (limit price vs execution).
      const buyerHoldDelta = buyerOrder.price * input.qty + buyerFee - (notional + buyerFee);
      await postJournalEntry(client, venueId, {
        kind: 'fill', referenceId: buyerFillId,
        legs: [
          { account: memberAccount(buyer.member_id, 'held'), amountCents: -(notional + buyerFee) },
          { account: isMarginSeller ? marginLendingAccount(market.id) : memberAccount(seller.member_id, 'held'), amountCents: notional },
          ...(buyerFee > 0 ? [{ account: venueAccount('fees'), amountCents: buyerFee }] : []),
          ...(buyerHoldDelta > 0 ? [
            { account: memberAccount(buyer.member_id, 'held'), amountCents: -buyerHoldDelta },
            { account: memberAccount(buyer.member_id, 'available'), amountCents: buyerHoldDelta },
          ] : []),
        ],
      });
    }
    if (!isMarginSeller) {
      await postJournalEntry(client, venueId, {
        kind: 'fill', referenceId: sellerFillId,
        legs: [
          { account: memberAccount(seller.member_id, 'held'), amountCents: -sellerFee },
          ...(sellerFee > 0 ? [{ account: venueAccount('fees'), amountCents: sellerFee }] : []),
        ],
      });
      // Seller delivers units from reserved holdings; buyer receives units.
      await this.transferSpotUnits(client, market.id, seller.member_id, buyer.member_id, input.qty);
    } else {
      // Margin short sells into the venue lending inventory; buyer receives units.
      await this.addSpotUnits(client, market.id, buyer.member_id, input.qty);
    }
    if (isMarginBuyer) {
      await this.addSpotUnits(client, market.id, buyer.member_id, input.qty);
    }
    if (isMarginSeller) {
      await this.addSpotUnits(client, market.id, buyer.member_id, input.qty);
    }
  }

  private async transferSpotUnits(client: PoolClient, marketId: string, fromMember: string, toMember: string, qty: number): Promise<void> {
    await client.query(
      `UPDATE spot_holdings SET quantity = quantity - $3, reserved = reserved - $3 WHERE member_id = $1 AND market_id = $2`,
      [fromMember, marketId, qty]
    );
    await this.addSpotUnits(client, marketId, toMember, qty);
  }

  private async addSpotUnits(client: PoolClient, marketId: string, memberId: string, qty: number): Promise<void> {
    await client.query(
      `INSERT INTO spot_holdings (member_id, market_id, quantity, reserved) VALUES ($1,$2,$3,0)
       ON CONFLICT (member_id, market_id) DO UPDATE SET quantity = spot_holdings.quantity + $3`,
      [memberId, marketId, qty]
    );
  }

  private async settlePair(
    client: PoolClient,
    market: MarketRecord,
    incoming: OrderRecord,
    maker: OrderRecord,
    qty: number,
    exec: number,
    takerFee: number,
    incomingPosition: PositionRecord | null
  ): Promise<void> {
    void incoming; void maker;
    const marginParticipants: { order: OrderRecord; position: PositionRecord | null; fee: number }[] = [];
    if (incoming.mode === 'margin') marginParticipants.push({ order: incoming, position: incomingPosition, fee: takerFee });
    // maker position loaded lazily inside growOrReduce
    for (const order of [incoming, maker]) {
      if (order.mode !== 'margin') continue;
      const isTaker = order.id === incoming.id;
      const fee = isTaker ? takerFee : feeForFill(exec * qty, maker.maker_fee_bps);
      const position = await this.growOrReducePosition(client, market, order.member_id, order.side, qty, exec, fee);
      void position;
    }
  }

  private async growOrReducePosition(
    client: PoolClient,
    market: MarketRecord,
    memberId: string,
    side: OrderSide,
    qty: number,
    exec: number,
    fee: number
  ): Promise<PositionRecord> {
    const existing = await this.openPosition(client, market.id, memberId);
    const notional = exec * qty;
    if (!existing) {
      const id = crypto.randomUUID();
      const collateral = Math.ceil(notional / 2);
      const positionSide: PositionSide = side === 'buy' ? 'long' : 'short';
      await client.query(
        `INSERT INTO margin_positions (id, venue_id, market_id, member_id, side, quantity, cost_cents, collateral_cents, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
        [id, market.venue_id, market.id, memberId, positionSide, qty, notional, collateral]
      );
      await postJournalEntry(client, market.venue_id, {
        kind: 'hold', referenceId: id,
        legs: [
          { account: memberAccount(memberId, 'held'), amountCents: -(collateral + fee) },
          { account: memberAccount(memberId, 'collateral'), amountCents: collateral },
          ...(fee > 0 ? [{ account: venueAccount('fees'), amountCents: fee }] : []),
        ],
      });
      return { id, market_id: market.id, member_id: memberId, side: positionSide, quantity: qty, cost_cents: notional, collateral_cents: collateral, status: 'open' };
    }

    const reduces = (existing.side === 'long' && side === 'sell') || (existing.side === 'short' && side === 'buy');
    if (reduces) {
      const reduceQty = Math.min(qty, existing.quantity);
      const { basis, releasedCollateral } = positionReduction(existing, reduceQty);
      const pnl = pnlForReduction(existing.side, reduceQty, exec, basis);
      const toAvailable = Math.max(releasedCollateral + pnl, 0);
      const insuranceLeg = releasedCollateral + pnl < 0
        ? [{ account: venueAccount('insurance'), amountCents: -(releasedCollateral + pnl) }]
        : [];
      await postJournalEntry(client, market.venue_id, {
        kind: 'margin_reduced', referenceId: existing.id,
        legs: [
          { account: memberAccount(memberId, 'collateral'), amountCents: -releasedCollateral },
          { account: memberAccount(memberId, 'held'), amountCents: -(fee) },
          ...(fee > 0 ? [{ account: venueAccount('fees'), amountCents: fee }] : []),
          { account: memberAccount(memberId, 'available'), amountCents: toAvailable },
          ...insuranceLeg,
        ].filter((leg) => leg.amountCents !== 0),
      });
      const newQty = existing.quantity - reduceQty;
      if (newQty === 0) {
        await client.query(`UPDATE margin_positions SET quantity = 0, status = 'closed' WHERE id = $1`, [existing.id]);
      } else {
        await client.query(
          `UPDATE margin_positions SET quantity = $2, cost_cents = cost_cents - $3, collateral_cents = collateral_cents - $4 WHERE id = $1`,
          [existing.id, newQty, basis, releasedCollateral]
        );
      }
      return { ...existing, quantity: newQty, cost_cents: existing.cost_cents - basis, collateral_cents: existing.collateral_cents - releasedCollateral, status: newQty === 0 ? 'closed' : 'open' };
    }

    // Grow position
    const collateralDelta = Math.ceil(notional / 2);
    await client.query(
      `UPDATE margin_positions SET quantity = quantity + $2, cost_cents = cost_cents + $3, collateral_cents = collateral_cents + $4 WHERE id = $1`,
      [existing.id, qty, notional, collateralDelta]
    );
    await postJournalEntry(client, market.venue_id, {
      kind: 'hold', referenceId: existing.id,
      legs: [
        { account: memberAccount(memberId, 'held'), amountCents: -(collateralDelta + fee) },
        { account: memberAccount(memberId, 'collateral'), amountCents: collateralDelta },
        ...(fee > 0 ? [{ account: venueAccount('fees'), amountCents: fee }] : []),
      ],
    });
    return { ...existing, quantity: existing.quantity + qty, cost_cents: existing.cost_cents + notional, collateral_cents: existing.collateral_cents + collateralDelta };
  }

  private async scheduleMaintenanceCheck(client: PoolClient, market: MarketRecord, fills: FillRecord[]): Promise<void> {
    if (market.kind !== 'pair' || fills.length === 0) return;
    await enqueue(client, {
      kind: 'book',
      venueId: market.venue_id,
      payload: { maintenance_check: true, market_id: market.id },
    });
  }

  async runMaintenanceCheck(venueId: string, marketId: string): Promise<{ checked: number; liquidated: { position_id: string; quantity: number; mark_price: number; returned_cents: number }[] }> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
      const market = await this.loadMarket(client, venueId, marketId);
      if (market.kind !== 'pair') throw conflict('not_a_pair');
      return this.checkPositions(client, market);
    });
  }

  async checkPositions(client: PoolClient, market: MarketRecord): Promise<{ checked: number; liquidated: { position_id: string; quantity: number; mark_price: number; returned_cents: number }[] }> {
    const mark = market.last_price ?? market.seed_last_price ?? 0;
    const res = await client.query(
      `SELECT * FROM margin_positions WHERE market_id = $1 AND status = 'open'`,
      [market.id]
    );
    const liquidated: { position_id: string; quantity: number; mark_price: number; returned_cents: number }[] = [];
    for (const position of res.rows as PositionRecord[]) {
      const equity = positionEquity(position, mark);
      const maintenance = maintenanceRequirement(position.quantity, mark);
      if (equity < maintenance) {
        const returned = await this.liquidatePosition(client, market, position, mark);
        liquidated.push({ position_id: position.id, quantity: position.quantity, mark_price: mark, returned_cents: returned });
      }
    }
    return { checked: (res.rows as PositionRecord[]).length, liquidated };
  }

  async liquidatePosition(client: PoolClient, market: MarketRecord, position: PositionRecord, mark: number): Promise<number> {
    const equity = positionEquity(position, mark);
    const returned = Math.max(equity, 0);
    const deficit = equity < 0 ? -equity : 0;
    const venueId = market.venue_id;
    await postJournalEntry(client, venueId, {
      kind: 'liquidation', referenceId: position.id,
      legs: [
        { account: memberAccount(position.member_id, 'collateral'), amountCents: -position.collateral_cents },
        ...(deficit > 0 ? [{ account: venueAccount('insurance'), amountCents: -deficit }] : []),
        { account: memberAccount(position.member_id, 'available'), amountCents: returned },
      ].filter((leg) => leg.amountCents !== 0),
    });
    await client.query(`UPDATE margin_positions SET status = 'liquidated', liquidated_at = now() WHERE id = $1`, [position.id]);

    const orders = await client.query(
      `SELECT * FROM orders WHERE market_id = $1 AND member_id = $2 AND mode = 'margin' AND status IN ('resting','partially_filled')`,
      [market.id, position.member_id]
    );
    for (const order of orders.rows as OrderRecord[]) {
      await this.releaseOrderHold(client, venueId, order);
      await client.query(`UPDATE orders SET status = 'liquidated', hold_cents = 0 WHERE id = $1`, [order.id]);
      await this.publishMemberOrder(client, venueId, order.member_id, { ...order, status: 'liquidated' });
    }

    await enqueue(client, {
      kind: 'webhook',
      venueId,
      payload: {
        event_type: 'position.liquidated',
        member_id: position.member_id,
        market_id: market.id,
        position_id: position.id,
        side: position.side,
        quantity: position.quantity,
        mark_price: mark,
        returned_cents: returned,
        liquidated_at: new Date().toISOString(),
      },
    });
    await enqueue(client, {
      kind: 'member_event',
      venueId,
      payload: {
        member_id: position.member_id,
        event: 'liquidation',
        liquidation: { position_id: position.id, market_id: market.id, mark_price: mark },
      },
    });
    await this.publishMemberSnapshot(client, venueId, position.member_id);
    return returned;
  }

  async releaseOrderHold(client: PoolClient, venueId: string, order: OrderRecord): Promise<void> {
    if (order.hold_cents <= 0) return;
    await postJournalEntry(client, venueId, {
      kind: 'hold_release', referenceId: order.id,
      legs: [
        { account: memberAccount(order.member_id, 'held'), amountCents: -order.hold_cents },
        { account: memberAccount(order.member_id, 'available'), amountCents: order.hold_cents },
      ],
    });
    await client.query(`UPDATE orders SET hold_cents = 0 WHERE id = $1`, [order.id]);
  }

  async marketFees(client: PoolClient, venueId: string): Promise<MarketFees> {
    const res = await client.query(`SELECT taker_fee_bps, maker_fee_bps FROM venues WHERE id = $1`, [venueId]);
    const row = res.rows[0] as { taker_fee_bps: number; maker_fee_bps: number } | undefined;
    return { taker: row?.taker_fee_bps ?? 0, maker: row?.maker_fee_bps ?? 0 };
  }

  async openPosition(client: PoolClient, marketId: string, memberId: string): Promise<PositionRecord | null> {
    const res = await client.query(
      `SELECT * FROM margin_positions WHERE market_id = $1 AND member_id = $2 AND status = 'open'`,
      [marketId, memberId]
    );
    return (res.rows[0] as PositionRecord | undefined) ?? null;
  }

  private async sumReducingResting(client: PoolClient, marketId: string, memberId: string, side: OrderSide): Promise<number> {
    const res = await client.query(
      `SELECT COALESCE(SUM(quantity - filled_quantity), 0) AS total FROM orders
       WHERE market_id = $1 AND member_id = $2 AND mode = 'margin' AND side = $3 AND status IN ('resting','partially_filled')`,
      [marketId, memberId, side]
    );
    return Number((res.rows[0] as { total: string }).total);
  }

  private async spotHolding(client: PoolClient, marketId: string, memberId: string): Promise<{ quantity: number; reserved: number }> {
    const res = await client.query(
      `SELECT quantity, reserved FROM spot_holdings WHERE member_id = $1 AND market_id = $2`,
      [memberId, marketId]
    );
    return (res.rows[0] as { quantity: number; reserved: number }) ?? { quantity: 0, reserved: 0 };
  }

  private async adjustEventHolding(client: PoolClient, marketId: string, memberId: string, outcome: Outcome, qty: number): Promise<void> {
    await client.query(
      `INSERT INTO event_holdings (member_id, market_id, outcome, quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (member_id, market_id, outcome) DO UPDATE SET quantity = event_holdings.quantity + $4`,
      [memberId, marketId, outcome, qty]
    );
  }

  private async netEventHoldings(client: PoolClient, market: MarketRecord, memberId: string): Promise<void> {
    const res = await client.query(
      `SELECT outcome, quantity FROM event_holdings WHERE member_id = $1 AND market_id = $2`,
      [memberId, market.id]
    );
    const rows = res.rows as { outcome: Outcome; quantity: number }[];
    const yes = rows.find((r) => r.outcome === 'yes')?.quantity ?? 0;
    const no = rows.find((r) => r.outcome === 'no')?.quantity ?? 0;
    const pairs = Math.min(yes, no);
    if (pairs <= 0) return;
    const refund = pairs * EVENT_ESCROW_PER_CONTRACT;
    await client.query(
      `UPDATE event_holdings SET quantity = quantity - $3 WHERE member_id = $1 AND market_id = $2 AND outcome = 'yes'`,
      [memberId, market.id, pairs]
    );
    await client.query(
      `UPDATE event_holdings SET quantity = quantity - $3 WHERE member_id = $1 AND market_id = $2 AND outcome = 'no'`,
      [memberId, market.id, pairs]
    );
    await postJournalEntry(client, market.venue_id, {
      kind: 'netting', referenceId: `${memberId}:${market.id}`,
      legs: [
        { account: escrowAccount(market.id), amountCents: -refund },
        { account: memberAccount(memberId, 'available'), amountCents: refund },
      ],
    });
  }

  async bookSnapshot(client: PoolClient, market: MarketRecord): Promise<BookSnapshot> {
    const res = await client.query(
      `SELECT price, COALESCE(SUM(quantity - filled_quantity), 0) AS qty,
              COALESCE(SUM(CASE WHEN mode = 'spot' THEN quantity - filled_quantity ELSE 0 END), 0) AS spot_qty,
              COALESCE(SUM(CASE WHEN mode = 'margin' THEN quantity - filled_quantity ELSE 0 END), 0) AS margin_qty
       FROM orders WHERE market_id = $1 AND status IN ('resting','partially_filled')
       GROUP BY price`,
      [market.id]
    );
    const rows = res.rows as { price: number; qty: string; spot_qty: string; margin_qty: string }[];

    if (market.kind === 'event') {
      const bids = new Map<number, number>();
      const asks = new Map<number, number>();
      const outcomes = await client.query(
        `SELECT side, outcome, price, COALESCE(SUM(quantity - filled_quantity), 0) AS qty
         FROM orders WHERE market_id = $1 AND status IN ('resting','partially_filled')
         GROUP BY side, outcome, price`,
        [market.id]
      );
      for (const row of outcomes.rows as { side: OrderSide; outcome: Outcome; price: number; qty: string }[]) {
        const yes = toYesPrice(row.outcome, row.price);
        const qty = Number(row.qty);
        if (row.outcome === 'yes') {
          bids.set(yes, (bids.get(yes) ?? 0) + qty);
        } else {
          asks.set(yes, (asks.get(yes) ?? 0) + qty);
        }
      }
      const bidLevels = [...bids.entries()].map(([price, quantity]) => ({ price, quantity })).sort((a, b) => b.price - a.price);
      const askLevels = [...asks.entries()].map(([price, quantity]) => ({ price, quantity })).sort((a, b) => a.price - b.price);
      return {
        market_id: market.id,
        sequence: 0,
        last_price: market.last_price,
        bids: bidLevels,
        asks: askLevels,
      };
    }

    const bidLevels = rows.map((r) => ({ price: r.price, quantity: Number(r.qty), spot_quantity: Number(r.spot_qty), margin_quantity: Number(r.margin_qty) }))
      .filter((l) => l.quantity > 0)
      .sort((a, b) => b.price - a.price);
    const askLevels = rows.map((r) => ({ price: r.price, quantity: Number(r.qty), spot_quantity: Number(r.spot_qty), margin_quantity: Number(r.margin_qty) }))
      .filter((l) => l.quantity > 0)
      .sort((a, b) => a.price - b.price);
    // bids and asks must split by side; re-query properly
    const bySide = await client.query(
      `SELECT side, price, COALESCE(SUM(quantity - filled_quantity), 0) AS qty,
              COALESCE(SUM(CASE WHEN mode = 'spot' THEN quantity - filled_quantity ELSE 0 END), 0) AS spot_qty,
              COALESCE(SUM(CASE WHEN mode = 'margin' THEN quantity - filled_quantity ELSE 0 END), 0) AS margin_qty
       FROM orders WHERE market_id = $1 AND status IN ('resting','partially_filled')
       GROUP BY side, price`,
      [market.id]
    );
    const sideRows = bySide.rows as { side: OrderSide; price: number; qty: string; spot_qty: string; margin_qty: string }[];
    const pairBids = sideRows.filter((r) => r.side === 'buy').map((r) => ({ price: r.price, quantity: Number(r.qty), spot_quantity: Number(r.spot_qty), margin_quantity: Number(r.margin_qty) })).sort((a, b) => b.price - a.price);
    const pairAsks = sideRows.filter((r) => r.side === 'sell').map((r) => ({ price: r.price, quantity: Number(r.qty), spot_quantity: Number(r.spot_qty), margin_quantity: Number(r.margin_qty) })).sort((a, b) => a.price - b.price);
    return {
      market_id: market.id,
      sequence: 0,
      last_price: market.last_price,
      bids: pairBids,
      asks: pairAsks,
    };
    void bidLevels; void askLevels;
  }

  async loadOrder(client: PoolClient, orderId: string): Promise<OrderRecord> {
    const res = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    return res.rows[0] as OrderRecord;
  }

  async loadOrderForUpdate(client: PoolClient, venueId: string, memberId: string, orderId: string): Promise<OrderRecord> {
    const res = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND venue_id = $2 AND member_id = $3 FOR UPDATE`,
      [orderId, venueId, memberId]
    );
    const order = res.rows[0] as OrderRecord | undefined;
    if (!order) throw notFound();
    return order;
  }

  async closeEvent(venueId: string, marketId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
      const market = await this.loadMarket(client, venueId, marketId);
      const now = new Date();
      if (market.kind !== 'event') return;
      if (market.status !== 'trading' && market.status !== 'halted') return;
      if (!market.closes_at || market.closes_at.getTime() > now.getTime()) return;
      await client.query(`UPDATE markets SET status = 'closed', auto_closed = true WHERE id = $1`, [marketId]);
      const orders = await client.query(
        `SELECT * FROM orders WHERE market_id = $1 AND status IN ('resting','partially_filled')`,
        [marketId]
      );
      for (const order of orders.rows as OrderRecord[]) {
        await this.releaseOrderHold(client, venueId, order);
        await client.query(`UPDATE orders SET status = 'cancelled', reserved_units = 0 WHERE id = $1`, [order.id]);
        await this.publishMemberOrder(client, venueId, order.member_id, { ...order, status: 'cancelled' });
        await this.publishMemberSnapshot(client, venueId, order.member_id);
      }
      await this.publishMarketSnapshot(client, marketId);
    });
  }

  async resolveEvent(venueId: string, marketId: string, outcome: Outcome): Promise<MarketRecord> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
      const market = await this.loadMarket(client, venueId, marketId);
      const now = new Date();
      const status = this.effectiveStatus(market, now);
      if (!marketCanTransition('event', status, 'resolved')) {
        throw conflict('invalid_transition', { from: status, to: 'resolved' });
      }
      await client.query(`UPDATE markets SET status = 'resolved', outcome = $2 WHERE id = $1`, [marketId, outcome]);
      await this.publishMarketSnapshot(client, marketId);
      return { ...market, status: 'resolved', outcome };
    });
  }

  async settleEvent(venueId: string, marketId: string, outcome: Outcome): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
      const market = await this.loadMarket(client, venueId, marketId);
      if (market.status !== 'resolved') return;
      const res = await client.query(
        `SELECT member_id, quantity FROM event_holdings WHERE market_id = $1 AND outcome = $2 AND quantity > 0`,
        [marketId, outcome]
      );
      for (const holding of res.rows as { member_id: string; quantity: number }[]) {
        const payout = holding.quantity * EVENT_ESCROW_PER_CONTRACT;
        await postJournalEntry(client, venueId, {
          kind: 'payout', referenceId: `${marketId}:${holding.member_id}`,
          legs: [
            { account: escrowAccount(marketId), amountCents: -payout },
            { account: memberAccount(holding.member_id, 'available'), amountCents: payout },
          ],
        });
        await enqueue(client, {
          kind: 'webhook',
          venueId,
          payload: {
            event_type: 'event.settled',
            member_id: holding.member_id,
            market_id: marketId,
            outcome,
            contracts: holding.quantity,
            payout_cents: payout,
            settled_at: new Date().toISOString(),
          },
        });
        await this.publishMemberSnapshot(client, venueId, holding.member_id);
      }
      await client.query(`UPDATE markets SET status = 'settled', settled_at = now() WHERE id = $1`, [marketId]);
      await this.publishMarketSnapshot(client, marketId);
    });
  }

  private async publishMarketSnapshot(client: PoolClient, marketId: string): Promise<void> {
    const market = await this.loadMarketAny(client, marketId);
    if (!market) return;
    const snapshot = await this.bookSnapshot(client, market);
    await enqueue(client, {
      kind: 'book',
      venueId: market.venue_id,
      payload: { event: 'book', book: snapshot },
    });
    await enqueue(client, {
      kind: 'book',
      venueId: market.venue_id,
      payload: { event: 'market', market_id: marketId, status: market.status, last_price: market.last_price },
    });
  }

  private async publishMemberSnapshot(client: PoolClient, venueId: string, memberId: string): Promise<void> {
    await enqueue(client, {
      kind: 'member_event',
      venueId,
      payload: { member_id: memberId, event: 'balance', venue_id: venueId },
    });
  }

  private async publishMemberOrder(client: PoolClient, venueId: string, memberId: string, order: OrderRecord): Promise<void> {
    await enqueue(client, {
      kind: 'member_event',
      venueId,
      payload: { member_id: memberId, event: 'order', order },
    });
  }

  private async enqueueOrderEvents(
    client: PoolClient,
    venueId: string,
    market: MarketRecord,
    memberId: string,
    orderId: string,
    fillId: string,
    fill: {
      mode: OrderMode; side: OrderSide; outcome: Outcome | null;
      price: number; quantity: number; fee_cents: number; liquidity: 'maker' | 'taker';
      order_status: OrderStatus; filled_at: string;
    }
  ): Promise<void> {
    await enqueue(client, {
      kind: 'member_event',
      venueId,
      payload: {
        member_id: memberId,
        event: 'fill',
        fill: { id: fillId, order_id: orderId, market_id: market.id, ...fill },
      },
    });
    await enqueue(client, {
      kind: 'webhook',
      venueId,
      payload: {
        event_type: 'order.filled',
        member_id: memberId,
        market_id: market.id,
        market_symbol: market.symbol,
        order_id: orderId,
        fill_id: fillId,
        mode: fill.mode,
        side: fill.side,
        outcome: fill.outcome,
        price: fill.price,
        quantity: fill.quantity,
        fee_cents: fill.fee_cents,
        liquidity: fill.liquidity,
        order_status: fill.order_status,
        filled_at: fill.filled_at,
      },
    });
  }

  async transitionMarket(venueId: string, marketId: string, to: MarketStatus): Promise<MarketRecord> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT id FROM markets WHERE id = $1 FOR UPDATE`, [marketId]);
      const market = await this.loadMarket(client, venueId, marketId);
      const now = new Date();
      const current = this.effectiveStatus(market, now);
      const kind = market.kind;
      if (kind === 'event' && (to === 'trading') && market.closes_at && market.closes_at.getTime() <= now.getTime()) {
        throw conflict('invalid_transition', { from: current, to });
      }
      if (!marketCanTransition(kind, current, to)) {
        throw conflict('invalid_transition', { from: current, to });
      }
      await client.query(`UPDATE markets SET status = $2 WHERE id = $1`, [marketId, to]);
      await this.publishMarketSnapshot(client, marketId);
      return { ...market, status: to };
    });
  }
}
