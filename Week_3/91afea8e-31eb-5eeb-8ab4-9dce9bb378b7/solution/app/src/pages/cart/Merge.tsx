import type { ReactNode } from "react";
import type { MergeResult } from "../../lib/types";

function outcomeText(result: MergeResult): string {
  switch (result.outcome) {
    case "added":
      return `${result.title}: added.`;
    case "combined":
      return `${result.title}: combined, now ${result.quantity}.`;
    case "capped":
      return `${result.title}: capped at 10.`;
    case "saved_for_later":
      return `${result.title}: cart full, saved for later.`;
    case "unavailable":
      return `${result.title}: no longer available.`;
  }
}

export function CartMerge({ results }: { results: MergeResult[] }): ReactNode {
  return (
    <section aria-label="Cart merge" className="panel panel--yellow merge">
      <h2>merged from this browser</h2>
      <ul className="merge__list">
        {results.map((result) => (
          <li key={result.listing_id} className="bill">
            {outcomeText(result)}
          </li>
        ))}
      </ul>
    </section>
  );
}
