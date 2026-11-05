// Prices and the upgrade split, decided once for the server's charges and the pages that quote them.

export const PRICES = {
  bench: { full: 345_000, deposit: 90_000, balance: 255_000 },
  atelier: { full: 590_000, deposit: 150_000, balance: 440_000 },
} as const;

/**
 * Upgrade charge now: from deposit_paid while deposits are open, only the deposit difference
 * (the rest joins the balance); otherwise the whole price difference.
 */
export function upgradeCharge(state: string, depositsOpen: boolean): number {
  return state === "deposit_paid" && depositsOpen
    ? PRICES.atelier.deposit - PRICES.bench.deposit
    : PRICES.atelier.full - PRICES.bench.full;
}
