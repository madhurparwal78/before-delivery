// The edition order state machine, decided here only. Every other move answers 409 invalid_transition,
// except buying an expired hold, which answers 409 hold_expired.

export type OrderState = "held" | "paying" | "paid" | "invoiced" | "receipted" | "refunded" | "expired" | "failed";

export const MOVES = {
  buy: { from: ["held"], to: "paying" },
  expire: { from: ["held"], to: "expired" },
  confirm: { from: ["paying"], to: "paid" },
  fail: { from: ["paying"], to: "failed" },
  invoice: { from: ["paid"], to: "invoiced" },
  receipt: { from: ["invoiced"], to: "receipted" },
  refundInFull: { from: ["receipted"], to: "refunded" },
} as const satisfies Record<string, { from: readonly OrderState[]; to: OrderState }>;

type Move = keyof typeof MOVES;

export const canMove = (move: Move, state: OrderState): boolean => (MOVES[move].from as readonly OrderState[]).includes(state);

/** SQL guard for a move: `state = ANY($n)` with this list. */
export const fromStates = (move: Move): string[] => [...MOVES[move].from];

/** Orders whose edition number is collected by their buyer (a partly refunded order included). */
export const COLLECTED: readonly OrderState[] = ["paid", "invoiced", "receipted"];
/** Orders whose number is taken while Kill Bill answers. */
export const IN_FLIGHT: readonly OrderState[] = ["paying"];
/** Orders that keep their export and invoice downloads. */
export const DOWNLOADABLE: readonly OrderState[] = [...COLLECTED, "refunded"];

/**
 * Hold expiry, the one rule: a held order counts as expired at or after `expires_at` on the database
 * clock, whether or not the sweep has written it yet. `alias` is the orders table alias in the query.
 */
export const liveHold = (alias: string): string => `(${alias}.state = 'held' AND ${alias}.expires_at > now())`;
export const effectiveState = (alias: string): string =>
  `CASE WHEN ${alias}.state = 'held' AND NOT ${liveHold(alias)} THEN 'expired' ELSE ${alias}.state END`;
/** An order that occupies its edition number right now. */
export const occupying = (alias: string): string =>
  `(${liveHold(alias)} OR ${alias}.state IN (${[...IN_FLIGHT, ...COLLECTED].map((s) => `'${s}'`).join(", ")}))`;
