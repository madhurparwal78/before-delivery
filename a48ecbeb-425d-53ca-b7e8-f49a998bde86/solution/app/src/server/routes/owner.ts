import { allow, OWNER, signedIn, type Ctx, type Reply } from "../context.js";
import { one, query, rows, tx } from "../db.js";
import { rateLabel } from "../domain/money.js";
import { loadPricing } from "../domain/quote.js";
import { stockChanged, stockFigures } from "../domain/stock.js";
import { applicationDecided } from "../emails.js";
import { getObject } from "../files.js";
import { serviceStatus } from "../health.js";
import { ApiError, int, notFound, str, validation } from "../http.js";
import { decideReview, literal, reviews } from "../pocketbase.js";

const DROP = "cacao-orange";

async function owner(ctx: Ctx): Promise<void> {
  allow(await signedIn(ctx), OWNER);
}

async function dropJson() {
  const drop = await one<{ can_price_cents: number; released: number }>(
    "SELECT can_price_cents, released FROM flavours WHERE slug = $1",
    [DROP],
  );
  return { flavour: DROP, can_price_cents: drop?.can_price_cents ?? 0, released: drop?.released ?? 0 };
}

export async function settings(ctx: Ctx): Promise<Reply> {
  await owner(ctx);
  const pricing = await loadPricing();
  return {
    status: 200,
    body: {
      provinces: pricing.provinces.map((p) => ({
        code: p.code,
        name: p.name,
        shipping_cents: p.shippingCents,
        free_shipping_threshold_cents: p.freeShippingThresholdCents,
        deposit_cents_per_can: p.depositCentsPerCan,
        taxes: p.taxes.map((t) => ({ name: t.name, rate: rateLabel(t.rateMilli) })),
      })),
      drop: await dropJson(),
    },
  };
}

export async function updateProvince(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  const code = ctx.params[0].toUpperCase();
  const pricing = await loadPricing();
  const province = pricing.provinces.find((p) => p.code === code);
  if (!province) throw notFound();
  allow(user, OWNER);
  const shipping = int(ctx.body, "shipping_cents");
  const threshold = int(ctx.body, "free_shipping_threshold_cents");
  const fields: Record<string, string> = {};
  if (shipping === undefined || shipping < 0 || shipping > 10000) fields.shipping_cents = "Shipping runs from $0.00 to $100.00.";
  if (threshold === undefined || threshold < 0 || threshold > 100000) {
    fields.free_shipping_threshold_cents = "The threshold runs from $0.00 to $1,000.00.";
  }
  if (shipping === undefined || threshold === undefined || Object.keys(fields).length > 0) throw validation(fields);
  await query("UPDATE provinces SET shipping_cents = $2, free_shipping_threshold_cents = $3 WHERE code = $1", [code, shipping, threshold]);
  return {
    status: 200,
    body: {
      province: {
        code,
        name: province.name,
        shipping_cents: shipping,
        free_shipping_threshold_cents: threshold,
        deposit_cents_per_can: province.depositCentsPerCan,
        taxes: province.taxes.map((t) => ({ name: t.name, rate: rateLabel(t.rateMilli) })),
      },
    },
  };
}

export async function updateDrop(ctx: Ctx): Promise<Reply> {
  await owner(ctx);
  const price = ctx.body.can_price_cents === undefined ? undefined : int(ctx.body, "can_price_cents");
  const released = ctx.body.released === undefined ? undefined : int(ctx.body, "released");
  await tx(async (client) => {
    await rows(client, "SELECT slug FROM flavours WHERE slug = $1 FOR UPDATE", [DROP]);
    const [figures] = await stockFigures(client, DROP);
    const committed = figures.reserved + figures.sold;
    if (released !== undefined && released < committed) {
      throw new ApiError(409, "below_committed", `${committed} cans are already held or sold, so the release can't go below that.`, {
        committed,
      });
    }
    const fields: Record<string, string> = {};
    if (ctx.body.can_price_cents !== undefined && (price === undefined || price < 1 || price > 2000)) {
      fields.can_price_cents = "The can price runs from $0.01 to $20.00.";
    }
    if (ctx.body.released !== undefined && (released === undefined || released < 0)) fields.released = "Release a whole number of cans.";
    else if (released !== undefined && released > figures.received) fields.released = `Only ${figures.received} cans were received.`;
    if (Object.keys(fields).length > 0) throw validation(fields);
    if (price !== undefined) await rows(client, "UPDATE flavours SET can_price_cents = $2 WHERE slug = $1", [DROP, price]);
    if (released !== undefined) await rows(client, "UPDATE flavours SET released = $2 WHERE slug = $1", [DROP, released]);
  });
  stockChanged([DROP]);
  return { status: 200, body: { drop: await dropJson() } };
}

export async function dashboard(ctx: Ctx): Promise<Reply> {
  await owner(ctx);
  const [dunning] = await query<{ entered: number; recovered: number; cancelled: number; in_progress: number }>(
    `SELECT count(*)::int AS entered,
       count(*) FILTER (WHERE status = 'recovered')::int AS recovered,
       count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       count(*) FILTER (WHERE status = 'open')::int AS in_progress
     FROM dunning WHERE failed_at > now() - interval '30 days'`,
  );
  const [refunds] = await query<{ count: number; total_cents: number }>(
    `SELECT count(*)::int AS count, COALESCE(sum(amount_cents), 0)::int AS total_cents
     FROM refunds WHERE status = 'applied' AND decided_at > now() - interval '30 days'`,
  );
  return { status: 200, body: { dunning, refunds, services: serviceStatus() } };
}

// ---- retailer applications ----------------------------------------------------------------

interface ApplicationRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  province: string;
  status: "submitted" | "approved" | "declined";
  licence_key: string;
  licence_type: string;
  submitted_at: Date;
  [key: string]: unknown;
}

const applicationJson = (a: ApplicationRow) => ({
  id: a.id,
  business_name: a.business_name,
  contact_name: a.contact_name,
  email: a.email,
  province: a.province,
  status: a.status,
  submitted_at: a.submitted_at.toISOString(),
});

export async function listApplications(ctx: Ctx): Promise<Reply> {
  await owner(ctx);
  const status = ctx.url.searchParams.get("status");
  const found = await query<ApplicationRow>(
    "SELECT * FROM applications WHERE ($1::text IS NULL OR status = $1) ORDER BY submitted_at DESC",
    [status],
  );
  return { status: 200, body: { applications: found.map(applicationJson) } };
}

async function application(ctx: Ctx): Promise<ApplicationRow> {
  const user = await signedIn(ctx);
  const [found] = await query<ApplicationRow>("SELECT * FROM applications WHERE id::text = $1", [ctx.params[0]]);
  if (!found) throw notFound();
  allow(user, OWNER);
  return found;
}

export async function licence(ctx: Ctx): Promise<Reply> {
  const found = await application(ctx);
  const file = await getObject(found.licence_key);
  return { status: 200, file: { data: file.body, type: found.licence_type, name: found.licence_key.split("/").pop() ?? "licence" } };
}

export async function decideApplication(ctx: Ctx): Promise<Reply> {
  const found = await application(ctx);
  const decision = str(ctx.body, "decision");
  if (found.status !== "submitted") throw new ApiError(409, "already_decided", "This application already has a decision.");
  if (decision !== "approved" && decision !== "declined") throw validation({ decision: "Approve or decline the application." });
  const [updated] = await query<ApplicationRow>(
    "UPDATE applications SET status = $2, decided_at = now() WHERE id = $1 AND status = 'submitted' RETURNING *",
    [found.id, decision],
  );
  if (!updated) throw new ApiError(409, "already_decided", "This application already has a decision.");
  await applicationDecided(updated.email, updated.contact_name, updated.business_name, decision === "approved");
  return { status: 200, body: { application: applicationJson(updated) } };
}

// ---- reviews ------------------------------------------------------------------------------

export async function pendingReviews(ctx: Ctx): Promise<Reply> {
  await owner(ctx);
  const status = ctx.url.searchParams.get("status") ?? "pending";
  const found = await reviews(`status=${literal(status)}`, "created");
  return {
    status: 200,
    body: {
      reviews: found.map((r) => ({
        id: r.id,
        flavour: r.flavour,
        rating: r.rating,
        body: r.body,
        author_first_name: r.author_first_name,
        status: r.status,
        created_at: new Date(r.created.replace(" ", "T")).toISOString(),
      })),
    },
  };
}

export async function decideReviewRoute(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  const [found] = await reviews(`id=${literal(ctx.params[0])}`);
  if (!found) throw notFound();
  allow(user, OWNER);
  const decision = str(ctx.body, "decision");
  if (found.status !== "pending") throw new ApiError(409, "already_decided", "This review already has a decision.");
  if (decision !== "approved" && decision !== "rejected") throw validation({ decision: "Approve or reject the review." });
  const updated = await decideReview(found.id, decision);
  return { status: 200, body: { review: { id: updated.id, flavour: updated.flavour, status: updated.status } } };
}
