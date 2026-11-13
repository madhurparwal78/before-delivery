// Copy the server sends and the browser shows, written once.

export const BANNER = "Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.";
export const SWAPS_PAUSED = "Swaps are paused while the price feed is stale.";
export const NETWORK_FAILURE = "Couldn’t reach Quillmoor. Press the same button again to retry safely.";
export const NOT_FOUND_PAGE = "We couldn’t find that page.";

export const ORACLE_LINES = {
  ok: null,
  unreachable: "Couldn’t reach the price oracle – showing the last good price",
  malformed: "The price oracle sent an unreadable reading – showing the last good price",
  old_round: "The price oracle sent an older round – ignored",
  not_newer: "Manual post holds – the oracle has nothing newer",
  large_move: "The oracle moved more than 60% – not applied, post it by hand to accept it",
  evidence_unavailable: "Couldn’t store the oracle evidence – showing the last good price",
} as const;

export type OracleStatus = keyof typeof ORACLE_LINES;
