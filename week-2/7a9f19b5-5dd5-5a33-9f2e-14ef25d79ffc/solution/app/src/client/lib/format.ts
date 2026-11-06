import { dollars } from "../../shared/money";
import type { Product, Variant } from "../../shared/types";

/** `$<price> + GST`, the brief's price line. */
export function plusGst(cents: number): string {
  return `${dollars(cents)} + GST`;
}

/** The caller's tier price: trade for approved trade buyers and admins, retail for everyone else. */
export function tierPrice(variant: Variant, seesTrade: boolean): number {
  return seesTrade && variant.trade_price_cents !== undefined ? variant.trade_price_cents : variant.retail_price_cents;
}

export function variantByCode(product: Product, code: string | null): Variant {
  return product.variants.find((v) => v.code === code) ?? product.variants.find((v) => v.code === product.default_variant)!;
}

/** The variant a catalogue card shows: the default, or the clearance variant when browsing clearance. */
export function shownVariant(product: Product, clearance: boolean): Variant {
  const fallback = variantByCode(product, product.default_variant);
  return clearance ? (product.variants.find((v) => v.clearance) ?? fallback) : fallback;
}

export function stockBadge(variant: Variant): string | null {
  if (!variant.clearance || variant.stock_on_hand === null) return null;
  if (variant.stock_on_hand === 0) return "Sold out";
  return variant.stock_on_hand <= 5 ? `Only ${variant.stock_on_hand} left` : null;
}

export type FittingKind = "recessed" | "track" | "pendant" | "cylinder" | "gimbal";

const KINDS: Record<string, FittingKind> = {
  KDL: "recessed",
  TTS: "track",
  PHP: "pendant",
  HSC: "cylinder",
  RGD: "gimbal",
};

export function fittingKind(code: string): FittingKind {
  return KINDS[code.split("-")[0] ?? ""] ?? "recessed";
}

export const FINISH_COLOURS: Record<string, string> = {
  WH: "#E9E6E0",
  BK: "#1B1C1F",
  BR: "#B48F55",
  BZ: "#6A4C36",
  CH: "#3A3C40",
  SN: "#B8BBBE",
};

export const LIGHT_COLOURS: Record<number, string> = {
  2700: "#FFB45E",
  3000: "#FFE2B8",
  4000: "#DCE9FF",
};

export function lightColour(cct: number): string {
  return LIGHT_COLOURS[cct] ?? LIGHT_COLOURS[3000]!;
}

export function familyLabel(family: string): string {
  return (
    { downlights: "Downlights", "track-spots": "Track spots", pendants: "Pendants", surface: "Surface mounted" }[family] ??
    family
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
