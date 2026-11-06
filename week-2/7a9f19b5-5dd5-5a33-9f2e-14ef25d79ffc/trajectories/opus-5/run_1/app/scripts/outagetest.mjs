/**
 * Degraded-boot, outage and recovery checks. Expects a Lightfall instance on
 * LF_BASE started with Kill Bill, MinIO and PocketBase pointed at dead ports, and
 * a freshly reset database.
 */

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4174";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

const CARD = { number: "4242 4242 4242 4242", expiry: "04/30", cvc: "123", name: "A Buyer" };
const DELIVERY = { name: "A Buyer", address: "1 Colombo Street", city: "Christchurch", postcode: "8011" };

let passed = 0;
const failures = [];
const check = (n, ok, d) => { if (ok) passed += 1; else failures.push(`${n}${d === undefined ? "" : ` -> ${JSON.stringify(d)}`}`); };
const eq = (n, a, e) => { const s = JSON.stringify(a) === JSON.stringify(e); check(n, s, s ? undefined : { actual: a, expected: e }); };

class Client {
  constructor() { this.cookie = null; }
  async call(method, path, { body, headers = {}, raw = false, formBody } = {}) {
    const init = { method, headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (formBody) { init.body = formBody.buffer; init.headers["content-type"] = formBody.contentType; }
    else if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    const r = await fetch(`${BASE}${path}`, init);
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    if (raw) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
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

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082", "hex");

function multipart(field, filename, contentType, content) {
  const boundary = `----lightfall${Date.now()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  return { buffer: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  // ---------- DP-55 degraded boot ----------
  eq("the health check answers while providers are down", (await new Client().get("/api/health")).body, { status: "ok" });

  const anon = new Client();
  eq("the catalogue still works", (await anon.get("/api/catalogue")).body.products.length, 5);
  eq("a product page still works", (await anon.get("/api/products/kauri-downlight")).status, 200);
  eq("the comparison still works", (await anon.get("/api/compare?codes=KDL-BK-24-3000")).status, 200);

  const retail = new Client();
  await retail.signin("jo@bennett-home.test", "Retail-buyer-2026");
  eq("sign-in still works", (await retail.get("/api/me")).status, 200);
  eq("the cart still works", (await retail.get("/api/cart")).status, 200);

  const admin = new Client();
  await admin.signin("admin@southerly-light.test", "Lightfall-admin-2026");
  const health = (await admin.get("/api/admin/health")).body.services;
  eq("postgres is up", health.postgres, "up");
  eq("mailpit is up", health.mailpit, "up");
  eq("kill bill is down", health.killbill, "down");
  eq("minio is down", health.minio, "down");
  eq("pocketbase is down", health.pocketbase, "down");

  // ---------- DP-10 Kill Bill unreachable at checkout ----------
  await retail.post("/api/cart/lines", { variant_code: "RGD-SN-36-3000", quantity: 1 });
  const cart = (await retail.get("/api/cart")).body.order;
  const stockBefore = (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "RGD-SN-36-3000").stock_on_hand;

  const attempt = await retail.post(
    `/api/orders/${cart.order_key}/authorise`, { card: CARD, delivery: DELIVERY },
    { headers: { "idempotency-key": "outage-1" } },
  );
  eq("payment service unavailable", [attempt.status, attempt.body.error], [503, "payment_unavailable"]);
  eq("the order is recoverable", attempt.body.order.status, "gateway_unavailable");
  eq("and reads Payment pending", attempt.body.order.display_status, "Payment pending");

  const stockAfter = (await admin.get("/api/admin/stock")).body.items.find((i) => i.variant_code === "RGD-SN-36-3000");
  eq("the reservation is released", stockAfter.stock_on_hand, stockBefore);
  eq("a release movement is written", stockAfter.movements.filter((m) => m.reason === "release").length, 1);
  eq("movements still add up", stockAfter.movements.reduce((n, m) => n + m.delta, 0), stockAfter.stock_on_hand);

  // The cart is still open, so the buyer can pay again from the same checkout.
  eq("the same cart is still open", (await retail.get("/api/cart")).body.order.order_key, cart.order_key);

  // A 503 is not stored, so the same key is tried again rather than replayed.
  const retry = await retail.post(
    `/api/orders/${cart.order_key}/authorise`, { card: CARD, delivery: DELIVERY },
    { headers: { "idempotency-key": "outage-1" } },
  );
  eq("a retry after a 503 is attempted again", retry.status, 503);

  // Placing on account never calls Kill Bill, so it still works.
  const trade = new Client();
  await trade.signin("rangi@kowhai-electrical.test", "Trade-approved-2026");
  await trade.post("/api/cart/lines", { variant_code: "PHP-BZ-60-2700", quantity: 1 });
  const tradeCart = (await trade.get("/api/cart")).body.order;
  const placed = await trade.post(
    `/api/orders/${tradeCart.order_key}/place-on-account`, { delivery: DELIVERY },
    { headers: { "idempotency-key": "outage-acct" } },
  );
  eq("placing on account works while Kill Bill is down", [placed.status, placed.body.order.status], [200, "placed"]);
  // But dispatching it needs Kill Bill.
  const dispatchDown = await admin.post(`/api/admin/orders/${tradeCart.order_key}/dispatch`, {});
  eq("dispatch reports the Kill Bill outage", [dispatchDown.status, dispatchDown.body.error], [503, "payment_unavailable"]);
  eq("and leaves the order unchanged", (await admin.get(`/api/orders/${tradeCart.order_key}`)).body.order.status, "placed");

  // ---------- DP-26, DP-28, DP-42 MinIO unreachable ----------
  const sheet = await retail.get("/api/variants/KDL-BK-24-3000/spec-sheet");
  eq("the spec sheet reports the storage outage", [sheet.status, sheet.body.error], [503, "storage_unavailable"]);

  const project = (await trade.get("/api/projects")).body.projects[0];
  const cover = await trade.call("POST", `/api/projects/${project.id}/cover`, { formBody: multipart("image", "c.png", "image/png", PNG) });
  eq("the cover upload reports the storage outage", [cover.status, cover.body.error], [503, "storage_unavailable"]);
  eq("and no cover is recorded", (await trade.get(`/api/projects/${project.id}`)).body.project.cover, null);

  const share = await trade.post(`/api/projects/${project.id}/shares`, {
    recipients: ["waiting@example.test"], price_display: "trade",
  });
  eq("the share is still queued", share.status, 201);
  await sleep(2500);
  const waiting = (await trade.get(`/api/projects/${project.id}/shares`)).body.shares[0];
  eq("the share waits for file storage", waiting.pdf_status, "waiting_for_storage");
  eq("no quote email goes out while storage is down", (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()).messages.filter((m) => m.Subject.includes("shared a Lightfall quote")).length, 0);
  const notReady = await trade.get(`/api/shares/${share.body.share.id}/pdf`);
  eq("the share pdf is not ready", [notReady.status, notReady.body.error], [409, "pdf_not_ready"]);

  // ---------- DP-39 PocketBase unreachable ----------
  const comments = await trade.get(`/api/projects/${project.id}/comments`);
  eq("reading comments reports the collaboration outage", [comments.status, comments.body.error], [503, "collaboration_unavailable"]);
  const posted = await trade.post(`/api/projects/${project.id}/comments`, { body: "Does this reach anyone?" });
  eq("posting a comment reports the collaboration outage", [posted.status, posted.body.error], [503, "collaboration_unavailable"]);

  // Placements still save, and report that collaboration is not live.
  const placement = await trade.post(`/api/projects/${project.id}/placements`, { variant_code: "KDL-BK-24-2700", x_mm: 3000, y_mm: 2300 });
  eq("a placement still saves", placement.status, 201);
  eq("and reports live false", placement.body.live, false);
  eq("the placement is in the project", (await trade.get(`/api/projects/${project.id}`)).body.project.placements.length, 1);
  eq("the project reports live false", (await trade.get(`/api/projects/${project.id}`)).body.project.live, false);
  eq("its light-pool figures are still computed", placement.body.placement.pool_diameter_mm, 1148);

  const moved = await trade.patch(`/api/projects/${project.id}/placements/${placement.body.placement.id}`, { x_mm: 3100, y_mm: 2300 });
  eq("a move still saves", [moved.status, moved.body.live], [200, false]);

  console.log(`\nOUTAGE PHASE: ${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);

  // ---------- recovery ----------
  console.log("\nStart the proxies now, then this script resumes...");
  return { retail, trade, admin, project, cart, tradeCart, shareId: share.body.share.id };
}

const state = await main();

// ---------- DP-52, DP-39, DP-42 recovery without a restart ----------
const { startProxies } = await import("./outage-proxies.mjs");
await startProxies();
await new Promise((r) => setTimeout(r, 1500));

const recovered = [];
const rcheck = (n, ok, d) => { if (ok) passed += 1; else { failures.push(`${n}${d === undefined ? "" : ` -> ${JSON.stringify(d)}`}`); } recovered.push(n); };

// Kill Bill: the next call goes through without restarting the app.
const payAgain = await state.retail.post(
  `/api/orders/${state.cart.order_key}/authorise`,
  { card: CARD, delivery: DELIVERY },
  { headers: { "idempotency-key": "recovered-1" } },
);
rcheck("the next payment goes through once Kill Bill returns", payAgain.status === 200 && payAgain.body.order.status === "authorised", { status: payAgain.status, body: payAgain.body });

const dispatchAgain = await state.admin.post(`/api/admin/orders/${state.tradeCart.order_key}/dispatch`, {});
rcheck("dispatch goes through once Kill Bill returns", dispatchAgain.status === 200 && dispatchAgain.body.order.status === "invoiced", { status: dispatchAgain.status, body: dispatchAgain.body });

// MinIO: the spec sheet and cover work again, and the waiting share finishes on its own.
const sheetAgain = await state.retail.get("/api/variants/KDL-BK-24-3000/spec-sheet", { raw: true });
rcheck("the spec sheet downloads once storage returns", sheetAgain.status === 200 && sheetAgain.buffer.subarray(0, 5).toString() === "%PDF-", sheetAgain.status);

let finished = null;
for (let i = 0; i < 30; i += 1) {
  const shares = (await state.trade.get(`/api/projects/${state.project.id}/shares`)).body.shares;
  finished = shares.find((s) => s.id === state.shareId);
  if (finished?.pdf_status === "ready") break;
  await new Promise((r) => setTimeout(r, 1000));
}
rcheck("the waiting share finishes on its own once storage returns", finished?.pdf_status === "ready", finished);

let quoteMail = [];
for (let i = 0; i < 20; i += 1) {
  quoteMail = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()).messages.filter((m) => m.Subject.includes("shared a Lightfall quote"));
  if (quoteMail.length > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
rcheck("and its email goes out then", quoteMail.length === 1, quoteMail.length);

// PocketBase: comments work again and live collaboration resumes.
let commentsBack = null;
for (let i = 0; i < 20; i += 1) {
  commentsBack = await state.trade.post(`/api/projects/${state.project.id}/comments`, { body: "Back online." });
  if (commentsBack.status === 201) break;
  await new Promise((r) => setTimeout(r, 1000));
}
rcheck("comments work once PocketBase returns", commentsBack?.status === 201, commentsBack?.body);
const liveBack = (await state.trade.get(`/api/projects/${state.project.id}`)).body.project.live;
rcheck("the project reports live again", liveBack === true, liveBack);
const placementLive = await state.trade.post(`/api/projects/${state.project.id}/placements`, { variant_code: "KDL-BK-24-2700", x_mm: 1000, y_mm: 1000 });
rcheck("a placement reports live again", placementLive.body.live === true, placementLive.body);

console.log(`\nTOTAL: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length > 0) process.exitCode = 1;
