// Stills, review links and reviewer actions: send for review, regenerate, revoke, accept and revision rounds.
import { randomBytes, randomUUID } from "node:crypto";
import { Busboy, type BusboyHeaders, type BusboyInstance } from "@fastify/busboy";
import type pg from "pg";
import { config } from "../config.js";
import { one, pool, rows, transaction, type Db } from "../db.js";
import { ApiError, FIELD_COPY, FieldErrors } from "../errors.js";
import { answerAndDrain, type Context } from "../http.js";
import { queueEmail, queuePush } from "../outbox.js";
import { deleteObject, getObject, objectSize, putObject } from "../storage.js";
import { contactEmail, engagementJson, loadEngagement, setStage, stageOf, type EngagementRow } from "./engagements.js";
import { draftInvoice } from "./invoices.js";
import { reviewLinkEmail, revisionPush } from "./notices.js";
import { catalogueFor, readQuote } from "./quote.js";
import { hashToken } from "./sessions.js";
import {
  assertStillsAllowed,
  regenerateMilestone,
  reviewActionsOpen,
  reviewerAcceptTransition,
  reviewerRevisionTransition,
  sendForReviewTransition,
  type ReviewMilestone,
} from "./states.js";

const STILL_CAP = 20_000_000;
const INCLUDED_ROUNDS = 2;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const MILESTONES: ReviewMilestone[] = ["look_dev", "final_delivery"];

const stillKey = (still: { engagement_id: string; milestone: string; id: string; extension: string }): string =>
  `stills/${still.engagement_id}/${still.milestone}/${still.id}.${still.extension}`;

type LinkRow = { id: string; engagement_id: string; milestone: ReviewMilestone; created_at: Date };
type StillRow = { id: string; engagement_id: string; shot_code: string; milestone: ReviewMilestone; extension: string; size_bytes: number };

// ---------- founder: stills ----------

type StillUpload = { fields: Record<string, string>; file: Buffer | null };

function readStillForm(ctx: Context): Promise<StillUpload | "too_large"> {
  return new Promise((resolve, reject) => {
    let parser: BusboyInstance;
    try {
      parser = Busboy({ headers: ctx.req.headers as BusboyHeaders, limits: { files: 1, fields: 10, fieldSize: 256 } });
    } catch {
      return resolve({ fields: {}, file: null });
    }
    const fields: Record<string, string> = {};
    let file: Buffer | null = null;
    let tooLarge = false;
    parser.on("field", (name, value) => (fields[name] = value));
    parser.on("file", (name, stream) => {
      if (name !== "file") return stream.resume();
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > STILL_CAP) {
          tooLarge = true;
          ctx.req.unpipe(parser);
          stream.destroy();
          resolve("too_large");
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => (file = Buffer.concat(chunks)));
    });
    parser.on("finish", () => {
      if (!tooLarge) resolve({ fields, file });
    });
    parser.on("error", reject);
    ctx.req.pipe(parser);
  });
}

/** POST /api/studio/engagements/{id}/stills: one still per shot and milestone, replacing any earlier one. */
export async function postStill(ctx: Context, engagementId: string): Promise<{ id: string; shot_code: string; milestone: string } | "sent"> {
  const engagement = await loadEngagement(pool, engagementId, null);
  const form = await readStillForm(ctx).catch(() => ({ fields: {}, file: null }) as StillUpload);
  if (form === "too_large") {
    answerAndDrain(ctx.req, ctx.res, new ApiError("file_too_large"));
    return "sent";
  }
  assertStillsAllowed(stageOf(engagement));
  const errors = new FieldErrors();
  const lines = (await readQuote(pool, engagement, await catalogueFor(engagement), new Date())).lines;
  const shotCode = form.fields.shot_code ?? "";
  if (!lines.some((line) => line.shot_code === shotCode)) errors.add("shot_code", FIELD_COPY.shot_code);
  const milestone = form.fields.milestone as ReviewMilestone;
  if (!MILESTONES.includes(milestone)) errors.add("milestone", FIELD_COPY.milestone);
  const file = form.file;
  const extension = file && file.subarray(0, 8).equals(PNG) ? "png" : file && file.subarray(0, 3).equals(JPEG) ? "jpg" : null;
  if (!extension || !file) errors.add("file", FIELD_COPY.still_file);
  errors.throwIfAny();
  if (!extension || !file) throw new ApiError("validation_failed");
  const still: StillRow = { id: randomUUID(), engagement_id: engagementId, shot_code: shotCode, milestone, extension, size_bytes: file.length };
  await putObject(stillKey(still), file, extension === "png" ? "image/png" : "image/jpeg");
  if ((await objectSize(stillKey(still))) !== file.length) throw new ApiError("storage_unavailable");
  const replaced = await transaction(async (client) => {
    const old = await one<StillRow>(client, "DELETE FROM stills WHERE engagement_id = $1 AND shot_code = $2 AND milestone = $3 RETURNING id, engagement_id, shot_code, milestone, extension, size_bytes", [
      engagementId,
      shotCode,
      milestone,
    ]);
    await client.query("INSERT INTO stills (id, engagement_id, shot_code, milestone, extension, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)", [
      still.id,
      engagementId,
      shotCode,
      milestone,
      extension,
      file.length,
    ]);
    return old;
  });
  if (replaced) await deleteObject(stillKey(replaced));
  return { id: still.id, shot_code: shotCode, milestone };
}

// ---------- founder: links ----------

/** A fresh link (killing any earlier one) and one email to the reviewer. */
async function createLink(client: pg.PoolClient, engagement: EngagementRow, milestone: ReviewMilestone, origin: string, now: Date): Promise<{ review_url: string; expires_at: string }> {
  const token = randomBytes(32).toString("base64url");
  await client.query("UPDATE review_links SET revoked_at = $2 WHERE engagement_id = $1 AND revoked_at IS NULL", [engagement.id, now]);
  await client.query("INSERT INTO review_links (id, engagement_id, milestone, token_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    engagement.id,
    milestone,
    hashToken(token),
    now,
  ]);
  const reviewUrl = `${origin}/review/${token}`;
  const expiresAt = new Date(now.getTime() + config.timers.reviewLinkTtl * 1000).toISOString();
  const reviewer = await contactEmail(client, engagement.brand_id, "reviewer");
  await queueEmail(client, reviewLinkEmail(engagement.reference, engagement.brand_name, milestone, reviewer, reviewUrl, expiresAt));
  return { review_url: reviewUrl, expires_at: expiresAt };
}

export async function sendForReview(engagementId: string, origin: string, now: Date): Promise<Record<string, unknown>> {
  const link = await transaction(async (client) => {
    const engagement = await loadEngagement(client, engagementId, null, true);
    const step = sendForReviewTransition(stageOf(engagement));
    if (step.needsLookDevPaid) {
      const lookDev = await one<{ status: string }>(client, "SELECT status FROM invoices WHERE engagement_id = $1 AND milestone = 'look_dev'", [engagementId]);
      if (lookDev?.status !== "paid") throw new ApiError("look_dev_unpaid");
    }
    const lines = await rows<{ shot_code: string }>(client, "SELECT shot_code FROM quote_lines WHERE engagement_id = $1", [engagementId]);
    const stills = new Set(
      (await rows<{ shot_code: string }>(client, "SELECT shot_code FROM stills WHERE engagement_id = $1 AND milestone = $2", [engagementId, step.milestone])).map((s) => s.shot_code),
    );
    if (lines.length === 0 || lines.some((line) => !stills.has(line.shot_code))) throw new ApiError("stills_missing");
    await setStage(client, engagementId, step.next);
    return createLink(client, engagement, step.milestone, origin, now);
  });
  const engagement = await loadEngagement(pool, engagementId, null);
  return { engagement: await engagementJson(pool, engagement, "studio", now), ...link };
}

export async function regenerateLink(engagementId: string, origin: string, now: Date): Promise<{ review_url: string; expires_at: string }> {
  return transaction(async (client) => {
    const engagement = await loadEngagement(client, engagementId, null, true);
    return createLink(client, engagement, regenerateMilestone(stageOf(engagement)), origin, now);
  });
}

export async function revokeLink(engagementId: string, now: Date): Promise<void> {
  await loadEngagement(pool, engagementId, null);
  await pool.query("UPDATE review_links SET revoked_at = $2 WHERE engagement_id = $1 AND revoked_at IS NULL", [engagementId, now]);
}

// ---------- reviewer ----------

/** The live link for a token: not revoked, not replaced, and no older than REVIEW_LINK_TTL_SECONDS (exactly that age still works). */
async function liveLink(db: Db, token: string, now: Date): Promise<LinkRow> {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw new ApiError("not_found");
  const link = await one<LinkRow>(db, "SELECT id, engagement_id, milestone, created_at FROM review_links WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
  if (!link || now.getTime() - link.created_at.getTime() > config.timers.reviewLinkTtl * 1000) throw new ApiError("not_found");
  return link;
}

export async function reviewTokenLive(token: string, now: Date): Promise<boolean> {
  return liveLink(pool, token, now).then(
    () => true,
    () => false,
  );
}

async function stillsOf(db: Db, engagement: EngagementRow, milestone: ReviewMilestone, token: string): Promise<{ id: string; shot_code: string; title: string; url: string }[]> {
  const lines = (await readQuote(db, engagement, await catalogueFor(engagement), new Date())).lines;
  const stills = await rows<StillRow>(db, "SELECT id, shot_code FROM stills WHERE engagement_id = $1 AND milestone = $2", [engagement.id, milestone]);
  return lines.flatMap((line) => {
    const still = stills.find((s) => s.shot_code === line.shot_code);
    return still ? [{ id: still.id, shot_code: line.shot_code, title: line.title, url: `/api/review/${token}/stills/${still.id}` }] : [];
  });
}

async function reviewJson(db: Db, link: LinkRow, token: string): Promise<Record<string, unknown>> {
  const engagement = await loadEngagement(db, link.engagement_id, null);
  const used = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM revision_rounds WHERE engagement_id = $1 AND milestone = $2", [engagement.id, link.milestone]);
  const stage = stageOf(engagement);
  return {
    reference: engagement.reference,
    brand_name: engagement.brand_name,
    milestone: link.milestone,
    state: engagement.state,
    revision_rounds_used: used?.n ?? 0,
    revision_rounds_included: INCLUDED_ROUNDS,
    actions_open: reviewActionsOpen(stage) && (stage.state === "look_dev_review" ? link.milestone === "look_dev" : link.milestone === "final_delivery"),
    stills: await stillsOf(db, engagement, link.milestone, token),
  };
}

export async function readReview(token: string, now: Date): Promise<Record<string, unknown>> {
  return reviewJson(pool, await liveLink(pool, token, now), token);
}

export async function sendStill(ctx: Context, token: string, stillId: string, now: Date): Promise<void> {
  const link = await liveLink(pool, token, now);
  const still = await one<StillRow>(pool, "SELECT id, engagement_id, shot_code, milestone, extension, size_bytes FROM stills WHERE id::text = $1 AND engagement_id = $2 AND milestone = $3", [
    stillId,
    link.engagement_id,
    link.milestone,
  ]);
  if (!still) throw new ApiError("not_found");
  const { stream } = await getObject(stillKey(still));
  ctx.res.writeHead(200, {
    "Content-Type": still.extension === "png" ? "image/png" : "image/jpeg",
    "Content-Length": String(still.size_bytes),
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (ctx.req.method === "HEAD") {
    stream.destroy();
    ctx.res.end();
  } else stream.pipe(ctx.res);
}

export async function acceptReview(token: string, now: Date): Promise<Record<string, unknown>> {
  return transaction(async (client) => {
    const link = await liveLink(client, token, now);
    const engagement = await loadEngagement(client, link.engagement_id, null, true);
    const step = reviewerAcceptTransition(stageOf(engagement));
    await setStage(client, engagement.id, step.next);
    await draftInvoice(client, engagement, step.milestone, now);
    return reviewJson(client, link, token);
  });
}

/** Resolves the token first (a dead link is not-found, even for a stored key); idempotency then wraps `requestRevision`. */
export async function linkEngagement(token: string, now: Date): Promise<string> {
  return (await liveLink(pool, token, now)).engagement_id;
}

export async function requestRevision(token: string, body: Record<string, unknown>, now: Date): Promise<{ status: number; body: unknown }> {
  return transaction(async (client) => {
    const link = await liveLink(client, token, now);
    const engagement = await loadEngagement(client, link.engagement_id, null, true);
    const step = reviewerRevisionTransition(stageOf(engagement));
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length < 1 || note.length > 2000) throw new ApiError("validation_failed", { note: FIELD_COPY.note });
    const used = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM revision_rounds WHERE engagement_id = $1 AND milestone = $2", [engagement.id, step.milestone]);
    const round = (used?.n ?? 0) + 1;
    await client.query("INSERT INTO revision_rounds (id, engagement_id, milestone, round, note) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), engagement.id, step.milestone, round, note]);
    await setStage(client, engagement.id, step.next);
    await queuePush(client, revisionPush(engagement.reference, step.milestone, round));
    return { status: 201, body: { review: await reviewJson(client, link, token), round, change_order: round > INCLUDED_ROUNDS } };
  });
}
