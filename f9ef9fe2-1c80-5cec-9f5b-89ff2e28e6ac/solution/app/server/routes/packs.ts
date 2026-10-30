import { audit, pool, transaction } from "../db.js";
import { type InvoiceRow, PACK_QUARTERS } from "../domain.js";
import { json, route } from "../http.js";
import { idempotencyKey, idempotent } from "../idempotency.js";
import { postCharges } from "../killbill.js";
import { hoursText } from "../money.js";
import { requireUp } from "../services.js";
import { cardInForce, loadKitchen, memberFor, packBalance } from "../store.js";
import { newId, nextRef, recordMovement } from "../bookingUnit.js";
import { allow, authed } from "../validate.js";
import { invoiceView } from "../views.js";

// The prepaid pack ledger (brief: Prepaid pack ledger): every movement is two opposite entries.

interface MovementRow {
  id: string;
  kind: "purchase" | "draw" | "refund";
  quarters: number;
  booking_id: string | null;
  reverses: string | null;
  created_at: Date;
  entries: { account: string; quarters: number }[];
}

const movementsWhere = (condition: string): string =>
  `SELECT m.id, m.kind, m.quarters, m.booking_id, m.reverses, m.created_at,
          json_agg(json_build_object('account', e.account, 'quarters', e.quarters) ORDER BY e.quarters DESC) AS entries
     FROM movements m JOIN entries e ON e.movement_id = m.id
    WHERE ${condition}
    GROUP BY m.id ORDER BY m.created_at, m.id`;

const movementView = (m: MovementRow) => ({
  id: m.id,
  kind: m.kind,
  quarters: m.quarters,
  booking_id: m.booking_id,
  reverses: m.reverses,
  created_at: m.created_at.toISOString(),
  entries: m.entries,
});

route(
  "GET",
  "/api/members/:member_id/pack",
  authed(async (request, user) => {
    const member = await memberFor(user, request.params.member_id ?? "");
    const balance = await packBalance(member.id);
    return json(200, {
      balance_quarters: balance,
      balance_hours: hoursText(balance),
      movements: (await pool.query<MovementRow>(movementsWhere("m.member_id = $1"), [member.id])).rows.map(movementView),
    });
  }),
);

route(
  "POST",
  "/api/members/:member_id/packs",
  authed(async (request, user, now) => {
    const member = await memberFor(user, request.params.member_id ?? "");
    allow(user, "operator", "member");
    const key = idempotencyKey(request);
    return idempotent(user, key, request, async () => {
      requireUp("billing");
      const kitchen = await loadKitchen(user.kitchen_id);
      return transaction(async (client) => {
        await client.query("SELECT id FROM members WHERE id = $1 FOR NO KEY UPDATE", [member.id]);
        const card = await cardInForce(kitchen, now, client);
        const invoice: InvoiceRow = {
          id: newId("inv"),
          ref: await nextRef(client, "invoice_ref_seq", "INV"),
          kitchen_id: kitchen.id,
          member_id: member.id,
          kind: "pack",
          booking_ids: [],
          lines: [{ description: "20-hour pack", amount_cents: card.pack_price_cents }],
          total_cents: card.pack_price_cents,
          killbill_invoice_id: null,
          issued_at: now,
        };
        const movementId = await recordMovement(client, member.id, "purchase", PACK_QUARTERS, null, null, now);
        await audit(client, user.id, "movement", movementId, null, "purchase", now);
        await client.query(
          `INSERT INTO invoices (id, ref, kitchen_id, member_id, kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at)
           VALUES ($1,$2,$3,$4,'pack','[]',$5,$6,NULL,$7)`,
          [invoice.id, invoice.ref, kitchen.id, member.id, JSON.stringify(invoice.lines), invoice.total_cents, now],
        );
        const balance = await packBalance(member.id, client);
        const movement = (await client.query<MovementRow>(movementsWhere("m.id = $1"), [movementId])).rows[0];
        if (!movement) throw new Error("purchase movement missing");
        const posted = await postCharges(client, member, [{ amountCents: card.pack_price_cents, description: `${invoice.ref} · 20-hour pack` }]);
        invoice.killbill_invoice_id = posted.invoiceId;
        await client.query("UPDATE invoices SET killbill_invoice_id = $1 WHERE id = $2", [posted.invoiceId, invoice.id]);
        return json(201, {
          movement: movementView(movement),
          invoice: invoiceView(invoice, new Map([[posted.invoiceId, posted.amountCents]])),
          balance_quarters: balance,
        });
      });
    });
  }),
);
