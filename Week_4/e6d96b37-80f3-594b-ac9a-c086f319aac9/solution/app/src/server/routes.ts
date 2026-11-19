// The published routes and their handlers.

import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { F, pageLimit, syncLimit } from "../shared/feedback.js";
import { CELLS } from "../shared/limits.js";
import type { AuditCellPage, Party, SpecimenPage, SyncResult } from "../shared/types.js";
import { callback, login, safeReturn, stepUp, type AuthOutcome } from "./auth.js";
import { type Body, commandIdOf, objects } from "./body.js";
import { config, DEFAULT_NAMESPACE } from "./config.js";
import { notify, query, reading, transaction } from "./db.js";
import { type Desk, loadDesk } from "./desk.js";
import { HttpError, invalid, notFound } from "./errors.js";
import { advanceClock, identity, otp, seed } from "./grading.js";
import { type Answer, type Context, type Route, sendPage } from "./http.js";
import { openStream } from "./live.js";
import { getObject } from "./minio.js";
import { expiredOffers, expireOffers } from "./rules.js";
import { partyOf, readSession, requireActiveAccount, requireSession, SESSION_COOKIE, sessionInfo, type Session } from "./sessions.js";
import { deskState, specimenView, visibleSpecimenKeys } from "./state.js";
import { ensureDefaultDesk } from "./fixtures/seed.js";
import { type CommandSpec, payloadHash, runCommand } from "./commands/runner.js";
import * as stock from "./commands/stock.js";
import * as exchange from "./commands/exchange.js";
import * as disputes from "./commands/disputes.js";

const NS = "(?<ns>[^/]+)";
const desk = (rest: string) => new RegExp(`^/api/desks/${NS}${rest}$`);

/** A desk route is hidden from an outsider, from another namespace and, when dealer-only, from a counterpart. */
function hiddenFrom(dealerOnly: boolean) {
  return async (req: IncomingMessage, params: Record<string, string>): Promise<boolean> => {
    if (params.ns === DEFAULT_NAMESPACE) await ensureDefaultDesk();
    const session = await readSession(req);
    if (!session) return false;
    return session.role === "outsider" || session.ns !== params.ns || (dealerOnly && session.role !== "dealer");
  };
}

async function gradingKeyMissing(req: IncomingMessage): Promise<boolean> {
  return !config.gradeKey || req.headers["x-flan-grading-key"] !== config.gradeKey;
}

/** The caller of a desk route; hidden-route checks already removed outsiders and other namespaces. */
async function party(ctx: Context): Promise<{ session: Session; party: Party }> {
  const session = await requireSession(ctx.req);
  return { session, party: partyOf(session) };
}

async function readDesk(ns: string): Promise<Desk> {
  let found = await reading((pool) => loadDesk(pool, ns, false));
  if (!found) throw notFound();
  if (expiredOffers(found).length > 0) {
    await transaction(async (client) => {
      const locked = (await loadDesk(client, ns, true))!;
      expireOffers(locked);
      await locked.save(client);
    });
    await notify(ns);
    found = (await reading((pool) => loadDesk(pool, ns, false)))!;
  }
  return found;
}

function hashOf(body: Body): string {
  const files = Object.fromEntries(Object.entries(body.files).map(([k, f]) => [k, createHash("sha256").update(f.bytes).digest("hex")]));
  return payloadHash({ fields: body.fields, files });
}

/** A confirmed command: live session (401), active Keycloak account (401/503), then the runner. */
function command<L, P, V>(spec: (ctx: Context) => CommandSpec<Body, L, P, V>, idFromBody = true) {
  return async (ctx: Context): Promise<Answer> => {
    const caller = await party(ctx);
    await requireActiveAccount(caller.session);
    const commandId = idFromBody ? commandIdOf(ctx.body) : `${ctx.req.method}:${ctx.url.pathname}:${randomUUID()}`;
    if (commandId === null) throw invalid({ command_id: F.INVALID });
    const reply = await runCommand(ctx.params.ns!, caller, spec(ctx), ctx.body, commandId, hashOf(ctx.body));
    return { status: reply.status, body: reply.body };
  };
}

function authAnswer(outcome: AuthOutcome, res: Context["res"]): Promise<Answer | "streamed"> | Answer {
  if ("signInDown" in outcome) return sendPage(res, 503).then(() => "streamed" as const);
  return { status: 302, headers: { location: outcome.redirect, ...(outcome.cookie ? { "set-cookie": outcome.cookie } : {}) } };
}

function pageSize(raw: string | null): number {
  if (raw === null) return config.limits.FLAN_PAGE_MAX;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > config.limits.FLAN_PAGE_MAX) throw invalid({ limit: pageLimit(config.limits.FLAN_PAGE_MAX) });
  return limit;
}

async function syncAudit(ctx: Context): Promise<Answer> {
  const caller = await party(ctx);
  await requireActiveAccount(caller.session);
  const commands = objects(ctx.body, "commands");
  if (commands === null) throw invalid({ commands: F.INVALID });
  if (commands.length > config.limits.FLAN_SYNC_BATCH_MAX) throw invalid({ commands: syncLimit(config.limits.FLAN_SYNC_BATCH_MAX) });
  const results: SyncResult[] = [];
  for (const fields of commands) {
    const body: Body = { fields, files: {} };
    const commandId = commandIdOf(body);
    try {
      if (commandId === null) throw invalid({ command_id: F.INVALID });
      const reply = await runCommand(ctx.params.ns!, caller, stock.markMissing, body, commandId, hashOf(body));
      results.push({ command_id: commandId, status: reply.status, body: reply.body });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      results.push({ command_id: commandId ?? "", status: error.status, body: error.body() });
    }
  }
  return { status: 200, body: { results } };
}

/** The register's reference image for a catalogue reference, as the "register" face (dealer only). */
async function registerImage(found: Desk, reference: string): Promise<Answer> {
  const record = [...found.register.values()].filter((r) => r.reference === reference).sort((a, b) => b.revision - a.revision)[0];
  if (!record) throw notFound();
  const object = await getObject(record.image_object_key);
  return { status: 200, bytes: { data: object.bytes, type: object.contentType } };
}

async function photo(ctx: Context): Promise<Answer> {
  const caller = await party(ctx);
  const found = await readDesk(ctx.params.ns!);
  const id = ctx.params.id!;
  if (id.startsWith("register:")) {
    if (caller.party !== "dealer") throw notFound();
    return registerImage(found, id.slice("register:".length));
  }
  const visible = visibleSpecimenKeys(found, caller.party);
  const stored = [...found.specimens.values()]
    .filter((s) => visible.has(s.key))
    .flatMap((s) => s.photos)
    .find((p) => p.id === id);
  if (!stored) throw notFound();
  const object = await getObject(stored.object_key);
  return { status: 200, bytes: { data: object.bytes, type: object.contentType } };
}

async function evidence(ctx: Context): Promise<Answer> {
  const session = await readSession(ctx.req);
  const rows = await query<{ ns: string; dispute: string; expires_at: Date; revoked: boolean }>(
    "SELECT ns, dispute, expires_at, revoked FROM evidence_links WHERE token = $1",
    [ctx.params.token],
  );
  const link = rows[0];
  if (!link || link.revoked || !session || session.ns !== link.ns || session.role === "outsider") throw notFound();
  const found = await readDesk(link.ns);
  if (found.now.getTime() >= link.expires_at.getTime()) throw notFound();
  const dispute = found.disputes.get(link.dispute)!;
  const arrival = exchange.arrivalFor(found.specimen(dispute.specimen), dispute.offer);
  if (!arrival) throw notFound();
  const object = await getObject(arrival.object_key);
  return { status: 200, bytes: { data: object.bytes, type: object.contentType } };
}

export const routes: Route[] = [
  { pattern: /^\/api\/health$/, methods: { GET: { body: "none", handler: async () => ({ status: 200, body: { status: "ok" } }) } } },
  {
    pattern: /^\/auth\/login$/,
    methods: { GET: { body: "none", handler: async (ctx) => authAnswer(await login(safeReturn(ctx.url.searchParams.get("return_to"))), ctx.res) } },
  },
  {
    pattern: /^\/auth\/callback$/,
    methods: { GET: { body: "none", handler: async (ctx) => authAnswer(await callback(ctx.url.searchParams), ctx.res) } },
  },
  {
    pattern: /^\/auth\/step-up$/,
    methods: {
      GET: { body: "none", handler: async (ctx) => authAnswer(await stepUp(ctx.req, safeReturn(ctx.url.searchParams.get("return_to"))), ctx.res) },
    },
  },
  {
    pattern: /^\/auth\/logout$/,
    methods: {
      POST: {
        body: "none",
        handler: async (ctx) => {
          const session = await requireSession(ctx.req);
          await query("UPDATE app_sessions SET ended = true WHERE id = $1", [session.id]);
          return { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
        },
      },
    },
  },
  {
    pattern: /^\/api\/session$/,
    methods: { GET: { body: "none", handler: async (ctx) => ({ status: 200, body: sessionInfo(await requireSession(ctx.req)) }) } },
  },
  {
    pattern: desk("/state"),
    hidden: hiddenFrom(false),
    methods: {
      GET: {
        body: "none",
        handler: async (ctx) => {
          const caller = await party(ctx);
          const found = await readDesk(ctx.params.ns!);
          return {
            status: 200,
            body: await reading((pool) => deskState(pool, found, caller.party)),
            headers: { "x-desk-clock": found.now.toISOString() },
          };
        },
      },
    },
  },
  {
    pattern: desk("/stream"),
    hidden: hiddenFrom(false),
    methods: {
      GET: {
        body: "none",
        handler: async (ctx) => {
          const caller = await party(ctx);
          await readDesk(ctx.params.ns!);
          const after = Number(ctx.req.headers["last-event-id"] ?? ctx.url.searchParams.get("after") ?? 0);
          await openStream(ctx.res, caller.session, Number.isFinite(after) ? after : 0);
          return "streamed";
        },
      },
    },
  },
  {
    pattern: desk("/specimens"),
    hidden: hiddenFrom(true),
    methods: {
      GET: {
        body: "none",
        handler: async (ctx) => {
          await party(ctx);
          const limit = pageSize(ctx.url.searchParams.get("limit"));
          const after = Number(ctx.url.searchParams.get("after") ?? 0);
          if (!Number.isInteger(after)) throw invalid({ after: F.INVALID });
          const found = await readDesk(ctx.params.ns!);
          const visible = visibleSpecimenKeys(found, "dealer");
          const ordered = [...found.specimens.values()].filter((s) => visible.has(s.key) && s.creation > after);
          const items = ordered.slice(0, limit);
          const page: SpecimenPage = {
            items: items.map((s) => ({ ...specimenView(found, s), key: s.key })),
            next: ordered.length > limit ? String(items.at(-1)!.creation) : null,
          };
          return { status: 200, body: page };
        },
      },
      POST: { body: "multipart", handler: command(() => stock.createSpecimen) },
    },
  },
  { pattern: desk("/specimens/(?<key>[^/]+)/quarantine"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command((c) => stock.quarantine(c.params.key!)) } } },
  { pattern: desk("/specimens/(?<key>[^/]+)/reconcile"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command((c) => stock.reconcile(c.params.key!)) } } },
  { pattern: desk("/specimens/(?<key>[^/]+)/annotations"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command((c) => stock.annotate(c.params.key!)) } } },
  { pattern: desk("/tray/placements"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command(() => stock.placeHolder) } } },
  { pattern: desk("/album/reconcile"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command(() => stock.reconcileAlbum) } } },
  { pattern: desk("/album/holes/(?<hole>[^/]+)/fill"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command((c) => stock.fillHole(c.params.hole!)) } } },
  { pattern: desk("/keeper-order"), hidden: hiddenFrom(true), methods: { PUT: { body: "json", handler: command(() => stock.reorderKeepers) } } },
  { pattern: desk("/keeper-order/undo"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command(() => stock.undoKeepers) } } },
  {
    pattern: desk("/audit/cells"),
    hidden: hiddenFrom(true),
    methods: {
      GET: {
        body: "none",
        handler: async (ctx) => {
          await party(ctx);
          const limit = pageSize(ctx.url.searchParams.get("limit"));
          const after = ctx.url.searchParams.get("after");
          const start = after === null ? 0 : CELLS.indexOf(after as (typeof CELLS)[number]) + 1;
          if (after !== null && start === 0) throw invalid({ after: F.INVALID });
          const found = await readDesk(ctx.params.ns!);
          const cells = CELLS.slice(start, start + limit);
          const page: AuditCellPage = {
            items: cells.map((cell) => {
              const c = found.cells.get(cell)!;
              return { cell, specimen: c.specimen, audit_mark: c.audit_mark, audit_version: c.audit_version };
            }),
            next: start + limit < CELLS.length ? cells.at(-1)! : null,
          };
          return { status: 200, body: page };
        },
      },
    },
  },
  { pattern: desk("/audit/marks"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: command(() => stock.markMissing) } } },
  { pattern: desk("/audit/sync"), hidden: hiddenFrom(true), methods: { POST: { body: "json", handler: syncAudit } } },
  { pattern: desk("/photos/(?<id>[^/]+)"), hidden: hiddenFrom(false), methods: { GET: { body: "none", handler: photo } } },
  { pattern: desk("/offers/(?<offer>[^/]+)/send"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => exchange.sendOffer(c.params.offer!)) } } },
  { pattern: desk("/offers/(?<offer>[^/]+)/holds"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => exchange.placeHold(c.params.offer!)) } } },
  {
    pattern: desk("/offers/(?<offer>[^/]+)/holds/(?<key>[^/]+)"),
    hidden: hiddenFrom(false),
    methods: { DELETE: { body: "none", handler: command((c) => exchange.releaseHold(c.params.offer!, c.params.key!), false) } },
  },
  { pattern: desk("/offers/(?<offer>[^/]+)/replace"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => exchange.replaceSpecimen(c.params.offer!)) } } },
  { pattern: desk("/offers/(?<offer>[^/]+)/accept"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => exchange.acceptOffer(c.params.offer!)) } } },
  {
    pattern: desk("/offers/(?<offer>[^/]+)/manifests/(?<party>[^/]+)/freeze"),
    hidden: hiddenFrom(false),
    methods: { POST: { body: "json", handler: command((c) => exchange.freezeManifest(c.params.offer!, c.params.party!)) } },
  },
  { pattern: desk("/offers/(?<offer>[^/]+)/arrivals"), hidden: hiddenFrom(false), methods: { POST: { body: "multipart", handler: command((c) => exchange.saveArrival(c.params.offer!)) } } },
  { pattern: desk("/offers/(?<offer>[^/]+)/receipts"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => exchange.recordReceipt(c.params.offer!)) } } },
  { pattern: desk("/offers/(?<offer>[^/]+)/disputes"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => disputes.openDispute(c.params.offer!)) } } },
  {
    pattern: desk("/disputes/(?<dispute>[^/]+)/markers/(?<marker>[^/]+)"),
    hidden: hiddenFrom(false),
    methods: { PUT: { body: "json", handler: command((c) => disputes.moveMarker(c.params.dispute!, c.params.marker!)) } },
  },
  { pattern: desk("/disputes/(?<dispute>[^/]+)/resolution"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => disputes.proposeResolution(c.params.dispute!)) } } },
  {
    pattern: desk("/disputes/(?<dispute>[^/]+)/approve-resolution"),
    hidden: hiddenFrom(false),
    methods: { POST: { body: "json", handler: command((c) => disputes.approveResolution(c.params.dispute!)) } },
  },
  { pattern: desk("/disputes/(?<dispute>[^/]+)/links"), hidden: hiddenFrom(false), methods: { POST: { body: "json", handler: command((c) => disputes.createLink(c.params.dispute!)) } } },
  {
    pattern: desk("/disputes/(?<dispute>[^/]+)/links/(?<token>[^/]+)"),
    hidden: hiddenFrom(false),
    methods: { DELETE: { body: "none", handler: command((c) => disputes.revokeLink(c.params.dispute!, c.params.token!), false) } },
  },
  { pattern: /^\/evidence\/(?<token>[^/]+)$/, methods: { GET: { body: "none", handler: evidence } } },
  { pattern: /^\/__grade\/seed$/, hidden: gradingKeyMissing, methods: { POST: { body: "json", handler: async (ctx) => seed(ctx.body) } } },
  {
    pattern: /^\/__grade\/(?<ns>[^/]+)\/clock$/,
    hidden: gradingKeyMissing,
    methods: { POST: { body: "json", handler: async (ctx) => ({ status: 200, body: await advanceClock(ctx.params.ns!, ctx.body) }) } },
  },
  {
    pattern: /^\/__grade\/(?<ns>[^/]+)\/otp$/,
    hidden: gradingKeyMissing,
    methods: { GET: { body: "none", handler: async (ctx) => ({ status: 200, body: await otp(ctx.params.ns!, ctx.url.searchParams.get("role")) }) } },
  },
  {
    pattern: /^\/__grade\/(?<ns>[^/]+)\/identity$/,
    hidden: gradingKeyMissing,
    methods: { POST: { body: "json", handler: async (ctx) => ({ status: 200, body: await identity(ctx.params.ns!, ctx.body) }) } },
  },
];
