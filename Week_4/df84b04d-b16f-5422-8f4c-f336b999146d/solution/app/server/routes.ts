import { ALERTS, searchTooLong } from "../shared/copy.js";
import {
  clearedCookie, confirmSignup, endSession, isEmail, meFor, normalizeEmail, sessionCookie, setHideCompleted, signIn, signUp,
  validateSignup,
} from "./accounts.js";
import { commit, ownerFor, ownerOfBullet, readOutline, type Work } from "./commit.js";
import { createBullet, deleteBullet, mirrorBullet, moveBullet, patchBullet } from "./commands.js";
import { config } from "./config.js";
import { databaseAnswers, pool } from "./db.js";
import { exportView, isExportFormat } from "./export.js";
import { setupGrading } from "./grading.js";
import { applyStep, dropStep, dropStepsOf, topStep, type StepRow } from "./history.js";
import {
  ApiError, conflict, cookieValue, GRADING_BODY_LIMIT, invalid, notFound, open, requireBody, secured, type Context, type Route, type Session,
} from "./http.js";
import { acceptInvitation, invite, listShares, readInvitation, retryShare, revokeShare } from "./invitations.js";
import { searchView, suggestions } from "./lookup.js";
import { bulletFor, outlineFor } from "./view.js";

const rootParam = (context: Context): string | null => context.query.get("root") || null;

async function viewOf(actor: Session, root: string | null) {
  const owner = root === null ? actor.accountId : await ownerOfBullet(root);
  const read = await readOutline(actor, owner);
  if (root !== null && !read.scope.canSee(root)) throw notFound();
  return { ...read, root };
}

class Retry extends Error {}

async function runStep(actor: Session, direction: "undo" | "redo") {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const step = await topStep(direction, actor.accountId);
    if (step === null) {
      throw conflict(direction === "undo" ? "nothing_to_undo" : "nothing_to_redo",
        direction === "undo" ? ALERTS.nothingToUndo : ALERTS.nothingToRedo);
    }
    try {
      const done = await commit(actor, step.ownerId, async (work) => {
        const locked = await work.client.query<{ id: number }>("SELECT id FROM steps WHERE id = $1 AND stack = $2 FOR UPDATE", [step.id, direction]);
        if (locked.rows[0] === undefined) throw new Retry();
        if (missing(work, step, direction)) {
          await dropStepsOf(work.client, [step.bulletId]);
          return null;
        }
        const data = await applyStep(work, step, direction);
        await work.client.query(
          "UPDATE steps SET stack = $2, data = $3, ord = nextval('step_order') WHERE id = $1",
          [step.id, direction === "undo" ? "redo" : "undo", JSON.stringify(data)],
        );
        return { step: step.kind, bulletId: step.bulletId };
      });
      if (done.result !== null) return { ...done.result, seq: done.seq };
    } catch (error) {
      if (error instanceof Retry) continue;
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) await dropStep(step.id);
      if (error instanceof ApiError && error.status === 404) continue;
      throw error;
    }
  }
  throw conflict("nothing_to_undo", ALERTS.nothingToUndo);
}

function missing(work: Work, step: StepRow, direction: "undo" | "redo"): boolean {
  const restoring = (step.kind === "delete" && direction === "undo") ||
    ((step.kind === "new bullet" || step.kind === "mirror") && direction === "redo");
  if (restoring && "ids" in step.data) return step.data.ids.some((id) => !work.state.rows.has(id));
  return !work.scope.canSee(step.bulletId);
}

export const routes: Route[] = [
  open("GET", "/api/health", async () =>
    (await databaseAnswers()) ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } }),

  open("POST", "/api/signup", async (context) => {
    await signUp(validateSignup(requireBody(context)));
    return { status: 202, body: { status: "code_sent" } };
  }),

  open("POST", "/api/signup/confirm", async (context) => {
    const body = requireBody(context);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const { token, person } = await confirmSignup(email, code);
    context.setCookie(sessionCookie(token));
    return { status: 200, body: { user: person } };
  }),

  open("POST", "/api/session", async (context) => {
    const body = requireBody(context);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const { token, person } = await signIn(isEmail(email) ? email : "", password);
    context.setCookie(sessionCookie(token));
    return { status: 200, body: { user: person } };
  }),

  open("DELETE", "/api/session", async (context) => {
    const cookie = cookieValue(context.req, "twig_session");
    if (cookie !== undefined) await endSession(cookie);
    context.setCookie(clearedCookie());
    return { status: 204 };
  }),

  secured("GET", "/api/me", async (context) => ({ status: 200, body: await meFor(context.user) })),

  secured("PATCH", "/api/me", async (context) => {
    const body = requireBody(context);
    if (typeof body.hideCompleted !== "boolean") throw invalid({ hideCompleted: "Send true or false." });
    const actor = context.user;
    await setHideCompleted(actor, body.hideCompleted);
    return { status: 200, body: await meFor({ ...actor, hideCompleted: body.hideCompleted }) };
  }),

  secured("GET", "/api/outline", async (context) => {
    const { state, scope, seq, root } = await viewOf(context.user, rootParam(context));
    return { status: 200, body: outlineFor(state, scope, seq, root) };
  }),

  secured("GET", "/api/bullets/:id", async (context) => {
    const actor = context.user;
    const owner = await ownerOfBullet(context.params.id ?? "");
    const { state, scope } = await readOutline(actor, owner);
    if (!scope.canSee(context.params.id ?? "")) throw notFound();
    return { status: 200, body: { bullet: bulletFor(state, scope, context.params.id ?? "") } };
  }),

  secured("POST", "/api/bullets", async (context) => {
    const actor = context.user;
    const body = requireBody(context);
    const owner = await ownerFor(actor, [body.parentId as string | null | undefined, body.afterId as string | null | undefined]);
    const { result, seq } = await commit(actor, owner, (work) => createBullet(work, body));
    return { status: 201, body: { bullet: result, seq } };
  }),

  secured("PATCH", "/api/bullets/:id", async (context) => {
    const actor = context.user;
    const id = context.params.id ?? "";
    const owner = await ownerOfBullet(id);
    const body = requireBody(context);
    const { result, seq } = await commit(actor, owner, (work) => patchBullet(work, id, body));
    return { status: 200, body: { bullet: result, seq } };
  }),

  secured("DELETE", "/api/bullets/:id", async (context) => {
    const actor = context.user;
    const id = context.params.id ?? "";
    const owner = await ownerOfBullet(id);
    const { result, seq } = await commit(actor, owner, (work) => deleteBullet(work, id));
    return { status: 200, body: { ...result, seq } };
  }),

  secured("POST", "/api/bullets/:id/move", async (context) => {
    const actor = context.user;
    const id = context.params.id ?? "";
    const owner = await ownerOfBullet(id);
    const body = requireBody(context);
    const { result, seq } = await commit(actor, owner, (work) => moveBullet(work, id, body));
    return { status: 200, body: { bullet: result, seq } };
  }),

  secured("POST", "/api/bullets/:id/mirror", async (context) => {
    const actor = context.user;
    const id = context.params.id ?? "";
    const owner = await ownerOfBullet(id);
    const body = requireBody(context);
    const { result, seq } = await commit(actor, owner, (work) => mirrorBullet(work, id, body));
    return { status: 201, body: { bullet: result, seq } };
  }),

  secured("POST", "/api/undo", async (context) => {
    requireBody(context);
    return { status: 200, body: await runStep(context.user, "undo") };
  }),

  secured("POST", "/api/redo", async (context) => {
    requireBody(context);
    return { status: 200, body: await runStep(context.user, "redo") };
  }),

  secured("GET", "/api/search", async (context) => {
    const { state, root } = await viewOf(context.user, rootParam(context));
    const query = context.query.get("q") ?? "";
    if (Array.from(query).length > config.searchMaxChars) throw invalid({ q: searchTooLong(config.searchMaxChars) });
    return { status: 200, body: searchView(state, root, query) };
  }),

  secured("GET", "/api/suggest", async (context) => {
    const { state, root } = await viewOf(context.user, rootParam(context));
    const kind = context.query.get("kind");
    if (kind !== "tag" && kind !== "mention") throw invalid({ kind: "Choose tag or mention." });
    return { status: 200, body: { suggestions: suggestions(state, root, kind, context.query.get("prefix") ?? "") } };
  }),

  secured("GET", "/api/export", async (context) => {
    const { state, root } = await viewOf(context.user, rootParam(context));
    const format = context.query.get("format") ?? "";
    if (!isExportFormat(format)) throw invalid({ format: "Choose text, markdown or opml." });
    const file = exportView(state, root, format);
    return {
      status: 200,
      raw: file.body,
      headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.name}"` },
    };
  }),

  secured("GET", "/api/bullets/:id/shares", async (context) => ({
    status: 200,
    body: { shares: await listShares(context.user, context.params.id ?? "") },
  })),

  secured("POST", "/api/bullets/:id/shares", async (context) => {
    const actor = context.user;
    const id = context.params.id ?? "";
    await ownerOfBullet(id);
    return { status: 201, body: { share: await invite(actor, id, requireBody(context)) } };
  }),

  secured("POST", "/api/shares/:id/retry", async (context) => {
    const actor = context.user;
    const found = await pool.query("SELECT 1 FROM shares WHERE id = $1", [context.params.id ?? ""]);
    if (found.rowCount === 0) throw notFound();
    requireBody(context);
    return { status: 200, body: { share: await retryShare(actor, context.params.id ?? "") } };
  }),

  secured("DELETE", "/api/shares/:id", async (context) => ({
    status: 200,
    body: { share: await revokeShare(context.user, context.params.id ?? "") },
  })),

  open("GET", "/api/invitations/:token", async (context) => ({
    status: 200,
    body: await readInvitation(context.params.token ?? ""),
  })),

  secured("POST", "/api/invitations/:token/accept", async (context) => {
    const actor = context.user;
    requireBody(context);
    return { status: 200, body: await acceptInvitation(actor, context.params.token ?? "") };
  }),

  open("POST", "/api/grading/setup", async (context) => ({
    status: 201,
    body: await setupGrading(requireBody(context)),
  }), { limit: GRADING_BODY_LIMIT, gradingKey: true }),
];
