// Catalog search (brief: Newsletter, partners and search): literal, case-insensitive, at most 20 results.
import { loadCatalog } from "../catalog.ts";
import type { Db } from "../db.ts";
import { invalid } from "../errors.ts";

const MAX_RESULTS = 20;

export async function search(db: Db, raw: string | null): Promise<{ sku: string; name: string; price_cents: number }[]> {
  const q = (raw ?? "").trim();
  if (q.length < 2 || q.length > 64) throw invalid({ q: "Enter 2 to 64 characters." });
  const needle = q.toLowerCase();
  const catalog = await loadCatalog(db);
  const items = [
    ...catalog.boards.map((b) => ({ sku: b.sku, name: `${b.name} ${b.size}`, price_cents: b.price_cents })),
    ...catalog.components.map((c) => ({ sku: c.sku, name: c.name, price_cents: c.price_cents })),
    ...catalog.accessories.map((a) => ({ sku: a.sku, name: a.name, price_cents: a.price_cents })),
  ];
  const key = (i: { name: string; sku: string }) => [i.name.toLowerCase(), i.sku] as const;
  return items
    .filter((i) => i.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const [an, as] = key(a);
      const [bn, bs] = key(b);
      return an < bn ? -1 : an > bn ? 1 : as < bs ? -1 : as > bs ? 1 : 0;
    })
    .slice(0, MAX_RESULTS);
}
