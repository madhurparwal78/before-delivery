/**
 * Money, stock, storage and email checks against a running Lightfall server.
 * Expects a freshly reset database. Run with `node scripts/apitest2.mjs`.
 */

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
const KB = process.env.KILLBILL_URL ?? "http://killbill:8080";

const APPROVE_CARD = "4242 4242 4242 4242";
const DECLINE_CARD = "4000 0000 0000 0002";
const DELIVERY = { name: "Jo Bennett", address: "12 Papanui Road", city: "Christchurch", postcode: "8014" };
const CARD = { number: APPROVE_CARD, expiry: "04/30", cvc: "123", name: "J Bennett" };

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) passed += 1;
  else failures.push(`${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
};
const eq = (name, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, same ? undefined : { actual, expected });
};

class Client {
  constructor() {
    this.cookie = null;
  }
  async call(method, path, { body, headers = {}, raw = false, formBody } = {}) {
    const init = { method, headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (formBody) {
      init.body = formBody.buffer;
      init.headers["content-type"] = formBody.contentType;
    } else if (body !== undefined) {
      init.headers["content-type"] = init.headers["content-type"] ?? "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const r = await fetch(`${BASE}${path}`, init);
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    if (raw) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), response: r };
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, response: r };
  }
  get = (p, o) => this.call("GET", p, o);
  post = (p, b, o) => this.call("POST", p, { ...o, body: b });
  patch = (p, b, o) => this.call("PATCH", p, { ...o, body: b });
  del = (p, o) => this.call("DELETE", p, o);
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

async function mailFor(subjectPart) {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  const { messages } = await r.json();
  return messages.filter((m) => m.Subject.includes(subjectPart));
}

async function mailBody(id) {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return r.json();
}

function multipart(fieldName, filename, contentType, content) {
  const boundary = `----lightfall${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { buffer: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// A minimal valid PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082",
  "hex",
);

async function main() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  const retail = new Client();
  await retail.signin("jo@bennett-home.test", "Retail-buyer-2026");
  const admin = new Client();
  await admin.signin("admin@southerly-light.test", "Lightfall-admin-2026");

  // ---------- DP-26 spec sheet ----------
  const sheet = await retail.get("/api/variants/KDL-BK-24-3000/spec-sheet", { raw: true });
  eq("spec sheet status", sheet.status, 200);
  eq("spec sheet content type", sheet.response.headers.get("content-type"), "application/pdf");
  check("spec sheet is a pdf", sheet.buffer.subarray(0, 5).toString() === "%PDF-", sheet.buffer.subarray(0, 8).toString());
  const sheet2 = await retail.get("/api/variants/KDL-BK-24-3000/spec-sheet", { raw: true });
  eq("spec sheet is reused", sheet2.buffer.length, sheet.buffer.length);
  eq("unknown spec sheet", (await retail.get("/api/variants/NOPE/spec-sheet")).status, 404);

  // ---------- DP-08..DP-13 card checkout ----------
  await retail.post("/api/cart/lines", { variant_code: "KDL-BK-24-3000", quantity: 2 });
  const cart = (await retail.get("/api/cart")).body.order;
  eq("cart subtotal", cart.subtotal_cents, 19000);
  eq("cart total", cart.total_cents, 21850);
  const orderKey = cart.order_key;

  // Missing idempotency key.
  const noKey = await retail.post(`/api/orders/${orderKey}/authorise`, { card: CARD, delivery: DELIVERY });
  eq("idempotency key required", [noKey.status, noKey.body.error], [400, "idempotency_key_required"]);

  // Field validation.
  const badCard = await retail.post(
    `/api/orders/${orderKey}/authorise`,
    { card: { ...CARD, number: "4242 4242 4242 4241" }, delivery: DELIVERY },
    { headers: { "idempotency-key": "k-badcard" } },
  );
  eq("luhn check", [badCard.status, badCard.body.errors.number], [422, "invalid"]);
  const pastExpiry = await retail.post(
    `/api/orders/${orderKey}/authorise`,
    { card: { ...CARD, expiry: "01/20" }, delivery: DELIVERY },
    { headers: { "idempotency-key": "k-expiry" } },
  );
  eq("expiry in the past", [pastExpiry.status, pastExpiry.body.errors.expiry], [422, "invalid"]);
  const badPostcode = await retail.post(
    `/api/orders/${orderKey}/authorise`,
    { card: CARD, delivery: { ...DELIVERY, postcode: "80145" } },
    { headers: { "idempotency-key": "k-post" } },
  );
  eq("postcode must be 4 digits", [badPostcode.status, badPostcode.body.errors.postcode], [422, "invalid"]);

  // DP-10: the decline test card.
  const declined = await retail.post(
    `/api/orders/${orderKey}/authorise`,
    { card: { ...CARD, number: DECLINE_CARD }, delivery: DELIVERY },
    { headers: { "idempotency-key": "k-decline" } },
  );
  eq("decline status", [declined.status, declined.body.error], [402, "card_declined"]);
  eq("declined order state", declined.body.order.status, "declined");
  eq("declined display status", declined.body.order.display_status, "Declined");
  eq("no Kill Bill payment for the decline card", await kbPayment(orderKey), null);
  // Recoverable: the same cart is still open and editable.
  eq("cart still open after a decline", (await retail.get("/api/cart")).body.order.order_key, orderKey);

  // DP-09: double submit with one key makes one authorisation.
  const key = "k-pay-1";
  const [first, second] = await Promise.all([
    retail.post(`/api/orders/${orderKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": key } }),
    retail.post(`/api/orders/${orderKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": key } }),
  ]);
  const statuses = [first.status, second.status].sort();
  check(
    "double submit yields one success and no second attempt",
    statuses.filter((s) => s === 200).length === 1 && statuses.every((s) => s === 200 || s === 409),
    { statuses, first: first.body, second: second.body },
  );
  const authorised = first.status === 200 ? first.body.order : second.body.order;
  eq("authorised state", authorised.status, "authorised");
  eq("authorised display status", authorised.display_status, "Authorised");

  const payment = await kbPayment(orderKey);
  check("Kill Bill holds the payment under the order key", payment !== null);
  eq("payment external key", payment.paymentExternalKey, orderKey);
  eq("one AUTHORIZE transaction", payment.transactions.filter((t) => t.transactionType === "AUTHORIZE").length, 1);
  eq("authorised amount in dollars", payment.authAmount, 218.5);
  eq("auth transaction key", payment.transactions[0].transactionExternalKey, `${orderKey}-auth`);
  eq("currency", payment.transactions[0].currency, "NZD");

  // The payment sits on the buyer's own Kill Bill account.
  const accountResponse = await fetch(`${KB}/1.0/kb/accounts/${payment.accountId}`, { headers: kbHeaders });
  const account = await accountResponse.json();
  const me = (await retail.get("/api/me")).body.user;
  eq("payment is on the buyer's own account", account.externalKey, `lf-user-${me.id}`);
  eq("account currency", account.currency, "NZD");
  eq("account name", account.name, "Jo Bennett");

  // Replaying the same key and body returns the stored answer and does nothing again.
  const replay = await retail.post(
    `/api/orders/${orderKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": key } },
  );
  eq("replay status", replay.status, 200);
  eq("replay body matches", replay.body.order.order_key, orderKey);
  eq("still one AUTHORIZE after the replay", (await kbPayment(orderKey)).transactions.filter((t) => t.transactionType === "AUTHORIZE").length, 1);

  // The same key with a different body is a conflict.
  const conflict = await retail.post(
    `/api/orders/${orderKey}/authorise`,
    { card: { ...CARD, name: "Someone Else" }, delivery: DELIVERY },
    { headers: { "idempotency-key": key } },
  );
  eq("idempotency conflict", [conflict.status, conflict.body.error], [409, "idempotency_conflict"]);

  // Authorising again is an invalid state, and reports the current status.
  const again = await retail.post(
    `/api/orders/${orderKey}/authorise`, { card: CARD, delivery: DELIVERY }, { headers: { "idempotency-key": "k-pay-2" } },
  );
  eq("re-authorising is refused", [again.status, again.body.error, again.body.status], [409, "invalid_state", "authorised"]);

  // A new cart gets a new key.
  const newCart = (await retail.get("/api/cart")).body.order;
  check("a new cart gets a new order key", newCart.order_key !== orderKey, newCart.order_key);

  // ---------- DP-11 confirmation email ----------
  const confirmations = await mailFor(`Your Lightfall order ${orderKey}`);
  eq("one confirmation email", confirmations.length, 1);
  const confirmation = await mailBody(confirmations[0].ID);
  eq("confirmation recipient", confirmation.To[0].Address, "jo@bennett-home.test");
  eq("confirmation from", confirmation.From.Address, "lightfall@southerly-light.test");
  for (const needle of ["KDL-BK-24-3000 x 2", "Subtotal (excl. GST)", "$190.00", "GST (15%)", "$28.50", "Total (incl. GST)", "$218.50"]) {
    check(`confirmation email contains ${needle}`, confirmation.Text.includes(needle), confirmation.Text);
  }

  // ---------- DP-44, DP-45 dispatch captures ----------
  const adminOrders = await admin.get("/api/admin/orders");
  eq("admin sees the order", adminOrders.body.orders.some((o) => o.order_key === orderKey), true);
  eq("admin order carries the customer email", adminOrders.body.orders.find((o) => o.order_key === orderKey).customer_email, "jo@bennett-home.test");

  const dispatched = await admin.post(`/api/admin/orders/${orderKey}/dispatch`, {});
  eq("dispatch status", dispatched.status, 200);
  eq("captured state", dispatched.body.order.status, "captured");
  eq("captured display status is Paid", dispatched.body.order.display_status, "Paid");
  eq("captured amount", dispatched.body.order.captured_cents, 21850);
  const afterCapture = await kbPayment(orderKey);
  eq("one CAPTURE transaction", afterCapture.transactions.filter((t) => t.transactionType === "CAPTURE").length, 1);
  eq("captured in Kill Bill", afterCapture.capturedAmount, 218.5);
  eq("capture transaction key", afterCapture.transactions.find((t) => t.transactionType === "CAPTURE").transactionExternalKey, `${orderKey}-capture`);

  // Dispatching twice is refused and never captures again.
  const twice = await admin.post(`/api/admin/orders/${orderKey}/dispatch`, {});
  eq("second dispatch refused", [twice.status, twice.body.error], [409, "invalid_state"]);
  eq("still one CAPTURE", (await kbPayment(orderKey)).transactions.filter((t) => t.transactionType === "CAPTURE").length, 1);

  // ---------- DP-46 partial refunds ----------
  const tooMuch = await admin.post(
    `/api/admin/orders/${orderKey}/refunds`, { amount_cents: 21851, reason: "too much" },
    { headers: { "idempotency-key": "r-0" } },
  );
  eq("refund above the refundable amount", [tooMuch.status, tooMuch.body.errors.amount_cents], [422, "exceeds_refundable"]);

  const partial = await admin.post(
    `/api/admin/orders/${orderKey}/refunds`, { amount_cents: 5000, reason: "One trim damaged" },
    { headers: { "idempotency-key": "r-1" } },
  );
  eq("partial refund status", partial.status, 201);
  eq("partly refunded", partial.body.order.status, "partially_refunded");
  eq("partly refunded label", partial.body.order.display_status, "Partly refunded");
  eq("refunded so far", partial.body.order.refunded_cents, 5000);
  eq("one refund recorded", partial.body.order.refunds.length, 1);
  check("refund carries a Kill Bill transaction id", Boolean(partial.body.refund.kb_transaction_id));

  const rest = await admin.post(
    `/api/admin/orders/${orderKey}/refunds`, { amount_cents: 16850, reason: "Returned" },
    { headers: { "idempotency-key": "r-2" } },
  );
  eq("final refund", rest.body.order.status, "refunded");
  eq("refunded label", rest.body.order.display_status, "Refunded");
  eq("fully refunded", rest.body.order.refunded_cents, 21850);

  const overRefund = await admin.post(
    `/api/admin/orders/${orderKey}/refunds`, { amount_cents: 1, reason: "Extra" },
    { headers: { "idempotency-key": "r-3" } },
  );
  eq("a fully refunded order cannot be refunded again", [overRefund.status, overRefund.body.error], [409, "invalid_state"]);

  const kbRefunds = (await kbPayment(orderKey)).transactions.filter((t) => t.transactionType === "REFUND");
  eq("two REFUND transactions in Kill Bill", kbRefunds.length, 2);
  eq("refund keys count from 1", kbRefunds.map((t) => t.transactionExternalKey).sort(), [`${orderKey}-refund-1`, `${orderKey}-refund-2`]);
  eq("refunded total in Kill Bill", (await kbPayment(orderKey)).refundedAmount, 218.5);

  // ---------- DP-48..DP-51 monthly account ----------
  const trade = new Client();
  await trade.signin("rangi@kowhai-electrical.test", "Trade-approved-2026");
  await trade.post("/api/cart/lines", { variant_code: "PHP-BZ-60-2700", quantity: 1 });
  const tradeCart = (await trade.get("/api/cart")).body.order;
  eq("trade cart total", tradeCart.total_cents, 27773);

  eq(
    "retail cannot place on account",
    (await retail.post(`/api/orders/${newCart.order_key}/place-on-account`, { delivery: DELIVERY }, { headers: { "idempotency-key": "a-x" } })).body.error,
    "trade_account_required",
  );

  const placed = await trade.post(
    `/api/orders/${tradeCart.order_key}/place-on-account`,
    { delivery: DELIVERY, purchase_order: "PO-2271" },
    { headers: { "idempotency-key": "a-1" } },
  );
  eq("placed on account", placed.status, 200);
  eq("placed state", placed.body.order.status, "placed");
  eq("placed label", placed.body.order.display_status, "Placed");
  eq("account payment method", placed.body.order.payment_method, "account");
  eq("trade price tier", placed.body.order.price_tier, "trade");
  eq("purchase order kept", placed.body.order.purchase_order, "PO-2271");
  eq("no Kill Bill payment when placing on account", await kbPayment(tradeCart.order_key), null);

  const accountMail = await mailFor(`Your Lightfall order ${tradeCart.order_key}`);
  eq("account confirmation email", accountMail.length, 1);
  const accountBody = await mailBody(accountMail[0].ID);
  for (const needle of ["PHP-BZ-60-2700 x 1", "$241.50", "$36.23", "$277.73", "PO-2271"]) {
    check(`account email contains ${needle}`, accountBody.Text.includes(needle), accountBody.Text);
  }

  const invoiced = await admin.post(`/api/admin/orders/${tradeCart.order_key}/dispatch`, {});
  eq("invoiced status", invoiced.status, 200);
  eq("invoiced state", invoiced.body.order.status, "invoiced");
  eq("invoiced label", invoiced.body.order.display_status, "Invoiced");
  const invoice = invoiced.body.order.invoice;
  check("invoice number present", Boolean(invoice.invoice_number), invoice);
  check("invoice date is an ISO date", /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date), invoice.invoice_date);

  // The due date is the 20th of the month after the invoice date.
  const [iy, im] = invoice.invoice_date.split("-").map(Number);
  const expectedDue = `${im === 12 ? iy + 1 : iy}-${String(im === 12 ? 1 : im + 1).padStart(2, "0")}-20`;
  eq("due date is the 20th of the next month", invoice.due_date, expectedDue);

  // The Kill Bill invoice itemises each line without GST plus one GST item.
  const kbInvoice = await (await fetch(`${KB}/1.0/kb/invoices/${invoice.kb_invoice_id}`, { headers: kbHeaders })).json();
  eq("invoice balance equals the order total", kbInvoice.balance, 277.73);
  eq("invoice amount equals the order total", kbInvoice.amount, 277.73);
  eq(
    "invoice items",
    kbInvoice.items.map((i) => [i.description, i.amount]),
    [["PHP-BZ-60-2700 x 1", 241.5], ["GST 15%", 36.23]],
  );

  const wrongAmount = await admin.post(`/api/admin/orders/${tradeCart.order_key}/record-payment`, { amount_cents: 1000 });
  eq("payment must equal the invoice total", [wrongAmount.status, wrongAmount.body.errors.amount_cents], [422, "must_equal_balance"]);

  const paid = await admin.post(`/api/admin/orders/${tradeCart.order_key}/record-payment`, { amount_cents: 27773 });
  eq("payment recorded", paid.status, 200);
  eq("paid state", paid.body.order.status, "paid");
  eq("paid label", paid.body.order.display_status, "Paid");
  const kbInvoiceAfter = await (await fetch(`${KB}/1.0/kb/invoices/${invoice.kb_invoice_id}`, { headers: kbHeaders })).json();
  eq("invoice settled in Kill Bill", kbInvoiceAfter.balance, 0);

  // Refunds and authorisation on an account order are refused.
  const refundAccount = await admin.post(
    `/api/admin/orders/${tradeCart.order_key}/refunds`, { amount_cents: 100, reason: "x" },
    { headers: { "idempotency-key": "r-acct" } },
  );
  eq("refunding an account order", [refundAccount.status, refundAccount.body.error], [409, "invalid_state"]);

  // ---------- DP-14..DP-16 clearance stock ----------
  const stock = await admin.get("/api/admin/stock");
  eq("two clearance items", stock.body.items.length, 2);
  const rgd = stock.body.items.find((i) => i.variant_code === "RGD-SN-36-3000");
  eq("rgd on hand", rgd.stock_on_hand, 3);
  eq("rgd clearance price", rgd.clearance_price_cents, 5900);
  eq("rgd opens with one seed movement", rgd.movements.map((m) => [m.reason, m.delta]), [["seed", 3]]);

  // Buying clearance stock writes a sale movement carrying the order key.
  const lee = new Client();
  await lee.signin("lee@chen-house.test", "Retail-buyer2-2026");
  await lee.post("/api/cart/lines", { variant_code: "RGD-SN-36-3000", quantity: 1 });
  const leeCart = (await lee.get("/api/cart")).body.order;
  eq("clearance price in the cart", leeCart.subtotal_cents, 5900);
  const leePaid = await lee.post(
    `/api/orders/${leeCart.order_key}/authorise`, { card: CARD, delivery: DELIVERY },
    { headers: { "idempotency-key": "lee-1" } },
  );
  eq("clearance purchase authorised", leePaid.body.order.status, "authorised");

  const afterSale = (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "RGD-SN-36-3000");
  eq("stock falls after the sale", afterSale.stock_on_hand, 2);
  const sale = afterSale.movements.find((m) => m.reason === "sale");
  eq("sale movement is negative", sale.delta, -1);
  eq("sale movement carries the order key", sale.order_key, leeCart.order_key);
  eq("movements add up to stock on hand", afterSale.movements.reduce((n, m) => n + m.delta, 0), afterSale.stock_on_hand);

  // A decline releases the reservation.
  await lee.post("/api/cart/lines", { variant_code: "RGD-SN-36-3000", quantity: 1 });
  const leeCart2 = (await lee.get("/api/cart")).body.order;
  await lee.post(
    `/api/orders/${leeCart2.order_key}/authorise`, { card: { ...CARD, number: DECLINE_CARD }, delivery: DELIVERY },
    { headers: { "idempotency-key": "lee-2" } },
  );
  const afterDecline = (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "RGD-SN-36-3000");
  eq("a decline releases the units", afterDecline.stock_on_hand, 2);
  eq("the release movement is recorded", afterDecline.movements.filter((m) => m.reason === "release").map((m) => m.delta), [1]);
  eq("movements still add up", afterDecline.movements.reduce((n, m) => n + m.delta, 0), afterDecline.stock_on_hand);

  // Asking for more clearance units than are on hand is refused.
  const greedy = await lee.patch("/api/cart/lines/RGD-SN-36-3000", { quantity: 99 });
  eq("over-ordering clearance stock", [greedy.status, greedy.body.error, greedy.body.available], [409, "insufficient_stock", 2]);

  // DP-47: only an admin changes stock.
  eq("retail cannot adjust stock", (await retail.patch("/api/admin/variants/RGD-SN-36-3000", { stock_adjust: 5 })).status, 403);
  const adjusted = await admin.patch("/api/admin/variants/RGD-SN-36-3000", { stock_adjust: 1, note: "Found one in the van" });
  eq("admin adjusts stock", adjusted.body.item.stock_on_hand, 3);
  eq("adjust movement recorded", adjusted.body.item.movements.filter((m) => m.reason === "adjust").map((m) => [m.delta, m.note]), [[1, "Found one in the van"]]);
  const belowZero = await admin.patch("/api/admin/variants/RGD-SN-36-3000", { stock_adjust: -99, note: "too many" });
  eq("stock cannot go below zero", [belowZero.status, belowZero.body.error], [409, "stock_below_zero"]);

  // ---------- DP-53 newsletter ----------
  const noConsent = await retail.post("/api/newsletter", { email: "sub@example.test", occupation: "architect", consent: false });
  eq("consent required", [noConsent.status, noConsent.body.errors.consent], [422, "required"]);
  const badEmail = await retail.post("/api/newsletter", { email: "nope", occupation: "architect", consent: true });
  eq("newsletter email must be valid", [badEmail.status, badEmail.body.errors.email], [422, "invalid"]);
  const subscribed = await retail.post("/api/newsletter", { email: "sub@example.test", occupation: "wholesaler", consent: true });
  eq("newsletter accepted", [subscribed.status, subscribed.body.status], [202, "pending_confirmation"]);

  const letters = await mailFor("Confirm your Lightfall newsletter");
  eq("confirmation email sent", letters.length, 1);
  const letter = await mailBody(letters[0].ID);
  check("email states the occupation", letter.Text.includes("Wholesaler"), letter.Text);
  const token = /newsletter\/confirm\?token=([a-f0-9]+)/.exec(letter.Text)?.[1];
  check("email carries a confirmation link", Boolean(token), letter.Text);
  const confirmed = await retail.get(`/api/newsletter/confirm?token=${token}`);
  eq("confirmed", [confirmed.status, confirmed.body.status, confirmed.body.email, confirmed.body.occupation], [200, "confirmed", "sub@example.test", "wholesaler"]);
  const confirmedAgain = await retail.get(`/api/newsletter/confirm?token=${token}`);
  eq("repeat confirmation is the same", confirmedAgain.body.status, "confirmed");
  eq("unknown token", (await retail.get("/api/newsletter/confirm?token=deadbeef")).body.error, "unknown_token");

  // ---------- DP-28 project cover ----------
  const project = (await trade.get("/api/projects")).body.projects[0];
  const cover = await trade.call("POST", `/api/projects/${project.id}/cover`, {
    formBody: multipart("image", "cover.png", "image/png", PNG),
  });
  eq("cover upload", [cover.status, cover.body.cover.status], [201, "ready"]);
  eq("cover url", cover.body.cover.url, `/api/projects/${project.id}/cover`);
  const coverBytes = await trade.get(`/api/projects/${project.id}/cover`, { raw: true });
  eq("cover served back", [coverBytes.status, coverBytes.buffer.length], [200, PNG.length]);
  const badType = await trade.call("POST", `/api/projects/${project.id}/cover`, {
    formBody: multipart("image", "x.gif", "image/gif", PNG),
  });
  eq("unsupported cover type", [badType.status, badType.body.errors.image], [422, "unsupported_type"]);
  const tooBig = await trade.call("POST", `/api/projects/${project.id}/cover`, {
    formBody: multipart("image", "big.png", "image/png", Buffer.alloc(5_000_001)),
  });
  eq("cover over 5,000,000 bytes", [tooBig.status, tooBig.body.error], [413, "payload_too_large"]);
  const exactly = await trade.call("POST", `/api/projects/${project.id}/cover`, {
    formBody: multipart("image", "exact.png", "image/png", Buffer.concat([PNG, Buffer.alloc(5_000_000 - PNG.length)])),
  });
  eq("exactly 5,000,000 bytes is allowed", exactly.status, 201);

  // ---------- DP-40..DP-43 quote shares ----------
  const badRecipients = await trade.post(`/api/projects/${project.id}/shares`, { recipients: [], price_display: "none" });
  eq("at least one recipient", [badRecipients.status, badRecipients.body.errors.recipients], [422, "invalid"]);
  const elevenRecipients = await trade.post(`/api/projects/${project.id}/shares`, {
    recipients: Array.from({ length: 11 }, (_, i) => `r${i}@example.test`), price_display: "none",
  });
  eq("at most ten recipients", elevenRecipients.status, 422);

  const noPrices = await trade.post(`/api/projects/${project.id}/shares`, {
    recipients: ["client-a@example.test", "client-b@example.test"], price_display: "none", message: "First pass for review.",
  });
  eq("no-prices share queued", noPrices.status, 201);
  eq("share starts pending", noPrices.body.share.pdf_status, "pending");
  eq("share recipients", noPrices.body.share.recipients, ["client-a@example.test", "client-b@example.test"]);

  const tradeShare = await trade.post(`/api/projects/${project.id}/shares`, {
    recipients: ["wholesaler@example.test"], price_display: "trade",
  });
  eq("trade-prices share queued", tradeShare.status, 201);

  // Shares become ready within 10 seconds while MinIO is reachable.
  let shares = [];
  for (let i = 0; i < 20; i += 1) {
    shares = (await trade.get(`/api/projects/${project.id}/shares`)).body.shares;
    if (shares.every((s) => s.pdf_status === "ready")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  eq("every share becomes ready", shares.map((s) => s.pdf_status), ["ready", "ready"]);

  const pdf = await trade.get(`/api/shares/${noPrices.body.share.id}/pdf`, { raw: true });
  eq("share pdf served", pdf.status, 200);
  check("share pdf is a pdf", pdf.buffer.subarray(0, 5).toString() === "%PDF-");

  // One email per recipient, with the PDF attached.
  let quoteMail = [];
  for (let i = 0; i < 20; i += 1) {
    quoteMail = await mailFor("shared a Lightfall quote");
    if (quoteMail.length >= 3) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  eq("one email per recipient", quoteMail.length, 3);
  eq("quote subject", quoteMail[0].Subject, "Rangi Parata shared a Lightfall quote: Ponsonby Kitchen");
  const addressed = quoteMail.map((m) => m.To[0].Address).sort();
  eq("each recipient gets their own email", addressed, ["client-a@example.test", "client-b@example.test", "wholesaler@example.test"]);

  for (const message of quoteMail) {
    const full = await mailBody(message.ID);
    const attachment = full.Attachments?.[0];
    check(`attachment present for ${message.To[0].Address}`, Boolean(attachment), full.Attachments);
    check(`attachment is named for the share for ${message.To[0].Address}`, /^lightfall-quote-[0-9a-f-]{36}\.pdf$/.test(attachment.FileName), attachment?.FileName);
    if (message.To[0].Address === "wholesaler@example.test") {
      check("trade share email shows amounts", /\$\d/.test(full.Text), full.Text);
    } else {
      check("no-prices email carries no dollar sign", !full.Text.includes("$"), full.Text);
      check("no-prices email carries no GST line", !full.Text.includes("GST"), full.Text);
      check("no-prices email still lists the codes", full.Text.includes("KDL-BK-24-2700"), full.Text);
    }
  }

  // Only the owner shares.
  const collab = new Client();
  await collab.signin("isla@harbourlight.test", "Trade-collab-2026");
  eq("only the owner shares a quote", (await collab.post(`/api/projects/${project.id}/shares`, { recipients: ["x@example.test"], price_display: "none" })).body.error, "owner_only");
  eq("the collaborator can list shares", (await collab.get(`/api/projects/${project.id}/shares`)).status, 200);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
