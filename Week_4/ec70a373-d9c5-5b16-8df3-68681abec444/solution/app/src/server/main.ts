// Pilotlight server: the API and the built frontend from one origin.
import { createServer } from "node:http";
import { config } from "./config.ts";
import { connectWithRetry, isReady } from "./db.ts";
import { malformedRequestBytes } from "./http.ts";
import { dispatch, json, route, type Reply } from "./router.ts";
import { listAudit } from "./audit.ts";
import { startWorkers } from "./workers.ts";
import { ledger, listPacks, me, searchMembers, signIn, signOut } from "./account.ts";
import { availability, listSites } from "./sites.ts";
import {
  bookSeries,
  cancelBooking,
  checkIn,
  confirmHold,
  getBooking,
  listOwnBookings,
  listSiteBookings,
  markNoShow,
  placeHold,
} from "./bookings.ts";
import { checkOut } from "./checkout.ts";
import { buyPack } from "./purchases.ts";
import { documentFile, getDocument, listDocuments, reviewDocument, uploadDocument } from "./documents.ts";
import { listVisits, recordArrival, recordDeparture } from "./visits.ts";
import { inspectPdf, inspectView, issueLink, listLinks, reissueLink, revokeLink } from "./inspector.ts";
import { listRates, scheduleRate } from "./rates.ts";
import { utilisation, utilisationCsv } from "./reports.ts";

route("GET", "/api/health", "public", health);
route("POST", "/api/session", "public", signIn);
route("DELETE", "/api/session", "public", signOut);
route("GET", "/api/me", "signed_in", me);
route("GET", "/api/sites", ["member", "kitchen_manager", "finance_lead"], listSites);
route("GET", "/api/sites/{site_id}/availability", ["member", "kitchen_manager"], availability);
route("POST", "/api/bookings", ["member"], placeHold);
route("POST", "/api/bookings/{id}/confirm", ["member"], confirmHold);
route("POST", "/api/bookings/{id}/cancel", ["member", "kitchen_manager"], cancelBooking);
route("GET", "/api/bookings", ["member"], listOwnBookings);
route("GET", "/api/bookings/{id}", ["member", "kitchen_manager"], getBooking);
route("GET", "/api/sites/{site_id}/bookings", ["kitchen_manager", "finance_lead"], listSiteBookings);
route("POST", "/api/recurring-series", ["member"], bookSeries);
route("POST", "/api/bookings/{id}/check-in", ["kitchen_manager"], checkIn);
route("POST", "/api/bookings/{id}/no-show", ["kitchen_manager"], markNoShow);
route("POST", "/api/bookings/{id}/check-out", ["kitchen_manager"], checkOut);
route("GET", "/api/packs", ["member", "finance_lead"], listPacks);
route("POST", "/api/pack-purchases", ["member"], buyPack);
route("GET", "/api/me/ledger", ["member"], ledger);
route("POST", "/api/documents", ["member"], uploadDocument);
route("GET", "/api/documents", ["member", "kitchen_manager"], listDocuments);
route("GET", "/api/documents/{id}", ["member", "kitchen_manager"], getDocument);
route("GET", "/api/documents/{id}/file", ["member", "kitchen_manager"], documentFile);
route("POST", "/api/documents/{id}/verify", ["kitchen_manager"], (ctx) => reviewDocument(ctx, "verified"));
route("POST", "/api/documents/{id}/reject", ["kitchen_manager"], (ctx) => reviewDocument(ctx, "rejected"));
route("GET", "/api/members", ["kitchen_manager", "finance_lead"], searchMembers);
route("GET", "/api/trucks/{truck_id}/visits", ["member", "kitchen_manager"], listVisits);
route("POST", "/api/trucks/{truck_id}/visits", ["kitchen_manager"], recordArrival);
route("POST", "/api/visits/{id}/depart", ["kitchen_manager"], recordDeparture);
route("GET", "/api/trucks/{truck_id}/inspector-links", ["kitchen_manager"], listLinks);
route("POST", "/api/trucks/{truck_id}/inspector-links", ["kitchen_manager"], issueLink);
route("POST", "/api/inspector-links/{id}/revoke", ["kitchen_manager"], revokeLink);
route("POST", "/api/inspector-links/{id}/reissue", ["kitchen_manager"], reissueLink);
route("GET", "/api/inspect/{token}", "public", inspectView);
route("GET", "/api/inspect/{token}/log.pdf", "public", inspectPdf);
route("GET", "/api/sites/{site_id}/rates", ["finance_lead"], listRates);
route("POST", "/api/sites/{site_id}/rates", ["finance_lead"], scheduleRate);
route("GET", "/api/reports/utilisation", ["finance_lead"], utilisation);
route("GET", "/api/reports/utilisation.csv", ["finance_lead"], utilisationCsv);
route("GET", "/api/audit", ["kitchen_manager", "finance_lead"], listAudit);

/** Health writes its own 503 body, the brief's one exception to the error shape. */
async function health(): Promise<Reply> {
  return (await isReady()) ? json(200, { status: "ok" }) : json(503, { status: "starting" });
}

const server = createServer((req, res) => void dispatch(req, res));
server.on("clientError", (_error, socket) => socket.end(malformedRequestBytes()));

server.listen(config.port, "0.0.0.0", () => console.log(`Pilotlight listening on 0.0.0.0:${config.port}`));
void connectWithRetry().then(startWorkers);

