import { randomUUID } from "node:crypto";
import type pg from "pg";
import { readRecorded, recordedFiles, requireSaved } from "../checkpoints.js";
import { config } from "../config.js";
import { many, one, pool, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { audit } from "../files.js";
import { newToken, ok, route } from "../http.js";
import { idempotentRequest, remember, replayed, requireKey } from "../idempotency.js";
import { reviewerMessage } from "../mail.js";
import { attempt, enqueue } from "../outbox.js";
import { checkpointById, iso, LINK_COLUMNS, type LinkRow, linkState, linkView, mentorOnly, reviewUrl } from "../views.js";
import { normaliseEmail, validEmail } from "./auth.js";
import { visibleCheckpoint } from "./checkpoints.js";

const HOURS_MAX = 336;

route("POST", "/api/checkpoints/:checkpoint_id/reviewer-links", async (ctx) => {
  const checkpoint = await visibleCheckpoint(pool, ctx.params.checkpoint_id!, ctx.user.id);
  await mentorOnly(pool, checkpoint.project_id, ctx.user.id);
  const request = idempotentRequest(ctx);
  const body = ctx.json();
  const outcome = await tx(async (db) => {
    await db.query("SELECT 1 FROM checkpoints WHERE id = $1 FOR UPDATE", [checkpoint.id]);
    const replay = await replayed(db, ctx.user.id, request);
    if (replay) return { reply: replay };
    requireSaved(checkpoint.state);
    requireKey(request);
    const hours = body.expires_in_hours;
    const fields: Record<string, string> = {};
    if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > HOURS_MAX) {
      fields.expires_in_hours = "Choose between 1 and 336 hours.";
    }
    const email = body.email === undefined || body.email === null || body.email === "" ? null : normaliseEmail(body.email);
    if (email !== null && !validEmail(email)) fields.email = "Enter an email address like name@example.com.";
    if (Object.keys(fields).length) throw invalid(fields);
    const link: LinkRow = {
      id: randomUUID(),
      checkpoint_id: checkpoint.id,
      token: newToken(),
      expires_at: new Date(Date.now() + (hours as number) * config.reviewerLinkHourSeconds * 1000),
      revoked_at: null,
      email_status: email ? "queued" : "none",
    };
    await db.query("INSERT INTO reviewer_links (id, checkpoint_id, token, expires_at, email_status) VALUES ($1, $2, $3, $4, $5)", [
      link.id,
      link.checkpoint_id,
      link.token,
      link.expires_at,
      link.email_status,
    ]);
    await audit(db, checkpoint.project_id, ctx.user.id, "reviewer_link_created", {
      link_id: link.id,
      checkpoint_id: checkpoint.id,
      checkpoint_name: checkpoint.name,
    });
    if (email) {
      const message = await enqueue(db, reviewerMessage(email, checkpoint.name, reviewUrl(link.token), link.expires_at), { link_id: link.id });
      if (await attempt(db, message, 0)) link.email_status = "sent";
    }
    const reply = ok({ link: linkView(link) }, 201);
    await remember(db, ctx.user.id, request, reply, null);
    return { reply };
  });
  return outcome.reply;
});

route("GET", "/api/checkpoints/:checkpoint_id/reviewer-links", async (ctx) => {
  const checkpoint = await visibleCheckpoint(pool, ctx.params.checkpoint_id!, ctx.user.id);
  await mentorOnly(pool, checkpoint.project_id, ctx.user.id);
  const links = await many<LinkRow>(pool, `SELECT ${LINK_COLUMNS} FROM reviewer_links WHERE checkpoint_id = $1 ORDER BY seq DESC`, [
    checkpoint.id,
  ]);
  return ok({ links: links.map(linkView) });
});

async function linkForMentor(db: pg.PoolClient, linkId: string, userId: string): Promise<{ link: LinkRow; projectId: string; name: string }> {
  const link = await one<LinkRow>(db, `SELECT ${LINK_COLUMNS} FROM reviewer_links WHERE id = $1 FOR UPDATE`, [linkId]);
  if (!link) throw new ApiError("not_found");
  const checkpoint = (await checkpointById(db, link.checkpoint_id))!;
  await mentorOnly(db, checkpoint.project_id, userId);
  return { link, projectId: checkpoint.project_id, name: checkpoint.name };
}

route("POST", "/api/reviewer-links/:link_id/regenerate", async (ctx) => {
  const link = await tx(async (db) => {
    const found = await linkForMentor(db, ctx.params.link_id!, ctx.user.id);
    const state = linkState(found.link);
    if (state !== "active") throw new ApiError("illegal_transition", { from: state, to: "active" });
    const renewed = (await one<LinkRow>(db, `UPDATE reviewer_links SET token = $2 WHERE id = $1 RETURNING ${LINK_COLUMNS}`, [
      found.link.id,
      newToken(),
    ]))!;
    await audit(db, found.projectId, ctx.user.id, "reviewer_link_regenerated", {
      link_id: found.link.id,
      checkpoint_id: found.link.checkpoint_id,
      checkpoint_name: found.name,
    });
    return renewed;
  });
  return ok({ link: linkView(link) });
});

route("POST", "/api/reviewer-links/:link_id/revoke", async (ctx) => {
  const link = await tx(async (db) => {
    const found = await linkForMentor(db, ctx.params.link_id!, ctx.user.id);
    const state = linkState(found.link);
    if (state !== "active") throw new ApiError("illegal_transition", { from: state, to: "revoked" });
    const revoked = (await one<LinkRow>(db, `UPDATE reviewer_links SET revoked_at = now() WHERE id = $1 RETURNING ${LINK_COLUMNS}`, [
      found.link.id,
    ]))!;
    await audit(db, found.projectId, ctx.user.id, "reviewer_link_revoked", {
      link_id: found.link.id,
      checkpoint_id: found.link.checkpoint_id,
      checkpoint_name: found.name,
    });
    return revoked;
  });
  return ok({ link: linkView(link) });
});

route(
  "GET",
  "/api/review/:token",
  async (ctx) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ctx.params.token!)) throw new ApiError("link_not_found");
    const link = await one<LinkRow>(pool, `SELECT ${LINK_COLUMNS} FROM reviewer_links WHERE token = $1`, [ctx.params.token]);
    if (!link) throw new ApiError("link_not_found");
    const state = linkState(link);
    if (state === "revoked") throw new ApiError("link_revoked");
    if (state === "expired") throw new ApiError("link_expired");
    const checkpoint = (await checkpointById(pool, link.checkpoint_id))!;
    const recorded = await recordedFiles(pool, checkpoint.id);
    const bytes = await readRecorded(checkpoint.project_id, recorded);
    return ok({
      checkpoint: {
        name: checkpoint.name,
        saved_at: iso(checkpoint.created_at),
        expires_at: iso(link.expires_at),
        files: recorded.map((f) => ({ path: f.path, content: bytes.get(f.file_id)!.toString("utf8") })),
      },
    });
  },
  { auth: false, private: true },
);
