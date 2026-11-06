import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Standings } from "../shared/api.js";
import { boundary } from "./boundary.js";
import type { AppEnv } from "./env.js";
import {
  type Auth,
  type ClubAuth,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  authFromToken,
  createSession,
  destroySession,
  memberOf,
  requireRole,
  sessionUser,
} from "./auth.js";
import { onboardClub, listClubs, signIn, signUp, signedInUser } from "./domain/accounts.js";
import { type Seated, assign, claim, loadRota, release } from "./domain/rota.js";
import { type EventRow, createEvent, eventView, eventViews, findEvent, patchEvent, reportedStatus, setRunningHeat, transitionEvent } from "./domain/events.js";
import { loadTable, loadTables } from "./domain/indexTables.js";
import { publication, publish, resultsFile } from "./domain/publish.js";
import { decideProtest, fileProtest, listProtests } from "./domain/protests.js";
import { checkIn, listRegistrations, register, waiverPdf, withdraw } from "./domain/registrations.js";
import { commitRun, resolveCommit, correctRun, listCorrections, listRunEntries } from "./domain/runs.js";
import { season, seasonCsv } from "./domain/season.js";
import { loadEntries, orderForView, rankEntries, standingRow } from "./domain/standings.js";
import { one, pool, rows } from "./db.js";
import { ApiError, errorResponse, validationError } from "./errors.js";
import { idempotently } from "./idempotency.js";
import { serveClient } from "./static.js";
import { parse, parseId } from "./validate.js";

export const app = new Hono<AppEnv>();

app.onError(errorResponse);

const PUBLIC = [
  (method: string, path: string): boolean => method === "GET" && path === "/api/health",
  (method: string, path: string): boolean => method === "POST" && path === "/api/session",
  (method: string, path: string): boolean => method === "POST" && /^\/api\/clubs\/[^/]+\/signup$/.test(path),
];

app.use("/api/*", boundary);
app.use("/api/*", async (c, next) => {
  if (!PUBLIC.some((isPublic) => isPublic(c.req.method, c.req.path))) {
    const token = getCookie(c, SESSION_COOKIE);
    const auth = token === undefined ? null : await authFromToken(token);
    if (!auth) throw new ApiError("unauthenticated");
    c.set("auth", auth);
  }
  await next();
});

const member = (c: Context<AppEnv>): ClubAuth => memberOf(c.get("auth"));

function startSession(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE_SECONDS });
}

// Health and sessions

app.get("/api/health", async (c) => {
  await pool.query("select 1");
  return c.json({ status: "ok" });
});

app.post("/api/session", async (c) => {
  const userId = await signIn(c.get("body"));
  startSession(c, await createSession(userId));
  return c.json({ user: await signedInUser(userId) });
});

app.get("/api/session", (c) => c.json({ user: sessionUser(c.get("auth")) }));

app.delete("/api/session", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token !== undefined) await destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

app.post("/api/clubs/:slug/signup", async (c) => {
  const userId = await signUp(c.req.param("slug"), c.get("body"));
  startSession(c, await createSession(userId));
  return c.json({ user: await signedInUser(userId) }, 201);
});

// Operator

function requireOperator(auth: Auth): void {
  if (!auth.roles.includes("operator")) throw new ApiError("forbidden");
}

app.get("/api/operator/clubs", async (c) => {
  requireOperator(c.get("auth"));
  return c.json({ clubs: await listClubs() });
});

app.post("/api/operator/clubs", async (c) => {
  requireOperator(c.get("auth"));
  const created = await onboardClub(c.get("body"));
  return c.json({ club: created.club, chair: { user: await signedInUser(created.chairId) } }, 201);
});

// Index tables

app.get("/api/index-tables", async (c) => c.json({ tables: await loadTables(pool, member(c).club.id) }));

app.post("/api/index-tables", async (c) => {
  const auth = member(c);
  requireRole(auth, "chair");
  return c.json({ table: await loadTable(auth, c.get("body")) }, 201);
});

// Events

app.get("/api/events", async (c) => {
  const auth = member(c);
  const found = await rows<EventRow>(pool, "select * from events where club_id = $1 order by date, id", [auth.club.id]);
  return c.json({ events: await eventViews(pool, auth.club, found, new Date()) });
});

app.post("/api/events", async (c) => c.json({ event: await createEvent(member(c), c.get("body")) }, 201));

app.get("/api/events/:id", async (c) => {
  const auth = member(c);
  const event = await findEvent(pool, auth.club.id, parseId(c.req.param("id")));
  return c.json({ event: await eventView(pool, auth.club, event) });
});

app.patch("/api/events/:id", async (c) =>
  c.json({ event: await patchEvent(member(c), parseId(c.req.param("id")), c.get("body")) }),
);

app.post("/api/events/:id/transition", async (c) =>
  c.json({ event: await transitionEvent(member(c), parseId(c.req.param("id")), c.get("body")) }),
);

app.post("/api/events/:id/running-heat", async (c) =>
  c.json({ event: await setRunningHeat(member(c), parseId(c.req.param("id")), c.get("body")) }),
);

// Registrations and check-in

app.get("/api/events/:id/registrations", async (c) => {
  const auth = member(c);
  const event = await findEvent(pool, auth.club.id, parseId(c.req.param("id")));
  return c.json({ registrations: await listRegistrations(pool, event.id) });
});

app.post("/api/events/:id/registrations", async (c) => {
  const auth = member(c);
  const eventId = parseId(c.req.param("id"));
  await findEvent(pool, auth.club.id, eventId);
  return idempotently(c, auth.userId, async () => ({
    status: 201,
    body: { registration: await register(auth, eventId, c.get("body")) },
  }));
});

app.delete("/api/registrations/:id", async (c) => {
  await withdraw(member(c), parseId(c.req.param("id")));
  return c.body(null, 204);
});

app.post("/api/registrations/:id/check-in", async (c) =>
  c.json({ registration: await checkIn(member(c), parseId(c.req.param("id")), c.get("body")) }, 201),
);

app.get("/api/registrations/:id/waiver.pdf", async (c) => {
  const pdf = await waiverPdf(member(c), parseId(c.req.param("id")));
  return c.body(new Uint8Array(pdf), 200, { "Content-Type": "application/pdf" });
});

// Rota

app.get("/api/events/:id/rota", async (c) => {
  const auth = member(c);
  const event = await findEvent(pool, auth.club.id, parseId(c.req.param("id")));
  return c.json({ heats: await loadRota(pool, event.id) });
});

function seated({ station, registration, assignmentEmail }: Seated): unknown {
  return { station: { id: station.id, name: station.name, heat: station.heat }, registration, assignmentEmail };
}

app.post("/api/stations/:id/claim", async (c) => c.json(seated(await claim(member(c), parseId(c.req.param("id")))), 201));

app.post("/api/stations/:id/assign", async (c) =>
  c.json(seated(await assign(member(c), parseId(c.req.param("id")), c.get("body"))), 201),
);

app.delete("/api/stations/:id/claim", async (c) => {
  await release(member(c), parseId(c.req.param("id")));
  return c.body(null, 204);
});

// Runs, corrections and standings

app.get("/api/events/:id/runs", async (c) =>
  c.json({ entries: await listRunEntries(member(c), parseId(c.req.param("id")), c.req.query("heat")) }),
);

app.post("/api/registrations/:id/runs/:runNumber", async (c) => {
  const auth = member(c);
  const target = await resolveCommit(auth, parseId(c.req.param("id")), c.req.param("runNumber"));
  return idempotently(c, auth.userId, async () => ({ status: 201, body: await commitRun(auth, target, c.get("body")) }));
});

app.post("/api/runs/:id/corrections", async (c) =>
  c.json(await correctRun(member(c), parseId(c.req.param("id")), c.get("body")), 201),
);

app.get("/api/events/:id/corrections", async (c) =>
  c.json({ corrections: await listCorrections(member(c), parseId(c.req.param("id")), c.req.query("registrationId")) }),
);

app.on(["PUT", "PATCH", "DELETE"], "/api/corrections/:id", async (c) => {
  const auth = member(c);
  const found = await one(
    pool,
    `select 1 from corrections c join runs ru on ru.id = c.run_id join registrations r on r.id = ru.registration_id
       join events e on e.id = r.event_id where c.id = $1 and e.club_id = $2`,
    [parseId(c.req.param("id")), auth.club.id],
  );
  if (!found) throw new ApiError("not_found");
  throw new ApiError("audit_immutable");
});

const standingsQuery = z.object({ view: z.enum(["indexed", "class", "raw"], { error: "Choose indexed, class or raw." }) });

app.get("/api/events/:id/standings", async (c) => {
  const auth = member(c);
  const event = await findEvent(pool, auth.club.id, parseId(c.req.param("id")));
  const { view } = parse(standingsQuery, { view: c.req.query("view") ?? "indexed" });
  const classCode = c.req.query("class") ?? null;
  if (classCode !== null && !(await one(pool, "select 1 from event_classes where event_id = $1 and class_code = $2", [event.id, classCode]))) {
    throw validationError({ class: "Choose a class this event runs." });
  }
  const ranked = rankEntries(await loadEntries(pool, event.id));
  const body: Standings = {
    eventId: event.id,
    status: reportedStatus(event, new Date()),
    runningHeat: event.running_heat,
    view,
    updatedAt: new Date().toISOString(),
    rows: orderForView(ranked, view, classCode).map(standingRow),
  };
  return c.json(body);
});

// Protests

app.get("/api/events/:id/protests", async (c) => c.json({ protests: await listProtests(member(c), parseId(c.req.param("id"))) }));

app.post("/api/events/:id/protests", async (c) =>
  c.json({ protest: await fileProtest(member(c), parseId(c.req.param("id")), c.get("body")) }, 201),
);

app.post("/api/protests/:id/decision", async (c) =>
  c.json({ protest: await decideProtest(member(c), parseId(c.req.param("id")), c.get("body")) }),
);

// Publishing

app.get("/api/events/:id/publication", async (c) => c.json(await publication(member(c), parseId(c.req.param("id")))));

app.post("/api/events/:id/publish", async (c) => {
  const auth = member(c);
  const eventId = parseId(c.req.param("id"));
  await findEvent(pool, auth.club.id, eventId);
  requireRole(auth, "chair");
  return idempotently(c, auth.userId, async () => ({ status: 200, body: await publish(auth, eventId) }));
});

app.get("/api/events/:id/results.pdf", async (c) => {
  const pdf = await resultsFile(member(c), parseId(c.req.param("id")));
  return c.body(new Uint8Array(pdf), 200, { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="final-results.pdf"' });
});

// Season

app.get("/api/season", async (c) => c.json(await season(member(c), c.req.query("year"))));

app.get("/api/season.csv", async (c) => {
  const { year, text } = await seasonCsv(member(c), c.req.query("year"));
  return c.body(text, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="season-standings-${year}.csv"`,
  });
});

app.all("/api/*", () => {
  throw new ApiError("not_found");
});

app.notFound(async (c) => {
  const served = c.req.method === "GET" ? await serveClient(c) : null;
  return served ?? errorResponse(new ApiError("not_found"), c);
});
