import type { ReturnCounts, ReturnView } from "./types";

/** The counts of a list of returns: how many, how many overdue, how many awaiting the owner's approval. */
export function countsOf(returns: ReturnView[]): ReturnCounts {
  return {
    total: returns.length,
    overdue: returns.filter((r) => r.overdue).length,
    awaiting_approval: returns.filter((r) => r.awaiting_approval).length,
  };
}
