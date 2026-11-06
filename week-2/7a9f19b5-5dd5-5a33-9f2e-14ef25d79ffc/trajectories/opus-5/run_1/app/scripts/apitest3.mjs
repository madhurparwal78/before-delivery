/**
 * Concurrency, trade approval and date-rule checks. Expects a freshly reset
 * database. Run with `node scripts/apitest3.mjs`.
 */

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
const KB = process.env.KILLBILL_URL ?? "http://killbill:8080";

const CARD = { number: "4242 4242 4242 4242", expiry: "04/30", cvc: "123", name: "A Buyer" };
const DELIVERY = { name: "A Buyer", address: "1 Colombo Street", city: "Christchurch", postcode: "8011" };

let passed = 0;
const failures = [];
const check = (n, ok, d) => { if (ok) passed += 1; else failures.push(`${n}${d === undefined ? "" : ` -> ${JSON.stringify(d)}`}`); };
const eq = (n, a, e) => { const s = JSON.stringify(a) === JSON.stringify(e); check(n, s, s ? undefined : { actual: a, expected: e }); };

class Client {
  constructor() { this.cookie = null; }
  async call(method, path, { body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${BASE}${path}`, init);
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
  get = (p, o) => this.call("GET", p, o);
  post = (p, b, o) => this.call("POST", p, { ...o, body: b });
  patch = (p, b, o) => this.call("PATCH", p, { ...o, body: b });
  async signin(email, password) {
    const r = await this.post("/api/auth/signin", { email, password });
    if (r.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(r.body)}`);
    return r.body.user;
  }
}

const kbHeaders = {
  authorization: `Basic ${Buffer.from(`${process.env.KILLBILL_USERNAME}:${process.env.KILLBILL_PASSWORD}`).toString("base64")}`,
  "x-killbill-apikey": process.env.KILLBILL_API_KEY,
  "x-killbill-apisecret": process.env.KILLBILL_API_SECRET,
  accept: "application/json",
};
async function kbPayment(orderKey) {
  const r = await fetch(`${KB}/1.0/kb/payments?externalKey=${encodeURIComponent(orderKey)}`, { headers: kbHeaders });
  return r.status === 200 ? r.json() : null;
}
async function mailFor(part) {
  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
  return messages.filter((m) => m.Subject.includes(part));
}
const mailBody = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();

async function main() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  const admin = new Client();
  await admin.signin("admin@southerly-light.test", "Lightfall-admin-2026");

  // ---------- DP-15 no overselling: HSC-CH-24-3000 opens with one unit ----------
  const jo = new Client();
  await jo.signin("jo@bennett-home.test", "Retail-buyer-2026");
  const lee = new Client();
  await lee.signin("lee@chen-house.test", "Retail-buyer2-2026");

  eq("the last unit is in stock", (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "HSC-CH-24-3000").stock_on_hand, 1);

  for (const client of [jo, lee]) {
    const added = await client.post("/api/cart/lines", { variant_code: "HSC-CH-24-3000", quantity: 1 });
    eq("both shoppers hold the last unit in their cart", added.status, 200);
  }
  const joKey = (await jo.get("/api/cart")).body.order.order_key;
  const leeKey = (await lee.get("/api/cart")).body.order.order_key;

  const [joPay, leePay] = await Promise.all([
    jo.post(`/api/orders/${joKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": "race-jo" } }),
    lee.post(`/api/orders/${leeKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": "race-lee" } }),
  ]);

  const results = [
    { name: "jo", key: joKey, res: joPay },
    { name: "lee", key: leeKey, res: leePay },
  ];
  const winners = results.filter((r) => r.res.status === 200);
  const losers = results.filter((r) => r.res.status !== 200);
  eq("exactly one buyer wins the last unit", winners.length, 1);
  eq("the other is told the stock ran out", [losers[0].res.status, losers[0].res.body.error], [409, "insufficient_stock"]);
  eq("the loser is told none are left", losers[0].res.body.available, 0);
  eq("the winner is authorised", winners[0].res.body.order.status, "authorised");

  // The loser is never charged.
  eq("no Kill Bill authorisation for the loser", await kbPayment(losers[0].key), null);
  check("the winner has a Kill Bill authorisation", (await kbPayment(winners[0].key)) !== null);

  // Stock on hand never goes below zero and the movements still add up.
  const soldOut = (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "HSC-CH-24-3000");
  eq("the fitting is sold out", soldOut.stock_on_hand, 0);
  check("stock never goes below zero", soldOut.stock_on_hand >= 0, soldOut.stock_on_hand);
  eq("movements add up to stock on hand", soldOut.movements.reduce((n, m) => n + m.delta, 0), 0);
  eq("exactly one sale movement", soldOut.movements.filter((m) => m.reason === "sale").length, 1);

  // The catalogue, the product page and the admin table agree.
  const anon = new Client();
  const clearanceCard = (await anon.get("/api/catalogue?family=clearance")).body.products
    .find((p) => p.slug === "harbour-surface-cylinder").variants.find((v) => v.code === "HSC-CH-24-3000");
  eq("the clearance card shows it sold out", clearanceCard.stock_on_hand, 0);
  const productPage = (await anon.get("/api/products/harbour-surface-cylinder")).body.product.variants
    .find((v) => v.code === "HSC-CH-24-3000");
  eq("the product page shows it sold out", productPage.stock_on_hand, 0);
  eq("the struck-through regular price is still published", productPage.was_price_cents, 13100);

  // A further attempt cannot reserve anything.
  const latecomer = await jo.post("/api/cart/lines", { variant_code: "HSC-CH-24-3000", quantity: 1 });
  eq("a latecomer cannot even add it to the cart", [latecomer.status, latecomer.body.error, latecomer.body.available], [409, "insufficient_stock", 0]);

  // ---------- DP-19..DP-21 trade approval ----------
  const sam = new Client();
  const samUser = await sam.signin("sam@whitcombe-wholesale.test", "Trade-pending-2026");
  eq("the applicant waits as submitted", samUser.trade_status, "submitted");
  const samKauri = await sam.get("/api/products/kauri-downlight");
  check("the applicant sees no trade price", !("trade_price_cents" in samKauri.body.product.variants[0]));
  eq("the applicant has no projects", (await sam.get("/api/projects")).body.error, "trade_account_required");

  const application = (await admin.get("/api/admin/trade-applications?status=submitted")).body.applications
    .find((a) => a.applicant_email === "sam@whitcombe-wholesale.test");
  check("the application is listed", Boolean(application));

  // Only an admin decides.
  eq("a retail caller cannot approve", (await jo.post(`/api/admin/trade-applications/${application.id}/approve`, {})).status, 403);
  eq("the applicant cannot approve themselves", (await sam.post(`/api/admin/trade-applications/${application.id}/approve`, {})).status, 403);

  const approved = await admin.post(`/api/admin/trade-applications/${application.id}/approve`, {});
  eq("approved", [approved.status, approved.body.application.status], [200, "approved"]);
  check("the decision is timestamped", Boolean(approved.body.application.decided_at));

  // A decided application cannot be decided again.
  const twice = await admin.post(`/api/admin/trade-applications/${application.id}/approve`, {});
  eq("already decided", [twice.status, twice.body.error, twice.body.status], [409, "invalid_state", "approved"]);
  const declineAfter = await admin.post(`/api/admin/trade-applications/${application.id}/decline`, { reason: "Changed my mind" });
  eq("cannot decline after approving", [declineAfter.status, declineAfter.body.error], [409, "invalid_state"]);

  // DP-20: the approval email.
  const approvalMail = await mailFor("Your Lightfall trade account is approved");
  eq("one approval email", approvalMail.length, 1);
  eq("addressed to the applicant", approvalMail[0].To[0].Address, "sam@whitcombe-wholesale.test");

  // DP-21: trade prices and projects after signing in again.
  const sam2 = new Client();
  const samAgain = await sam2.signin("sam@whitcombe-wholesale.test", "Trade-pending-2026");
  eq("now approved", samAgain.trade_status, "approved");
  const samKauri2 = await sam2.get("/api/products/kauri-downlight");
  check("now sees trade prices", "trade_price_cents" in samKauri2.body.product.variants[0]);
  eq("now has projects", (await sam2.get("/api/projects")).status, 200);
  const samProject = await sam2.post("/api/projects", { name: "Wholesale showroom", client_name: "Trade counter", ceiling_height_mm: 3200 });
  eq("the approved buyer can create a project", [samProject.status, samProject.body.project.ceiling_height_mm], [201, 3200]);

  // The cart reprices to the trade tier now that the buyer is approved.
  await sam2.post("/api/cart/lines", { variant_code: "KDL-WH-36-3000", quantity: 1 });
  const samCart = (await sam2.get("/api/cart")).body.order;
  eq("the cart is priced at the trade tier", [samCart.price_tier, samCart.subtotal_cents], ["trade", 6400]);

  // DP-20: a decline carries the admin's reason.
  const lucy = new Client();
  await lucy.post("/api/auth/signup", {
    email: "lucy@declined-trade.test", password: "a-long-enough-password", name: "Lucy Vane",
    account_type: "trade", trade: { business_name: "Vane Lighting", nzbn: "9429099999991", occupation: "architect" },
  });
  const lucyApplication = (await admin.get("/api/admin/trade-applications?status=submitted")).body.applications
    .find((a) => a.applicant_email === "lucy@declined-trade.test");
  const noReason = await admin.post(`/api/admin/trade-applications/${lucyApplication.id}/decline`, {});
  eq("a decline needs a reason", [noReason.status, noReason.body.errors.reason], [422, "required"]);
  const declined = await admin.post(`/api/admin/trade-applications/${lucyApplication.id}/decline`, { reason: "NZBN does not match the business name." });
  eq("declined", [declined.status, declined.body.application.status], [200, "declined"]);
  eq("the reason is stored", declined.body.application.decline_reason, "NZBN does not match the business name.");

  const declineMail = await mailFor("About your Lightfall trade application");
  eq("one decline email", declineMail.length, 1);
  const declineText = (await mailBody(declineMail[0].ID)).Text;
  check("the decline email carries the reason", declineText.includes("NZBN does not match the business name."), declineText);

  eq("the declined applicant stays on retail prices", (await lucy.get("/api/me")).body.user.trade_status, "declined");
  check("the declined applicant sees no trade price", !("trade_price_cents" in (await lucy.get("/api/products/kauri-downlight")).body.product.variants[0]));

  // ---------- DP-50 the due date and overdue ----------
  const rangi = new Client();
  await rangi.signin("rangi@kowhai-electrical.test", "Trade-approved-2026");
  await rangi.post("/api/cart/lines", { variant_code: "PHP-BZ-60-2700", quantity: 1 });
  const accountKey = (await rangi.get("/api/cart")).body.order.order_key;
  await rangi.post(`/api/orders/${accountKey}/place-on-account`, { delivery: DELIVERY }, { headers: { "idempotency-key": "acct-1" } });
  const invoicedOrder = (await admin.post(`/api/admin/orders/${accountKey}/dispatch`, {})).body.order;
  eq("invoiced", invoicedOrder.status, "invoiced");
  console.log(`  (account order ${accountKey} invoiced ${invoicedOrder.invoice.invoice_date}, due ${invoicedOrder.invoice.due_date})`);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length > 0) process.exitCode = 1;

  // Hand the order key to the overdue check that runs with LIGHTFALL_TODAY set.
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/overdue-order.json", JSON.stringify({ orderKey: accountKey, invoice: invoicedOrder.invoice }));
}

await main();
