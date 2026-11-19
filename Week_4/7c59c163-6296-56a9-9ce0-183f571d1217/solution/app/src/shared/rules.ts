// Domain rules shared by the server and the order ticket. Every rule here is decided once.

export type MarketKind = "pair" | "event";
export type MarketStatus = "listed" | "trading" | "halted" | "closed" | "resolved" | "settled";
export type MarketAction = "open" | "halt" | "resume" | "resolve" | "settle";
export type Outcome = "yes" | "no";
export type Mode = "spot" | "margin";
export type Side = "buy" | "sell";
export type OrderStatus = "resting" | "partially_filled" | "filled" | "cancelled" | "liquidated";
export type Role = "trader" | "builder" | "market_admin" | "org_owner" | "founder_operator";
export type Plan = "sandbox" | "builder" | "desk";
export type PlanState = "active" | "payment_failed" | "downgraded";

export const ROLES: readonly Role[] = ["trader", "builder", "market_admin", "org_owner", "founder_operator"];
export const PLANS: readonly Plan[] = ["sandbox", "builder", "desk"];
export const PLAN_LABEL: Record<Plan, string> = { sandbox: "Sandbox", builder: "Builder", desk: "Desk" };
export const PLAN_RATE: Record<Plan, number> = { sandbox: 2, builder: 20, desk: 100 };

export const RANGES = {
  eventPrice: { min: 1, max: 99 },
  pairPrice: { min: 1, max: 1_000_000 },
  quantity: { min: 1, max: 100_000 },
  deposit: { min: 500, max: 500_000 },
  feeBps: { min: 0, max: 1_000 },
} as const;

export const CONTRACT_CENTS = 100;

/** Fee for one fill: half-up rounding of notional × bps / 10,000, in integer cents. */
export function fee(notionalCents: number, bps: number): number {
  return Math.floor((notionalCents * bps + 5000) / 10000);
}

export function collateralFor(notionalCents: number): number {
  return Math.ceil(notionalCents / 2);
}

export type HoldKind = "buy" | "spot_sell" | "margin_open" | "margin_reduce";

/** Which hold an order takes: a margin order on the opposite side of the member's open position reduces it. */
export function holdKindOf(kind: MarketKind, mode: Mode | null, side: Side, openPosition: "long" | "short" | null): HoldKind {
  if (kind === "event") return "buy";
  if (mode === "spot") return side === "sell" ? "spot_sell" : "buy";
  const reducing = openPosition !== null && (openPosition === "long") === (side === "sell");
  return reducing ? "margin_reduce" : "margin_open";
}

/** Maximum spend of an order at its limit price, held from available on placement. */
export function holdFor(kind: HoldKind, price: number, quantity: number, takerBps: number): number {
  const notional = price * quantity;
  const charge = fee(notional, takerBps);
  switch (kind) {
    case "buy":
      return notional + charge;
    case "spot_sell":
    case "margin_reduce":
      return charge;
    case "margin_open":
      return collateralFor(notional) + charge;
  }
}

export function maintenanceFor(quantity: number, mark: number): number {
  return Math.ceil((quantity * mark) / 4);
}

export function equityFor(side: "long" | "short", collateral: number, cost: number, quantity: number, mark: number): number {
  return side === "long" ? collateral + (quantity * mark - cost) : collateral + (cost - quantity * mark);
}

export function feeBpsValid(taker: number, maker: number): "ok" | "taker_out_of_range" | "maker_out_of_range" | "exceeds_taker" {
  const inRange = (v: number) => Number.isInteger(v) && v >= RANGES.feeBps.min && v <= RANGES.feeBps.max;
  if (!inRange(taker)) return "taker_out_of_range";
  if (!inRange(maker)) return "maker_out_of_range";
  return maker > taker ? "exceeds_taker" : "ok";
}

/** `$1,000.00` from integer cents. */
export function money(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function priceLabel(kind: MarketKind, price: number): string {
  return kind === "event" ? `${price}¢` : money(price);
}

/** Integer cents from a "50", "50.0" or "50.00" dollar string, or null. */
export function parseDollars(text: string): number | null {
  const match = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function luhnValid(cardNumber: string): boolean {
  if (!/^[\d ]+$/.test(cardNumber)) return false;
  const digits = cardNumber.replace(/ /g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const TRANSITIONS: Record<MarketAction, { from: readonly MarketStatus[]; to: MarketStatus; kinds: readonly MarketKind[] }> = {
  open: { from: ["listed"], to: "trading", kinds: ["pair", "event"] },
  halt: { from: ["trading"], to: "halted", kinds: ["pair", "event"] },
  resume: { from: ["halted"], to: "trading", kinds: ["pair", "event"] },
  resolve: { from: ["closed"], to: "resolved", kinds: ["event"] },
  settle: { from: ["resolved"], to: "settled", kinds: ["event"] },
};

export function targetOf(action: MarketAction): MarketStatus {
  return TRANSITIONS[action].to;
}

/**
 * The market state machine. An event in trading or halted reads as closed from its close instant
 * (see the market query); opening or resuming an event whose close instant has passed is illegal.
 */
export function transitionAllowed(kind: MarketKind, status: MarketStatus, action: MarketAction, closePassed: boolean): boolean {
  const rule = TRANSITIONS[action];
  if (!rule.kinds.includes(kind) || !rule.from.includes(status)) return false;
  return !(kind === "event" && closePassed && rule.to === "trading");
}

/** Lifecycle actions a market admin can take from the admin screen. */
export const ADMIN_ACTIONS: readonly MarketAction[] = ["open", "halt", "resume", "resolve"];

const MARKET_STATUS_TEXT: Record<MarketStatus, string> = {
  listed: "Listed",
  trading: "Trading open",
  halted: "Trading halted",
  closed: "Trading closed",
  resolved: "Resolved",
  settled: "Settled",
};

export function marketStatusText(status: MarketStatus, outcome: Outcome | null): string {
  if ((status === "resolved" || status === "settled") && outcome) {
    return `${MARKET_STATUS_TEXT[status]} ${outcome.toUpperCase()}`;
  }
  return MARKET_STATUS_TEXT[status];
}

export const ORDER_ENDED: readonly OrderStatus[] = ["filled", "cancelled", "liquidated"];

export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(m) - 1]} ${year}`;
}
