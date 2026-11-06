import { type Ctx, readJson, sendJson, setSessionCookie, clearSessionCookie } from "../http.js";
import { errors } from "../errors.js";
import { databaseReachable } from "../db.js";
import { STUDIO_ZONE } from "../config.js";
import { studioInstant } from "../time.js";
import * as killbill from "../services/killbill.js";
import * as storage from "../services/storage.js";
import * as mail from "../services/mail.js";
import * as cms from "../services/cms.js";
import { isCurrency, toAmountString } from "../../shared/money.js";
import { PLANS, isPlanId, isCarePlan } from "../../shared/plans.js";
import { priceInEffect } from "../domain/prices.js";
import { quoteAt, serializeQuote } from "../domain/quotes.js";
import {
  createSession,
  deleteSession,
  serializeUser,
  userByEmail,
  verifyPassword,
} from "../domain/accounts.js";

export async function health(ctx: Ctx): Promise<void> {
  const [postgres, billing, files, mailer, content] = await Promise.all([
    databaseReachable(),
    killbill.reachable(),
    storage.reachable(),
    mail.reachable(),
    cms.reachable(),
  ]);
  sendJson(ctx.res, 200, {
    status: "ok",
    services: {
      postgres: postgres ? "up" : "down",
      killbill: billing ? "up" : "down",
      minio: files ? "up" : "down",
      mailpit: mailer ? "up" : "down",
      pocketbase: content ? "up" : "down",
    },
  });
}

export async function clock(ctx: Ctx): Promise<void> {
  sendJson(ctx.res, 200, { now: studioInstant(new Date()), zone: STUDIO_ZONE });
}

function entrySummary(entry: cms.CmsEntry): Record<string, unknown> {
  return {
    slug: entry.slug,
    title: entry.title,
    client: entry.client,
    year: entry.year,
    summary: entry.summary,
    publishedAt: entry.publishedAt,
  };
}

export async function listEntries(ctx: Ctx, kind: cms.EntryKind): Promise<void> {
  const entries = await cms.publishedEntries(kind);
  sendJson(ctx.res, 200, { entries: entries.map(entrySummary) });
}

export async function entryDetail(ctx: Ctx, kind: cms.EntryKind): Promise<void> {
  const slug = ctx.params.slug ?? "";
  const entry = await cms.publishedEntry(kind, slug);
  if (!entry) throw errors.notFound();
  sendJson(ctx.res, 200, { ...entrySummary(entry), body: entry.body });
}

export async function plans(ctx: Ctx): Promise<void> {
  const currency = ctx.url.searchParams.get("currency");
  if (!isCurrency(currency)) throw errors.validation({ currency: "Choose USD or ARS." });
  const now = new Date();
  const rows = [];
  for (const plan of PLANS) {
    const price = await priceInEffect(plan.id, currency, now);
    if (!price) continue;
    rows.push({
      plan: plan.id,
      name: plan.name,
      amount: toAmountString(price.amount),
      interval: isCarePlan(plan.id) ? "month" : null,
    });
  }
  sendJson(ctx.res, 200, { currency, plans: rows });
}

export async function quote(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const fields: Record<string, string> = {};
  if (!isPlanId(body.plan)) fields.plan = "Choose one of the published plans.";
  if (!isCurrency(body.currency)) fields.currency = "Choose USD or ARS.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  if (!(await killbill.reachable())) throw errors.billingUnavailable();
  const computed = await quoteAt(
    body.plan as (typeof PLANS)[number]["id"],
    body.currency as "USD" | "ARS",
    new Date(),
  );
  sendJson(ctx.res, 200, serializeQuote(computed));
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await userByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw errors.invalidCredentials();
  const sessionId = await createSession(user.id);
  setSessionCookie(ctx.res, sessionId);
  sendJson(ctx.res, 200, { user: serializeUser(user) });
}

export async function signOut(ctx: Ctx): Promise<void> {
  if (ctx.sessionId) await deleteSession(ctx.sessionId);
  clearSessionCookie(ctx.res);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function me(ctx: Ctx): Promise<void> {
  if (!ctx.user) throw errors.unauthenticated();
  sendJson(ctx.res, 200, { user: serializeUser(ctx.user) });
}
