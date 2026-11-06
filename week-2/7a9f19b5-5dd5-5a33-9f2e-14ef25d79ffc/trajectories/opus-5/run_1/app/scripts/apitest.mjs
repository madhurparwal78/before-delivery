/**
 * End-to-end checks against a running Lightfall server. Run with `node scripts/apitest.mjs`.
 * Exits non-zero when any expectation fails.
 */

const BASE = process.env.LF_BASE ?? "http://127.0.0.1:4173";

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
}

function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, same ? undefined : { actual, expected });
}

class Client {
  constructor() {
    this.cookie = null;
  }

  async call(method, path, { body, headers = {}, raw = false, formData } = {}) {
    const init = { method, headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (formData) {
      init.body = formData;
    } else if (body !== undefined) {
      init.headers["content-type"] = init.headers["content-type"] ?? "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const response = await fetch(`${BASE}${path}`, init);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), response };
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, body: json, response };
  }

  get = (p, o) => this.call("GET", p, o);
  post = (p, b, o) => this.call("POST", p, { ...o, body: b });
  put = (p, b, o) => this.call("PUT", p, { ...o, body: b });
  patch = (p, b, o) => this.call("PATCH", p, { ...o, body: b });
  del = (p, o) => this.call("DELETE", p, o);

  async signin(email, password) {
    const r = await this.post("/api/auth/signin", { email, password });
    if (r.status !== 200) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(r.body)}`);
    return r.body.user;
  }
}

const PUBLIC_VARIANT_KEYS = [
  "code", "finish", "finish_name", "beam_deg", "cct_k", "lumens", "candela",
  "retail_price_cents", "was_price_cents", "clearance", "stock_on_hand",
].sort();
const TRADE_VARIANT_KEYS = [...PUBLIC_VARIANT_KEYS, "trade_price_cents"].sort();

async function main() {
  // ---------- DP-01 catalogue and search ----------
  const anon = new Client();
  const all = await anon.get("/api/catalogue");
  eq("catalogue status", all.status, 200);
  eq("catalogue product count", all.body.products.length, 5);
  eq(
    "catalogue order is the seed order",
    all.body.products.map((p) => p.slug),
    ["kauri-downlight", "totara-track-spot", "pohutukawa-pendant", "harbour-surface-cylinder", "rimu-gimbal-downlight"],
  );
  const variantTotal = all.body.products.reduce((n, p) => n + p.variants.length, 0);
  eq("variant total", variantTotal, 59);

  // Journey 1: search "downlight" gives exactly two cards.
  const search = await anon.get("/api/catalogue?q=downlight");
  eq("search downlight", search.body.products.map((p) => p.name), ["Kauri Downlight", "Rimu Gimbal Downlight"]);

  // Journey 1: filter Matte Black gives exactly three cards.
  const black = await anon.get("/api/catalogue?finish=BK");
  eq(
    "filter Matte Black",
    black.body.products.map((p) => p.name),
    ["Kauri Downlight", "T\u014dtara Track Spot", "Harbour Surface Cylinder"],
  );

  const clearance = await anon.get("/api/catalogue?family=clearance");
  eq(
    "clearance family",
    clearance.body.products.map((p) => p.slug).sort(),
    ["harbour-surface-cylinder", "rimu-gimbal-downlight"],
  );

  const unknown = await anon.get("/api/catalogue?finish=ZZ");
  eq("unknown filter value matches nothing", unknown.body.products.length, 0);
  const multi = await anon.get("/api/catalogue?beam=15,60");
  eq("comma list is an any-match", multi.body.products.length, 3);
  eq("trimmed empty q means no search", (await anon.get("/api/catalogue?q=%20%20")).body.products.length, 5);
  eq("q matches a variant code", (await anon.get("/api/catalogue?q=php-bz")).body.products.length, 1);
  eq("q matches the description", (await anon.get("/api/catalogue?q=glare-free")).body.products.length, 1);

  // ---------- DP-02 price fields by role ----------
  const kauriAnon = await anon.get("/api/products/kauri-downlight");
  eq("signed-out variant keys", Object.keys(kauriAnon.body.product.variants[0]).sort(), PUBLIC_VARIANT_KEYS);
  eq(
    "product keys",
    Object.keys(kauriAnon.body.product).sort(),
    ["slug", "name", "family", "description", "watts", "cri", "ip_rating", "default_variant", "variants"].sort(),
  );

  const retail = new Client();
  await retail.signin("jo@bennett-home.test", "Retail-buyer-2026");
  const kauriRetail = await retail.get("/api/products/kauri-downlight");
  eq("retail variant keys", Object.keys(kauriRetail.body.product.variants[0]).sort(), PUBLIC_VARIANT_KEYS);

  const pending = new Client();
  await pending.signin("sam@whitcombe-wholesale.test", "Trade-pending-2026");
  const kauriPending = await pending.get("/api/products/kauri-downlight");
  eq("unapproved trade variant keys", Object.keys(kauriPending.body.product.variants[0]).sort(), PUBLIC_VARIANT_KEYS);
  eq("unapproved trade status", (await pending.get("/api/me")).body.user.trade_status, "submitted");

  const trade = new Client();
  await trade.signin("rangi@kowhai-electrical.test", "Trade-approved-2026");
  const kauriTrade = await trade.get("/api/products/kauri-downlight");
  eq("approved trade variant keys", Object.keys(kauriTrade.body.product.variants[0]).sort(), TRADE_VARIANT_KEYS);

  const adminClient = new Client();
  await adminClient.signin("admin@southerly-light.test", "Lightfall-admin-2026");
  eq(
    "admin variant keys",
    Object.keys((await adminClient.get("/api/products/kauri-downlight")).body.product.variants[0]).sort(),
    TRADE_VARIANT_KEYS,
  );

  // ---------- seed prices ----------
  const byCode = new Map();
  for (const p of (await trade.get("/api/catalogue")).body.products) {
    for (const v of p.variants) byCode.set(v.code, v);
  }
  eq("KDL-WH-36-3000 retail", byCode.get("KDL-WH-36-3000").retail_price_cents, 8900);
  eq("KDL-WH-36-3000 trade", byCode.get("KDL-WH-36-3000").trade_price_cents, 6400);
  eq("KDL-BR-24-4000 retail (BR +2000, beam24 +600)", byCode.get("KDL-BR-24-4000").retail_price_cents, 11500);
  eq("KDL-BR-24-4000 trade (BR +1400, beam24 +400)", byCode.get("KDL-BR-24-4000").trade_price_cents, 8200);
  eq("PHP-BZ-60-2700 trade", byCode.get("PHP-BZ-60-2700").trade_price_cents, 24150);
  eq("TTS-BK-15-2700 retail (beam15 +900)", byCode.get("TTS-BK-15-2700").retail_price_cents, 15800);
  eq("KDL-BK-24-3000 candela", byCode.get("KDL-BK-24-3000").candela, 6550);
  eq("TTS-BK-15-4000 candela", byCode.get("TTS-BK-15-4000").candela, 23420);
  eq("HSC-CH-24-3000 is clearance at 7900", byCode.get("HSC-CH-24-3000").retail_price_cents, 7900);
  eq("HSC-CH-24-3000 was price is the regular retail", byCode.get("HSC-CH-24-3000").was_price_cents, 13100);
  eq("HSC-CH-24-3000 stock", byCode.get("HSC-CH-24-3000").stock_on_hand, 1);
  eq("RGD clearance price", byCode.get("RGD-SN-36-3000").retail_price_cents, 5900);
  eq("RGD clearance trade price equals clearance price", byCode.get("RGD-SN-36-3000").trade_price_cents, 5900);
  eq("RGD was price", byCode.get("RGD-SN-36-3000").was_price_cents, 11900);
  eq("RGD stock", byCode.get("RGD-SN-36-3000").stock_on_hand, 3);
  eq("non-clearance stock is null", byCode.get("KDL-WH-36-3000").stock_on_hand, null);
  eq("non-clearance was price is null", byCode.get("KDL-WH-36-3000").was_price_cents, null);

  // ---------- DP-03 compare ----------
  const cmp = await anon.get("/api/compare?codes=KDL-BK-24-3000,TTS-BK-24-3000");
  eq("compare status", cmp.status, 200);
  eq("compare item order", cmp.body.items.map((i) => i.code), ["KDL-BK-24-3000", "TTS-BK-24-3000"]);
  eq("compare pool at 2.7 m", cmp.body.items[0].pool_diameter_mm_at_2700, 1148);
  eq("compare centre lux at 2.7 m", cmp.body.items[0].centre_lux_at_2700, 898);
  eq(
    "comparison item keys",
    Object.keys(cmp.body.items[0]).sort(),
    [...PUBLIC_VARIANT_KEYS, "product_slug", "product_name", "watts", "cri", "ip_rating",
     "pool_diameter_mm_at_2700", "centre_lux_at_2700"].sort(),
  );
  const five = await anon.get("/api/compare?codes=KDL-BK-24-3000,KDL-BK-36-3000,KDL-BK-60-3000,KDL-WH-24-3000,KDL-WH-36-3000");
  eq("five codes refused", [five.status, five.body.errors.codes], [422, "too_many"]);
  eq("unknown code", (await anon.get("/api/compare?codes=NOPE")).body.error, "unknown_variant");

  // ---------- DP-04 favourites ----------
  eq("favourites need a session", (await anon.get("/api/favourites")).status, 401);
  eq("save favourite", (await retail.put("/api/favourites/KDL-BK-24-3000")).status, 200);
  eq("repeat save is a no-op", (await retail.put("/api/favourites/KDL-BK-24-3000")).status, 200);
  eq("favourite listed", (await retail.get("/api/favourites")).body.items.length, 1);
  eq("unknown favourite", (await retail.put("/api/favourites/NOPE")).status, 404);
  const favKeys = Object.keys((await retail.get("/api/favourites")).body.items[0]).sort();
  eq("favourite keys", favKeys, [...PUBLIC_VARIANT_KEYS, "product_name", "product_slug"].sort());
  // Persists across sessions: sign in again in a fresh client.
  const retail2 = new Client();
  await retail2.signin("jo@bennett-home.test", "Retail-buyer-2026");
  eq("favourite persists across sessions", (await retail2.get("/api/favourites")).body.items.length, 1);
  eq("remove favourite", (await retail.del("/api/favourites/KDL-BK-24-3000")).status, 204);
  eq("favourites now empty", (await retail.get("/api/favourites")).body.items.length, 0);

  // ---------- DP-07 cart and GST ----------
  const cart0 = await retail.get("/api/cart");
  eq("cart status", cart0.status, 200);
  check("order key format", /^LF-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(cart0.body.order.order_key), cart0.body.order.order_key);
  eq("cart starts empty", cart0.body.order.lines.length, 0);
  eq("cart tier for retail", cart0.body.order.price_tier, "retail");

  const added = await retail.post("/api/cart/lines", { variant_code: "KDL-BK-24-3000", quantity: 2 });
  eq("add line", added.status, 200);
  eq("line total", added.body.order.lines[0].line_total_cents, 2 * 9500);
  eq("subtotal", added.body.order.subtotal_cents, 19000);
  eq("gst 15%", added.body.order.gst_cents, 2850);
  eq("total", added.body.order.total_cents, 21850);
  eq("display status", added.body.order.display_status, "Cart");

  const addedAgain = await retail.post("/api/cart/lines", { variant_code: "KDL-BK-24-3000", quantity: 1 });
  eq("adds to the existing line", addedAgain.body.order.lines[0].quantity, 3);
  eq("remove by setting zero", (await retail.patch("/api/cart/lines/KDL-BK-24-3000", { quantity: 0 })).body.order.lines.length, 0);

  // GST rounds halves up: PHP-BZ-60-2700 at trade is the brief's worked example.
  const tradeCart = await trade.post("/api/cart/lines", { variant_code: "PHP-BZ-60-2700", quantity: 1 });
  eq("trade tier", tradeCart.body.order.price_tier, "trade");
  eq("worked example subtotal", tradeCart.body.order.subtotal_cents, 24150);
  eq("worked example gst", tradeCart.body.order.gst_cents, 3623);
  eq("worked example total", tradeCart.body.order.total_cents, 27773);

  // ---------- DP-56 server boundary ----------
  eq("unknown api path", (await anon.get("/api/nope")).body.error, "not_found");
  const wrongType = await anon.call("POST", "/api/auth/signin", {
    body: "email=x", headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  eq("wrong content type", [wrongType.status, wrongType.body.error], [415, "unsupported_media_type"]);
  const badJson = await anon.call("POST", "/api/auth/signin", { body: "{oops", headers: { "content-type": "application/json" } });
  eq("unparseable json", [badJson.status, badJson.body.error], [400, "invalid_json"]);
  const huge = await anon.call("POST", "/api/auth/signin", {
    body: JSON.stringify({ email: "a".repeat(100_001) }), headers: { "content-type": "application/json" },
  });
  eq("json over 100000 bytes", [huge.status, huge.body.error], [413, "payload_too_large"]);
  const cross = await anon.call("POST", "/api/auth/signin", {
    body: { email: "a@b.test", password: "x" }, headers: { origin: "http://evil.test" },
  });
  eq("cross origin refused", [cross.status, cross.body.error], [403, "cross_origin"]);
  const crossGet = await anon.call("GET", "/api/catalogue", { headers: { origin: "http://evil.test" } });
  eq("cross origin GET allowed", crossGet.status, 200);
  // Framing is checked before the origin.
  const crossBadJson = await anon.call("POST", "/api/auth/signin", {
    body: "{oops", headers: { "content-type": "application/json", origin: "http://evil.test" },
  });
  eq("framing precedes origin", crossBadJson.body.error, "invalid_json");

  for (const path of ["/run.json", "/package.json", "/package-lock.json", "/src/server/index.ts", "/.env", "/tsconfig.json", "/vite.config.ts"]) {
    eq(`never serves ${path}`, (await anon.get(path)).status, 404);
  }

  // ---------- DP-19 / DP-47 admin only ----------
  for (const [name, client] of [["signed out", anon], ["retail", retail], ["trade", trade]]) {
    const expected = name === "signed out" ? 401 : 403;
    eq(`${name} refused admin health`, (await client.get("/api/admin/health")).status, expected);
    eq(`${name} refused admin orders`, (await client.get("/api/admin/orders")).status, expected);
    eq(`${name} refused admin stock`, (await client.get("/api/admin/stock")).status, expected);
    // Admin paths never answer 404 to non-admins, even for unknown records.
    const bogus = await client.post("/api/admin/trade-applications/00000000-0000-0000-0000-000000000000/approve", {});
    eq(`${name} refused unknown application without 404`, bogus.status, expected);
  }

  const health = await adminClient.get("/api/admin/health");
  eq("health status", health.status, 200);
  eq(
    "health services",
    Object.keys(health.body.services).sort(),
    ["killbill", "mailpit", "minio", "pocketbase", "postgres"],
  );
  eq("all services up", Object.values(health.body.services).every((s) => s === "up"), true);

  // ---------- DP-18 trade applications ----------
  const apps = await adminClient.get("/api/admin/trade-applications?status=submitted");
  eq("one submitted application", apps.body.applications.length, 1);
  eq("submitted applicant", apps.body.applications[0].business_name, "Whitcombe Wholesale");
  eq("nzbn seeded", apps.body.applications[0].nzbn, "9429030000017");

  // ---------- DP-17 sign-up validation ----------
  const dupe = await anon.post("/api/auth/signup", {
    email: "jo@bennett-home.test", password: "a-long-enough-password", name: "Jo", account_type: "retail",
  });
  eq("duplicate email", [dupe.status, dupe.body.error], [409, "email_taken"]);
  const shortPw = await anon.post("/api/auth/signup", {
    email: "new1@example.test", password: "short", name: "N", account_type: "retail",
  });
  eq("short password", [shortPw.status, shortPw.body.errors.password], [422, "too_short"]);
  const badNzbn = await anon.post("/api/auth/signup", {
    email: "new2@example.test", password: "a-long-enough-password", name: "N", account_type: "trade",
    trade: { business_name: "B", nzbn: "12345678901", occupation: "wholesaler" },
  });
  eq("bad nzbn", [badNzbn.status, badNzbn.body.errors.nzbn], [422, "invalid"]);
  const missingTrade = await anon.post("/api/auth/signup", {
    email: "new3@example.test", password: "a-long-enough-password", name: "N", account_type: "trade",
  });
  eq("trade block required", [missingTrade.status, missingTrade.body.errors.trade], [422, "required"]);
  eq("bad credentials", (await anon.post("/api/auth/signin", { email: "jo@bennett-home.test", password: "nope" })).body.error, "invalid_credentials");

  // ---------- DP-30 light-pool geometry ----------
  const projects = await trade.get("/api/projects");
  eq("seeded project visible", projects.body.projects.length, 1);
  const ponsonby = projects.body.projects[0];
  eq("project name", ponsonby.name, "Ponsonby Kitchen");
  eq("project client", ponsonby.client_name, "M. and T. Hale");
  eq("project ceiling", ponsonby.ceiling_height_mm, 2700);
  eq("project room", [ponsonby.room_width_mm, ponsonby.room_depth_mm], [6000, 4500]);
  eq("project is owned", ponsonby.is_owner, true);
  eq("project lines", ponsonby.lines.map((l) => [l.variant_code, l.quantity]), [["KDL-BK-24-2700", 6], ["TTS-BK-36-3000", 2]]);
  eq("project collaborator", ponsonby.collaborators.map((c) => c.email), ["isla@harbourlight.test"]);

  // Two KDL-BK-24-2700 500 mm apart: pool 1148, own 858 (2700K candela 6260).
  const p1 = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-2700", x_mm: 3000, y_mm: 2300 });
  eq("placement created", p1.status, 201);
  eq("placement ordinal starts at 1", p1.body.placement.ordinal, 1);
  eq("pool diameter at 2700", p1.body.placement.pool_diameter_mm, 1148);
  eq("own lux alone", p1.body.placement.own_lux, 859);
  eq("centre lux alone equals own lux", p1.body.placement.centre_lux, 859);

  const p2 = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-2700", x_mm: 3500, y_mm: 2300 });
  eq("second ordinal", p2.body.placement.ordinal, 2);
  const after = await trade.get(`/api/projects/${ponsonby.id}`);
  const pair = after.body.project.placements.filter((p) => p.variant_code === "KDL-BK-24-2700");
  eq("overlapping centre lux is summed", pair.map((p) => p.centre_lux), [1675, 1675]);

  // The brief's worked example uses 3000K candela 6550 -> 1753.
  const kdl3000 = await trade.post(`/api/projects/${ponsonby.id}/lines`, { variant_code: "KDL-BK-24-3000", quantity: 2 });
  eq("line added to project", kdl3000.status, 200);
  const q1 = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-3000", x_mm: 1000, y_mm: 1000 });
  eq("a lone fitting reports its own lux", q1.body.placement.centre_lux, 898);
  await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-3000", x_mm: 1500, y_mm: 1000 });
  const settled = (await trade.get(`/api/projects/${ponsonby.id}`)).body.project.placements
    .filter((p) => p.variant_code === "KDL-BK-24-3000");
  eq("worked example centre lux", settled.map((p) => p.centre_lux), [1753, 1753]);

  // ---------- DP-31 placements ----------
  const outside = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-3000", x_mm: 6001, y_mm: 0 });
  eq("outside the room", outside.status, 422);
  const edge = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "TTS-BK-36-3000", x_mm: 6000, y_mm: 4500 });
  eq("the edges are allowed", edge.status, 201);
  // KDL-BK-24-3000 line quantity is 2 and both are placed.
  const tooMany = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-3000", x_mm: 2000, y_mm: 2000 });
  eq("never more placements than the line quantity", [tooMany.status, tooMany.body.error], [409, "placement_exceeds_quantity"]);
  const lower = await trade.patch(`/api/projects/${ponsonby.id}/lines/KDL-BK-24-3000`, { quantity: 1 });
  eq("lowering below the placed count", [lower.status, lower.body.error], [409, "placement_exceeds_quantity"]);
  const shrink = await trade.patch(`/api/projects/${ponsonby.id}`, { room_width_mm: 2000, room_depth_mm: 2000 });
  eq("shrinking the room", [shrink.status, shrink.body.error], [409, "placements_outside_room"]);

  // Ordinals are never reused: remove the highest, then place again.
  const removeEdge = await trade.del(`/api/projects/${ponsonby.id}/placements/${edge.body.placement.id}`);
  eq("placement removed", removeEdge.status, 204);
  const replaced = await trade.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "TTS-BK-36-3000", x_mm: 100, y_mm: 100 });
  eq("ordinal is not reused after a removal", replaced.body.placement.ordinal, 2);

  const ceilingBad = await trade.patch(`/api/projects/${ponsonby.id}`, { ceiling_height_mm: 5000 });
  eq("ceiling out of range", [ceilingBad.status, ceilingBad.body.errors.ceiling_height_mm], [422, "out_of_range"]);
  const ceiling3000 = await trade.patch(`/api/projects/${ponsonby.id}`, { ceiling_height_mm: 3000 });
  eq("ceiling set to 3.0 m", ceiling3000.body.project.ceiling_height_mm, 3000);
  const at3000 = ceiling3000.body.project.placements.find((p) => p.variant_code === "KDL-BK-24-2700");
  eq("pool grows with the ceiling", at3000.pool_diameter_mm, 1275);
  eq("own lux falls with the ceiling", at3000.own_lux, 696);
  await trade.patch(`/api/projects/${ponsonby.id}`, { ceiling_height_mm: 2700 });

  // ---------- DP-27 / DP-36 project access ----------
  eq("retail cannot create projects", (await retail.post("/api/projects", { name: "X" })).body.error, "trade_account_required");
  eq("retail cannot list projects", (await retail.get("/api/projects")).body.error, "trade_account_required");
  eq("unapproved trade cannot create projects", (await pending.post("/api/projects", { name: "X" })).body.error, "trade_account_required");
  eq("a stranger gets not-found", (await retail.get(`/api/projects/${ponsonby.id}`)).status, 404);
  const collab = new Client();
  await collab.signin("isla@harbourlight.test", "Trade-collab-2026");
  eq("the collaborator can see the project", (await collab.get(`/api/projects/${ponsonby.id}`)).status, 200);
  eq("the collaborator is not the owner", (await collab.get(`/api/projects/${ponsonby.id}`)).body.project.is_owner, false);
  eq("the collaborator can place", (await collab.post(`/api/projects/${ponsonby.id}/placements`, { variant_code: "KDL-BK-24-2700", x_mm: 500, y_mm: 500 })).status, 201);
  eq("only the owner invites", (await collab.post(`/api/projects/${ponsonby.id}/collaborators`, { email: "lee@chen-house.test" })).body.error, "owner_only");
  const notTrade = await trade.post(`/api/projects/${ponsonby.id}/collaborators`, { email: "lee@chen-house.test" });
  eq("inviting a retail account", [notTrade.status, notTrade.body.errors.email], [422, "not_a_trade_account"]);

  // ---------- DP-37 comments ----------
  const comment = await trade.post(`/api/projects/${ponsonby.id}/comments`, { body: "Centre the pair over the island." });
  eq("comment posted", comment.status, 201);
  eq("comment author", comment.body.comment.author_name, "Rangi Parata");
  const comments = await collab.get(`/api/projects/${ponsonby.id}/comments`);
  eq("the collaborator sees the comment", comments.body.comments.some((c) => c.body === "Centre the pair over the island."), true);
  const longComment = await trade.post(`/api/projects/${ponsonby.id}/comments`, { body: "x".repeat(2001) });
  eq("comment length limit", [longComment.status, longComment.body.errors.body], [422, "too_long"]);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
