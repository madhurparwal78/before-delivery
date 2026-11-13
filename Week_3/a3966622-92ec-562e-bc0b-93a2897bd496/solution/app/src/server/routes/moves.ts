// Move routes: orders, plans, windows, commit, assignment, amendment, cancellation and status actions.
import { isPortDate } from "../../shared/portTime.js";
import type { Move } from "../../shared/types.js";
import { mayReadMove, readableMove, readableVessel, requireCrew, requireRole } from "../access.js";
import type { App } from "../app.js";
import { inBoardingOrder } from "../domain/exportCsv.js";
import {
  amendMove,
  assignPilot,
  cancelMove,
  commitWindow,
  detention,
  nextEligible,
  placeOrder,
  reorderMove,
  transition,
  turnOf,
} from "../domain/moves.js";
import { boardingInstant } from "../domain/moveClock.js";
import { CURRENT_ASSIGNMENT } from "../domain/moveRules.js";
import { openWindows, planFor, subjectOf } from "../domain/plan.js";
import { ApiError, invalid, notFound } from "../errors.js";
import { created, ok, type Router, type SignedIn } from "../http.js";
import { keyed } from "../idempotency.js";
import type { MoveRecord, UserRecord } from "../store.js";
import { Fields, objectBody, orderValues } from "../validate.js";
import { moveView } from "../views.js";

export function moveRoutes(router: Router, app: App): void {
  const { store } = app;
  const view = (user: UserRecord, move: MoveRecord, now = Date.now()): Move => moveView(store, user, move, now);

  /** If-Match carries the version the user planned against: missing answers 428, older answers 412. */
  const checkVersion = (request: SignedIn, move: MoveRecord): void => {
    const header = request.raw.headers["if-match"];
    if (!header) throw new ApiError(428, "version_required", "Send If-Match with the move version you planned against");
    const version = Number(header.replace(/^W\//, "").replaceAll('"', "").trim());
    if (version !== move.version) {
      throw new ApiError(412, "stale_version", "Another user changed this move", { current: view(request.user, move) });
    }
  };

  const vesselInBody = (request: SignedIn): void => {
    const id = objectBody(request.body).vessel_id;
    if (typeof id === "string") readableVessel(store, request.user, id);
  };

  router.add("GET", "/api/moves", ({ user, url }) => {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = url.searchParams.get("status");
    const now = Date.now();
    const moves = (status ? store.moves.by("status", status) : store.moves.all())
      .filter((m) => mayReadMove(user, m))
      .filter((m) => !q || [m.ref, m.vessel.name, m.status].some((text) => text.toLowerCase().includes(q)))
      .sort(inBoardingOrder);
    return ok({ moves: moves.map((m) => view(user, m, now)) });
  });

  router.add("POST", "/api/plan", (request) => {
    const body = objectBody(request.body);
    vesselInBody(request);
    requireRole(request.user, "agent", "dispatcher");
    const fields = new Fields(body);
    const vessel = typeof body.vessel_id === "string" ? store.vessels.get(body.vessel_id) : null;
    if (!vessel) fields.fail("vessel_id", "Choose a vessel");
    const boarding = fields.boarding("boarding_at", null);
    const values = vessel ? orderValues(fields, vessel) : undefined;
    if (fields.failed() || !boarding || !values) throw invalid(fields.errors);
    return ok(planFor(store, values, boarding.instant));
  });

  router.add("POST", "/api/moves", (request) => {
    vesselInBody(request);
    requireRole(request.user, "agent");
    return keyed(store, request, () => {
      const id = objectBody(request.body).vessel_id;
      const vessel = typeof id === "string" ? store.vessels.get(id) : null;
      const move = placeOrder(app, request.user, vessel, request.body, Date.now());
      return created(view(request.user, move));
    });
  });

  router.add("GET", "/api/moves/:ref", ({ user, params }) => {
    const move = readableMove(store, user, params.ref ?? "");
    return ok(view(user, move), { ETag: `"${move.version}"` });
  });

  router.add("PATCH", "/api/moves/:ref", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    vesselInBody(request);
    requireRole(request.user, "agent", "dispatcher");
    checkVersion(request, move);
    const result = amendMove(app, request.user, move, request.body, Date.now());
    return ok({ ...view(request.user, result.move), window_returned: result.window_returned, late_notice: result.late_notice });
  });

  router.add("POST", "/api/moves/:ref/cancel", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    requireRole(request.user, "agent", "dispatcher");
    return keyed(store, request, () => {
      const current = store.moves.get(move.ref) ?? move;
      return ok(view(request.user, cancelMove(app, request.user, current, Date.now())));
    });
  });

  router.add("POST", "/api/moves/:ref/reorder", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    requireRole(request.user, "agent");
    return ok(view(request.user, reorderMove(app, request.user, move, request.body, Date.now())));
  });

  router.add("GET", "/api/moves/:ref/plan", ({ user, params, url }) => {
    const move = readableMove(store, user, params.ref ?? "");
    requireRole(user, "agent", "dispatcher", "pilot");
    const asked = url.searchParams.get("boarding_at");
    if (asked === null) return ok(planFor(store, subjectOf(move), boardingInstant(move)));
    const fields = new Fields({ boarding_at: asked });
    const boarding = fields.boarding("boarding_at", null);
    if (fields.failed() || !boarding) throw invalid(fields.errors);
    return ok(planFor(store, subjectOf(move), boarding.instant));
  });

  router.add("GET", "/api/moves/:ref/windows", ({ user, params, url }) => {
    const move = readableMove(store, user, params.ref ?? "");
    requireRole(user, "agent", "dispatcher", "pilot");
    const date = url.searchParams.get("date") ?? "";
    if (!isPortDate(date)) throw invalid({ date: "Give the date as YYYY-MM-DD" });
    return ok({ date, tide_version: store.tideVersion(), windows: openWindows(store, subjectOf(move), date) });
  });

  router.add("POST", "/api/moves/:ref/commit", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    requireRole(request.user, "dispatcher");
    checkVersion(request, move);
    return ok(view(request.user, commitWindow(app, request.user, move, request.body, Date.now())));
  });

  router.add("GET", "/api/moves/:ref/eligibility", ({ user, params }) => {
    const move = readableMove(store, user, params.ref ?? "");
    requireRole(user, "dispatcher");
    const turn = turnOf(store, move);
    return ok({ boarding_at: move.boarding_at, next_eligible: nextEligible(turn)?.pilot_id ?? null, turn });
  });

  router.add("POST", "/api/moves/:ref/assignment", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    const pilotId = objectBody(request.body).pilot_id;
    if (typeof pilotId === "string" && !store.pilots.get(pilotId)) throw notFound();
    requireRole(request.user, "dispatcher");
    return keyed(store, request, () => {
      const current = store.moves.get(move.ref) ?? move;
      checkVersion(request, current);
      if (typeof pilotId !== "string") throw invalid({ pilot_id: "Choose a pilot" });
      return ok(view(request.user, assignPilot(app, request.user, current, request.body, Date.now())));
    });
  });

  router.add("POST", "/api/moves/:ref/transitions", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    requireCrew(request.user, move);
    return keyed(store, request, () => {
      const current = store.moves.get(move.ref) ?? move;
      return ok(view(request.user, transition(app, request.user, current, request.body, Date.now())));
    });
  });

  router.add("POST", "/api/moves/:ref/detention", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    requireCrew(request.user, move);
    return keyed(store, request, () => {
      const current = store.moves.get(move.ref) ?? move;
      return ok(view(request.user, detention(app, request.user, current, request.body, Date.now())));
    });
  });

  router.add("GET", "/api/me/next-job", ({ user }) => {
    requireRole(user, "pilot");
    const next = store.moves
      .all()
      .filter((m) => m.pilot_id === user.id && CURRENT_ASSIGNMENT.includes(m.status))
      .sort(inBoardingOrder)[0];
    return ok({ move: next ? view(user, next) : null, plan: next ? planFor(store, subjectOf(next), boardingInstant(next)) : null });
  });
}
