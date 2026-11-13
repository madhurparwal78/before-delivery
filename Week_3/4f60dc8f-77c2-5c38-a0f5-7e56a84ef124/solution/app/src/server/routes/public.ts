// Public routes (health, status, content, search, start, sign-in) and the review-link routes.
import { caseStudy, publishedContent } from "../content.js";
import { loadEngagement, engagementJson } from "../domain/engagements.js";
import { requireKey, runOnce } from "../domain/idempotency.js";
import { startProject } from "../domain/brands.js";
import { acceptReview, linkEngagement, readReview, requestRevision, sendStill } from "../domain/review.js";
import { CLIENT_COOKIE, endSession, SESSION_SECONDS } from "../domain/sessions.js";
import { landingPath, requestCode, signIn } from "../domain/signin.js";
import { pool } from "../db.js";
import { ApiError, FIELD_COPY, invalid } from "../errors.js";
import { clearedCookie, route, sessionCookie, type Context } from "../http.js";
import { search } from "../search.js";
import { clientStatus } from "../status.js";

const NO_REFERRER = { "Referrer-Policy": "no-referrer" };
const bodyOf = (ctx: Context): Record<string, unknown> => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {});

route("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }));

route("GET", "/api/status", async () => ({ status: 200, body: await clientStatus() }));

route("GET", "/api/content", async () => ({ status: 200, body: await publishedContent() }));

route("GET", "/api/work/:slug", async (ctx) => {
  const study = await caseStudy(ctx.params.slug ?? "");
  if (!study || !study.published) throw new ApiError("not_found");
  return { status: 200, body: study };
});

route("GET", "/api/search", async (ctx) => {
  const query = (ctx.url.searchParams.get("q") ?? "").trim();
  if (Array.from(query).length > 100) throw invalid("q", FIELD_COPY.q);
  return { status: 200, body: { query, hits: await search(query) } };
});

route("POST", "/api/projects/start", async (ctx) => {
  const now = new Date();
  const started = await startProject(bodyOf(ctx));
  const engagement = await loadEngagement(pool, started.engagementId, started.brandId);
  return {
    status: 201,
    body: { engagement: await engagementJson(pool, engagement, "client", now) },
    headers: { "Set-Cookie": sessionCookie(CLIENT_COOKIE, started.token, SESSION_SECONDS) },
  };
});

route("POST", "/api/session/code", async (ctx) => {
  await requestCode(bodyOf(ctx).email, new Date());
  return { status: 202, body: { status: "sent" } };
});

route("POST", "/api/session", async (ctx) => {
  const body = bodyOf(ctx);
  const signed = await signIn(body.email, body.code, new Date());
  return {
    status: 200,
    body: { brand: signed.brand, contact: signed.contact, landing: landingPath(body.next) },
    headers: { "Set-Cookie": sessionCookie(CLIENT_COOKIE, signed.token, SESSION_SECONDS) },
  };
});

route("DELETE", "/api/session", async (ctx) => {
  await endSession(ctx.cookies[CLIENT_COOKIE]);
  return { status: 204, headers: { "Set-Cookie": clearedCookie(CLIENT_COOKIE) } };
});

// ---------- review links (the token is the capability) ----------

function withNoReferrer<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof ApiError) throw new ApiError(error.code, error.fields, { ...error.headers, ...NO_REFERRER });
    throw error;
  });
}

route("GET", "/api/review/:token", (ctx) => withNoReferrer(async () => ({ status: 200, body: await readReview(ctx.params.token ?? "", new Date()), headers: NO_REFERRER })));

route("GET", "/api/review/:token/stills/:stillId", (ctx) =>
  withNoReferrer(async () => {
    await sendStill(ctx, ctx.params.token ?? "", ctx.params.stillId ?? "", new Date());
    return "sent" as const;
  }),
);

route("POST", "/api/review/:token/accept", (ctx) => withNoReferrer(async () => ({ status: 200, body: await acceptReview(ctx.params.token ?? "", new Date()), headers: NO_REFERRER })));

route("POST", "/api/review/:token/revisions", (ctx) =>
  withNoReferrer(async () => {
    const token = ctx.params.token ?? "";
    const engagementId = await linkEngagement(token, new Date());
    const key = requireKey(ctx.req.headers["idempotency-key"]);
    const outcome = await runOnce(`engagement:${engagementId}:revisions`, key, ctx.body, () => requestRevision(token, bodyOf(ctx), new Date()));
    return { status: outcome.status, body: outcome.body, headers: NO_REFERRER };
  }),
);
