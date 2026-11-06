// The Farshore server: one origin for the marketing page, the console, the operator console, the JSON
// API, the S3 API and share links. It starts and answers /api/health even when a dependency is down.
import { createServer } from "node:http";
import { requireOperator } from "./access.js";
import {
  changePassword, codeStep, confirmStepUp, endSession, listSessions, me, requireCsrfHeader, signIn, signOut, signOutOthers, twoStepDisable,
  twoStepEnable, twoStepSetup, twoStepStatus,
} from "./account.js";
import { appendAudit, deniedRecord, exportAudit, listAudit, verifyAudit } from "./audit.js";
import { encryptionStatus, rotateEncryption } from "./encryption.js";
import { billingOverview, listRegions, listWorkspaces, runLifecycle, setRegionState, setWorkspaceStatus, syncBillingNow } from "./opsApi.js";
import { startBillingWorker, usageExport, usageRowsPage, usageView } from "./billing.js";
import { config } from "./config.js";
import {
  bulkDelete, createBucket, deleteCurrent, deleteVersion, downloadContent, getBucket, getLifecycle, getObjectInfo, getReplicas,
  listBuckets, listObjects, listVersions, putLifecycle, retryRegion, search, setLegalHold, setRetention, undoBatch, uploadObject,
} from "./consoleApi.js";
import { isDatabaseDown, markReady, pool, requireDatabase } from "./db.js";
import { ApiError, s3Error, S3Error } from "./errors.js";
import { createCtx, send, sendApiError, sendJson, Router, type Ctx } from "./http.js";
import { startByteRemovalWorker, startLifecycleWorker } from "./lifecycle.js";
import { listLinks, mintLink, revokeLink, serveLink } from "./links.js";
import { startMailWorker } from "./mail.js";
import { seedObjects } from "./objects.js";
import { servePage, serveAsset } from "./pages.js";
import { startReplicationWorker } from "./replication.js";
import { handleS3 } from "./s3api.js";
import { applySchema } from "./schema.js";
import { StorageUnavailable } from "./storage.js";
import {
  acceptInvite, createInvite, createKey, deleteKey, disableKey, getInvite, listInvites, listKeys, listMembers, patchMember, regions,
  removeMember, rotateKey,
} from "./teamApi.js";
import { rollWindowsNow } from "./usage.js";
import {
  createEndpoint, deleteEndpoint, listDeliveries, listEndpoints, redeliver, setEndpointState, startDeliveryWorker,
} from "./webhooks.js";

const api = new Router();
const w = "/api/w/:ws";
const b = `${w}/buckets/:bucket`;
api.on("POST", "/api/session", signIn);
api.on("POST", "/api/session/two-step", codeStep);
api.on("DELETE", "/api/session", signOut);
api.on("GET", "/api/me", me);
api.on("GET", "/api/me/two-step", twoStepStatus);
api.on("POST", "/api/me/two-step/setup", twoStepSetup);
api.on("POST", "/api/me/two-step/enable", twoStepEnable);
api.on("DELETE", "/api/me/two-step", twoStepDisable);
api.on("POST", "/api/me/two-step/confirm", confirmStepUp);
api.on("GET", "/api/me/sessions", listSessions);
api.on("DELETE", "/api/me/sessions/:id", endSession);
api.on("POST", "/api/me/sessions/sign-out-others", signOutOthers);
api.on("PUT", "/api/me/password", changePassword);
api.on("GET", "/api/regions", regions);
api.on("GET", `${w}/buckets`, listBuckets);
api.on("POST", `${w}/buckets`, createBucket);
api.on("GET", b, getBucket);
api.on("GET", `${b}/lifecycle`, getLifecycle);
api.on("PUT", `${b}/lifecycle`, putLifecycle);
api.on("GET", `${b}/objects`, listObjects);
api.on("GET", `${w}/search`, search);
api.on("PUT", `${b}/object`, uploadObject);
api.on("GET", `${b}/object`, getObjectInfo);
api.on("DELETE", `${b}/object`, deleteCurrent);
api.on("GET", `${b}/object/content`, downloadContent);
api.on("GET", `${b}/object/versions`, listVersions);
api.on("DELETE", `${b}/object/version`, deleteVersion);
api.on("PUT", `${b}/object/retention`, setRetention);
api.on("PUT", `${b}/object/legal-hold`, setLegalHold);
api.on("GET", `${b}/object/replicas`, getReplicas);
api.on("POST", `${b}/object/replicas/:region/retry`, retryRegion);
api.on("POST", `${b}/objects/delete`, bulkDelete);
api.on("POST", `${w}/batches/:id/undo`, undoBatch);
api.on("POST", `${b}/object/links`, mintLink);
api.on("GET", `${w}/links`, listLinks);
api.on("POST", `${w}/links/:id/revoke`, revokeLink);
api.on("GET", `${w}/members`, listMembers);
api.on("PATCH", `${w}/members/:user`, patchMember);
api.on("DELETE", `${w}/members/:user`, removeMember);
api.on("POST", `${w}/invites`, createInvite);
api.on("GET", `${w}/invites`, listInvites);
api.on("GET", "/api/invites/:token", getInvite);
api.on("POST", "/api/invites/:token/accept", acceptInvite);
api.on("GET", `${w}/keys`, listKeys);
api.on("POST", `${w}/keys`, createKey);
api.on("POST", `${w}/keys/:key/rotate`, rotateKey);
api.on("POST", `${w}/keys/:key/disable`, disableKey);
api.on("DELETE", `${w}/keys/:key`, deleteKey);
api.on("GET", `${w}/webhooks`, listEndpoints);
api.on("POST", `${w}/webhooks`, createEndpoint);
api.on("POST", `${w}/webhooks/:id/disable`, setEndpointState);
api.on("POST", `${w}/webhooks/:id/enable`, setEndpointState);
api.on("DELETE", `${w}/webhooks/:id`, deleteEndpoint);
api.on("GET", `${w}/webhooks/:id/deliveries`, listDeliveries);
api.on("POST", `${w}/webhooks/:id/deliveries/:delivery/redeliver`, redeliver);
api.on("GET", `${w}/usage`, usageView);
api.on("GET", `${w}/usage/rows`, usageRowsPage);
api.on("GET", `${w}/usage/export.csv`, usageExport);
api.on("GET", `${w}/encryption`, encryptionStatus);
api.on("POST", `${w}/encryption/rotate`, rotateEncryption);
api.on("GET", `${w}/audit`, listAudit);
api.on("GET", `${w}/audit/export.csv`, exportAudit);
api.on("GET", `${w}/audit/verify`, verifyAudit);

const ops = new Router();
ops.on("GET", "/api/ops/regions", listRegions);
ops.on("POST", "/api/ops/regions/:id/state", setRegionState);
ops.on("GET", "/api/ops/workspaces", listWorkspaces);
ops.on("POST", "/api/ops/workspaces/:ws/suspend", setWorkspaceStatus);
ops.on("POST", "/api/ops/workspaces/:ws/reinstate", setWorkspaceStatus);
ops.on("POST", "/api/ops/lifecycle/run", runLifecycle);
ops.on("GET", "/api/ops/billing", billingOverview);
ops.on("POST", "/api/ops/billing/sync", syncBillingNow);

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const THROTTLED = new Set([signIn, codeStep, acceptInvite, twoStepDisable, confirmStepUp, changePassword]);

async function handleApi(ctx: Ctx): Promise<void> {
  if (ctx.path === "/api/health") {
    sendJson(ctx, 200, { status: "ok" });
    return;
  }
  requireDatabase();
  if (ctx.path === "/api/ops" || ctx.path.startsWith("/api/ops/")) {
    if (CHANGES.has(ctx.method)) requireCsrfHeader(ctx);
    await requireOperator(ctx);
    const route = ops.match(ctx.method, ctx.rawPath);
    if (!route) throw new ApiError("not_found");
    ctx.params = route.params;
    await route.handler(ctx);
    return;
  }
  const route = api.match(ctx.method, ctx.rawPath);
  if (!route) throw new ApiError("not_found");
  // Throttled endpoints check their throttle before X-Requested-With, as the error precedence orders it.
  if (CHANGES.has(ctx.method) && !THROTTLED.has(route.handler)) requireCsrfHeader(ctx);
  ctx.params = route.params;
  await route.handler(ctx);
}

// A refusal for the caller's role or a key's permission, bucket scope or prefix appends one
// permission.denied entry naming the object key, else the bucket, else the request path.
async function recordDenial(ctx: Ctx, error: unknown, s3: boolean): Promise<void> {
  const denial = error instanceof ApiError || error instanceof S3Error ? error.denial : undefined;
  if (!denial) return;
  let key: string | null = ctx.query.get("key");
  let bucket: string | null = ctx.params.bucket ?? null;
  if (s3) {
    const [name = "", ...rest] = ctx.path.slice("/s3/".length).split("/");
    bucket = name || null;
    key = rest.join("/") || null;
  }
  await appendAudit(pool, denial.workspaceSlug, deniedRecord(denial.actor, ctx.method, ctx.rawPath, key, bucket), ctx.now)
    .catch((failure: unknown) => console.error("audit:", failure));
}

async function refuse(ctx: Ctx, error: unknown, s3: boolean): Promise<void> {
  if (ctx.res.headersSent) {
    ctx.res.destroy();
    return;
  }
  await recordDenial(ctx, error, s3);
  let failure = error;
  if (isDatabaseDown(error)) failure = s3 ? new S3Error("ServiceUnavailable") : new ApiError("service_unavailable");
  else if (error instanceof StorageUnavailable) failure = s3 ? new S3Error("ServiceUnavailable") : new ApiError("storage_unavailable");
  if (s3) {
    const s3Failure = failure instanceof S3Error ? failure
      : failure instanceof ApiError && failure.code === "service_unavailable" ? new S3Error("ServiceUnavailable")
        : new S3Error("ServiceUnavailable", "Farshore could not complete this request.");
    if (!(failure instanceof S3Error) && !(failure instanceof ApiError)) console.error(failure);
    const headers: Record<string, string> = { "Content-Type": "application/xml" };
    if (s3Failure.retryAfter !== undefined) headers["Retry-After"] = String(s3Failure.retryAfter);
    send(ctx, s3Failure.status, headers, ctx.method === "HEAD" ? "" : s3Error(s3Failure, ctx.rawPath));
    return;
  }
  if (failure instanceof ApiError) {
    sendApiError(ctx, failure);
    return;
  }
  console.error(failure);
  sendApiError(ctx, new ApiError("service_unavailable", "Farshore could not complete this request. Try again in a minute."));
}

const server = createServer((req, res) => {
  const ctx = createCtx(req, res);
  const s3 = ctx.rawPath === "/s3" || ctx.rawPath.startsWith("/s3/");
  void (async () => {
    try {
      if (s3) {
        requireDatabase();
        await handleS3(ctx);
      } else if (ctx.rawPath.startsWith("/api/")) {
        await handleApi(ctx);
      } else if (/^\/l\/[^/]+$/.test(ctx.rawPath) && (ctx.method === "GET" || ctx.method === "HEAD")) {
        requireDatabase();
        await serveLink(ctx, ctx.rawPath.slice(3));
      } else if (!serveAsset(ctx)) {
        if (/^\/(console|ops|account)(\/|$)/.test(ctx.rawPath)) requireDatabase();
        if (!(await servePage(ctx))) send(ctx, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found.");
      }
    } catch (error) {
      await refuse(ctx, error, s3);
    }
  })();
});
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, "0.0.0.0");

// Applies schema and seed in the background until Postgres and MinIO answer, then starts the workers.
async function bootstrap(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      break;
    } catch (error) {
      console.error("bootstrap: database not ready:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  markReady();
  startReplicationWorker();
  startMailWorker();
  startDeliveryWorker();
  startLifecycleWorker();
  startByteRemovalWorker();
  startBillingWorker();
  setInterval(() => void rollWindowsNow().catch(() => undefined), 1000).unref();
  for (;;) {
    try {
      await seedObjects();
      return;
    } catch (error) {
      console.error("bootstrap: seed objects pending:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
void bootstrap();
