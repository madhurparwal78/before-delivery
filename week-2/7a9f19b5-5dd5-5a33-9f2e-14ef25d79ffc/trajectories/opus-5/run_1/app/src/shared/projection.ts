/**
 * The one role projection of price fields. Only approved trade buyers and admins
 * ever receive `trade_price_cents`; everyone else receives exactly the public keys.
 */

import type { PriceTier, PublicVariant, Role, TradeStatus, TradeVariant, Variant } from "./types.js";

export interface Viewer {
  role: Role;
  trade_status: TradeStatus;
}

/** Signed-out visitors are modelled as no viewer at all. */
export function seesTradePrices(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || (viewer.role === "trade" && viewer.trade_status === "approved");
}

export function priceTierFor(viewer: Viewer | null): PriceTier {
  return seesTradePrices(viewer) ? "trade" : "retail";
}

/** Projects are only for approved trade buyers, never for admins acting as staff. */
export function hasTradeAccount(viewer: Viewer | null): boolean {
  return viewer?.role === "trade" && viewer.trade_status === "approved";
}

/** Every field the catalogue, product, search and comparison responses may carry. */
export interface VariantSource {
  code: string;
  finish: PublicVariant["finish"];
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  retail_price_cents: number;
  trade_price_cents: number;
  was_price_cents: number | null;
  clearance: boolean;
  stock_on_hand: number | null;
}

export function projectVariant(source: VariantSource, viewer: Viewer | null): Variant {
  const base: PublicVariant = {
    code: source.code,
    finish: source.finish,
    finish_name: source.finish_name,
    beam_deg: source.beam_deg,
    cct_k: source.cct_k,
    lumens: source.lumens,
    candela: source.candela,
    retail_price_cents: source.retail_price_cents,
    was_price_cents: source.clearance ? source.was_price_cents : null,
    clearance: source.clearance,
    stock_on_hand: source.clearance ? source.stock_on_hand : null,
  };
  if (!seesTradePrices(viewer)) return base;
  const trade: TradeVariant = { ...base, trade_price_cents: source.trade_price_cents };
  return trade;
}

/** The price a cart line is struck at for this tier. */
export function unitPriceCentsFor(
  prices: Pick<VariantSource, "retail_price_cents" | "trade_price_cents">,
  tier: PriceTier,
): number {
  return tier === "trade" ? prices.trade_price_cents : prices.retail_price_cents;
}

/** The price shown in the light readout and the variant-change announcement. */
export function tierPriceCents(variant: Variant): number {
  return "trade_price_cents" in variant ? variant.trade_price_cents : variant.retail_price_cents;
}
