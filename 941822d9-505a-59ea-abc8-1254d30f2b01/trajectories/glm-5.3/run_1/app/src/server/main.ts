import express from "express";
import type { Request, Response } from "express";
import { readFileSync, existsSync } from "node:fs";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { applySchemaAndSeed } from "./seed.ts";
import { ensureBucket } from "./storage.ts";
import { runOutboxLoop } from "./mail.ts";
import { runSealRetryLoop } from "./sealing.ts";
import { ApiError } from "./errors.ts";
import { crossOriginFailure, originOf, parseCookie, readBody, NO_STORE_HEADERS } from "./http-kernel.ts";
import { loadSession, SESSION_COOKIE } from "./session.ts";
import { ALL_ROLES, compilePattern, type Ctx, type PublicCtx, type Role, type RouteSpec } from "./route.ts";
import * as auth from "./handlers-auth.ts";
import * as courses from "./handlers-courses.ts";
import * as cohorts from "./handlers-cohorts.ts";
import * as checkout from "./handlers-checkout.ts";
import * as learning from "./handlers-learning.ts";
import * as certs from "./handlers-certificates.ts";
import * as planner from "./handlers-planner.ts";
import * as refunds from "./handlers-refunds.ts";
import * as sponsor from "./handlers-sponsor.ts";

const routes: RouteSpec[] = [
  { method: "POST", pattern: "/api/session", roles: null, publicAccess: true, handler: auth.signIn },
  { method: "DELETE", pattern: "/api/session", roles: ALL_ROLES, handler: auth.signOut },
  { method: "GET", pattern: "/api/me", roles: ALL_ROLES, handler: auth.getMe },
  { method: "PATCH", pattern: "/api/me", roles: ALL_ROLES, handler: auth.patchMe },
  { method: "GET", pattern: "/api/health", roles: null, publicAccess: true, handler: health },
  { method: "GET", pattern: "/api/courses", roles: ALL_ROLES, handler: courses.listCourses },
  { method: "GET", pattern: "/api/courses/:id", roles: ALL_ROLES, handler: courses.getCourse },
  { method: "POST", pattern: "/api/courses", roles: ["author"], handler: courses.createCourse },
  { method: "PATCH", pattern: "/api/courses/:id", roles: ["author", "planner"], handler: courses.patchCourse },
  { method: "POST", pattern: "/api/courses/:id/transitions", roles: ["author", "planner"], handler: courses.transitionCourse },
  { method: "GET", pattern: "/api/courses/:id/history", roles: ["author", "planner"], handler: courses.courseHistory },
  { method: "POST", pattern: "/api/courses/:id/cohorts", roles: ["planner"], handler: cohorts.createCohort },
  { method: "GET", pattern: "/api/cohorts/:id", roles: ALL_ROLES, handler: cohorts.getCohort },
  { method: "PATCH", pattern: "/api/cohorts/:id", roles: ["planner"], handler: cohorts.patchCohort },
  { method: "POST", pattern: "/api/cohorts/:id/waitlist", roles: ["learner"], handler: cohorts.joinWaitlist },
  { method: "DELETE", pattern: "/api/cohorts/:id/waitlist", roles: ["learner"], handler: cohorts.leaveWaitlist },
  { method: "GET", pattern: "/api/checkout/quote", roles: ["learner"], handler: checkout.quoteForCourse },
  { method: "POST", pattern: "/api/checkout", roles: ["learner"], handler: checkout.checkout },
  { method: "GET", pattern: "/api/me/enrolments", roles: ["learner"], handler: checkout.listMyEnrolments },
  { method: "GET", pattern: "/api/enrolments/:id", roles: ALL_ROLES, handler: checkout.getEnrolment },
  {
    method: "GET",
    pattern: "/api/enrolments/:id/modules/:moduleId",
    roles: ["learner"],
    handler: learning.getModule,
  },
  {
    method: "POST",
    pattern: "/api/enrolments/:id/modules/:moduleId/answer",
    roles: ["learner"],
    handler: learning.answerModule,
  },
  { method: "POST", pattern: "/api/enrolments/:id/evaluation", roles: ["learner"], handler: learning.submitEvaluation },
  { method: "POST", pattern: "/api/enrolments/:id/refund-request", roles: ["learner"], handler: learning.requestRefund },
  { method: "GET", pattern: "/api/me/transcript", roles: ["learner"], handler: certs.transcript },
  { method: "GET", pattern: "/api/certificates/:id", roles: ALL_ROLES, handler: certs.getCertificate },
  { method: "GET", pattern: "/api/certificates/:id/pdf", roles: ALL_ROLES, handler: certs.downloadCertificatePdf },
  { method: "POST", pattern: "/api/certificates/:id/share-links", roles: ["learner"], handler: certs.createShareLink },
  { method: "GET", pattern: "/api/certificates/:id/share-links", roles: ["learner"], handler: certs.listShareLinks },
  { method: "DELETE", pattern: "/api/certificates/:id/share-links/:linkId", roles: ["learner"], handler: certs.revokeShareLink },
  { method: "GET", pattern: "/api/verify/:token", roles: null, publicAccess: true, handler: certs.verifyToken },
  { method: "GET", pattern: "/api/verify/:token/pdf", roles: null, publicAccess: true, handler: certs.verifyTokenPdf },
  { method: "GET", pattern: "/api/planner/certificates", roles: ["planner"], handler: planner.plannerCertificatesSearch },
  { method: "POST", pattern: "/api/certificates/:id/reissue", roles: ["planner"], handler: planner.reissueCertificate },
  { method: "POST", pattern: "/api/certificates/:id/revoke", roles: ["planner"], handler: planner.revokeCertificate },
  { method: "GET", pattern: "/api/refund-requests", roles: ["planner"], handler: refunds.listRefundRequests },
  { method: "POST", pattern: "/api/refund-requests/:id/approve", roles: ["planner"], handler: refunds.approveRefund },
  { method: "POST", pattern: "/api/refund-requests/:id/decline", roles: ["planner"], handler: refunds.declineRefund },
  { method: "GET", pattern: "/api/sponsor/dashboard", roles: ["coordinator"], handler: sponsor.sponsorDashboard },
  { method: "PATCH", pattern: "/api/sponsor/coverage", roles: ["coordinator"], handler: sponsor.saveCoverage },
  { method: "GET", pattern: "/api/sponsor/packs", roles: ["coordinator"], handler: sponsor.listPacks },
  { method: "POST", pattern: "/api/sponsor/packs", roles: ["coordinator"], handler: sponsor.buyPack },
  { method: "GET", pattern: "/api/sponsor/packs/:id/ledger", roles: ["coordinator"], handler: sponsor.packLedger },
  { method: "POST", pattern: "/api/sponsor/packs/:id/assignments", roles: ["coordinator"], handler: sponsor.assignSeat },
  { method: "DELETE", pattern: "/api/sponsor/assignments/:id", roles: ["coordinator"], handler: sponsor.returnSeat },
  { method: "GET", pattern: "/api/sponsor/learners", roles: ["coordinator"], handler: sponsor.searchLearners },
  { method: "GET", pattern: "/api/sponsor/learners/:id", roles: ["coordinator"], handler: sponsor.learnerRecord },
  { method: "GET", pattern: "/api/sponsor/reports/monthly", roles: ["coordinator"], handler: sponsor.monthlyReport },
  { method: "POST", pattern: "/api/sponsor/exports", roles: ["coordinator"], handler: sponsor.createExport },
  { method: "GET", pattern: "/api/sponsor/exports/:id\\.csv", roles: ["coordinator"], handler: sponsor.downloadExport },
];

type CompiledRoute = RouteSpec & { regex: RegExp; names: string[] };
const compiled: CompiledRoute[] = routes.map((r) => ({ ...r, ...compilePattern(r.pattern) }));

async function health(ctx: PublicCtx): Promise<void> {
  ctx.res.json({ status: "ok" });
}

const isVerifyApiPath = (path: string): boolean => /^\/api\/verify\/[^/]+(\/pdf)?$/.test(path);

const isTokenPdfPath = (path: string, url: URL): boolean =>
  /^\/api\/certificates\/[^/]+\/pdf$/.test(path) && url.searchParams.has("token");

async function handleApi(req: Request, res: Response): Promise<void> {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  // The public verification paths and the token-bearing download carry
  // no-store and no-referrer on every response, whatever its status.
  if (isVerifyApiPath(path) || isTokenPdfPath(path, url)) {
    res.set(NO_STORE_HEADERS);
  }
  const method = req.method === "HEAD" ? "GET" : req.method;
  const candidates = compiled.filter((r) => r.regex.test(path));
  if (candidates.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const match = candidates.find((r) => r.method === method);
  if (!match) {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // Boundary checks: body size, content type, JSON validity, then cross-origin.
  const body = await readBody(req);
  if (body.failure) {
    res.status(body.failure.status).json(body.failure.body);
    return;
  }
  const crossOrigin = crossOriginFailure(req);
  if (crossOrigin) {
    res.status(crossOrigin.status).json(crossOrigin.body);
    return;
  }

  // Authentication, unless the request is one of the four exempt kinds.
  const tokenPdf = isTokenPdfPath(path, url);
  const exempt =
    tokenPdf ||
    match.publicAccess === true ||
    (method === "POST" && path === "/api/session") ||
    path === "/api/health";
  let user: Ctx["user"] | null = null;
  if (!exempt) {
    const cookie = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
    user = await loadSession(cookie);
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (match.roles !== null && !match.roles.includes(user.role as Role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  const params: Record<string, string> = {};
  const groups = match.regex.exec(path)?.slice(1) ?? [];
  match.names.forEach((name, i) => {
    params[name] = decodeURIComponent(groups[i] ?? "");
  });

  const ctx: Ctx | PublicCtx = {
    req,
    res,
    params,
    query: url.searchParams,
    body: body.body,
    user,
    origin: originOf(req),
  };

  try {
    await (match.handler as (c: Ctx | PublicCtx) => Promise<void> | void)(ctx);
  } catch (e) {
    if (e instanceof ApiError) {
      res.status(e.status).json(e.body);
      return;
    }
    console.error("unhandled error", e);
    res.status(500).json({ error: "internal" });
  }
}

const app = express();
app.disable("x-powered-by");
app.all(/^\/api\//, (req, res) => {
  void handleApi(req, res);
});

// Public verification page.
app.get(/^\/verify\/[^/]+$/, (req, res) => {
  res.set(NO_STORE_HEADERS);
  res.type("html").send(indexHtml());
});

// Built frontend assets, self-hosted fonts, then the single-page shell.
const assetRoot = new URL("../public/", import.meta.url).pathname;
const fontRoot = new URL("./fonts/", import.meta.url).pathname;
const indexContent = existsSync(`${assetRoot}index.html`) ? readFileSync(`${assetRoot}index.html`, "utf8") : "";
function indexHtml(): string {
  return indexContent;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  ttf: "font/ttf",
  woff2: "font/woff2",
  svg: "image/svg+xml",
};

function sendFile(res: Response, file: string): void {
  const ext = file.split(".").pop() ?? "";
  res.set("Cache-Control", "no-cache");
  res.type(MIME[ext] ?? "application/octet-stream").sendFile(file);
}

app.get(/^\/(index\.html|assets\/[\w.-]+)$/, (req, res) => {
  const file = `${assetRoot}${req.path.slice(1)}`;
  if (!existsSync(file)) {
    res.status(404).send(indexHtml());
    return;
  }
  sendFile(res, file);
});

app.get(/^\/fonts\/[\w.-]+$/, (req, res) => {
  const file = `${fontRoot}${req.path.slice("/fonts/".length)}`;
  if (!existsSync(file)) {
    res.status(404).send(indexHtml());
    return;
  }
  sendFile(res, file);
});

app.use((req, res) => {
  const blockedExact = [
    "/run.json",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.json",
    "/tsconfig.frontend.json",
    "/build.mjs",
    "/third_party_notices.md",
    "/.gitignore",
    "/.env",
  ];
  const blockedPrefix = ["/node_modules/", "/src/", "/dist/", "/scripts/"];
  const last = req.path.split("/").pop() ?? "";
  if (
    blockedExact.includes(req.path) ||
    blockedPrefix.some((p) => req.path.startsWith(p)) ||
    last.includes(".")
  ) {
    res.status(404).send("Not found");
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    res.type("html").send(indexHtml());
    return;
  }
  res.status(405).send(indexHtml());
});

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed(pool);
  await ensureBucket().catch(() => undefined);
  void runOutboxLoop();
  void runSealRetryLoop();
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`credwell listening on ${config.port}`);
  });
}

void start();
