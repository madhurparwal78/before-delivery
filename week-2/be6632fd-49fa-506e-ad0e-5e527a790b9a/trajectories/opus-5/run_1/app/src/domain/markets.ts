export const MARKETS = ['copenhagen', 'stockholm', 'paris', 'london', 'new_york', 'tokyo'] as const;

export type Market = (typeof MARKETS)[number];

export const COPENHAGEN_ZONE = 'Europe/Copenhagen';

export const CURRENCIES = ['DKK', 'SEK', 'EUR', 'GBP', 'USD', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];

interface MarketInfo {
  readonly city: string;
  readonly zone: string;
  readonly currency: Currency;
}

const INFO: Record<Market, MarketInfo> = {
  copenhagen: { city: 'Copenhagen', zone: COPENHAGEN_ZONE, currency: 'DKK' },
  stockholm: { city: 'Stockholm', zone: 'Europe/Stockholm', currency: 'SEK' },
  paris: { city: 'Paris', zone: 'Europe/Paris', currency: 'EUR' },
  london: { city: 'London', zone: 'Europe/London', currency: 'GBP' },
  new_york: { city: 'New York', zone: 'America/New_York', currency: 'USD' },
  tokyo: { city: 'Tokyo', zone: 'Asia/Tokyo', currency: 'JPY' },
};

export function marketCity(market: Market): string {
  return INFO[market].city;
}

export function marketZone(market: Market): string {
  return INFO[market].zone;
}

export function marketCurrency(market: Market): Currency {
  return INFO[market].currency;
}

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && (MARKETS as readonly string[]).includes(value);
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** Only stockists in the Copenhagen market are Danish for VAT. */
export function isDanishVat(market: Market): boolean {
  return market === 'copenhagen';
}
