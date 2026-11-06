// The API's endpoints. Each line names its method, path, roles and handler; the pipeline applies
// the error precedence before any handler runs.

import { pool, one } from "./db.js";
import { fail, invalid } from "./http/errors.js";
import { type Reply, publicRoute, signedInRoute } from "./http/pipeline.js";
import { type Caller, callerByUserId, endSession, startSession, userView } from "./http/session.js";
import { verifyPassword } from "./passwords.js";
import { StorageUnavailable, signedLink } from "./services/storage.js";
import {
  cancelBooking,
  checkIn,
  checkOut,
  confirmHold,
  createBookings,
  getBooking,
  listBookings,
  releaseHold,
  usageSheet,
} from "./domain/bookings.js";
import { createLink, listLinks, regenerateLink, revokeLink, shareView, sharedDocumentKey } from "./domain/complianceLinks.js";
import { documentById, documentView, documentsOf, uploadDocument } from "./domain/documents.js";
import { ledgerOf } from "./domain/ledger.js";
import { blockStation, deleteBlock } from "./domain/maintenance.js";
import { listNotifications } from "./domain/outbox.js";
import { listPacks, purchasePack } from "./domain/purchases.js";
import { apply, listRenters, recordAdjustment, reviewDocument, transitionRenter } from "./domain/renters.js";
import { endShelf, renterView, startShelf } from "./domain/shelf.js";
import { createStatement, listStatements, statementRow } from "./domain/statements.js";
import { saveSettings, stationsForDay } from "./domain/stations.js";

const EVERYONE = ["operator", "shift_lead", "renter"] as const;
const STAFF = ["operator", "shift_lead"] as const;
const OPERATOR = ["operator"] as const;
const RENTER = ["renter"] as const;

const ok = (body: unknown, status = 200): Reply => ({ status, body });

function renterIdOf(caller: Caller): string {
  if (!caller.renterId) throw fail(403, "forbidden");
  return caller.renterId;
}

/** A 302 to a short-lived signed storage URL. */
async function signedRedirect(key: string): Promise<Reply> {
  try {
    return { status: 302, headers: { Location: await signedLink(key) } };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw fail(503, "storage_unavailable");
    throw error;
  }
}

export function registerRoutes(): void {
  publicRoute("GET", "/api/health", async () => ok({ status: "ok" }));

  publicRoute("POST", "/api/applications", async ({ body }) => {
    const application = await apply(body);
    return { status: application.status, body: application.body, headers: { "Set-Cookie": application.cookie } };
  });

  publicRoute("POST", "/api/session", async ({ body }) => {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) throw invalid({ ...(email ? {} : { email: "Enter your email." }), ...(password ? {} : { password: "Enter your password." }) });
    const user = await one<{ id: string; password_hash: string }>(pool, "SELECT id, password_hash FROM users WHERE email = $1", [email]);
    if (!(await verifyPassword(password, user?.password_hash ?? null)) || !user) throw fail(401, "invalid_credentials");
    const cookie = await startSession(pool, user.id);
    return { status: 200, body: { user: userView(await callerByUserId(pool, user.id)) }, headers: { "Set-Cookie": cookie } };
  });

  signedInRoute("DELETE", "/api/session", EVERYONE, async ({ req }) => ({ status: 204, headers: { "Set-Cookie": await endSession(pool, req) } }));
  signedInRoute("GET", "/api/me", EVERYONE, async ({ caller }) => ok({ user: userView(caller) }));

  signedInRoute("GET", "/api/renters", STAFF, async () => ok({ renters: await listRenters() }));
  signedInRoute("GET", "/api/renters/:renter_id", EVERYONE, async ({ param }) => ok({ renter: await renterView(param("renter_id")) }));
  signedInRoute("POST", "/api/renters/:renter_id/transitions", OPERATOR, async ({ param, body }) =>
    ok({ renter: await transitionRenter(param("renter_id"), body) }),
  );

  signedInRoute(
    "POST",
    "/api/renters/:renter_id/documents",
    RENTER,
    async ({ caller, form }) => ok({ document: await uploadDocument(renterIdOf(caller), form?.fields ?? {}, form?.files.file) }, 201),
    "multipart",
  );
  signedInRoute("GET", "/api/renters/:renter_id/documents", EVERYONE, async ({ param }) =>
    ok({ documents: (await documentsOf(pool, param("renter_id"))).map(documentView) }),
  );
  signedInRoute("GET", "/api/documents/:document_id", EVERYONE, async ({ param }) => ok({ document: documentView(await documentById(pool, param("document_id"))) }));
  signedInRoute("GET", "/api/documents/:document_id/file", EVERYONE, async ({ param }) =>
    signedRedirect((await documentById(pool, param("document_id"))).object_key),
  );
  signedInRoute("POST", "/api/documents/:document_id/review", OPERATOR, async ({ param, body }) => ok(await reviewDocument(param("document_id"), body)));

  signedInRoute("GET", "/api/packs", EVERYONE, async () => ok(await listPacks()));
  signedInRoute("POST", "/api/purchases", RENTER, async ({ caller, req, body }) => {
    const key = req.headers["idempotency-key"];
    return purchasePack(renterIdOf(caller), Array.isArray(key) ? key[0] : key, body);
  });

  signedInRoute("GET", "/api/renters/:renter_id/ledger", EVERYONE, async ({ param }) => ok(await ledgerOf(pool, param("renter_id"))));
  signedInRoute("POST", "/api/renters/:renter_id/adjustments", OPERATOR, async ({ param, body }) =>
    ok(await recordAdjustment(param("renter_id"), body), 201),
  );

  signedInRoute("GET", "/api/stations", EVERYONE, async ({ caller, query }) => ok(await stationsForDay(caller, query.get("date"))));
  signedInRoute("POST", "/api/stations/:station_id/settings", OPERATOR, async ({ param, body }) =>
    ok({ settings: await saveSettings(param("station_id"), body) }, 201),
  );
  signedInRoute("POST", "/api/stations/:station_id/maintenance", STAFF, async ({ param, body }) => ok(await blockStation(param("station_id"), body), 201));
  signedInRoute("DELETE", "/api/maintenance/:block_id", STAFF, async ({ param }) => {
    await deleteBlock(param("block_id"));
    return { status: 204 };
  });

  signedInRoute("POST", "/api/bookings", RENTER, async ({ caller, body }) => ok(await createBookings({ ...caller, renterId: renterIdOf(caller) }, body), 201));
  signedInRoute("GET", "/api/bookings", EVERYONE, async ({ caller, query }) => ok(await listBookings(caller, query)));
  signedInRoute("GET", "/api/bookings/:booking_id", EVERYONE, async ({ param }) => ok(await getBooking(param("booking_id"))));
  signedInRoute("POST", "/api/bookings/:booking_id/confirm", RENTER, async ({ param }) => ok(await confirmHold(param("booking_id"))));
  signedInRoute("POST", "/api/bookings/:booking_id/release", RENTER, async ({ param }) => ok(await releaseHold(param("booking_id"))));
  signedInRoute("POST", "/api/bookings/:booking_id/cancel", RENTER, async ({ param }) => ok(await cancelBooking(param("booking_id"))));
  signedInRoute("POST", "/api/bookings/:booking_id/check-in", STAFF, async ({ param, body }) => ok(await checkIn(param("booking_id"), body)));
  signedInRoute("POST", "/api/bookings/:booking_id/check-out", STAFF, async ({ param, body }) => ok(await checkOut(param("booking_id"), body)));
  signedInRoute("GET", "/api/usage-sheet", STAFF, async ({ query }) => ok(await usageSheet(query.get("date"))));

  signedInRoute("POST", "/api/renters/:renter_id/statements", ["renter", "operator"], async ({ param, body }) =>
    ok({ statement: await createStatement(param("renter_id"), body) }, 201),
  );
  signedInRoute("GET", "/api/renters/:renter_id/statements", EVERYONE, async ({ param }) => ok({ statements: await listStatements(param("renter_id")) }));
  signedInRoute("GET", "/api/statements/:statement_id/file", EVERYONE, async ({ param }) =>
    signedRedirect((await statementRow(pool, param("statement_id"))).object_key),
  );

  signedInRoute("POST", "/api/renters/:renter_id/shelf-subscription", OPERATOR, async ({ param, body }) =>
    ok({ subscription: await startShelf(param("renter_id"), body) }, 201),
  );
  signedInRoute("DELETE", "/api/renters/:renter_id/shelf-subscription", OPERATOR, async ({ param }) =>
    ok({ subscription: await endShelf(param("renter_id")) }),
  );

  signedInRoute("POST", "/api/compliance-links", OPERATOR, async ({ body }) => ok({ link: await createLink(body) }, 201));
  signedInRoute("GET", "/api/compliance-links", OPERATOR, async () => ok({ links: await listLinks() }));
  signedInRoute("POST", "/api/compliance-links/:link_id/revoke", OPERATOR, async ({ param }) => ok({ link: await revokeLink(param("link_id")) }));
  signedInRoute("POST", "/api/compliance-links/:link_id/regenerate", OPERATOR, async ({ param }) =>
    ok({ link: await regenerateLink(param("link_id")) }),
  );
  publicRoute("GET", "/api/share/:token", async ({ param }) => ok(await shareView(param("token"))));
  publicRoute("GET", "/api/share/:token/documents/:document_id", async ({ param }) =>
    signedRedirect(await sharedDocumentKey(param("token"), param("document_id"))),
  );

  signedInRoute("GET", "/api/notifications", OPERATOR, async () => ok({ notifications: await listNotifications() }));
}
