import { FLAVOURS, type FlavourSlug } from '../../shared/catalogue.js';
import { query, type Runner, type Transaction } from './pool.js';

export type LedgerEventKind = 'received' | 'reserved' | 'released' | 'sold' | 'returned';

export interface StockFigures {
  flavour: FlavourSlug;
  received: number;
  sold: number;
  returned: number;
  on_hand: number;
  reserved: number;
  available: number;
  /** The limited drop's release quantity, and null for a regular flavour. */
  released: number | null;
}

const TOTALS_SQL = `
  select flavour,
         coalesce(sum(case when kind = 'received' then quantity else 0 end), 0)::int as received,
         coalesce(sum(case when kind = 'reserved' then quantity else 0 end), 0)::int as reserved,
         coalesce(sum(case when kind = 'released' then quantity else 0 end), 0)::int as released_events,
         coalesce(sum(case when kind = 'sold'     then quantity else 0 end), 0)::int as sold,
         coalesce(sum(case when kind = 'returned' then quantity else 0 end), 0)::int as returned
    from stock_events
   group by flavour`;

interface TotalsRow {
  flavour: string;
  received: number;
  reserved: number;
  released_events: number;
  sold: number;
  returned: number;
}

/**
 * The ledger identities, in one place: on hand is received less sold plus
 * returned, reserved is the cans still held, and available subtracts the two.
 * The limited drop's available figure is also capped by its release quantity.
 */
async function figuresFrom(
  runner: Runner,
  releaseQuantities: ReadonlyMap<FlavourSlug, number | null>,
): Promise<StockFigures[]> {
  const rows = await runner.query<TotalsRow>(TOTALS_SQL);
  const byFlavour = new Map(rows.map((row) => [row.flavour, row]));

  return FLAVOURS.map((flavour) => {
    const totals = byFlavour.get(flavour.slug);
    const received = totals?.received ?? 0;
    const sold = totals?.sold ?? 0;
    const returned = totals?.returned ?? 0;
    const onHand = received - sold + returned;
    const reserved = (totals?.reserved ?? 0) - (totals?.released_events ?? 0);
    const releaseQuantity = releaseQuantities.get(flavour.slug) ?? null;
    const available =
      releaseQuantity === null
        ? onHand - reserved
        : Math.min(onHand - reserved, releaseQuantity - reserved - sold);
    return {
      flavour: flavour.slug,
      received,
      sold,
      returned,
      on_hand: onHand,
      reserved,
      available,
      released: releaseQuantity,
    };
  });
}

async function releaseQuantities(
  runner: Runner,
  lockForUpdate: boolean,
): Promise<Map<FlavourSlug, number | null>> {
  const rows = await runner.query<{ slug: string; released: number | null }>(
    `select slug, released from flavours order by slug${lockForUpdate ? ' for update' : ''}`,
  );
  const byFlavour = new Map(rows.map((row) => [row.slug, row.released]));
  return new Map(
    FLAVOURS.map((flavour) => [
      flavour.slug,
      flavour.limited ? (byFlavour.get(flavour.slug) ?? 0) : null,
    ]),
  );
}

/** The stock figures behind `GET /api/staff/stock` and every `stock_left` count. */
export async function stockFigures(): Promise<StockFigures[]> {
  const runner: Runner = { query };
  return figuresFrom(runner, await releaseQuantities(runner, false));
}

export async function availableStock(): Promise<Map<FlavourSlug, number>> {
  return new Map((await stockFigures()).map((figure) => [figure.flavour, figure.available]));
}

/**
 * The figures seen after locking the flavour rows, so competing reservations are
 * granted in the order the server commits them and never take available below 0.
 */
export async function lockedStockFigures(tx: Transaction): Promise<Map<FlavourSlug, StockFigures>> {
  const figures = await figuresFrom(tx, await releaseQuantities(tx, true));
  return new Map(figures.map((figure) => [figure.flavour, figure]));
}

export async function writeLedgerEvent(
  tx: Transaction,
  flavour: FlavourSlug,
  kind: LedgerEventKind,
  quantity: number,
): Promise<void> {
  await tx.execute('insert into stock_events (flavour, kind, quantity) values ($1, $2, $3)', [
    flavour,
    kind,
    quantity,
  ]);
}

/** The limited drop's reserved plus sold cans, which a release may never go below. */
export async function committedDropCans(): Promise<number> {
  const drop = (await stockFigures()).find((figure) => figure.released !== null);
  return drop === undefined ? 0 : drop.reserved + drop.sold;
}
