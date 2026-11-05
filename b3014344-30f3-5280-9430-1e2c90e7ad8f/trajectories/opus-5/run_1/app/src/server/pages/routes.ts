import { type ApiError } from "../errors.js";
import { type Ctx, redirect, sendHtml } from "../http.js";
import { type Route, route } from "../router.js";
import { COPY } from "../../shared/copy.js";
import { escapeHtml, renderPage } from "./layout.js";
import * as publicPages from "./public.js";
import * as portalPages from "./portal.js";
import { studioConsole } from "./studio.js";

export const pageRoutes: Route[] = [
  route("GET", "/", publicPages.home),
  route("GET", "/work/:slug", publicPages.caseStudy),
  route("GET", "/journal", publicPages.journal),
  route("GET", "/journal/:slug", publicPages.journalPost),
  route("GET", "/sign-in", publicPages.signIn),
  route("GET", "/checkout/:id", publicPages.checkout),
  route("GET", "/orders/:id/receipt", publicPages.receipt),
  route("GET", "/invite/:token", publicPages.invitePage),
  route("GET", "/portal", portalPages.overview),
  route("GET", "/portal/projects/:id", portalPages.projectPage),
  route("GET", "/portal/plan", portalPages.planPage),
  route("GET", "/portal/invoices", portalPages.invoicesPage),
  route("GET", "/studio", studioConsole),
];

function simplePage(ctx: Ctx, status: number, heading: string): void {
  sendHtml(
    ctx.res,
    status,
    renderPage({
      title: heading,
      shell: "public",
      user: ctx.user,
      body: `<section class="notice"><h1>${escapeHtml(heading)}</h1><a href="/">Back to the home page</a></section>`,
    }),
  );
}

export async function renderErrorPage(ctx: Ctx, error: ApiError): Promise<void> {
  if (error.status === 401) {
    redirect(ctx.res, `/sign-in?next=${encodeURIComponent(ctx.url.pathname)}`);
    return;
  }
  if (error.code === "access_ended") {
    simplePage(ctx, 403, COPY.accessEndedHeading);
    return;
  }
  if (error.status === 403 || error.status === 404) {
    simplePage(ctx, 404, COPY.notFoundHeading);
    return;
  }
  simplePage(ctx, error.status, error.message);
}
