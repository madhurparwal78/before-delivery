import { pool } from "../db.js";
import { benchState, currentInventory } from "../ledger.js";
import { BENCH_LABELS, SEATS_TOTAL, depositsOpen, tierOf, venueToday } from "../rules.js";
import { publicRoute } from "../router.js";
import { freshLedger } from "../views.js";

publicRoute({
  method: "GET",
  path: "/api/benches",
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const stock = await currentInventory(pool);
    const viewer = ctx.account?.id ?? null;
    const today = venueToday(ctx.now);
    return {
      status: 200,
      body: {
        server_time: ctx.now.toISOString(),
        venue_date: today,
        deposits_open: depositsOpen(today),
        seats_total: SEATS_TOTAL,
        seats_remaining: stock.seatsRemaining,
        held: stock.held,
        sold: stock.sold,
        tiers: {
          bench: { remaining: stock.benchRemaining },
          atelier: { remaining: stock.atelier.remaining, cap: stock.atelier.cap, active: stock.atelier.active, sold_out: stock.atelier.soldOut },
        },
        benches: BENCH_LABELS.map((label) => ({
          label,
          row: label.slice(0, 1),
          number: Number.parseInt(label.slice(1), 10),
          tier: tierOf(label),
          state: benchState(stock.occupied.get(label), viewer),
        })),
      },
    };
  },
});
