import type { Hono } from "hono";
import { one, query, transaction } from "../db.js";
import { FIELD, notFound, validationFailed } from "../errors.js";
import { noContent, ok, route, type Reply, type Request } from "../http.js";
import { publicId } from "../id.js";
import { loadDestination, PINCODE } from "../services/catalogue.js";
import { Body } from "../validate.js";
import { accountView, changePassword } from "./auth.js";

const ALL_ROLES = ["shopper", "seller", "support"] as const;
const PHONE = /^(\+91)?([6-9]\d{9})$/;

function actorOf(req: Request): NonNullable<Request["actor"]> {
  return req.actor as NonNullable<Request["actor"]>;
}

function addressView(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    phone: row.phone,
  };
}

async function me(req: Request): Promise<Reply> {
  const account = await one<{ id: string; name: string; first_name: string; role: "shopper" | "seller" | "support"; balance_paise: number }>(
    "SELECT id, name, first_name, role, balance_paise FROM accounts WHERE id = $1",
    [actorOf(req).accountId],
  );
  if (!account) throw notFound();
  return ok({ account: accountView(account), balance_paise: account.balance_paise });
}

async function addAddress(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["label", "name", "line1", "line2", "city", "pincode", "phone"]);
  const label = body.text("label", { label: "Label", min: 1, max: 30 });
  const name = body.text("name", { label: "Name", min: 1, max: 60 });
  const line1 = body.text("line1", { label: "Address line 1", min: 1, max: 120 });
  const line2 = body.text("line2", { label: "Address line 2", max: 120, optional: true });
  const city = body.text("city", { label: "City", min: 1, max: 60 });
  const pincode = body.text("pincode", { label: "Pincode", max: 6 });
  const phone = body.text("phone", { label: "Phone", max: 20 });
  if (pincode !== undefined && !PINCODE.test(pincode)) body.fail("pincode", FIELD.badPincode);
  const phoneMatch = phone === undefined ? null : PHONE.exec(phone);
  if (phone !== undefined && !phoneMatch) body.fail("phone", FIELD.badPhone);
  body.done();
  if (label === undefined || name === undefined || line1 === undefined || city === undefined || pincode === undefined || !phoneMatch) throw validationFailed({});
  const known = await loadDestination(pincode);
  const id = publicId("AD");
  await query(
    "INSERT INTO addresses (id, account_id, label, name, line1, line2, city, state, pincode, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, actorOf(req).accountId, label, name, line1, line2 ?? "", city, known.state, pincode, `+91${phoneMatch[2]}`],
  );
  const row = await one<Record<string, unknown>>("SELECT * FROM addresses WHERE id = $1", [id]);
  return ok(addressView(row as Record<string, unknown>), 201);
}

async function redeem(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["code"]);
  const code = body.text("code", { label: "Gift card code", min: 1, max: 60 });
  body.done();
  if (code === undefined) throw validationFailed({});
  const balance = await transaction(async (client) => {
    const card = await client.query(
      "UPDATE gift_cards SET redeemed_by = $2, redeemed_at = $3 WHERE code = $1 AND redeemed_by IS NULL RETURNING amount_paise",
      [code.toUpperCase(), actorOf(req).accountId, req.nowMs],
    );
    const amount = (card.rows[0] as { amount_paise: number } | undefined)?.amount_paise;
    if (amount === undefined) return null;
    const updated = await client.query("UPDATE accounts SET balance_paise = balance_paise + $2 WHERE id = $1 RETURNING balance_paise", [actorOf(req).accountId, amount]);
    return (updated.rows[0] as { balance_paise: number }).balance_paise;
  });
  if (balance === null) throw validationFailed({ code: FIELD.badGiftCard });
  return ok({ balance_paise: balance });
}

export function registerAccount(app: Hono): void {
  const shopper = { access: ["shopper"] } as const;
  route(app, ["GET"], "/api/me", { access: ALL_ROLES }, me);
  route(app, ["POST"], "/api/account/password", { access: ALL_ROLES }, changePassword);
  route(app, ["GET"], "/api/account/addresses", { access: ALL_ROLES }, async (req) =>
    ok({ addresses: (await query("SELECT * FROM addresses WHERE account_id = $1 ORDER BY seq", [actorOf(req).accountId])).map(addressView) }),
  );
  route(app, ["POST"], "/api/account/addresses", { access: ALL_ROLES }, addAddress);
  route(app, ["DELETE"], "/api/account/addresses/:id", { access: ALL_ROLES }, async (req) => {
    const removed = await query("DELETE FROM addresses WHERE id = $1 AND account_id = $2 RETURNING id", [req.params.id, actorOf(req).accountId]);
    if (removed.length === 0) throw notFound();
    return noContent();
  });
  route(app, ["GET"], "/api/account/cards", shopper, async (req) =>
    ok({
      cards: (await query<Record<string, unknown>>("SELECT * FROM cards WHERE account_id = $1 ORDER BY seq", [actorOf(req).accountId])).map((card) => ({
        card_id: card.id,
        network: card.network,
        last4: card.last4,
        expiry_month: card.expiry_month,
        expiry_year: card.expiry_year,
        name: card.name,
      })),
    }),
  );
  route(app, ["DELETE"], "/api/account/cards/:id", shopper, async (req) => {
    const removed = await query("DELETE FROM cards WHERE id = $1 AND account_id = $2 RETURNING id", [req.params.id, actorOf(req).accountId]);
    if (removed.length === 0) throw notFound();
    return noContent();
  });
  route(app, ["POST"], "/api/balance/redeem", { access: ["shopper"], rate: { bucket: "redeem", limit: 10 } }, redeem);
}
