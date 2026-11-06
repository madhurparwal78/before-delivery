import { withClient, type DbClient } from '../db.js';
import { upsertStockLevel } from '../services/pocketbase.js';
import { databaseName } from '../env.js';

export interface Flavour {
  slug: string;
  name: string;
  can_price_cents: number;
  limited: boolean;
  subscribable: boolean;
  received: number;
  released: number | null;
}

export const FLAVOUR_ORDER = ['guava-lime', 'yuzu-ginger', 'passionfruit-basil', 'cacao-orange'];

export async function listFlavours(client?: DbClient): Promise<Flavour[]> {
  const c = client ?? (await withClient(async (cl) => cl));
  const q = await c.query(
    'select slug, name, can_price_cents, limited, subscribable, received, released from flavours order by array_position($1::text[], slug)',
    [FLAVOUR_ORDER]
  );
  return q.rows as Flavour[];
}

export async function getFlavour(slug: string, client?: DbClient): Promise<Flavour | null> {
  const c = client ?? (await withClient(async (x) => x));
  const q = await c.query('select slug, name, can_price_cents, limited, subscribable, received, released from flavours where slug = $1', [slug]);
  return (q.rows[0] as Flavour) ?? null;
}

export interface LedgerFigures {
  flavour: string;
  received: number;
  sold: number;
  returned: number;
  on_hand: number;
  reserved: number;
  available: number;
  released: number | null;
}

export function ledgerFigures(rows: {
  flavour: string;
  kind: string;
  qty: number;
}[], flavours: Flavour[]): LedgerFigures[] {
  const totals = new Map<string, { received: number; sold: number; returned: number; reserved: number; released: number }>();
  for (const flavour of flavours) {
    totals.set(flavour.slug, { received: 0, sold: 0, returned: 0, reserved: 0, released: 0 });
  }
  for (const row of rows) {
    const t = totals.get(row.flavour);
    if (!t) continue;
    if (row.kind === 'received') t.received += row.qty;
    else if (row.kind === 'sold') t.sold += row.qty;
    else if (row.kind === 'returned') t.returned += row.qty;
    else if (row.kind === 'reserved') t.reserved += row.qty;
    else if (row.kind === 'released') t.released += row.qty;
  }
  return flavours.map((f) => {
    const t = totals.get(f.slug)!;
    const onHand = t.received - t.sold + t.returned;
    // A reservation ends when its can goes back to the shelf or is sold.
    const reserved = Math.max(0, t.reserved - t.released - t.sold);
    const available = f.limited
      ? Math.min(onHand - reserved, (f.released ?? 0) - reserved - t.sold)
      : onHand - reserved;
    return {
      flavour: f.slug,
      received: t.received,
      sold: t.sold,
      returned: t.returned,
      on_hand: onHand,
      reserved,
      available: Math.max(0, available),
      released: f.released,
    };
  });
}

export async function stockForAll(): Promise<LedgerFigures[]> {
  return withClient(async (client) => {
    const flavours = await listFlavures(client);
    const q = await client.query('select flavour, kind, qty from stock_ledger');
    return ledgerFigures(q.rows, flavours);
  });
}

async function listFlavures(client: DbClient): Promise<Flavour[]> {
  const q = await client.query(
    'select slug, name, can_price_cents, limited, subscribable, received, released from flavours order by array_position($1::text[], slug)',
    [FLAVOUR_ORDER]
  );
  return q.rows as Flavour[];
}

export async function stockLeftOf(flavour: string, client: DbClient): Promise<number> {
  const rows = (await client.query('select flavour, kind, qty from stock_ledger where flavour = $1', [flavour]))
    .rows as { flavour: string; kind: string; qty: number }[];
  const f = await getFlavour(flavour, client);
  if (!f) return 0;
  const figures = ledgerFigures(rows, [f]);
  return figures[0].available;
}

export async function pushStockLevels(): Promise<void> {
  try {
    const figures = await stockForAll();
    for (const f of figures) {
      await upsertStockLevel(databaseName(), f.flavour, f.available);
    }
  } catch {
    // PocketBase down; live feed pauses and will catch up on the next ledger change.
  }
}

export async function flavourName(slug: string): Promise<string> {
  return withClient(async (client) => {
    const q = await client.query('select name from flavours where slug = $1', [slug]);
    return (q.rows[0]?.name as string) ?? slug;
  });
}
