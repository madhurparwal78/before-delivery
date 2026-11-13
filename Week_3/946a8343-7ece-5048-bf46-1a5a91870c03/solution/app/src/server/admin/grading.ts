// Grading routes (registered only when SPUR_GRADING=1): seed, session, clock, commit, runner, storage and the webhook sink.
import { iso, now, setGradingClock } from "../clock.ts";
import { config, LIMITS } from "../config.ts";
import { db, withTx } from "../db.ts";
import { findProject, projectAccess, type UserRow } from "../access.ts";
import { publicUser, sessionCookie, startSession } from "../auth.ts";
import { runDue } from "../deadlines.ts";
import { FieldErrors, notFound, validation, validationOne } from "../errors.ts";
import { forgetStorageProbe, json, type Ctx, type JsonReply, type Router } from "../http.ts";
import { broadcastInstance } from "../live.ts";
import { commitToBranch, readCommitRequest } from "../repo/index.ts";
import { runRounds, settle } from "../ci/index.ts";
import { storage } from "../s3.ts";
import { bodyOf, flag, text, whole } from "./input.ts";
import { runSeed } from "./seed.ts";
import { parseSeed } from "./seed-parse.ts";

async function userNamed(username: string | undefined, field: string): Promise<UserRow> {
  const user = username === undefined ? undefined : await db.maybe<UserRow>("SELECT id, username, time_zone FROM users WHERE username = $1", [username]);
  if (user === undefined) throw validationOne(field, `Unknown user ${username ?? ""}.`);
  return user;
}

async function changeClock(ctx: Ctx): Promise<JsonReply> {
  const body = bodyOf(ctx.body);
  const set = whole(body, "set_ms");
  const advance = whole(body, "advance_ms");
  if (set === undefined && advance === undefined) throw validationOne("set_ms", "Send set_ms or advance_ms.");
  if (advance !== undefined && advance < 0) throw validationOne("advance_ms", "advance_ms can't be negative.");
  setGradingClock(set ?? now() + (advance ?? 0));
  await runDue();
  return json(200, { now_ms: now(), now: iso(now()) });
}

async function gradingCommit(ctx: Ctx): Promise<JsonReply> {
  const body = bodyOf(ctx.body);
  const errors = new FieldErrors();
  const projectId = whole(body, "project");
  const timestamp = whole(body, "timestamp");
  if (timestamp === undefined || timestamp < 0) errors.add("timestamp", "Timestamp must be unix seconds.");
  errors.throwIfAny();
  const actor = await userNamed(text(body, "as"), "as");
  const request = readCommitRequest(body);
  return withTx(async (tx) => {
    const project = projectId === undefined ? undefined : await findProject(tx, projectId);
    if (project === undefined) throw notFound();
    const access = await projectAccess(tx, actor.id, project);
    if (!access.canRead) throw notFound();
    const result = await commitToBranch(tx, {
      project,
      access,
      actor: { id: actor.id, username: actor.username },
      branch: request.branch,
      startRef: request.startRef,
      baseCommit: request.baseCommit,
      message: request.message,
      actions: request.actions,
      source: "api",
      authoredAt: timestamp ?? 0,
      invalid: request.invalid,
    });
    return json(201, { commit: result.commit, seq: await tx.currentSeq(project.id), pipeline: result.pipeline });
  });
}

function projectParam(ctx: Ctx): number {
  const id = whole(bodyOf(ctx.body), "project");
  if (id === undefined) throw validationOne("project", "Project is required.");
  return id;
}

// Postgres text cannot hold a NUL byte, so a sink named with one cannot exist.
function sinkName(ctx: Ctx): string {
  const name = ctx.params["name"] ?? "";
  if (name.includes("\0")) throw notFound();
  return name;
}

async function sinkStatus(name: string): Promise<number> {
  const stored = await db.maybe<{ status: number }>("SELECT status FROM grading_sink_status WHERE name = $1", [name]);
  return stored?.status ?? 200;
}

function lowerCaseHeaders(ctx: Ctx): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(ctx.req.headers)) {
    if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

export function registerGradingRoutes(router: Router): void {
  if (!config.grading) return;
  const open = { auth: false } as const;

  router.post(
    "/api/grading/seed",
    async (ctx) => json(201, await withTx((tx) => runSeed(tx, parseSeed(bodyOf(ctx.body), "")))),
    { ...open, bodyLimit: LIMITS.commitBodyBytes },
  );

  router.post(
    "/api/grading/session",
    async (ctx) => {
      const user = await userNamed(text(bodyOf(ctx.body), "username"), "username");
      const token = await startSession(db, user.id);
      return json(200, { user: publicUser(user) }, { "set-cookie": sessionCookie(token) });
    },
    open,
  );

  router.post("/api/grading/clock", changeClock, open);
  router.post("/api/grading/commit", gradingCommit, { ...open, bodyLimit: LIMITS.commitBodyBytes });

  router.post(
    "/api/grading/runner/step",
    async (ctx) => {
      const count = whole(bodyOf(ctx.body), "count") ?? 1;
      if (count < 0) throw validationOne("count", "count can't be negative.");
      return json(200, await runRounds(projectParam(ctx), count));
    },
    open,
  );

  router.post("/api/grading/runner/settle", async (ctx) => json(200, await settle(projectParam(ctx))), open);

  router.post(
    "/api/grading/storage",
    (ctx) => {
      const down = flag(bodyOf(ctx.body), "down");
      if (down === undefined) throw validation({ down: "down must be true or false." });
      storage.setDown(down);
      forgetStorageProbe();
      broadcastInstance(!down);
      return json(200, { storage: down ? "down" : "up" });
    },
    open,
  );

  router.post(
    "/api/grading/sink/:name",
    async (ctx) => {
      const name = sinkName(ctx);
      await db.q("INSERT INTO grading_sink_requests (name, headers, body, received_at_ms) VALUES ($1, $2, $3, $4)", [
        name,
        JSON.stringify(lowerCaseHeaders(ctx)),
        ctx.text.replaceAll("\0", ""),
        now(),
      ]);
      const asked = Number(ctx.query.get("status"));
      return json(Number.isInteger(asked) && asked >= 200 && asked <= 599 ? asked : await sinkStatus(name));
    },
    { ...open, bodyKind: "text" },
  );

  router.put(
    "/api/grading/sink/:name",
    async (ctx) => {
      const status = whole(bodyOf(ctx.body), "status");
      if (status === undefined || status < 200 || status > 599) throw validationOne("status", "status must be an HTTP status code.");
      await db.q(
        "INSERT INTO grading_sink_status (name, status) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET status = $2",
        [sinkName(ctx), status],
      );
      return json(200, { status });
    },
    open,
  );

  router.get(
    "/api/grading/sink/:name",
    async (ctx) => {
      const requests = await db.q<{ headers: Record<string, string>; body: string; received_at_ms: number }>(
        "SELECT headers, body, received_at_ms FROM grading_sink_requests WHERE name = $1 ORDER BY id",
        [sinkName(ctx)],
      );
      return json(200, { requests });
    },
    open,
  );
}
