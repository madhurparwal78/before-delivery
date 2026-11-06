export type Market = 'copenhagen' | 'stockholm' | 'paris' | 'london' | 'new_york' | 'tokyo';
export type DropType = 'simultaneous' | 'rolling';
export type Role = 'launch_producer' | 'merchandiser' | 'finance_lead' | 'press_lead' | 'stockist_buyer';

export interface MarketInfo { market: Market; city: string; timeZone: string; currency: string; }

// The single source of market data and the published market order.
export const MARKETS: MarketInfo[] = [
  { market: 'copenhagen', city: 'Copenhagen', timeZone: 'Europe/Copenhagen', currency: 'DKK' },
  { market: 'stockholm', city: 'Stockholm', timeZone: 'Europe/Stockholm', currency: 'SEK' },
  { market: 'paris', city: 'Paris', timeZone: 'Europe/Paris', currency: 'EUR' },
  { market: 'london', city: 'London', timeZone: 'Europe/London', currency: 'GBP' },
  { market: 'new_york', city: 'New York', timeZone: 'America/New_York', currency: 'USD' },
  { market: 'tokyo', city: 'Tokyo', timeZone: 'Asia/Tokyo', currency: 'JPY' }
];

export const MARKET_ORDER: Market[] = MARKETS.map(m => m.market);
export const MARKETS_BY_MARKET: Record<string, MarketInfo> = Object.fromEntries(MARKETS.map(m => [m.market, m]));
export const ZONES = MARKETS.map(m => ({ market: m.market, timeZone: m.timeZone }));

export function marketInfo(market: string): MarketInfo | null {
  return MARKETS_BY_MARKET[market] ?? null;
}

export function marketCity(market: string): string {
  return MARKETS_BY_MARKET[market]?.city ?? market;
}

// Night is decided here, and only here: 22:00 up to but not including 07:00 local.
export function isNightAt(instant: Date, timeZone: string): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(instant).replace('24', '0'));
  return h >= 22 || h < 7;
}

export const ROLE_LABELS: Record<Role, string> = {
  launch_producer: 'Launch producer',
  merchandiser: 'Merchandiser',
  finance_lead: 'Finance lead',
  press_lead: 'Press lead',
  stockist_buyer: 'Stockist buyer'
};

export const ROLE_VALUES = Object.keys(ROLE_LABELS) as Role[];
