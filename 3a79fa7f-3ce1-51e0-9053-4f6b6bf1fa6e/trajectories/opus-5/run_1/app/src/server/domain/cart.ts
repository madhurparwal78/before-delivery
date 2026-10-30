import { fail } from '../errors.js';
import { roundHalfUp } from '../money.js';
import { boardPackage, boardPackageName, sellableSku } from './catalog.js';
import { financingFor, type FinancingTerm } from './financing.js';

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export const BUILD_LINE_CAP = 2;
export const BUILD_TOTAL_CAP = 3;
export const ACCESSORY_LINE_CAP = 5;

export interface CartLineShape {
  id: number;
  type: 'build' | 'accessory';
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

export interface CartCodeShape {
  code: string;
  amount_cents: number;
}

export interface CartShape {
  lines: CartLineShape[];
  accessory_subtotal_cents: number;
  build_subtotal_cents: number;
  subtotal_cents: number;
  codes: CartCodeShape[];
  item_count: number;
  financing: FinancingTerm[];
}

interface LineRow {
  id: string;
  type: string;
  build_code: string | null;
  sku: string;
  quantity: number;
}

export const DISCOUNT_CODES = ['FLYFIRST', 'CHARGE25'] as const;
export type DiscountCode = (typeof DISCOUNT_CODES)[number];

export function normaliseCode(value: unknown): DiscountCode | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (DISCOUNT_CODES as readonly string[]).includes(upper) ? (upper as DiscountCode) : null;
}

function codeAmount(code: DiscountCode, accessorySubtotal: number): number {
  if (code === 'FLYFIRST') return Number(roundHalfUp(BigInt(accessorySubtotal) * 10n, 100n));
  return accessorySubtotal >= 10000 ? 2500 : 0;
}

/** Code amounts, in the order they were added, each capped so the pair never exceeds the accessory subtotal. */
export function codeAmounts(codes: DiscountCode[], accessorySubtotal: number): CartCodeShape[] {
  let remaining = accessorySubtotal;
  return codes.map((code) => {
    const amount = Math.min(codeAmount(code, accessorySubtotal), Math.max(0, remaining));
    remaining -= amount;
    return { code, amount_cents: amount };
  });
}

export function buildLineName(boardSku: string, code: string): string {
  const pkg = boardPackage(boardSku);
  return `${pkg ? boardPackageName(pkg) : boardSku} build ${code}`;
}

export async function cartLineUnitCents(db: Queryable, row: LineRow): Promise<{ name: string; unitCents: number }> {
  if (row.type === 'build') {
    const { buildFromCode } = await import('./buildstore.js');
    const build = await buildFromCode(db, row.build_code ?? '');
    if (!build) throw new Error(`Cart line references missing build ${row.build_code}`);
    return { name: buildLineName(build.board_sku, build.code), unitCents: build.total_cents };
  }
  const item = sellableSku(row.sku);
  if (!item) throw new Error(`Cart line references missing SKU ${row.sku}`);
  return { name: item.name, unitCents: item.priceCents };
}

export async function loadCart(db: Queryable, cartId: number): Promise<CartShape> {
  const lineRows = (
    await db.query('SELECT id, type, build_code, sku, quantity FROM cart_lines WHERE cart_id = $1 ORDER BY id', [cartId])
  ).rows as unknown as LineRow[];
  const codeRows = (await db.query('SELECT code FROM cart_codes WHERE cart_id = $1 ORDER BY id', [cartId])).rows as {
    code: string;
  }[];

  const lines: CartLineShape[] = [];
  let accessorySubtotal = 0;
  let buildSubtotal = 0;
  let itemCount = 0;
  for (const row of lineRows) {
    const { name, unitCents } = await cartLineUnitCents(db, row);
    const lineCents = unitCents * row.quantity;
    lines.push({
      id: Number(row.id),
      type: row.type as 'build' | 'accessory',
      code: row.type === 'build' ? row.build_code : null,
      sku: row.sku,
      name,
      quantity: row.quantity,
      unit_cents: unitCents,
      line_cents: lineCents,
    });
    if (row.type === 'build') buildSubtotal += lineCents;
    else accessorySubtotal += lineCents;
    itemCount += row.quantity;
  }

  const codes = codeAmounts(
    codeRows.map((r) => r.code as DiscountCode),
    accessorySubtotal,
  );
  const subtotal = accessorySubtotal + buildSubtotal;
  const financedAmount = subtotal - codes.reduce((sum, c) => sum + c.amount_cents, 0);

  return {
    lines,
    accessory_subtotal_cents: accessorySubtotal,
    build_subtotal_cents: buildSubtotal,
    subtotal_cents: subtotal,
    codes,
    item_count: itemCount,
    financing: financingFor(financedAmount),
  };
}

export function failLimit(cap: number): never {
  fail('limit', { message: `Limit ${cap} per order.`, fields: { quantity: `Limit ${cap} per order.` } });
}
