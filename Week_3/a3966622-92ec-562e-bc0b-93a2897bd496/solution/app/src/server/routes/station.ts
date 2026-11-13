// Station routes: health, port, service state, tide tables, vessels, pilots, skips and overrides.
import { isPortDate, PORT_ZONE, portDate, portStamp, STEP_MINUTES } from "../../shared/portTime.js";
import type { Pilot, Vessel } from "../../shared/types.js";
import { requireRole } from "../access.js";
import type { App } from "../app.js";
import { restUntil } from "../domain/eligibility.js";
import { publishTideRevision } from "../domain/revisions.js";
import { BERTH_NM, PORT_NAME, WAYPOINTS } from "../domain/route.js";
import { tideEventsOf } from "../domain/tide.js";
import { invalid, methodNotAllowed } from "../errors.js";
import { created, ok, type Router } from "../http.js";
import type { VesselRecord } from "../store.js";

export function stationRoutes(router: Router, app: App): void {
  const { store } = app;

  router.open("GET", "/api/health", () => ok({ status: "ok" }));

  router.open("GET", "/api/port", () =>
    ok({
      port: PORT_NAME,
      zone: PORT_ZONE,
      now: portStamp(Date.now()),
      store_date: portDate(store.createdAt()),
      tide_version: store.tideVersion(),
      step_minutes: STEP_MINUTES,
      berth_nm: BERTH_NM,
      waypoints: WAYPOINTS,
    }),
  );

  router.add("GET", "/api/services", () => ok(app.services.current()));

  router.add("GET", "/api/tide", ({ url }) => {
    const date = url.searchParams.get("date") ?? "";
    if (!isPortDate(date)) throw invalid({ date: "Give the date as YYYY-MM-DD" });
    return ok({ date, version: store.tideVersion(), events: tideEventsOf(store, date) });
  });

  router.add("POST", "/api/tide-revisions", ({ user, body }) => {
    requireRole(user, "dispatcher");
    return created(publishTideRevision(app, user, body, Date.now()));
  });

  const vesselView = (vessel: VesselRecord): Vessel => {
    const card = store.pilotCards.by("vessel_id", vessel.id).sort((a, b) => b.seq - a.seq)[0];
    return { ...vessel, pilot_card: card ? { card_id: card.id, sha256: card.sha256, size_bytes: card.size_bytes } : null };
  };

  router.add("GET", "/api/vessels", ({ user }) => {
    requireRole(user, "agent", "dispatcher", "pilot");
    const vessels = store.vessels.all().filter((v) => user.role !== "agent" || v.agency_code === user.agency_code);
    return ok({ vessels: vessels.map(vesselView) });
  });

  router.add("GET", "/api/pilots", ({ user }) => {
    requireRole(user, "dispatcher");
    const now = Date.now();
    const pilots: Pilot[] = store.pilots
      .all()
      .sort((a, b) => a.position - b.position)
      .map((pilot) => {
        const duties = store.duties.by("pilot_id", pilot.id);
        const until = restUntil(duties, now);
        return {
          id: pilot.id,
          name: pilot.name,
          licence_class: pilot.licence_class,
          position: pilot.position,
          on_duty: duties.some((d) => d.start <= now && now < d.end),
          rest_until: until !== null && until > now ? portStamp(until) : null,
        };
      });
    return ok({ pilots });
  });

  router.add("GET", "/api/skips", ({ user }) => {
    requireRole(user, "dispatcher");
    return ok({ skips: store.skips.all().map(({ pilot_id, reasons, move_ref, at }) => ({ pilot_id, reasons, move_ref, at })) });
  });

  router.add("GET", "/api/overrides", ({ user }) => {
    requireRole(user, "dispatcher");
    return ok({ overrides: store.overrides.all().map(({ id, move_ref, pilot_id, reason, by, at }) => ({ id, move_ref, pilot_id, reason, by, at })) });
  });

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    router.add(method, "/api/overrides/:id", () => {
      throw methodNotAllowed("Rest overrides are attributed and immutable");
    });
  }
}
