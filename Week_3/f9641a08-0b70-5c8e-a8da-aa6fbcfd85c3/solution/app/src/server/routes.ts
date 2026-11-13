import type { CaseKind, Config, CollectionSummary } from "../shared/api";
import { createHash } from "node:crypto";
import * as accounts from "./accounts";
import { airlines, productDetail } from "./catalogue";
import * as cart from "./cart";
import * as cases from "./cases";
import * as checkout from "./checkout";
import { config } from "./config";
import { one, pool, rows, unit, type Unit } from "./db";
import type { Ctx, Reply } from "./http";
import { FIELD, fail, tooLargeFile, validation } from "./errors";
import * as evidence from "./evidence";
import { hasCabinFit } from "../shared/cabin";
import { cabinFit } from "./fit";
import { fingerprint, lookupStored, once, type Stored } from "./idempotency";
import { searchReachable } from "./indexer";
import * as orders from "./orders";
import { searchProducts, suggest, COLLECTIONS } from "./search";
import * as reports from "./reports";
import { runSetup, tokenMatches } from "./setup";
import * as staff from "./staff";
import { collectionUnits, figures, badgeFor, lapseExpiredHolds, totalAvailable } from "./stock";
import { storageReachable } from "./storage";
import { isIdempotencyKey } from "./validate";
import { knownCaseStatus } from "./machines";

export interface Route {
  method: string;
  pattern: RegExp;
  template: string;
  auth: "any" | "user" | "staff";
  upload?: boolean;
  hidden?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export const routes: Route[] = [];

type Handler = (ctx: Ctx) => Promise<Reply>;
interface Options {
  auth?: Route["auth"];
  upload?: boolean;
  hidden?: boolean;
}

function add(method: string, template: string, options: Options, handler: Handler): void {
  const pattern = new RegExp(`^${template.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
  routes.push({ method, pattern, template, auth: options.auth ?? "any", upload: options.upload, hidden: options.hidden, handler });
}

const json = (status: number, body: object): Reply => ({ status, body });

function fromStored(stored: Stored): Reply {
  return { status: stored.status, text: stored.text, headers: stored.replayed ? { "Idempotency-Replayed": "true" } : undefined };
}

/** Runs the write once per Idempotency-Key when one is sent; otherwise just runs it. */
async function keyed(ctx: Ctx, userId: string, body: unknown, work: (u: Unit) => Promise<{ status: number; body: object }>): Promise<Reply> {
  const key = ctx.idempotencyKey;
  if (key === null) {
    const result = await unit(work);
    return json(result.status, result.body);
  }
  if (!isIdempotencyKey(key)) throw validation({ "Idempotency-Key": FIELD.idempotencyKey });
  return fromStored(await once(`${userId}:${ctx.method} ${ctx.route.template}`, key, fingerprint(ctx.method, ctx.route.template, body), work));
}

const session = (ctx: Ctx) => ctx.session;

// ---- platform and catalogue ------------------------------------------------------------------

add("GET", "/api/health", {}, async () => {
  const [search, storage] = await Promise.all([searchReachable(), storageReachable()]);
  return json(200, { status: search && storage ? "ok" : "unavailable" });
});

add("GET", "/api/config", {}, async () => {
  const body: Config = {
    reservation_ttl_seconds: config.reservationTtlSeconds,
    return_window_days: config.returnWindowDays,
    trial_window_days: config.trialWindowDays,
    compare_max: config.compareMax,
    page_size: config.pageSize,
    cart_undo_seconds: config.cartUndoSeconds,
    toast_seconds: config.toastSeconds,
    low_stock_threshold: config.lowStockThreshold,
    free_shipping_minimum: config.freeShippingMinimum,
    tax_rate_percent: config.taxRatePercent,
    upload_max_bytes: config.uploadMaxBytes,
    warranty_years_luggage: config.warrantyYearsLuggage,
    warranty_years_bags: config.warrantyYearsBags,
    warranty_years_accessories: config.warrantyYearsAccessories,
  };
  return json(200, body);
});

const COLLECTION_NAMES: Record<string, string> = { all: "All bags", luggage: "Luggage", backpacks: "Backpacks", totes: "Totes", wallets: "Wallets", accessories: "Accessories" };

add("GET", "/api/collections", {}, async () => {
  await lapseExpiredHolds();
  const units = await collectionUnits(pool);
  const designs = await rows<{ category: string; n: number }>(pool, "SELECT category, count(*) AS n FROM products WHERE status = 'published' GROUP BY category");
  const total = designs.reduce((sum, d) => sum + d.n, 0);
  const body: CollectionSummary[] = COLLECTIONS.map((slug) => ({
    slug,
    name: COLLECTION_NAMES[slug] ?? slug,
    designs: slug === "all" ? total : (designs.find((d) => d.category === slug)?.n ?? 0),
    units: units.get(slug) ?? 0,
  }));
  return json(200, body);
});

add("GET", "/api/search", {}, async (ctx) => json(200, await searchProducts(ctx.query)));
add("GET", "/api/search/suggest", {}, async (ctx) => json(200, await suggest(ctx.query.get("q") ?? "")));

add("GET", "/api/products/:slug", {}, async (ctx) => {
  const product = await productDetail(pool, ctx.params.slug ?? "");
  if (!product) throw fail("not_found");
  return json(200, product);
});

add("GET", "/api/variants/:sku/stock", {}, async (ctx) => {
  await lapseExpiredHolds();
  const sku = ctx.params.sku ?? "";
  if (!(await one(pool, "SELECT 1 FROM variants WHERE sku = $1", [sku]))) throw fail("not_found");
  const by = (await figures(pool, [sku])).get(sku);
  const available = by ? totalAvailable(by) : 0;
  return json(200, { sku, available, badge: badgeFor(available) });
});

add("GET", "/api/airlines", {}, async () => json(200, await airlines(pool)));

add("GET", "/api/fit", {}, async (ctx) => {
  const frames = await airlines(pool);
  const frame = frames.find((f) => f.code === ctx.query.get("airline"));
  const variant = await one<{ sku: string; category: string; height_cm: number; width_cm: number; depth_cm: number }>(
    pool,
    "SELECT v.sku, p.category, v.height_cm, v.width_cm, v.depth_cm FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = $1",
    [ctx.query.get("sku") ?? ""],
  );
  const fields: Record<string, string> = {};
  if (!frame) fields.airline = FIELD.airline;
  if (!variant || !hasCabinFit(variant.category)) fields.sku = FIELD.fitSku;
  if (!frame || !variant || Object.keys(fields).length > 0) throw validation(fields);
  return json(200, cabinFit(variant.sku, { height: variant.height_cm, width: variant.width_cm, depth: variant.depth_cm }, frame));
});

// ---- accounts, wishlist, addresses ------------------------------------------------------------

const sessionCookie = (id: string) => `rh_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;

add("POST", "/api/accounts", {}, async (ctx) => {
  const { user, sessionId } = await accounts.register(ctx.body, session(ctx));
  return { status: 201, body: { user }, headers: { "Set-Cookie": sessionCookie(sessionId) } };
});

add("POST", "/api/session", {}, async (ctx) => {
  const { user, sessionId } = await accounts.signIn(ctx.body, session(ctx));
  return { status: 200, body: { user }, headers: { "Set-Cookie": sessionCookie(sessionId) } };
});

add("DELETE", "/api/session", {}, async (ctx) => {
  await accounts.signOut(session(ctx).id);
  return { status: 204, headers: { "Set-Cookie": "rh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } };
});

add("GET", "/api/me", {}, async (ctx) => json(200, { user: session(ctx).user }));

add("GET", "/api/addresses", { auth: "user" }, async (ctx) => json(200, await accounts.listAddresses(pool, ctx.user().id)));
add("POST", "/api/addresses", { auth: "user" }, async (ctx) => json(201, await accounts.addAddress(pool, ctx.user().id, ctx.body)));
add("DELETE", "/api/addresses/:id", { auth: "user" }, async (ctx) => {
  await accounts.removeAddress(pool, ctx.user().id, ctx.params.id ?? "");
  return { status: 204 };
});

add("GET", "/api/wishlist", {}, async (ctx) => json(200, await accounts.wishlistOf(pool, session(ctx).owner)));
add("PUT", "/api/wishlist/:slug", {}, async (ctx) => json(200, await unit((u) => accounts.save(u, session(ctx).owner, ctx.params.slug ?? ""))));
add("DELETE", "/api/wishlist/:slug", {}, async (ctx) => json(200, await unit((u) => accounts.unsave(u, session(ctx).owner, ctx.params.slug ?? ""))));

add("GET", "/api/notifications", { auth: "user" }, async (ctx) => json(200, await accounts.notificationsOf(pool, ctx.user().id)));
add("GET", "/api/gift-cards/:code", { auth: "user" }, async (ctx) => json(200, await accounts.giftCardView(pool, ctx.params.code ?? "")));

// ---- bag ---------------------------------------------------------------------------------------

add("GET", "/api/cart", {}, async (ctx) => {
  await lapseExpiredHolds();
  return json(200, await unit((u) => cart.readCart(u, session(ctx))));
});
add("POST", "/api/cart/lines", {}, async (ctx) => json(200, await unit((u) => cart.addLine(u, session(ctx), ctx.body))));
add("PATCH", "/api/cart/lines/:id", {}, async (ctx) => json(200, await unit((u) => cart.setQuantity(u, session(ctx), ctx.params.id ?? "", ctx.body))));
add("DELETE", "/api/cart/lines/:id", {}, async (ctx) => json(200, await unit((u) => cart.removeLine(u, session(ctx), ctx.params.id ?? ""))));
add("POST", "/api/cart/codes", {}, async (ctx) => json(200, await unit((u) => cart.applyCode(u, session(ctx), ctx.body))));
add("DELETE", "/api/cart/discount", {}, async (ctx) => json(200, await unit((u) => cart.removeDiscount(u, session(ctx)))));
add("DELETE", "/api/cart/gift-card", {}, async (ctx) => json(200, await unit((u) => cart.removeGiftCard(u, session(ctx)))));

// ---- checkout and orders ----------------------------------------------------------------------------

add("POST", "/api/checkout", { auth: "user" }, async (ctx) => json(201, await unit((u) => checkout.create(u, session(ctx), ctx.user().id, ctx.now))));

add("GET", "/api/checkout/:id", { auth: "user" }, async (ctx) => {
  await lapseExpiredHolds();
  return json(200, await unit(async (u) => checkout.body(u, await checkout.loadOwned(u.db, ctx.params.id ?? "", ctx.user().id), session(ctx).owner, ctx.now)));
});

add("PATCH", "/api/checkout/:id", { auth: "user" }, async (ctx) =>
  json(200, await unit((u) => checkout.patch(u, session(ctx), ctx.user().id, ctx.params.id ?? "", ctx.body, ctx.now))));

add("POST", "/api/checkout/:id/reserve", { auth: "user" }, async (ctx) => json(200, { hold: await checkout.reserveHold(session(ctx), ctx.user().id, ctx.params.id ?? "") }));

add("POST", "/api/orders", { auth: "user" }, async (ctx) => {
  const user = ctx.user();
  return fromStored(await orders.place(session(ctx), user.id, user.email, ctx.body, ctx.idempotencyKey, ctx.now));
});

add("GET", "/api/orders", { auth: "user" }, async (ctx) => json(200, await orders.listFor(pool, ctx.user().id)));
add("GET", "/api/orders/:number", { auth: "user" }, async (ctx) => {
  await lapseExpiredHolds();
  return json(200, await orders.orderBody(pool, await orders.findByNumber(pool, ctx.params.number ?? "", ctx.user().id), ctx.now));
});
add("POST", "/api/orders/:number/cancel", { auth: "user" }, async (ctx) =>
  json(200, await unit(async (u) => {
    const order = await orders.findByNumber(u.db, ctx.params.number ?? "", ctx.user().id, true);
    await orders.cancelOrder(u, order, ctx.now);
    return orders.orderBody(u.db, await orders.findByNumber(u.db, order.number), ctx.now);
  })));

// ---- returns, trials, warranty ------------------------------------------------------------------------

function caseRoutes(kind: CaseKind, path: string, create: (u: Unit, userId: string, body: Record<string, unknown>, now: Date) => Promise<object>): void {
  add("POST", `/api/${path}`, { auth: "user" }, async (ctx) => {
    const user = ctx.user();
    return keyed(ctx, user.id, ctx.body, async (u) => ({ status: 201, body: await create(u, user.id, ctx.body, ctx.now) }));
  });
  add("GET", `/api/${path}`, { auth: "user" }, async (ctx) => {
    const found = await cases.listCases(pool, kind, { userId: ctx.user().id });
    return json(200, await Promise.all(found.map((row) => cases.customerBody(pool, row))));
  });
  add("GET", `/api/${path}/:number`, { auth: "user" }, async (ctx) =>
    json(200, await cases.customerBody(pool, await cases.loadCase(pool, kind, ctx.params.number ?? "", ctx.user().id))));
}

caseRoutes("return", "returns", cases.createReturn);
caseRoutes("trial", "trials", cases.createTrial);
caseRoutes("claim", "warranty/claims", cases.createClaim);

add("POST", "/api/warranty/registrations", { auth: "user" }, async (ctx) => {
  const result = await unit((u) => cases.registerWarranty(u, ctx.user().id, ctx.body, ctx.now));
  return json(result.status, result.body);
});

add("POST", "/api/warranty/evidence", { auth: "user", upload: true }, async (ctx) => {
  const user = ctx.user();
  const input = evidence.readUpload(ctx.form);
  const print = input.file ? { kind: input.kind, size: input.file.size, sha: createHash("sha256").update(Buffer.from(await input.file.arrayBuffer())).digest("hex") } : { kind: input.kind };
  return keyed(ctx, user.id, print, async (u) => {
    const upload = await evidence.checkUpload(input);
    return { status: 201, body: await evidence.store(u, user.id, upload, ctx.now) };
  });
});

add("GET", "/api/warranty/evidence/:id/content", { auth: "user" }, async (ctx) => {
  const served = await evidence.content(await evidence.ownEvidence(pool, ctx.params.id ?? "", ctx.user().id));
  return { status: 200, bytes: served.bytes, contentType: served.contentType, headers: served.headers };
});

// ---- staff ---------------------------------------------------------------------------------------------

const OPS = "operations" as const;
const SUPPORT = "support" as const;

add("GET", "/api/admin/products", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return json(200, await staff.listProducts(pool));
});

add("GET", "/api/admin/products/:slug", { auth: "staff" }, async (ctx) => {
  const product = await staff.getProduct(pool, ctx.params.slug ?? "");
  staff.requireRole(ctx.user(), OPS);
  return json(200, product);
});

add("PATCH", "/api/admin/products/:slug", { auth: "staff" }, async (ctx) => {
  await staff.findProduct(pool, ctx.params.slug ?? "");
  staff.requireRole(ctx.user(), OPS);
  return json(200, await unit((u) => staff.patchProduct(u, ctx.user(), ctx.params.slug ?? "", ctx.body, ctx.now)));
});

add("PATCH", "/api/admin/variants/:sku", { auth: "staff" }, async (ctx) => {
  if (!(await one(pool, "SELECT 1 FROM variants WHERE sku = $1", [ctx.params.sku ?? ""]))) throw fail("not_found");
  staff.requireRole(ctx.user(), OPS);
  return json(200, await unit((u) => staff.patchVariant(u, ctx.user(), ctx.params.sku ?? "", ctx.body, ctx.now)));
});

add("POST", "/api/admin/products/:slug/images", { auth: "staff", upload: true }, async (ctx) => {
  const slug = ctx.params.slug ?? "";
  await staff.findProduct(pool, slug);
  const user = ctx.user();
  staff.requireRole(user, OPS);
  const key = ctx.idempotencyKey;
  const file = ctx.form?.get("file");
  const colour = ctx.form?.get("colour");
  const alt = ctx.form?.get("alt");
  const upload = file instanceof File ? file : null;
  const bytes = upload ? Buffer.from(await upload.arrayBuffer()) : null;
  const print = fingerprint("POST", ctx.route.template, { slug, colour, alt, file: bytes ? createHash("sha256").update(bytes).digest("hex") : null });
  const scope = `${user.id}:POST ${ctx.route.template}`;
  if (isIdempotencyKey(key)) {
    const stored = await lookupStored(pool, scope, key, print);
    if (stored) return fromStored(stored);
  }
  const fields: Record<string, string> = {};
  if (!isIdempotencyKey(key)) fields["Idempotency-Key"] = FIELD.idempotencyKey;
  const colours = await staff.productColours(pool, slug);
  if (typeof colour !== "string" || !colours.includes(colour)) fields.colour = FIELD.colour;
  if (typeof alt !== "string" || alt.trim().length < 5 || alt.trim().length > 160) fields.alt = FIELD.alt;
  if (!upload) fields.file = FIELD.file;
  if (upload && upload.size > config.uploadMaxBytes) throw tooLargeFile(config.uploadMaxBytes);
  if (Object.keys(fields).length > 0 || !bytes || typeof colour !== "string" || typeof alt !== "string" || !isIdempotencyKey(key)) throw validation(fields);
  return fromStored(await once(scope, key, print, async (u) => ({ status: 201, body: await staff.addImage(u, user, slug, { colour, alt: alt.trim(), bytes }, ctx.now) })));
});

add("GET", "/api/admin/inventory", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  await lapseExpiredHolds();
  return json(200, await staff.inventory(pool, ctx.query.get("low_stock") === "true"));
});

add("GET", "/api/admin/inventory/:sku/movements", { auth: "staff" }, async (ctx) => {
  const sku = ctx.params.sku ?? "";
  if (!(await one(pool, "SELECT 1 FROM variants WHERE sku = $1", [sku]))) throw fail("not_found");
  staff.requireRole(ctx.user(), OPS);
  return json(200, await staff.movements(pool, sku));
});

add("GET", "/api/admin/orders", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS, SUPPORT);
  return json(200, await staff.listOrders(pool, ctx.query.get("q")?.trim() ?? "", ctx.query.get("status") ?? ""));
});

add("GET", "/api/admin/orders/:number", { auth: "staff" }, async (ctx) => {
  const order = await staff.adminOrder(pool, ctx.params.number ?? "", ctx.now);
  staff.requireRole(ctx.user(), OPS, SUPPORT);
  return json(200, order);
});

add("POST", "/api/admin/orders/:number/status", { auth: "staff" }, async (ctx) => {
  await orders.findByNumber(pool, ctx.params.number ?? "");
  staff.requireRole(ctx.user(), OPS);
  return json(200, await unit((u) => staff.setOrderStatus(u, ctx.user(), ctx.params.number ?? "", ctx.body, ctx.now)));
});

add("POST", "/api/admin/orders/:number/shipments", { auth: "staff" }, async (ctx) => {
  await orders.findByNumber(pool, ctx.params.number ?? "");
  staff.requireRole(ctx.user(), OPS);
  return json(201, await unit((u) => staff.createShipment(u, ctx.user(), ctx.params.number ?? "", ctx.body, ctx.now)));
});

function adminCases(kind: CaseKind, path: string): void {
  add("GET", `/api/admin/${path}`, { auth: "staff" }, async (ctx) => {
    staff.requireRole(ctx.user(), SUPPORT);
    const status = ctx.query.get("status") ?? undefined;
    const found = await cases.listCases(pool, kind, { status: status && knownCaseStatus(kind, status) ? status : undefined });
    return json(200, await Promise.all(found.map((row) => cases.caseBody(pool, row))));
  });
  add("GET", `/api/admin/${path}/:number`, { auth: "staff" }, async (ctx) => {
    const row = await cases.loadCase(pool, kind, ctx.params.number ?? "");
    staff.requireRole(ctx.user(), SUPPORT);
    return json(200, await cases.caseBody(pool, row));
  });
  add("POST", `/api/admin/${path}/:number/transition`, { auth: "staff" }, async (ctx) => {
    await cases.loadCase(pool, kind, ctx.params.number ?? "");
    staff.requireRole(ctx.user(), SUPPORT);
    return json(200, await unit((u) => cases.transition(u, staff.asActor(ctx.user()), kind, ctx.params.number ?? "", ctx.body, ctx.now)));
  });
}

adminCases("return", "returns");
adminCases("trial", "trials");
adminCases("claim", "warranty");

add("GET", "/api/admin/warranty/evidence/:id/content", { auth: "staff" }, async (ctx) => {
  const row = await evidence.ownEvidence(pool, ctx.params.id ?? "");
  staff.requireRole(ctx.user(), SUPPORT);
  const served = await evidence.content(row);
  return { status: 200, bytes: served.bytes, contentType: served.contentType, headers: served.headers };
});

add("GET", "/api/admin/discount-codes", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return json(200, await reports.listCodes(pool));
});
add("POST", "/api/admin/discount-codes", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return json(201, await unit((u) => reports.createCode(u, ctx.user(), ctx.body, ctx.now)));
});
add("GET", "/api/admin/gift-cards/:code", { auth: "staff" }, async (ctx) => {
  const ledger = await reports.giftCardLedger(pool, ctx.params.code ?? "");
  staff.requireRole(ctx.user(), OPS);
  return json(200, ledger);
});
add("GET", "/api/admin/audit", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS, SUPPORT);
  return json(200, await reports.auditEntries(pool, ctx.query.get("entity") ?? "", ctx.query.get("entity_id") ?? ""));
});
add("GET", "/api/admin/metrics", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return json(200, await reports.metrics(pool, ctx.query));
});

const csv = (text: string): Reply => ({ status: 200, bytes: Buffer.from(text, "utf8"), contentType: "text/csv; charset=utf-8" });
add("GET", "/api/admin/reports/orders.csv", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return csv(await reports.ordersCsv(pool, ctx.query));
});
add("GET", "/api/admin/reports/inventory.csv", { auth: "staff" }, async (ctx) => {
  staff.requireRole(ctx.user(), OPS);
  return csv(await reports.inventoryCsv(pool));
});

// ---- grading setup: registered only when a grading token is configured --------------------------------

if (config.gradingToken) {
  add("POST", "/api/grading/setup", { hidden: true }, async (ctx) => {
    const given = ctx.headers["x-grading-token"];
    if (!tokenMatches(typeof given === "string" ? given : undefined)) throw fail("not_found");
    return json(201, await runSetup(ctx.body));
  });
}

