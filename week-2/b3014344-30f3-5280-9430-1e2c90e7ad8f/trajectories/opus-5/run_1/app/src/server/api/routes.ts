import { type Route, route } from "../router.js";
import { errors } from "../errors.js";
import { type Ctx } from "../http.js";
import { COPY } from "../../shared/copy.js";
import * as publicApi from "./public.js";
import * as orders from "./orders.js";
import * as plan from "./plan.js";
import * as portal from "./portal.js";
import * as studio from "./studio.js";

export const apiRoutes: Route[] = [
  route("GET", "/api/health", publicApi.health),
  route("GET", "/api/clock", publicApi.clock),
  route("GET", "/api/case-studies", (ctx) => publicApi.listEntries(ctx, "case_study")),
  route("GET", "/api/case-studies/:slug", (ctx) => publicApi.entryDetail(ctx, "case_study")),
  route("GET", "/api/journal", (ctx) => publicApi.listEntries(ctx, "journal")),
  route("GET", "/api/journal/:slug", (ctx) => publicApi.entryDetail(ctx, "journal")),
  route("GET", "/api/plans", publicApi.plans),
  route("POST", "/api/quotes", publicApi.quote, { billing: COPY.quoteOutage }),
  route("POST", "/api/session", publicApi.signIn),
  route("DELETE", "/api/session", publicApi.signOut),
  route("GET", "/api/me", publicApi.me),

  route("POST", "/api/orders", orders.createOrder),
  route("GET", "/api/orders", orders.listOrders),
  route("GET", "/api/orders/:id", orders.getOrder),
  route("POST", "/api/orders/:id/accept", orders.acceptOrder),
  route("POST", "/api/orders/:id/pay", orders.payOrderRoute, {
    storage: COPY.storageOutageCheckout,
  }),

  route("GET", "/api/plan", plan.getPlan, { billing: COPY.planPageOutage }),
  route("POST", "/api/plan/previews", plan.createPlanPreview, { billing: COPY.planChangeOutage }),
  route("POST", "/api/plan/changes", plan.confirmPlanChange, { billing: COPY.planChangeOutage }),
  route("POST", "/api/plan/pause", plan.pausePlan, { billing: COPY.planChangeOutage }),
  route("POST", "/api/plan/resume", plan.resumePlan, { billing: COPY.planChangeOutage }),
  route("POST", "/api/plan/cancel", plan.cancelPlan, { billing: COPY.planChangeOutage }),
  route("POST", "/api/plan/card", plan.updatePlanCard),

  route("GET", "/api/invoices", portal.listInvoices),
  route("GET", "/api/invoices/:id", portal.getInvoice),
  route("POST", "/api/invoices/:id/links", portal.createInvoiceLink),
  route("GET", "/api/projects", portal.listProjects),
  route("GET", "/api/projects/:id", portal.getProject),
  route("POST", "/api/projects/:id/assets", portal.uploadAsset),
  route("POST", "/api/projects/:id/deliverables", portal.uploadDeliverable),
  route("POST", "/api/projects/:id/invites", portal.createInvite),
  route("POST", "/api/files/:id/links", portal.createFileLink),
  route("GET", "/api/invites/:token", portal.getInvite),
  route("POST", "/api/invites/:token/accept", portal.acceptInvite),
  route("GET", "/download/:token", portal.download),

  route("GET", "/api/studio/orders", studio.listStudioOrders),
  route("GET", "/api/studio/orders/:id", studio.getStudioOrder),
  route("POST", "/api/studio/orders/:id/transitions", studio.transitionOrder),
  route("POST", "/api/studio/orders/:id/refunds", studio.issueRefund),
  route("POST", "/api/studio/projects/:id/assignments", studio.assignContractor),
  route("DELETE", "/api/studio/projects/:id/assignments/:contractorId", studio.unassignContractor),
  route("GET", "/api/studio/contractors", studio.listContractors),
  route("POST", "/api/studio/accounts/:id/credits", studio.issueCredit),
  route("GET", "/api/studio/prices", studio.listPrices),
  route("POST", "/api/studio/prices", studio.schedulePrice),
  route("GET", "/api/studio/entries", studio.listEntries),
  route("POST", "/api/studio/entries", studio.createEntry),
  route("POST", "/api/studio/entries/:id/publish", studio.publishEntry),
  route("POST", "/api/studio/entries/:id/withdraw", studio.withdrawEntry),
];

/** Every studio route is refused to anyone but the studio owner, before any id is read. */
export function guardStudioRoutes(ctx: Ctx): void {
  if (!ctx.url.pathname.startsWith("/api/studio/")) return;
  if (!ctx.user) throw errors.unauthenticated();
  if (ctx.user.role !== "studio_owner") throw errors.forbidden();
}
