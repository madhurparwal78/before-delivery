import { today } from "./clock.js";
import { json, route } from "./http.js";
import { listDeliveries, listEndpoints, recoverFailed, redeliver, removeOwnEndpoint, rotateSecret, saveEndpoint, testEndpoint } from "./deliveries.js";
import { priceSheetCsv } from "./pricesheet.js";

const stockist = { auth: "stockist" } as const;
const stockistJson = { auth: "stockist", body: "json" } as const;

route("GET", "/api/stockist/endpoints", stockist, async (ctx) => json(200, { endpoints: await listEndpoints(ctx.account!.id) }));
route("POST", "/api/stockist/endpoints", stockistJson, async (ctx) => json(201, await saveEndpoint(ctx.account!.id, ctx.body)));
route("POST", "/api/stockist/endpoints/:id/test", stockistJson, async (ctx) => json(202, await testEndpoint(ctx.account!.id, ctx.params[0]!)));
route("POST", "/api/stockist/endpoints/:id/rotate-secret", stockistJson, async (ctx) => json(200, await rotateSecret(ctx.account!.id, ctx.params[0]!)));
route("POST", "/api/stockist/endpoints/:id/recover", stockistJson, async (ctx) => json(202, await recoverFailed(ctx.account!.id, ctx.params[0]!)));
route("DELETE", "/api/stockist/endpoints/:id", stockist, async (ctx) => {
  await removeOwnEndpoint(ctx.account!.id, ctx.params[0]!);
  return { status: 204 };
});
route("GET", "/api/stockist/deliveries", stockist, async (ctx) => json(200, await listDeliveries(ctx.account!.id)));
route("POST", "/api/stockist/deliveries/:eventId/redeliver", stockistJson, async (ctx) => json(202, await redeliver(ctx.account!.id, ctx.params[0]!)));

route("GET", "/api/stockist/price-sheet.csv", { auth: "any" }, async () => ({
  status: 200, raw: await priceSheetCsv(), contentType: "text/csv; charset=utf-8",
  headers: { "content-disposition": `attachment; filename="interval-price-sheet-${today()}.csv"` },
}));
