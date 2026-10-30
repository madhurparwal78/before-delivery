// Server-owned data the pages need but no endpoint publishes, written once into every page shell.
import { BOARD_NAMES, BOARD_SEED, COMPONENT_SEED } from "./catalog.ts";
import { slotDelta } from "./domain/builds.ts";
import { CALLBACK_TOPICS, CALLBACK_ZONES } from "./domain/callbacks.ts";
import { CART_LIMITS } from "./domain/cart.ts";
import { CANADIAN_POSTAL_PATTERN, COUNTRIES, PROVINCES } from "./domain/checkout.ts";
import { quizCopy } from "./domain/match.ts";
import { PROTECTION_PRICES } from "./domain/protection.ts";
import { TRADE_IN_BRANDS } from "./domain/tradeins.ts";

/** Each board package's price delta for every component, as the configurator lists them beside each option. */
function optionDeltas(): Record<string, Record<string, number>> {
  const price = (sku: string) => COMPONENT_SEED.find((c) => c.sku === sku)!;
  return Object.fromEntries(BOARD_SEED.map((b) => [b.sku, Object.fromEntries(COMPONENT_SEED.map((c) => [c.sku, slotDelta(c, price(b.defaults[c.slot]))]))]));
}

/** The package with the lowest price of each board ("From <price>"); the first in Seed data on a tie. */
function lineupFrom(): Record<string, string> {
  return Object.fromEntries(BOARD_NAMES.map((name) => {
    const sizes = BOARD_SEED.filter((b) => b.name === name);
    return [name, sizes.reduce((low, b) => (b.price_cents < low.price_cents ? b : low)).sku];
  }));
}

export function bootData(): string {
  const data = {
    countries: COUNTRIES,
    provinces: PROVINCES,
    canadianPostalPattern: CANADIAN_POSTAL_PATTERN,
    cartLimits: CART_LIMITS,
    optionDeltas: optionDeltas(),
    lineupFrom: lineupFrom(),
    quiz: quizCopy(),
    callback: { zones: CALLBACK_ZONES, topics: CALLBACK_TOPICS },
    protection: PROTECTION_PRICES,
    tradeInBrands: TRADE_IN_BRANDS,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
