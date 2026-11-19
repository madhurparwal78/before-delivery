import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ASPECTS, FORMATS, RENDER_SECONDS, RESOLUTIONS, renderCost, type Aspect, type Format, type Resolution } from "../shared/rules.js";
import { requireRole, signedIn } from "./auth.js";
import { config } from "./config.js";
import { iso, one, pool, rows, tx, UUID, type Db, type Tx } from "./db.js";
import { ApiError, invalidTransition, notFound, validationFailed } from "./errors.js";
import { json, type Ctx, type Route } from "./http.js";
import { idempotent } from "./idempotency.js";
import { available, balance, lockCredits, move } from "./ledger.js";
import { queueEmail } from "./outbox.js";
import { ownPiece, requireDraft } from "./pieces.js";
import { renderAttempt } from "./provider.js";
import { publishDead, publishJob, type RenderJob } from "./queue.js";
import { getObject, putObject } from "./s3.js";

// Render jobs: accepted → queued → rendering → stored → ready. Failure moves rendering to failed or
// timed_out and on to credits_released; cancelling moves queued straight to credits_released.

type RenderState = "accepted" | "queued" | "rendering" | "stored" | "ready" | "failed" | "timed_out" | "credits_released";
type FailureReason = "provider_error" | "timeout" | "malformed" | "storage_error" | "cancelled";

/** The render job state machine: the states each move starts from. */
const RENDER_MOVES: Record<"cancel" | "start" | "finish" | "fail", readonly RenderState[]> = {
  cancel: ["queued"], // → credits_released (cancelled)
  start: ["queued", "rendering"], // → rendering; a redelivered job resumes its attempts
  finish: ["rendering"], // → stored → ready
  fail: ["rendering"], // → failed | timed_out → credits_released
};

const MAX_ATTEMPTS = 3;

interface RenderRow {
  id: string;
  piece_id: string;
  piece_slug: string;
  piece_title: string;
  creator_id: string;
  creator_email: string;
  state: RenderState;
  failure_reason: FailureReason | null;
  cost_credits: number;
  attempts: number;
  format: Format;
  resolution: Resolution;
  duration_s: number;
  aspect: Aspect;
  sha256: string | null;
  history: { state: RenderState; at: string }[];
  fragment_source: string;
  uniforms: { name: string; value: number }[];
  timeline: unknown;
  created_at: Date;
}

const RENDER_SELECT = `
  SELECT r.*, p.slug AS piece_slug, p.title AS piece_title, u.email AS creator_email
    FROM renders r JOIN pieces p ON p.id = r.piece_id JOIN users u ON u.id = r.creator_id`;

const renderView = (r: RenderRow) => ({
  id: r.id,
  piece_slug: r.piece_slug,
  state: r.state,
  failure_reason: r.failure_reason,
  cost_credits: r.cost_credits,
  attempts: r.attempts,
  format: r.format,
  resolution: r.resolution,
  duration_s: r.duration_s,
  aspect: r.aspect,
  sha256: r.sha256,
  history: r.history,
  created_at: iso(r.created_at),
});

export const exportKey = (renderId: string, format: string): string => `renders/${renderId}/export.${format}`;

async function lockRender(client: Tx, id: string): Promise<RenderRow | undefined> {
  return one<RenderRow>(client, `${RENDER_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
}

/** Appends each reached state to the history and leaves the render in the last one. */
async function advance(client: Tx, render: RenderRow, states: RenderState[], set: Record<string, unknown> = {}): Promise<void> {
  const at = new Date().toISOString();
  const history = [...render.history, ...states.map((state) => ({ state, at }))];
  const columns = Object.keys(set);
  await client.query(
    `UPDATE renders SET state = $2, history = $3${columns.map((c, i) => `, ${c} = $${i + 4}`).join("")} WHERE id = $1`,
    [render.id, states[states.length - 1], JSON.stringify(history), ...columns.map((c) => set[c])],
  );
}

export async function rendersOf(db: Db, where: string, params: unknown[]) {
  return (await rows<RenderRow>(db, `${RENDER_SELECT} ${where} ORDER BY r.created_at DESC LIMIT 500`, params)).map(renderView);
}

// ---- API ----

async function accept(ctx: Ctx) {
  const { user, piece } = await ownPiece(ctx);
  return idempotent(ctx, user, async () => {
    requireDraft(piece);
    const body = ctx.body !== null && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    if (!(FORMATS as readonly unknown[]).includes(body.format)) fields.format = "Choose MP4 or WebM.";
    if (!(RESOLUTIONS as readonly unknown[]).includes(body.resolution)) fields.resolution = "Choose 720p or 1080p.";
    if (!(ASPECTS as readonly unknown[]).includes(body.aspect)) fields.aspect = `Choose an aspect ratio from ${ASPECTS.join(", ")}.`;
    const duration = body.duration_s;
    if (!Number.isInteger(duration) || (duration as number) < RENDER_SECONDS.min || (duration as number) > RENDER_SECONDS.max) {
      fields.duration_s = `Render ${RENDER_SECONDS.min} to ${RENDER_SECONDS.max} seconds.`;
    }
    if (Object.keys(fields).length) throw validationFailed(fields);
    const cost = renderCost(duration as number, body.resolution as Resolution);
    const id = randomUUID();
    await tx(async (client, after) => {
      await lockCredits(client, user.id);
      const locked = await one<{ state: string; fragment_source: string; uniforms: unknown; timeline: unknown }>(
        client,
        "SELECT state, fragment_source, uniforms, timeline FROM pieces WHERE id = $1 FOR SHARE",
        [piece.id],
      );
      if (locked?.state !== "draft") throw invalidTransition("Only a draft piece can render.");
      const have = await balance(client, available(user.id));
      if (have < cost) {
        throw new ApiError(402, "insufficient_credits", `This render needs ${cost} credits; you have ${have}.`, { needed: cost, available: have });
      }
      const at = new Date().toISOString();
      await client.query(
        `INSERT INTO renders (id, piece_id, creator_id, state, cost_credits, format, resolution, duration_s, aspect, history,
                              fragment_source, uniforms, timeline)
         VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, piece.id, user.id, cost, body.format, body.resolution, duration, body.aspect,
          JSON.stringify([{ state: "accepted", at }, { state: "queued", at }]),
          locked.fragment_source, JSON.stringify(locked.uniforms), JSON.stringify(locked.timeline)],
      );
      await move(client, "reserve", user.id, cost, id);
      after(() => void enqueue(id, piece.slug));
    });
    const [render] = await rendersOf(pool, "WHERE r.id = $1", [id]);
    return json(202, { render });
  });
}

async function enqueue(id: string, slug: string): Promise<void> {
  if (await publishJob({ render_id: id, piece_slug: slug, attempt: 1 })) {
    await pool.query("UPDATE renders SET published_at = now() WHERE id = $1", [id]);
  }
}

/** Re-publishes queued renders whose job never reached the queue (RabbitMQ was unreachable at accept). */
export async function republishQueued(): Promise<void> {
  const stuck = await rows<{ id: string; slug: string }>(
    pool,
    `SELECT r.id, p.slug FROM renders r JOIN pieces p ON p.id = r.piece_id
      WHERE r.state = 'queued' AND r.published_at IS NULL AND r.created_at < now() - interval '5 seconds'`,
  );
  for (const render of stuck) await enqueue(render.id, render.slug);
}

async function ownRender(ctx: Ctx): Promise<RenderRow> {
  const user = await signedIn(ctx);
  const id = ctx.params.id ?? "";
  const render = UUID.test(id) ? await one<RenderRow>(pool, `${RENDER_SELECT} WHERE r.id = $1`, [id]) : undefined;
  if (!render || render.creator_id !== user.id) throw notFound();
  requireRole(user, "creator");
  return render;
}

async function getRender(ctx: Ctx) {
  return json(200, renderView(await ownRender(ctx)));
}

async function listRenders(ctx: Ctx) {
  const { piece } = await ownPiece(ctx);
  return json(200, { renders: await rendersOf(pool, "WHERE r.piece_id = $1", [piece.id]) });
}

async function cancel(ctx: Ctx) {
  const render = await ownRender(ctx);
  await tx(async (client) => {
    const locked = await lockRender(client, render.id);
    if (!locked || !RENDER_MOVES.cancel.includes(locked.state)) throw invalidTransition("Only a queued render can be cancelled.");
    await advance(client, locked, ["credits_released"], { failure_reason: "cancelled" });
    await move(client, "release", locked.creator_id, locked.cost_credits, locked.id);
  });
  const [view] = await rendersOf(pool, "WHERE r.id = $1", [render.id]);
  return json(200, view);
}

// ---- the worker ----

type Outcome = { kind: "ready" } | { kind: "malformed" } | { kind: "retry"; reason: "provider_error" | "timeout" | "storage_error" };

async function attempt(render: RenderRow): Promise<Outcome> {
  const result = await renderAttempt({
    jobId: render.id,
    fragmentSource: render.fragment_source,
    uniforms: Object.fromEntries(render.uniforms.map((u) => [u.name, u.value])),
    timeline: render.timeline,
    format: render.format,
    resolution: render.resolution,
    durationS: render.duration_s,
    aspect: render.aspect,
  });
  if (result.kind === "malformed") return result;
  if (result.kind === "failed") return { kind: "retry", reason: result.reason };
  const key = exportKey(render.id, render.format);
  try {
    await putObject(key, result.bytes, render.format === "mp4" ? "video/mp4" : "video/webm");
    const stored = await getObject(key);
    if (createHash("sha256").update(stored).digest("hex") !== result.sha256) return { kind: "retry", reason: "storage_error" };
  } catch {
    return { kind: "retry", reason: "storage_error" };
  }
  await tx(async (client, after) => {
    const locked = await lockRender(client, render.id);
    if (!locked || !RENDER_MOVES.finish.includes(locked.state)) return;
    await advance(client, locked, ["stored", "ready"], { sha256: result.sha256 });
    await move(client, "capture", locked.creator_id, locked.cost_credits, locked.id);
    const mail = await queueEmail(client, {
      kind: "render_ready",
      to: locked.creator_email,
      subject: `Export ready: ${locked.piece_title}`,
      text: [
        `Your ${locked.aspect} ${locked.resolution} ${locked.format.toUpperCase()} export of "${locked.piece_title}" (${locked.duration_s} s) is ready.`,
        `It used ${locked.cost_credits} credits. Open the piece in your studio to publish it as a numbered edition run.`,
        "",
        "Phosphene Yard, by Brightmoss Works",
      ].join("\n"),
    });
    after(mail);
  });
  return { kind: "ready" };
}

async function release(id: string, terminal: "failed" | "timed_out", reason: FailureReason): Promise<void> {
  await tx(async (client) => {
    const locked = await lockRender(client, id);
    if (!locked || !RENDER_MOVES.fail.includes(locked.state)) return;
    await advance(client, locked, [terminal, "credits_released"], { failure_reason: reason });
    await move(client, "release", locked.creator_id, locked.cost_credits, locked.id);
  });
}

/** Handles one delivery; a job delivered again after it settled does nothing. */
export async function processJob(job: RenderJob): Promise<void> {
  if (!UUID.test(job.render_id)) return;
  const started = await tx(async (client) => {
    const locked = await lockRender(client, job.render_id);
    if (!locked || !RENDER_MOVES.start.includes(locked.state)) return null;
    if (locked.state === "queued") await advance(client, locked, ["rendering"]);
    return locked;
  });
  if (!started) return;
  for (let n = Math.max(1, job.attempt, started.attempts); n <= MAX_ATTEMPTS; n++) {
    await pool.query("UPDATE renders SET attempts = $2 WHERE id = $1 AND state = 'rendering'", [started.id, n]);
    const outcome = await attempt(started);
    if (outcome.kind === "ready") return;
    if (outcome.kind === "malformed") return release(started.id, "failed", "malformed");
    if (n === MAX_ATTEMPTS) {
      await publishDead({ ...job, attempt: n }, outcome.reason);
      return release(started.id, outcome.reason === "timeout" ? "timed_out" : "failed", outcome.reason);
    }
    await sleep(config.renderBackoffSeconds * 1000 * n);
  }
}

export const renderRoutes: Route[] = [
  { method: "POST", pattern: "/api/pieces/{slug}/renders", handler: accept },
  { method: "GET", pattern: "/api/pieces/{slug}/renders", handler: listRenders },
  { method: "GET", pattern: "/api/renders/{id}", handler: getRender },
  { method: "POST", pattern: "/api/renders/{id}/cancel", handler: cancel },
];
