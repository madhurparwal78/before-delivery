import type { DbClient } from './db.js'
import type { VariantSeed } from './seed.js'
import { finish_name } from './seed.js'

export interface VariantRow {
  id: number
  code: string
  product_id: number
  finish: string
  beam_deg: number
  cct_k: number
  lumens: number
  candela: number
  retail_price_cents: number
  trade_price_cents: number
  clearance: boolean
  clearance_price_cents: number | null
  was_price_cents: number | null
  stock_on_hand: number
}

export interface ProductRow {
  id: number
  slug: string
  name: string
  family: string
  description: string
  watts: number
  cri: number
  ip_rating: string
  default_variant: string
}

export async function load_variant(client: DbClient, code: string): Promise<VariantRow | null> {
  const result = await client.query<VariantRow>(
    'SELECT id, code, product_id, finish, beam_deg, cct_k, lumens, candela, retail_price_cents, trade_price_cents, clearance, clearance_price_cents, was_price_cents, stock_on_hand FROM variants WHERE code=$1',
    [code],
  )
  return result.rows[0] ?? null
}

export interface Caller {
  id: number
  email: string
  name: string
  role: 'retail' | 'trade' | 'admin'
  trade_status: string | null
  dial_mode: string
  is_admin(): boolean
  is_approved_trade(): boolean
  trade_price_visible(): boolean
}

export function caller_from_row(row: {
  id: number; email: string; name: string; role: string; trade_status: string | null; dial_mode: string
}): Caller {
  const role = row.role as Caller['role']
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    trade_status: row.trade_status,
    dial_mode: row.dial_mode,
    is_admin: () => role === 'admin',
    is_approved_trade: () => role === 'trade' && row.trade_status === 'approved',
    trade_price_visible: () => role === 'admin' || (role === 'trade' && row.trade_status === 'approved'),
  }
}

/** Role projection of a variant: exactly the published key list for the caller. */
export function variant_public(v: VariantRow, caller: Caller | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: v.code,
    finish: v.finish,
    finish_name: finish_name(v.finish),
    beam_deg: v.beam_deg,
    cct_k: v.cct_k,
    lumens: v.lumens,
    candela: v.candela,
    retail_price_cents: v.retail_price_cents,
    was_price_cents: v.clearance ? v.was_price_cents : null,
    clearance: v.clearance,
    stock_on_hand: v.clearance ? v.stock_on_hand : null,
  }
  if (caller && caller.trade_price_visible()) body.trade_price_cents = v.trade_price_cents
  return body
}

export function product_public(
  p: ProductRow,
  variants: VariantRow[],
  caller: Caller | null,
): Record<string, unknown> {
  return {
    slug: p.slug,
    name: p.name,
    family: p.family,
    description: p.description,
    watts: p.watts,
    cri: p.cri,
    ip_rating: p.ip_rating,
    default_variant: p.default_variant,
    variants: variants.map((v) => variant_public(v, caller)),
  }
}

export type VariantProjection = ReturnType<typeof variant_public>
export type { VariantSeed }
