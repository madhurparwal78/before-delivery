import { useEffect, useState } from "react";
import { get } from "../../lib/api";
import type { Hit } from "../../lib/types";

/** Seller names by id: the search facet counts sellers by id, the checkbox is named by the display name. */
const names = new Map<string, string>();
let seeded: Promise<void> | null = null;

export function learnSellers(hits: Hit[]): void {
  for (const hit of hits) names.set(hit.seller_id, hit.seller_name);
}

function seed(): Promise<void> {
  seeded ??= get<{ hits: Hit[] }>("/api/search?limit=24&sort=price_desc").then(
    (found) => learnSellers(found.hits),
    () => undefined,
  );
  return seeded;
}

/** Re-renders once the names of the sellers in the facet are known. */
export function useSellerNames(ids: string[]): (id: string) => string {
  const [, bump] = useState(0);
  const missing = ids.some((id) => !names.has(id));
  useEffect(() => {
    if (missing) void seed().then(() => bump((n) => n + 1));
  }, [missing]);
  return (id) => names.get(id) ?? id;
}
