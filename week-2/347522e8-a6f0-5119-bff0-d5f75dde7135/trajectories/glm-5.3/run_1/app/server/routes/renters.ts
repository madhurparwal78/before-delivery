import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireOperator, requireStaff, requireUser, renterScoped, type RouteContext, loadRenterOr404 } from "../router.js";
import { one, rows, withTx } from "../db.js";
import {
  canActivate,
  complianceForRenter,
  hasAllThreeKinds,
  isCurrent,
  latestByKind,
  loadDocuments,
  type DocumentKind,
} from "../compliance.js";
import { kitchenToday } from "../kitchenTime.js";
import { balances } from "../ledger.js";
import { getSubscription } from "../killbill.js";

type TransitionBody = { to?: unknown };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const renterPathId = (ctx: RouteContext): string => ctx.url.pathname.split("/")[3]!;

// The renter object shared by every renter read.
const renterObject = async (
  db: Parameters<typeof loadRenterOr404>[0],
  renter: {
    id: string;
    business_name: string;
    contact_name: string;
    email: string;
    phone: string;
    status: string;
    created_at: Date;
  },
  now: Date,
  reconcileShelf: boolean,
): Promise<Record<string, unknown>> => {
  const compliance = await complianceForRenter(db, renter.id, now);
  const balance = await balances(db, renter.id);
  const subscriptionRow = await one<{
    id: string;
    shelf_label: string;
    external_key: string;
    killbill_subscription_id: string;
    state: string;
    sequence_no: number;
  }>(
    db,
    `select id, shelf_label, external_key, killbill_subscription_id, state, sequence_no
     from shelf_subscriptions where renter_id = $1 and state = 'active'
     order by created_at desc limit 1`,
    [renter.id],
  );
  let shelf: Record<string, unknown> | null = null;
  if (subscriptionRow) {
    let billingState = "unknown";
    let ended = false;
    if (reconcileShelf) {
      const remote = await getSubscription(subscriptionRow.killbill_subscription_id);
      if (remote.kind === "ok" && remote.value) {
        if (remote.value.state === "CANCELLED") {
          ended = true;
        } else {
          billingState = remote.value.state === "ACTIVE" ? "ACTIVE" : "unknown";
        }
      }
    }
    if (ended) {
      await withTx(async (tx) => {
        await tx.query("update shelf_subscriptions set state = 'cancelled', ended_at = now() where id = $1", [
          subscriptionRow!.id,
        ]);
      });
      shelf = null;
    } else {
      shelf = {
        shelf_label: subscriptionRow.shelf_label,
        plan: "walk-in-shelf-monthly",
        external_key: subscriptionRow.external_key,
        killbill_subscription_id: subscriptionRow.killbill_subscription_id,
        state: subscriptionRow.state,
        billing_state: billingState,
      };
    }
  }
  return {
    id: renter.id,
    business_name: renter.business_name,
    contact_name: renter.contact_name,
    email: renter.email,
    phone: renter.phone,
    status: renter.status,
    balance_minutes: balance.balanceMinutes,
    held_minutes: balance.heldMinutes,
    compliance,
    shelf_subscription: shelf,
    created_at: renter.created_at.toISOString(),
  };
};

export const renterWithShelf = async (db: Parameters<typeof loadRenterOr404>[0], renterId: string, now: Date) => {
  const renter = await loadRenterOr404(db, renterId);
  return renterObject(db, renter, now, true);
};

route("GET", "/api/renters", "staff", async (ctx: RouteContext) => {
  const list = await rows<{
    id: string;
    business_name: string;
    contact_name: string;
    email: string;
    phone: string;
    status: string;
    created_at: Date;
  }>(
    ctx.db,
    "select id, business_name, contact_name, email, phone, status, created_at from renters order by created_at asc, id asc",
  );
  const today = kitchenToday(ctx.now);
  const items = [];
  for (const renter of list) {
    const compliance = await complianceForRenter(ctx.db, renter.id, ctx.now);
    const balance = await balances(ctx.db, renter.id);
    items.push({
      id: renter.id,
      business_name: renter.business_name,
      contact_name: renter.contact_name,
      email: renter.email,
      phone: renter.phone,
      status: renter.status,
      balance_minutes: balance.balanceMinutes,
      held_minutes: balance.heldMinutes,
      compliance,
      created_at: renter.created_at.toISOString(),
    });
  }
  void today;
  return json({ renters: items });
});

route("GET", "/api/renters/{renter_id}", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const renterId = renterPathId(ctx);
  if (user.role === "renter") renterScoped(ctx, renterId);
  else requireStaff(ctx);
  const renter = await renterWithShelf(ctx.db, renterId, ctx.now);
  return json({ renter });
});


const legalTransitions = (from: string, to: string): boolean => {
  if (to === "offboarded") return from !== "offboarded";
  if (to === "active") return from === "suspended" || from === "documents_review";
  return false;
};

route("POST", "/api/renters/{renter_id}/transitions", "operator", async (ctx: RouteContext) => {
  const renterId = renterPathId(ctx);
  const body = parseJsonBody<TransitionBody>(ctx);
  const to = text(body.to);
  if (to !== "active" && to !== "offboarded") {
    throw ApiError.validationError({ to: "A transition names 'active' or 'offboarded'." });
  }
  const renter = await loadRenterOr404(ctx.db, renterId);
  if (!legalTransitions(renter.status, to)) {
    throw ApiError.invalidTransition(renter.status, to);
  }
  if (to === "active") {
    const documents = await loadDocuments(ctx.db, renterId);
    if (!canActivate(documents, kitchenToday(ctx.now))) {
      throw ApiError.documentsIncomplete();
    }
  }
  if (to === "offboarded") {
    const future = await one<{ count: string }>(
      ctx.db,
      `select count(*)::text as count from bookings
       where renter_id = $1 and status in ('hold','confirmed') and starts_at > now()`,
      [renterId],
    );
    if (Number(future?.count ?? 0) > 0) throw ApiError.hasFutureBookings();
  }
  await ctx.db.query("update renters set status = $1 where id = $2", [to, renterId]);
  const updated = await renterWithShelf(ctx.db, renterId, ctx.now);
  return json({ renter: updated });
});

// Documents list (owner or staff)
route("GET", "/api/renters/{renter_id}/documents", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const renterId = renterPathId(ctx);
  if (user.role === "renter") renterScoped(ctx, renterId);
  else requireStaff(ctx);
  const documents = await loadDocuments(ctx.db, renterId);
  return json({ documents });
});


route("GET", "/api/documents/{document_id}", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const documentId = ctx.url.pathname.split("/")[3]!;
  const found = await one<{ id: string; renter_id: string }>(ctx.db, "select id, renter_id from documents where id = $1", [
    documentId,
  ]);
  if (!found) throw ApiError.notFound();
  if (user.role === "renter") renterScoped(ctx, found.renter_id);
  else requireStaff(ctx);
  const documents = await loadDocuments(ctx.db, found.renter_id);
  const document = documents.find((d) => d.id === documentId);
  if (!document) throw ApiError.notFound();
  return json({ document });
});

export const latestDocumentsByKind = latestByKind;
export const documentIsCurrent = isCurrent;
export const documentKindValues: DocumentKind[] = ["coi", "food_handler_card", "business_licence"];
export const kindsPresent = hasAllThreeKinds;

