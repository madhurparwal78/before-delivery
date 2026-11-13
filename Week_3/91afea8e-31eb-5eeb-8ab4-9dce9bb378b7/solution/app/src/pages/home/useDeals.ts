import { useEffect, useState } from "react";
import { ApiFailure, get } from "../../lib/api";
import type { Hit } from "../../lib/types";

export interface DealsState {
  deals: Hit[] | null;
  /** Listings per category slug, from the same search reply. */
  counts: Record<string, number>;
  /** The pincode the promise dates were computed for. */
  forPin: string | null;
  failure: string | null;
}

interface SearchReply {
  hits: Hit[];
  facets: { category: Record<string, number> };
}

/** Today's deals: the top rated listings, one panel per product. The app has no deals endpoint, so they come from search. */
export function useDeals(pin: string | null): DealsState {
  const [state, setState] = useState<DealsState>({ deals: null, counts: {}, forPin: null, failure: null });
  useEffect(() => {
    let current = true;
    get<SearchReply>(`/api/search?sort=rating&limit=6${pin ? `&pin=${pin}` : ""}`).then(
      (reply) => {
        if (!current) return;
        const seen = new Set<string>();
        const deals = reply.hits.filter((hit) => !seen.has(hit.product_id) && seen.add(hit.product_id));
        setState({ deals, counts: reply.facets.category, forPin: pin, failure: null });
      },
      (error: unknown) => {
        if (!current) return;
        if (!(error instanceof ApiFailure)) throw error;
        setState((previous) => ({ ...previous, deals: previous.deals ?? [], failure: error.body.message }));
      },
    );
    return () => {
      current = false;
    };
  }, [pin]);
  return state;
}
