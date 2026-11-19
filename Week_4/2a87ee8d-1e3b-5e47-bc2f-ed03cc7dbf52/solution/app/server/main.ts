import { config } from "./config.js";
import { migrate } from "./db.js";
import { createServer, reply, route, streamRoute, type Req } from "./http.js";
import { authenticate, requireFacilitator } from "./auth.js";
import { seed } from "./seed.js";
import { health, startHealth } from "./health.js";
import { listActivity } from "./activity.js";
import { billingObject, changePlan, ensureCatalog, refresh, refreshAll, retryPayment, validatePlanRequest } from "./billing.js";
import { db } from "./db.js";
import { once } from "./ops.js";
import { actorKey } from "./auth.js";
import * as board from "./board.js";
import * as workshops from "./workshops.js";
import * as sessions from "./sessions.js";
import { publicRecap, recapFile } from "./recap.js";
import { openStream, startLive } from "./live.js";
import { startWorker, tick } from "./worker.js";

async function facilitatorOf(req: Req) {
  return requireFacilitator(await authenticate(req));
}

route("GET", "/api/health", health);

route("POST", "/api/session", sessions.signIn);
route("GET", "/api/session", sessions.currentSession);
route("DELETE", "/api/session", sessions.signOut);

route("GET", "/api/billing", async (req) => {
  const fac = await facilitatorOf(req);
  const fresh = await refresh(fac.id);
  return reply(200, await billingObject(db, fac.id, !fresh));
});
route("POST", "/api/billing/plan", async (req) => {
  const fac = await facilitatorOf(req);
  const body = req.json && typeof req.json === "object" ? (req.json as Record<string, unknown>) : {};
  return once(req, actorKey(fac), async (t) => {
    const target = validatePlanRequest(body);
    const outcome = await changePlan(t, fac.id, target);
    return reply(200, { billing: await billingObject(t, fac.id, false), invoice: outcome.kind === "immediate" ? outcome.invoice : null });
  });
});
route("POST", "/api/billing/payments", async (req) => {
  const fac = await facilitatorOf(req);
  return once(req, actorKey(fac), async (t) => {
    await retryPayment(t, fac.id);
    return reply(200, { billing: await billingObject(t, fac.id, false) });
  });
});
route("GET", "/api/activity", async (req) => reply(200, await listActivity((await facilitatorOf(req)).id, req.query)));

route("GET", "/api/workshops", workshops.listWorkshops);
route("POST", "/api/workshops", workshops.createWorkshop);
route("GET", "/api/workshops/:id", workshops.getWorkshop);
route("POST", "/api/workshops/:id/transitions", workshops.transition);
route("POST", "/api/workshops/:id/join-link/rotate", workshops.rotateLink);
route("DELETE", "/api/workshops/:id/join-link", workshops.turnOffLink);
route("POST", "/api/workshops/:id/invites", workshops.sendInvites);
route("GET", "/api/workshops/:id/trash", workshops.trashList);
route("GET", "/api/workshops/:id/versions", workshops.versionList);
route("POST", "/api/workshops/:id/versions/:versionId/restore", workshops.versionRestore);
route("GET", "/api/workshops/:id/recap", workshops.recapStatus);

route("GET", "/api/join/:token", sessions.joinInfo);
route("POST", "/api/join/:token", sessions.join);

route("GET", "/api/workshops/:id/board", board.getBoard);
streamRoute("/api/workshops/:id/stream", openStream);
route("POST", "/api/workshops/:id/presence", board.presence);
route("GET", "/api/workshops/:id/search", board.search);
route("POST", "/api/workshops/:id/frames", board.createFrame);
route("PATCH", "/api/frames/:id", board.patchFrame);
route("POST", "/api/frames/:id/trash", board.trash);
route("POST", "/api/trash/:id/restore", board.restore);
route("POST", "/api/workshops/:id/images", board.uploadImage, "image");
route("POST", "/api/workshops/:id/notes", board.createNote);
route("PATCH", "/api/notes/:id", board.patchNote);
route("DELETE", "/api/notes/:id", board.deleteNote);
route("GET", "/api/notes/:id/image", board.getImage);
route("POST", "/api/workshops/:id/clusters", board.createCluster);
route("PATCH", "/api/clusters/:id", board.patchCluster);
route("DELETE", "/api/clusters/:id", board.deleteCluster);
route("POST", "/api/workshops/:id/connectors", board.createConnector);
route("DELETE", "/api/connectors/:id", board.deleteConnector);
route("POST", "/api/clusters/:id/dots", board.spend);
route("POST", "/api/clusters/:id/dots/return", board.giveBack);

route("GET", "/api/recaps/:token", publicRecap);
route("GET", "/api/recaps/:token/files/:name", recapFile);

await migrate();
await seed();
await startHealth();
startLive();
createServer().listen(config.port, "0.0.0.0", () => console.log(`Lanternfold Rooms (${config.instanceId}) on :${config.port}`));
startWorker();
process.on("unhandledRejection", (error) => console.error("unhandled", error));
void (async () => {
  await ensureCatalog();
  await refreshAll();
  await tick();
})().catch((error: unknown) => console.error(`boot billing: ${(error as Error).message}`));
