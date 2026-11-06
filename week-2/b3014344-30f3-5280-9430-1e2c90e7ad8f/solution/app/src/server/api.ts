import type { IncomingMessage, ServerResponse } from "node:http";
import { anonymousSession, checkCredentials, clearedCookie, loadSession, sessionCookie, signIn, signOut, type Session } from "./auth";
import { allEntries, cmsHealthy, createEntry, moveEntry, publishedEntries, publishedEntry, slugTaken } from "./cms";
import { healthy as databaseHealthy, query, type Row } from "./db";
import { crossOrigin, errors, HttpError, isUuid, matchPath, parseJsonBody, parseUpload, record, sendJson, uuidOr404, type BodyKind, type Upload } from "./http";
import { idempotent, readKey, type Outcome } from "./idempotency";
import { createInvite, acceptInvite, inviteInfo } from "./invites";
import { accountInvoice, listInvoices, pdfPending } from "./invoices";
import { killbillHealthy } from "./killbill";
import { mailHealthy } from "./smtp";
import { accept, addAccountCredit, createOrder, issueRefund, pay, present, presentOne, readPick, transition, visibleOrder, type OrderRow } from "./orders";
import { cancel, confirmChange, currentPlan, pause, preview, resume, updateCard } from "./plans";
import { planListing, priceAt, figuresFor, quoteBody, schedule, schedulePrice } from "./pricing";
import { download, fileLink, invoiceLink, projectAccess, projectDetail, uploadFile, visibleProjects } from "./projects";
import { storageHealthy } from "./storage";
import { studioInstant, ZONE } from "./time";
import { COPY } from "../shared/copy";
import { isCurrency } from "../shared/money";
import { type EntryKind, type User } from "../shared/domain";

interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  upload: Upload | null;
  session: Session | null;
  now: Date;
  headers: Record<string, string>;
}

type Reply = { status: number; body: unknown } | "streamed";
type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  method: string;
  pattern: string;
  body: BodyKind;
  handler: Handler;
}

const ok = (body: unknown, status = 200): Reply => ({ status, body });

// ---- guards, in the published order: session, role, then the resource

function signedIn(ctx: Context): User {
  const user = ctx.session?.user;
  if (!user) throw errors.unauthenticated();
  return user;
}

function clientOwner(ctx: Context): User & { accountId: string } {
  const user = signedIn(ctx);
  if (user.role !== "client_owner" || !user.accountId) throw errors.forbidden();
  return user as User & { accountId: string };
}

/** Runs a keyed action under its Idempotency-Key, scoped to the caller. */
async function keyed(ctx: Context, run: () => Promise<Outcome>): Promise<Reply> {
  const key = readKey(ctx.req.headers["idempotency-key"]);
  const scope = ctx.session?.user?.id ?? ctx.session?.ownerKey ?? "anonymous";
  const outcome = await idempotent(scope, key, ctx.req.method!, ctx.url.pathname, ctx.body, run);
  if (outcome.replayed) ctx.headers["Idempotent-Replayed"] = "true";
  return { status: outcome.status, body: outcome.body };
}

const entryKind = (path: string): EntryKind => (path.startsWith("/api/journal") ? "journal" : "case_study");

// ---- handlers

const health: Handler = async () => {
  const [postgres, killbill, minio, mailpit, pocketbase] = await Promise.all([
    databaseHealthy(),
    killbillHealthy(),
    storageHealthy(),
    mailHealthy(),
    cmsHealthy(),
  ]);
  const state = (up: boolean) => (up ? "up" : "down");
  return ok({ status: "ok", services: { postgres: state(postgres), killbill: state(killbill), minio: state(minio), mailpit: state(mailpit), pocketbase: state(pocketbase) } });
};

const routes: Route[] = [
  { method: "GET", pattern: "/api/health", body: "none", handler: health },
  { method: "GET", pattern: "/api/clock", body: "none", handler: async (ctx) => ok({ now: studioInstant(ctx.now), zone: ZONE }) },

  ...(["/api/case-studies", "/api/journal"] as const).flatMap((base): Route[] => [
    { method: "GET", pattern: base, body: "none", handler: async () => ok({ entries: await publishedEntries(entryKind(base)) }) },
    {
      method: "GET",
      pattern: `${base}/:slug`,
      body: "none",
      handler: async (ctx) => {
        const entry = await publishedEntry(entryKind(base), ctx.params.slug!);
        if (!entry) throw errors.notFound();
        return ok(entry);
      },
    },
  ]),

  {
    method: "GET",
    pattern: "/api/plans",
    body: "none",
    handler: async (ctx) => {
      const currency = ctx.url.searchParams.get("currency");
      if (!isCurrency(currency)) throw errors.invalid({ currency: "Choose USD or ARS." });
      return ok(await planListing(currency, ctx.now));
    },
  },
  {
    method: "POST",
    pattern: "/api/quotes",
    body: "json",
    handler: async (ctx) => {
      const { plan, currency } = readPick(ctx.body);
      if (!(await killbillHealthy())) throw new HttpError(503, "billing_unavailable", COPY.quoteOutage);
      const price = await priceAt(plan, currency, ctx.now);
      return ok(quoteBody(plan, currency, figuresFor(plan, price.amountMinor), price.effectiveAt));
    },
  },

  {
    method: "POST",
    pattern: "/api/session",
    body: "json",
    handler: async (ctx) => {
      const input = record(ctx.body);
      const user = await checkCredentials(input.email, input.password);
      ctx.headers["Set-Cookie"] = sessionCookie(await signIn(null, user.id, ctx.session));
      return ok({ user });
    },
  },
  {
    method: "DELETE",
    pattern: "/api/session",
    body: "json",
    handler: async (ctx) => {
      signedIn(ctx);
      await signOut(ctx.session!);
      ctx.headers["Set-Cookie"] = clearedCookie();
      return ok(null, 204);
    },
  },
  { method: "GET", pattern: "/api/me", body: "none", handler: async (ctx) => ok({ user: signedIn(ctx) }) },

  {
    method: "POST",
    pattern: "/api/orders",
    body: "json",
    handler: async (ctx) => {
      const user = ctx.session?.user;
      if (user && user.role !== "client_owner") throw errors.forbidden();
      const { plan, currency } = readPick(ctx.body);
      let session = ctx.session;
      if (!session) {
        const started = await anonymousSession();
        session = started.session;
        ctx.headers["Set-Cookie"] = sessionCookie(started.token);
      }
      return ok(await createOrder(session, plan, currency, ctx.now), 201);
    },
  },
  {
    method: "GET",
    pattern: "/api/orders",
    body: "none",
    handler: async (ctx) => {
      const user = clientOwner(ctx);
      const found = await query<OrderRow>(
        `SELECT o.*, p.id AS project_id, a.business_name FROM orders o LEFT JOIN projects p ON p.order_id = o.id
         LEFT JOIN client_accounts a ON a.id = o.account_id WHERE o.account_id = $1 ORDER BY o.created_at DESC`,
        [user.accountId],
      );
      return ok({ orders: await present(found) });
    },
  },
  {
    method: "GET",
    pattern: "/api/orders/:id",
    body: "none",
    handler: async (ctx) => ok(await presentOne(await visibleOrder(uuidOr404(ctx.params.id), ctx.session))),
  },
  {
    method: "POST",
    pattern: "/api/orders/:id/accept",
    body: "json",
    handler: async (ctx) => {
      const result = await accept(uuidOr404(ctx.params.id), ctx.session, ctx.body, ctx.now);
      if (result.token) ctx.headers["Set-Cookie"] = sessionCookie(result.token);
      return ok({ order: result.order, user: result.user });
    },
  },
  {
    method: "POST",
    pattern: "/api/orders/:id/pay",
    body: "json",
    handler: async (ctx) => {
      signedIn(ctx);
      const order = await visibleOrder(uuidOr404(ctx.params.id), ctx.session);
      clientOwner(ctx);
      return keyed(ctx, async () => ok(await pay(order.id, ctx.session!, ctx.body, ctx.now), 201) as Outcome);
    },
  },

  { method: "GET", pattern: "/api/plan", body: "none", handler: async (ctx) => ok({ plan: await currentPlan(clientOwner(ctx).accountId, ctx.now) }) },
  {
    method: "POST",
    pattern: "/api/plan/previews",
    body: "json",
    handler: async (ctx) => ok(await preview(clientOwner(ctx).accountId, ctx.body, ctx.now), 201),
  },
  ...(
    [
      ["changes", (accountId: string, ctx: Context) => confirmChange(accountId, ctx.body, ctx.now)],
      ["pause", (accountId: string, ctx: Context) => pause(accountId, ctx.now)],
      ["resume", (accountId: string, ctx: Context) => resume(accountId, ctx.now)],
      ["cancel", (accountId: string, ctx: Context) => cancel(accountId, ctx.now)],
      ["card", (accountId: string, ctx: Context) => updateCard(accountId, ctx.body, ctx.now)],
    ] as const
  ).map(
    ([action, run]): Route => ({
      method: "POST",
      pattern: `/api/plan/${action}`,
      body: "json",
      handler: async (ctx) => {
        const user = clientOwner(ctx);
        return keyed(ctx, async () => ok(await run(user.accountId, ctx)) as Outcome);
      },
    }),
  ),

  { method: "GET", pattern: "/api/invoices", body: "none", handler: async (ctx) => ok({ invoices: await listInvoices(clientOwner(ctx).accountId) }) },
  {
    method: "GET",
    pattern: "/api/invoices/:id",
    body: "none",
    handler: async (ctx) => ok((await ownInvoice(ctx)).invoice),
  },
  {
    method: "POST",
    pattern: "/api/invoices/:id/links",
    body: "json",
    handler: async (ctx) => {
      const { invoice, orderId, user } = await ownInvoice(ctx);
      if (!invoice.pdf) throw pdfPending();
      return ok(await invoiceLink(user, user.accountId!, orderId, invoice.id, invoice.number), 201);
    },
  },

  { method: "GET", pattern: "/api/projects", body: "none", handler: async (ctx) => ok({ projects: await visibleProjects(signedIn(ctx)) }) },
  {
    method: "GET",
    pattern: "/api/projects/:id",
    body: "none",
    handler: async (ctx) => ok(await projectDetail(uuidOr404(ctx.params.id), signedIn(ctx))),
  },
  ...(["assets", "deliverables"] as const).map(
    (kind): Route => ({
      method: "POST",
      pattern: `/api/projects/:id/${kind}`,
      body: "upload",
      handler: async (ctx) => {
        const user = signedIn(ctx);
        return ok(await uploadFile(uuidOr404(ctx.params.id), kind === "assets" ? "asset" : "deliverable", user, ctx.upload!), 201);
      },
    }),
  ),
  {
    method: "POST",
    pattern: "/api/projects/:id/invites",
    body: "json",
    handler: async (ctx) => {
      const user = signedIn(ctx);
      return ok(await createInvite(uuidOr404(ctx.params.id), user, ctx.body), 201);
    },
  },
  {
    method: "POST",
    pattern: "/api/files/:id/links",
    body: "json",
    handler: async (ctx) => {
      const user = signedIn(ctx);
      return ok(await fileLink(uuidOr404(ctx.params.id), user), 201);
    },
  },
  {
    method: "GET",
    pattern: "/api/downloads/:token",
    body: "none",
    handler: async (ctx) => {
      await download(ctx.params.token!, signedIn(ctx), ctx.res);
      return "streamed";
    },
  },
  { method: "GET", pattern: "/api/invites/:token", body: "none", handler: async (ctx) => ok(await inviteInfo(ctx.params.token!)) },
  {
    method: "POST",
    pattern: "/api/invites/:token/accept",
    body: "json",
    handler: async (ctx) => {
      const result = await acceptInvite(ctx.params.token!, ctx.body, ctx.session);
      ctx.headers["Set-Cookie"] = sessionCookie(result.token);
      return ok({ user: result.user, projectId: result.projectId }, 201);
    },
  },

  // ---- studio console (studio owner only, checked before any id is read)
  {
    method: "GET",
    pattern: "/api/studio/orders",
    body: "none",
    handler: async () => {
      const found = await query<OrderRow>(
        `SELECT o.*, p.id AS project_id, a.business_name FROM orders o LEFT JOIN projects p ON p.order_id = o.id
         LEFT JOIN client_accounts a ON a.id = o.account_id WHERE o.state <> 'quoted' ORDER BY o.number DESC`,
      );
      return ok({ orders: await present(found, null, true) });
    },
  },
  {
    method: "GET",
    pattern: "/api/studio/orders/:id",
    body: "none",
    handler: async (ctx) => {
      const order = await visibleOrder(uuidOr404(ctx.params.id), ctx.session);
      return ok(await presentOne(order, null, true));
    },
  },
  { method: "POST", pattern: "/api/studio/orders/:id/transitions", body: "json", handler: async (ctx) => ok(await transition(uuidOr404(ctx.params.id), ctx.body)) },
  {
    method: "POST",
    pattern: "/api/studio/orders/:id/refunds",
    body: "json",
    handler: async (ctx) => {
      const order = await visibleOrder(uuidOr404(ctx.params.id), ctx.session);
      return keyed(ctx, async () => ok(await issueRefund(order.id, ctx.body), 201) as Outcome);
    },
  },
  {
    method: "POST",
    pattern: "/api/studio/accounts/:id/credits",
    body: "json",
    handler: async (ctx) => {
      const id = uuidOr404(ctx.params.id);
      if (!(await query("SELECT 1 FROM client_accounts WHERE id = $1", [id])).length) throw errors.notFound();
      return keyed(ctx, async () => ok(await addAccountCredit(id, ctx.body), 201) as Outcome);
    },
  },
  {
    method: "POST",
    pattern: "/api/studio/projects/:id/assignments",
    body: "json",
    handler: async (ctx) => {
      const { project } = await projectAccess(uuidOr404(ctx.params.id), signedIn(ctx));
      const contractorId = record(ctx.body).contractorId;
      const contractor = isUuid(contractorId)
        ? (await query("SELECT id FROM users WHERE id = $1 AND role = 'contractor'", [contractorId]))[0]
        : undefined;
      if (!contractor) throw errors.notFound();
      if (project.closed_at) throw new HttpError(409, "project_closed", "This project is closed.");
      const added = await query("INSERT INTO assignments (project_id, contractor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [project.id, contractorId]);
      return ok({ contractors: await assigned(project.id) }, added.length ? 201 : 200);
    },
  },
  {
    method: "DELETE",
    pattern: "/api/studio/projects/:id/assignments/:contractorId",
    body: "json",
    handler: async (ctx) => {
      const { project } = await projectAccess(uuidOr404(ctx.params.id), signedIn(ctx));
      await query("DELETE FROM assignments WHERE project_id = $1 AND contractor_id = $2", [project.id, uuidOr404(ctx.params.contractorId)]);
      return ok(null, 204);
    },
  },
  {
    method: "GET",
    pattern: "/api/studio/contractors",
    body: "none",
    handler: async () => ok({ contractors: await query("SELECT id, name, email FROM users WHERE role = 'contractor' ORDER BY name") }),
  },
  { method: "GET", pattern: "/api/studio/prices", body: "none", handler: async () => ok({ prices: await schedule() }) },
  { method: "POST", pattern: "/api/studio/prices", body: "json", handler: async (ctx) => ok(await schedulePrice(record(ctx.body), ctx.now), 201) },
  { method: "GET", pattern: "/api/studio/entries", body: "none", handler: async () => ok({ entries: await allEntries() }) },
  {
    method: "POST",
    pattern: "/api/studio/entries",
    body: "json",
    handler: async (ctx) => {
      const input = record(ctx.body);
      const fields: Record<string, string> = {};
      const text = (name: string, max: number, required = true) => {
        const value = typeof input[name] === "string" ? (input[name] as string).trim() : "";
        if ((required && !value) || value.length > max) fields[name] = `Enter the ${name} (up to ${max} characters).`;
        return value;
      };
      if (input.kind !== "case_study" && input.kind !== "journal") fields.kind = "Choose case_study or journal.";
      const slug = typeof input.slug === "string" ? input.slug : "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) fields.slug = "Use lowercase letters, digits and hyphens.";
      const title = text("title", 160);
      const client = text("client", 120, input.kind === "case_study");
      const summary = text("summary", 400);
      const body = text("body", 20_000);
      const year = input.year === undefined || input.year === null ? null : Number(input.year);
      if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2100)) fields.year = "Enter a year such as 2026.";
      if (!fields.slug && (await slugTaken(slug))) fields.slug = "That slug is already used by another entry.";
      if (Object.keys(fields).length) throw errors.invalid(fields);
      return ok(await createEntry({ kind: input.kind as EntryKind, slug, title, client, year, summary, body }), 201);
    },
  },
  ...(["publish", "withdraw"] as const).map(
    (action): Route => ({
      method: "POST",
      pattern: `/api/studio/entries/:id/${action}`,
      body: "json",
      handler: async (ctx) => ok(await moveEntry(ctx.params.id!, action)),
    }),
  ),
];

async function assigned(projectId: string): Promise<Row[]> {
  return query("SELECT u.id, u.name, u.email FROM assignments s JOIN users u ON u.id = s.contractor_id WHERE s.project_id = $1 ORDER BY u.name", [projectId]);
}

/** An invoice of the caller's account: teammates are refused, anyone else gets the uniform 404. */
async function ownInvoice(ctx: Context) {
  const user = signedIn(ctx);
  const id = uuidOr404(ctx.params.id);
  if (user.role === "teammate" && user.accountId) {
    await accountInvoice(user.accountId, id);
    throw errors.forbidden();
  }
  if (user.role !== "client_owner" || !user.accountId) throw errors.notFound();
  return { ...(await accountInvoice(user.accountId, id)), user };
}

export function isApi(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const headers: Record<string, string> = {};
  try {
    const found = routes
      .map((route) => ({ route, params: route.method === req.method ? matchPath(route.pattern, url.pathname) : null }))
      .find((candidate) => candidate.params !== null);
    if (!found) throw errors.notFound();
    const { route, params } = found;
    if (crossOrigin(req)) throw new HttpError(403, "cross_origin", "Requests must come from this site.");
    const body = route.body === "json" ? await parseJsonBody(req) : {};
    const upload = route.body === "upload" ? await parseUpload(req) : null;
    const open = route.pattern === "/api/health" || route.pattern === "/api/clock";
    const session = open ? null : await loadSession(req);
    if (route.pattern.startsWith("/api/studio/")) {
      if (!session?.user) throw errors.unauthenticated();
      if (session.user.role !== "studio_owner") throw errors.forbidden();
    }
    const ctx: Context = { req, res, url, params: params!, body, upload, session, now: new Date(), headers };
    const reply = await route.handler(ctx);
    if (reply !== "streamed") sendJson(res, reply.status, reply.body, headers);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.body(), headers);
      return;
    }
    console.error(`${req.method} ${url.pathname} failed:`, error);
    sendJson(res, 500, { error: "internal_error", message: "Something went wrong on our side. Try again in a moment." }, headers);
  }
}

