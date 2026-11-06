import { requireActor, requireRole } from "../auth.js";
import { newId, pool, tx } from "../db.js";
import { field, invalid, json, route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { purchase } from "../killbill.js";
import { lockRenter, move, packBalance, packView } from "../ledger.js";
import { PACK_PRODUCT } from "../../shared/pricing.js";
import { renterInScope } from "../scope.js";

route("GET", "/api/me/pack", async (request) => {
  const actor = await requireActor(request);
  requireRole(actor, "renter");
  return json(200, await packView(pool, actor.renterId ?? ""));
});

route("GET", "/api/renters/:id/pack", async (request) => {
  const actor = await requireActor(request);
  const renter = await renterInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "front_desk", "manager");
  return json(200, await packView(pool, renter.id));
});

route("POST", "/api/packs", async (request) => {
  const actor = await requireActor(request);
  requireRole(actor, "renter");
  const renterId = actor.renterId ?? "";
  return idempotent(request, actor, async () => {
    if (field(request.body, "product") !== PACK_PRODUCT.id) throw invalid({ product: "The only hour pack is 20h." });
    const packId = newId("pk");
    const paymentId = await purchase(renterId, `hs-pack-${packId}`, PACK_PRODUCT.priceCents);
    const available = await tx(async (client) => {
      const now = new Date();
      await lockRenter(client, renterId);
      await client.query("INSERT INTO packs (id, renter_id, minutes, price_cents, kb_payment_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [packId, renterId, PACK_PRODUCT.minutes, PACK_PRODUCT.priceCents, paymentId, now]);
      await move(client, { renterId, reason: "purchase", minutes: PACK_PRODUCT.minutes, at: now, packId });
      return (await packBalance(client, renterId)).available;
    });
    return json(201, { pack: { id: packId, minutes: PACK_PRODUCT.minutes, price_cents: PACK_PRODUCT.priceCents }, available_minutes: available });
  });
});
