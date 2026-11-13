// Install crew (brief: API › Crew): crew leads see and act on only the days they are assigned to.
import { crewAlertTitle } from "../alerts.js";
import { requireCaller, type Caller } from "../auth.js";
import { installDayView, loadCommission, userById, type InstallDay } from "../commissions.js";
import { one, pool, query, type Db } from "../db.js";
import { fail, jsonBody, ok, record, UUID, type Request, type Router } from "../http.js";
import { displayName, userHasRole, usersWithRole } from "../keycloak.js";

async function roster(req: Request) {
  const caller = await requireCaller(req);
  if (!caller.roles.includes("producer")) fail(403, "forbidden");
  const crew = await usersWithRole("crew");
  return ok({ crew: crew.map((u) => ({ id: u.id, name: displayName(u), email: u.email ?? u.username })) });
}

async function dayFor(db: Db, caller: Caller, id: string): Promise<InstallDay> {
  if (!UUID.test(id)) fail(404, "not_found");
  const row = await one<{ id: string; commission_id: string; venue_id: string; date: string }>(
    "SELECT id, commission_id, venue_id, date FROM install_days WHERE id = $1 AND released_at IS NULL", [id], db,
  );
  if (!row) fail(404, "not_found");
  const crew = (await query<{ crew_user_id: string }>("SELECT crew_user_id FROM install_day_crew WHERE install_day_id = $1", [id], db)).map((x) => x.crew_user_id);
  const day = { id: row.id, commissionId: row.commission_id, venueId: row.venue_id, date: row.date, crewUserIds: crew };
  if (caller.roles.includes("producer") || crew.includes(caller.id)) return day;
  return fail(404, "not_found");
}

async function daySheet(db: Db, day: InstallDay): Promise<Record<string, unknown>> {
  const c = (await loadCommission(db, day.commissionId)) ?? fail(404, "not_found");
  const client = await userById(db, c.clientId);
  const alerts = await query<{ payload: { title: string; alertKind: string }; run_at: Date; status: string }>(
    "SELECT payload, run_at, status FROM jobs WHERE kind = 'crew_alert' AND payload->>'installDayId' = $1 ORDER BY run_at", [day.id], db,
  );
  const listed = alerts.map((a) => ({ kind: a.payload.alertKind, title: a.payload.title, sendAt: a.run_at.toISOString(), status: a.status === "done" ? "sent" : "scheduled" }));
  const loadIn = await one<{ load_in_at: Date }>("SELECT load_in_at FROM install_days WHERE id = $1 AND load_in_queued_at IS NULL", [day.id], db);
  if (loadIn) listed.push({ kind: "load_in", title: crewAlertTitle("load_in", c, day.date), sendAt: loadIn.load_in_at.toISOString(), status: "scheduled" });
  return {
    ...installDayView(day, c.venue.timeZone), commissionId: c.id, commissionTitle: c.title, commissionState: c.state, clientName: client.name,
    venue: c.venue, layout: { version: c.layoutVersion, items: c.layout },
    alerts: listed,
  };
}

async function list(req: Request) {
  const caller = await requireCaller(req);
  const producer = caller.roles.includes("producer");
  const rows = await query<{ id: string }>(
    `SELECT d.id FROM install_days d WHERE d.released_at IS NULL
       AND ($1 OR EXISTS (SELECT 1 FROM install_day_crew x WHERE x.install_day_id = d.id AND x.crew_user_id = $2))
     ORDER BY d.date`,
    [producer, caller.id],
  );
  const days = [];
  for (const row of rows) days.push(await daySheet(pool, await dayFor(pool, caller, row.id)));
  return ok({ installDays: days });
}

async function read(req: Request) {
  const caller = await requireCaller(req);
  return ok(await daySheet(pool, await dayFor(pool, caller, req.params.id)));
}

async function assign(req: Request) {
  const caller = await requireCaller(req);
  const day = await dayFor(pool, caller, req.params.id);
  if (!caller.roles.includes("producer")) fail(403, "forbidden");
  const crewUserId = String(record(jsonBody(req)).crewUserId ?? "");
  const member = UUID.test(crewUserId) ? await userHasRole(crewUserId, "crew") : null;
  if (!member) fail(404, "not_found");
  await query(
    "INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [member.id, member.email ?? member.username, displayName(member)],
  );
  await query("INSERT INTO install_day_crew (install_day_id, crew_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [day.id, member.id]);
  return ok(await daySheet(pool, await dayFor(pool, caller, day.id)));
}

export function registerCrew(router: Router): void {
  router.add("GET", "/api/crew", roster);
  router.add("GET", "/api/install-days", list);
  router.add("GET", "/api/install-days/:id", read);
  router.add("POST", "/api/install-days/:id/crew", assign);
}
