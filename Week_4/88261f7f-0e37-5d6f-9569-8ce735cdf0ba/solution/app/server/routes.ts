import type { IncomingMessage, ServerResponse } from "node:http";
import type { Role, User } from "../shared/api";
import { currentUser, requireRole, signIn, signOut } from "./auth";
import { completeCheckIn, guestPage, idPhoto, uploadPhoto } from "./checkin";
import { runClose } from "./close";
import { deskView, timelineView } from "./desk";
import { addCharge, addFolio, addPayment, moveEntry, reverseEntry, savePayer, splitEntry } from "./folios";
import { gradingClock, gradingSetup } from "./grading";
import { guestDetail, listGuests, mergeGuests } from "./guests";
import { health } from "./health";
import { decodeSegment, fail, jsonBody, ok, stringField, type Reply } from "./http";
import { closeFolio, emailInvoice, invoicePdf } from "./invoices";
import { openStream } from "./live";
import { listPlans, listTaxRates, savePlan, saveTaxRate } from "./rates";
import { reportView } from "./reports";
import { boardReply, changeRoomStatus } from "./rooms";
import { changeStayStatus, createStay, moveStay, patchStay, quoteStay, resendLink, stayDetail } from "./stays";
import { config } from "./config";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  user: User;
  params: Record<string, string>;
  query: URLSearchParams;
  origin: string;
}

type Access = readonly Role[] | "public" | "signed-in";
interface Route { method: string; pattern: RegExp; names: string[]; access: Access; run: (ctx: Ctx) => Promise<Reply> }

const ALL: readonly Role[] = ["owner", "front_desk", "housekeeper"];
const DESK: readonly Role[] = ["owner", "front_desk"];
const OWNER: readonly Role[] = ["owner"];

const routes: Route[] = [];

function route(method: string, path: string, access: Access, run: (ctx: Ctx) => Promise<Reply>): void {
  const names: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, access, run });
}

const json = (ctx: Ctx) => jsonBody(ctx.req);
const hotelOf = (ctx: Ctx): string => ctx.user.hotelId;

route("POST", "/api/session", "public", async (ctx) => {
  const body = await json(ctx);
  const started = await signIn(stringField(body, "email"), typeof body.password === "string" ? body.password : "");
  if (!started) throw fail.credentials();
  return { status: 200, json: { user: started.user }, headers: { "Set-Cookie": started.cookie } };
});
route("GET", "/api/session", "signed-in", async (ctx) => ok({ user: ctx.user }));
route("DELETE", "/api/session", "signed-in", async (ctx) => ({ status: 204, headers: { "Set-Cookie": await signOut(ctx.req) } }));
route("GET", "/api/health", "public", () => health());
route("POST", "/api/grading/setup", "public", (ctx) => gradingSetup(ctx.req, ctx.origin));
route("POST", "/api/grading/clock", "public", (ctx) => gradingClock(ctx.req));

route("GET", "/api/live", ALL, async (ctx) => {
  openStream(ctx.req, ctx.res, ctx.user.role, hotelOf(ctx));
  return { status: 200, handled: true };
});
route("GET", "/api/housekeeping/board", ALL, (ctx) => boardReply(hotelOf(ctx)));
route("POST", "/api/rooms/:id/status", ALL, async (ctx) => changeRoomStatus(hotelOf(ctx), ctx.user.role, ctx.params.id, await json(ctx)));

route("GET", "/api/desk", DESK, (ctx) => deskView(hotelOf(ctx)));
route("GET", "/api/timeline", DESK, (ctx) => timelineView(hotelOf(ctx), ctx.query));
route("POST", "/api/stays/quote", DESK, async (ctx) => quoteStay(hotelOf(ctx), await json(ctx)));
route("POST", "/api/stays", DESK, async (ctx) => {
  const key = ctx.req.headers["idempotency-key"];
  return createStay(hotelOf(ctx), ctx.origin, typeof key === "string" ? key : undefined, await json(ctx));
});
route("GET", "/api/stays/:id", DESK, (ctx) => stayDetail(hotelOf(ctx), ctx.params.id));
route("PATCH", "/api/stays/:id", DESK, async (ctx) => patchStay(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/stays/:id/move", DESK, async (ctx) => moveStay(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/stays/:id/check-in", DESK, (ctx) => changeStayStatus(hotelOf(ctx), ctx.params.id, "check-in"));
route("POST", "/api/stays/:id/check-out", DESK, (ctx) => changeStayStatus(hotelOf(ctx), ctx.params.id, "check-out"));
route("POST", "/api/stays/:id/cancel", DESK, (ctx) => changeStayStatus(hotelOf(ctx), ctx.params.id, "cancel"));
route("POST", "/api/stays/:id/checkin-link", DESK, (ctx) => resendLink(hotelOf(ctx), ctx.params.id, ctx.origin));
route("GET", "/api/stays/:id/id-photo", DESK, (ctx) => idPhoto(hotelOf(ctx), ctx.params.id));
route("POST", "/api/stays/:id/folios", DESK, async (ctx) => addFolio(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("PATCH", "/api/folios/:id", DESK, async (ctx) => savePayer(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/folios/:id/charges", DESK, async (ctx) => addCharge(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/folios/:id/payments", DESK, async (ctx) => addPayment(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/folios/:id/close", DESK, (ctx) => closeFolio(hotelOf(ctx), ctx.params.id));
route("POST", "/api/entries/:id/reverse", DESK, (ctx) => reverseEntry(hotelOf(ctx), ctx.params.id));
route("POST", "/api/entries/:id/split", DESK, async (ctx) => splitEntry(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/entries/:id/move", DESK, async (ctx) => moveEntry(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/invoices/:id/email", DESK, (ctx) => emailInvoice(hotelOf(ctx), ctx.params.id));
route("GET", "/api/invoices/:id/pdf", DESK, (ctx) => invoicePdf(hotelOf(ctx), ctx.params.id));
route("GET", "/api/guests", DESK, (ctx) => listGuests(hotelOf(ctx), ctx.query));
route("POST", "/api/guests/merge", DESK, async (ctx) => mergeGuests(hotelOf(ctx), await json(ctx)));
route("GET", "/api/guests/:id", DESK, (ctx) => guestDetail(hotelOf(ctx), ctx.params.id));
route("GET", "/api/rate-plans", DESK, (ctx) => listPlans(hotelOf(ctx)));
route("GET", "/api/tax-rates", DESK, (ctx) => listTaxRates(hotelOf(ctx)));

route("POST", "/api/close", OWNER, async (ctx) => runClose(hotelOf(ctx), await json(ctx)));
route("GET", "/api/reports", OWNER, (ctx) => reportView(hotelOf(ctx), ctx.query));
route("PATCH", "/api/rate-plans/:id", OWNER, async (ctx) => savePlan(hotelOf(ctx), ctx.params.id, await json(ctx)));
route("POST", "/api/tax-rates", OWNER, async (ctx) => saveTaxRate(hotelOf(ctx), await json(ctx)));

route("GET", "/api/checkin/:token", "public", (ctx) => guestPage(ctx.params.token));
route("POST", "/api/checkin/:token/photo", "public", (ctx) => uploadPhoto(ctx.params.token, ctx.req));
route("POST", "/api/checkin/:token/complete", "public", (ctx) => completeCheckIn(ctx.params.token, ctx.req));

const NOBODY: User = { id: "", email: "", name: "", role: "housekeeper", hotelId: "" };

/** Matches the route, enforces 401 then 404 by role, then runs it. */
export async function dispatch(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams, origin: string): Promise<Reply> {
  const method = req.method ?? "GET";
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = candidate.pattern.exec(pathname);
    if (!found) continue;
    const user =
      candidate.access === "public" ? NOBODY
      : candidate.access === "signed-in" ? await currentUser(req)
      : await requireRole(req, candidate.access);
    const params = Object.fromEntries(candidate.names.map((name, index) => [name, decodeSegment(found[index + 1] as string)]));
    return candidate.run({ req, res, user, params, query, origin });
  }
  throw fail.notFound();
}

export const publicOrigin = (req: IncomingMessage): string => config.publicUrl || `http://${req.headers.host ?? ""}`;
