import { query, rows } from "../db.js";
import { publishStockLevel } from "../pocketbase.js";
const FIGURES_SQL = `
SELECT f.slug AS flavour, f.released, f.limited,
  COALESCE(SUM(l.quantity) FILTER (WHERE l.kind = 'received'), 0)::int AS received,
  COALESCE(SUM(l.quantity) FILTER (WHERE l.kind = 'sold'), 0)::int AS sold,
  COALESCE(SUM(l.quantity) FILTER (WHERE l.kind = 'returned'), 0)::int AS returned,
  (SELECT count(*) FROM crate_slots s JOIN crates c ON c.id = s.crate_id
    WHERE s.flavour = f.slug AND c.hold_status = 'active' AND c.hold_expires_at > now())::int AS reserved
FROM flavours f LEFT JOIN ledger l ON l.flavour = f.slug
WHERE ($1::text IS NULL OR f.slug = $1)
GROUP BY f.slug ORDER BY f.position`;
function figures(row) {
    const onHand = row.received - row.sold + row.returned;
    const fromHand = onHand - row.reserved;
    const available = row.limited && row.released !== null ? Math.min(fromHand, row.released - row.reserved - row.sold) : fromHand;
    return {
        flavour: row.flavour,
        received: row.received,
        sold: row.sold,
        returned: row.returned,
        on_hand: onHand,
        reserved: row.reserved,
        available: Math.max(0, available),
        released: row.limited ? row.released : null,
    };
}
export async function stockFigures(client, flavour) {
    const found = client
        ? await rows(client, FIGURES_SQL, [flavour ?? null])
        : await query(FIGURES_SQL, [flavour ?? null]);
    return found.map(figures);
}
export async function ledgerEvent(client, flavour, kind, quantity, ref) {
    if (quantity > 0) {
        await rows(client, "INSERT INTO ledger (flavour, kind, quantity, ref) VALUES ($1, $2, $3, $4)", [flavour, kind, quantity, ref]);
    }
}
// ---- live stock-left mirror -----------------------------------------------------------------
const changed = new Set();
let flushing = null;
/** Records that a flavour's figures moved; PocketBase gets the new stock-left soon after. */
export function stockChanged(flavours) {
    for (const f of flavours)
        changed.add(f);
    flushing ??= flush().finally(() => {
        flushing = null;
        if (changed.size > 0)
            stockChanged([]);
    });
}
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const batch = [...changed];
    changed.clear();
    try {
        const current = await stockFigures();
        for (const f of current.filter((c) => batch.includes(c.flavour)))
            await publishStockLevel(f.flavour, f.available);
    }
    catch {
        // PocketBase or Postgres is down: the live feed pauses and the next change republishes.
    }
}
