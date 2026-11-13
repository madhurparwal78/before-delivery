// Studio routes (gw_studio): health, engagements, stills, review links, invoices, cancellation, rates, services and work.
import { ACCENTS, PRIMITIVES, SLUG_PATTERN, caseStudies, createCaseStudy, updateCaseStudy, updateService } from "../content.js";
import { one, pool } from "../db.js";
import { cancelEngagement } from "../domain/cancellation.js";
import { engagementJson, engagementSummaries, loadEngagement } from "../domain/engagements.js";
import { loadFile, sendFileContent } from "../domain/intake.js";
import { issueInvoice } from "../domain/invoices.js";
import { addRate, rateTable } from "../domain/rates.js";
import { postStill, regenerateLink, revokeLink, sendForReview } from "../domain/review.js";
import { createSession, passwordMatches, requireFounder, SESSION_SECONDS, STUDIO_COOKIE, endSession } from "../domain/sessions.js";
import { ApiError, FIELD_COPY, FieldErrors } from "../errors.js";
import { clearedCookie, publicOrigin, route, sessionCookie } from "../http.js";
import { indexCaseStudy, indexService } from "../search.js";
import { health } from "../status.js";
const bodyOf = (ctx) => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {});
const param = (ctx, name) => ctx.params[name] ?? "";
route("POST", "/api/studio/session", async (ctx) => {
    const password = bodyOf(ctx).password;
    const stored = await one(pool, "SELECT password_hash FROM studio_founder WHERE id = 1");
    if (typeof password !== "string" || !stored || !(await passwordMatches(password, stored.password_hash)))
        throw new ApiError("invalid_credentials");
    const token = await createSession(pool, "studio", null, null);
    return { status: 200, body: { role: "founder" }, headers: { "Set-Cookie": sessionCookie(STUDIO_COOKIE, token, SESSION_SECONDS) } };
});
route("DELETE", "/api/studio/session", async (ctx) => {
    await endSession(ctx.cookies[STUDIO_COOKIE]);
    return { status: 204, headers: { "Set-Cookie": clearedCookie(STUDIO_COOKIE) } };
});
route("GET", "/api/studio/health", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await health() };
});
route("GET", "/api/studio/engagements", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: { engagements: await engagementSummaries(pool, null) } };
});
route("GET", "/api/studio/engagements/:id", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await engagementJson(pool, await loadEngagement(pool, param(ctx, "id"), null), "studio", new Date()) };
});
route("GET", "/api/studio/engagements/:id/files/:fileId/content", async (ctx) => {
    await requireFounder(ctx);
    const engagement = await loadEngagement(pool, param(ctx, "id"), null);
    return sendFileContent(ctx, await loadFile(pool, engagement.id, param(ctx, "fileId")));
});
route("POST", "/api/studio/engagements/:id/stills", async (ctx) => {
    await requireFounder(ctx);
    const still = await postStill(ctx, param(ctx, "id"));
    return still === "sent" ? "sent" : { status: 201, body: still };
}, { multipart: true });
route("POST", "/api/studio/engagements/:id/send-for-review", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await sendForReview(param(ctx, "id"), publicOrigin(ctx.req), new Date()) };
});
route("POST", "/api/studio/engagements/:id/review-link", async (ctx) => {
    await requireFounder(ctx);
    return { status: 201, body: await regenerateLink(param(ctx, "id"), publicOrigin(ctx.req), new Date()) };
});
route("DELETE", "/api/studio/engagements/:id/review-link", async (ctx) => {
    await requireFounder(ctx);
    await revokeLink(param(ctx, "id"), new Date());
    return { status: 204 };
});
route("POST", "/api/studio/invoices/:invoiceId/issue", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await issueInvoice(param(ctx, "invoiceId"), publicOrigin(ctx.req), new Date()) };
});
route("POST", "/api/studio/engagements/:id/cancel", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await cancelEngagement(param(ctx, "id"), bodyOf(ctx), publicOrigin(ctx.req), new Date()) };
});
route("GET", "/api/studio/fx-rates", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: await rateTable(pool, new Date()) };
});
route("POST", "/api/studio/fx-rates", async (ctx) => {
    await requireFounder(ctx);
    return { status: 201, body: await addRate(pool, bodyOf(ctx), new Date()) };
});
route("PATCH", "/api/studio/services/:code", async (ctx) => {
    await requireFounder(ctx);
    const body = bodyOf(ctx);
    const errors = new FieldErrors();
    const changes = {};
    if (body.title !== undefined) {
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (title.length < 1 || title.length > 60)
            errors.add("title", FIELD_COPY.title_service);
        else
            changes.title = title;
    }
    if (body.list_price_pence !== undefined) {
        const price = body.list_price_pence;
        if (typeof price !== "number" || !Number.isInteger(price) || price < 1 || price > 10_000_000)
            errors.add("list_price_pence", FIELD_COPY.list_price_pence);
        else
            changes.list_price_pence = price;
    }
    errors.throwIfAny();
    const service = await updateService(param(ctx, "code"), changes);
    if (!service)
        throw new ApiError("not_found");
    await indexService(service).catch(() => undefined);
    return { status: 200, body: service };
});
/** Validates the CaseStudy fields present in the body; `creating` requires every field. */
function caseStudyFields(body, creating) {
    const errors = new FieldErrors();
    const out = {};
    if (creating) {
        const slug = body.slug;
        if (typeof slug !== "string" || !SLUG_PATTERN.test(slug))
            errors.add("slug", FIELD_COPY.slug);
        else
            out.slug = slug;
    }
    for (const [field, max] of [["title", 120], ["client", 120], ["summary", 2000]]) {
        if (body[field] === undefined && !creating)
            continue;
        const value = typeof body[field] === "string" ? body[field].trim() : "";
        if (value.length < 1 || value.length > max)
            errors.add(field, `Use 1 to ${max} characters.`);
        else
            out[field] = value;
    }
    if (body.scene !== undefined || creating) {
        const scene = body.scene;
        const primitives = scene && Array.isArray(scene.primitives) ? scene.primitives : null;
        const valid = primitives !== null &&
            primitives.length >= 1 &&
            primitives.length <= 8 &&
            primitives.every((p) => typeof p === "string" && PRIMITIVES.includes(p)) &&
            typeof scene?.accent === "string" &&
            ACCENTS.includes(scene.accent);
        if (!valid)
            errors.add("scene", FIELD_COPY.scene);
        else
            out.scene = { primitives: primitives, accent: scene?.accent };
    }
    if (body.published !== undefined) {
        if (typeof body.published !== "boolean")
            errors.add("published", "Choose published or draft.");
        else
            out.published = body.published;
    }
    else if (creating)
        out.published = false;
    if (body.sort !== undefined) {
        if (typeof body.sort !== "number" || !Number.isInteger(body.sort))
            errors.add("sort", "Use a whole number.");
        else
            out.sort = body.sort;
    }
    else if (creating)
        out.sort = 0;
    errors.throwIfAny();
    return out;
}
route("GET", "/api/studio/work", async (ctx) => {
    await requireFounder(ctx);
    return { status: 200, body: { case_studies: await caseStudies(false) } };
});
route("POST", "/api/studio/work", async (ctx) => {
    await requireFounder(ctx);
    const study = await createCaseStudy(caseStudyFields(bodyOf(ctx), true));
    await indexCaseStudy(study).catch(() => undefined);
    return { status: 201, body: study };
});
route("PATCH", "/api/studio/work/:slug", async (ctx) => {
    await requireFounder(ctx);
    const { slug: _ignored, ...changes } = caseStudyFields(bodyOf(ctx), false);
    const study = await updateCaseStudy(param(ctx, "slug"), changes);
    if (!study)
        throw new ApiError("not_found");
    await indexCaseStudy(study).catch(() => undefined);
    return { status: 200, body: study };
});
