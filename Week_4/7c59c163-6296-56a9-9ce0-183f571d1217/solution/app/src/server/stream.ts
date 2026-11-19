import type { ServerResponse } from "node:http";
import { pool, rows } from "./db.js";
import { balanceOf } from "./ledger.js";
import { listen, publish } from "./valkey.js";
import { bookOf, fillView, marketRow, marketView, orderViews, type FillRow, type MarketRow, type OrderRow } from "./views.js";

/** What a committed transaction changed; published to `market:<id>` and `member:<id>` after commit. */
export class Changes {
  readonly markets = new Set<string>();
  readonly members = new Set<string>();
  readonly orders = new Set<string>();
  readonly fills: string[] = [];
  readonly trades: { marketId: string; price: number; quantity: number; at: string }[] = [];
  readonly liquidations: { memberId: string; position_id: string; market_id: string; mark_price: number }[] = [];
}

async function publishChanges(changes: Changes): Promise<void> {
  for (const trade of changes.trades) {
    publish(`market:${trade.marketId}`, "trade", { price: trade.price, quantity: trade.quantity, at: trade.at });
  }
  for (const id of changes.markets) {
    const market = await marketRow(pool, id);
    publish(`market:${id}`, "book", await bookOf(pool, market));
    publish(`market:${id}`, "market", marketView(market));
  }
  if (changes.fills.length > 0) {
    const fills = await rows<FillRow>(pool, "SELECT * FROM fills WHERE id = ANY($1) ORDER BY seq", [changes.fills]);
    for (const fill of fills) publish(`member:${fill.member_id}`, "fill", fillView(fill));
  }
  if (changes.orders.size > 0) {
    const orders = await rows<OrderRow>(pool, "SELECT * FROM orders WHERE id = ANY($1)", [[...changes.orders]]);
    const views = await orderViews(pool, orders);
    orders.forEach((order, i) => publish(`member:${order.member_id}`, "order", views[i]));
  }
  for (const { memberId, ...liquidation } of changes.liquidations) publish(`member:${memberId}`, "liquidation", liquidation);
  for (const id of changes.members) publish(`member:${id}`, "balance", await balanceOf(pool, id));
}

/** Runs publication without letting a fan-out failure reach the caller. */
export function publishLater(changes: Changes): void {
  publishChanges(changes).catch((error: unknown) => console.error("publish failed:", error instanceof Error ? error.message : error));
}

export async function openStream(res: ServerResponse, market: MarketRow, memberId: string): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stops = await Promise.all([listen(`market:${market.id}`, write), listen(`member:${memberId}`, write)]);
  write("market", marketView(market));
  write("book", await bookOf(pool, market));
  write("balance", await balanceOf(pool, memberId));
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
  res.on("close", () => {
    clearInterval(heartbeat);
    for (const stop of stops) stop();
  });
}
