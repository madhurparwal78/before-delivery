import { Router, type RouteCtx, json } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { requireMentor } from "./helpers.js";
import { checkIdempotency, storeIdempotency } from "./idempotency.js";

import type { Services } from "../services.js";

export function registerReviewerRoutes(router: Router, svc: Services): void {
  router.add("POST", "/api/checkpoints/<checkpoint_id>/reviewer-links", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const checkpointId = ctx.params["checkpoint_id"] as string;
    const projectId = await svc.checkpointProject(checkpointId, user);
    await requireMentor(svc.pool, projectId, user);
    const key = headerKey(ctx.req.headers["idempotency-key"]);
    const replay = await checkIdempotency(svc.pool, user.id, key, ctx.body);
    if (replay) return json(replay.status, replay.body);
    const body = z.object({
      expires_in_hours: z.number({ int: true }),
      email: z.optional(z.string()),
    }).parse(ctx.body);
    const hours = body.expires_in_hours;
    if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 336) {
      throw new ApiError("validation", "Choose between 1 and 336 hours.", {
        fields: { expires_in_hours: "Choose between 1 and 336 hours." },
      });
    }
    let email: string | null = null;
    if (body.email !== undefined && body.email !== "") {
      email = (body.email as string).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ApiError("validation", "Invalid email.", {
          fields: { email: "Enter an email address like name@example.com." },
        });
      }
    }
    const state = await svc.checkpointState(checkpointId);
    if (state !== "saved") {
      throw new ApiError("checkpoint_not_saved", "This checkpoint hasn't finished uploading yet.", { state });
    }
    const result = await svc.reviewerLinks.createLink(
      checkpointId, projectId, user, hours, email, svc.cfg,
    );
    const responseBody = { link: result.link };
    await storeIdempotency(svc.pool, user.id, key as string, ctx.body, 201, responseBody);
    return json(201, responseBody);
  });

  router.add("GET", "/api/checkpoints/<checkpoint_id>/reviewer-links", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const checkpointId = ctx.params["checkpoint_id"] as string;
    const projectId = await svc.checkpointProject(checkpointId, user);
    await requireMentor(svc.pool, projectId, user);
    const links = await svc.reviewerLinks.listLinks(checkpointId, svc.cfg);
    return json(200, { links });
  });

  router.add("POST", "/api/reviewer-links/<link_id>/regenerate", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const linkId = ctx.params["link_id"] as string;
    const link = await svc.reviewerLinks.linkProject(linkId);
    if (!link) throw new ApiError("not_found", "No such link.");
    await requireMentor(svc.pool, link.project_id, user);
    const result = await svc.reviewerLinks.regenerate(linkId, user, svc.cfg);
    return json(200, { link: result });
  });

  router.add("POST", "/api/reviewer-links/<link_id>/revoke", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const linkId = ctx.params["link_id"] as string;
    const link = await svc.reviewerLinks.linkProject(linkId);
    if (!link) throw new ApiError("not_found", "No such link.");
    await requireMentor(svc.pool, link.project_id, user);
    const result = await svc.reviewerLinks.revoke(linkId, user, svc.cfg);
    return json(200, { link: result });
  });

  router.add("GET", "/api/review/<token>", async (ctx: RouteCtx) => {
    const token = ctx.params["token"] as string;
    const result = await svc.reviewerLinks.reviewView(token);
    return json(200, result, {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    });
  });
}

function headerKey(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
