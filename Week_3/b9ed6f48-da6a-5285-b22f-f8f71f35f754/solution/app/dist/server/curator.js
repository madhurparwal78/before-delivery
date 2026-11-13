// The studio: items, drafts, the editorial lifecycle and scheduled publishing
// (brief: API › Studio; Business rules › Editorial lifecycle, Scheduled publishing).
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { locked, one, pool, rows, tx } from "./db.js";
import { ApiError, assertValid, fail } from "./http.js";
import { recordAction } from "./audit.js";
import { deliverNow, queueMail } from "./mail.js";
import { SEED_ACCOUNTS } from "./pocketbase.js";
import { COPY, copyFor } from "../shared/copy.js";
import { ITEM_STATUSES, STATUS_LABELS, isLegalMove, judgeMover } from "../shared/lifecycle.js";
import { parseIsoWithOffset, toLisbonIso } from "../shared/lisbon.js";
const ITEMS = `SELECT id, 'chapter' AS type, title, status, owner_email, publish_at, number AS chapter, 0 AS year FROM chapters
  UNION ALL SELECT id, 'event' AS type, title, status, owner_email, publish_at, chapter, year FROM events`;
function itemJson(i) {
    return { id: i.id, type: i.type, title: i.title, status: i.status, owner_email: i.owner_email, publish_at: i.publish_at ? toLisbonIso(i.publish_at.getTime()) : null, chapter: i.chapter };
}
async function itemById(db, id) {
    return one(db, `SELECT * FROM (${ITEMS}) i WHERE id = $1`, [id]);
}
export async function listItems(type, status) {
    const fields = {};
    if (type !== null && type !== "chapter" && type !== "event")
        fields.type = "Choose chapter or event.";
    if (status !== null && !ITEM_STATUSES.includes(status))
        fields.status = "Choose draft, review, scheduled, published or withdrawn.";
    assertValid(fields);
    const found = await rows(pool, `SELECT * FROM (${ITEMS}) i WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR status = $2)
     ORDER BY chapter, type, year, title COLLATE "C", id`, [type, status]);
    return { items: found.map(itemJson) };
}
const isText = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.length <= max;
const isIntIn = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
async function eventFieldErrors(input, partial) {
    const fields = {};
    const has = (k) => !partial || k in input;
    if (has("chapter") && !isIntIn(input.chapter, 1, 8))
        fields.chapter = "Choose a chapter from I to VIII.";
    if (has("year") && !isIntIn(input.year, 1600, 2100))
        fields.year = "Enter a year from 1600 to 2100.";
    if (has("title") && !isText(input.title, 3, 120))
        fields.title = COPY.sessionTitleField;
    if (has("summary") && !isText(input.summary, 10, 600))
        fields.summary = "Write a summary of 10 to 600 characters.";
    if (has("source_ids") && input.source_ids !== undefined) {
        const ids = input.source_ids;
        const valid = Array.isArray(ids) && ids.length <= 5 && ids.every((s) => typeof s === "string");
        const known = valid ? await rows(pool, "SELECT id FROM sources WHERE id = ANY($1)", [ids]) : [];
        if (!valid || known.length !== new Set(ids).size)
            fields.source_ids = "Choose up to five existing sources.";
    }
    return fields;
}
export async function createEvent(user, input) {
    assertValid(await eventFieldErrors(input, false));
    const id = `ev-${input.year}-${randomBytes(4).toString("hex")}`;
    const item = await tx(async (db) => {
        await db.query("INSERT INTO events (id, chapter, year, title, summary, source_ids, status, owner_email) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)", [
            id,
            input.chapter,
            input.year,
            input.title.trim(),
            input.summary.trim(),
            input.source_ids ?? [],
            user.email,
        ]);
        await recordAction(db, user.email, "item_created", "event", id, { chapter: input.chapter, title: input.title });
        return (await itemById(db, id));
    });
    return { status: 201, body: { item: itemJson(item) } };
}
const curatorOf = (user, item) => ({ isOwner: item.owner_email === user.email, isLead: user.role === "lead_curator" });
export async function editItem(user, id, input) {
    const existing = await itemById(pool, id);
    if (!existing)
        throw fail.notFound();
    const who = curatorOf(user, existing);
    if (!who.isOwner && !who.isLead)
        throw fail.forbidden();
    const item = await tx(async (db) => {
        const table = existing.type === "chapter" ? "chapters" : "events";
        const current = (await one(db, `SELECT status FROM ${table} WHERE id = $1 FOR UPDATE`, [id]));
        if (current.status !== "draft")
            throw fail.conflict("not_editable", COPY.notEditable);
        const allowed = existing.type === "chapter" ? ["title", "era", "body", "sightline_deg"] : ["chapter", "year", "title", "summary", "source_ids"];
        const changes = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)));
        const fields = {};
        if (existing.type === "chapter") {
            if ("title" in changes && !isText(changes.title, 3, 120))
                fields.title = COPY.sessionTitleField;
            if ("era" in changes && !isText(changes.era, 3, 40))
                fields.era = "Give an era of 3 to 40 characters.";
            if ("body" in changes && !isText(changes.body, 10, 20000))
                fields.body = "Write a body of at least 10 characters.";
            if ("sightline_deg" in changes && !(isIntIn(changes.sightline_deg, -60, 60) && changes.sightline_deg % 3 === 0)) {
                fields.sightline_deg = "Choose a multiple of 3 from -60 to 60.";
            }
        }
        else
            Object.assign(fields, await eventFieldErrors(changes, true));
        if (!Object.keys(changes).length)
            fields.body = "Change at least one editable field.";
        assertValid(fields);
        const keys = Object.keys(changes);
        await db.query(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...keys.map((k) => changes[k])]);
        await recordAction(db, user.email, "item_edited", existing.type, id, { fields: keys });
        return (await itemById(db, id));
    });
    return { status: 200, body: { item: itemJson(item) } };
}
const LEAD = SEED_ACCOUNTS.find((a) => a.role === "lead_curator");
const nameOf = (email) => SEED_ACCOUNTS.find((a) => a.email === email)?.name ?? email;
export async function transition(user, id, input) {
    const existing = await itemById(pool, id);
    if (!existing)
        throw fail.notFound();
    const to = input.to;
    if (typeof to !== "string" || !ITEM_STATUSES.includes(to))
        throw fail.validation({ to: "Choose a lifecycle status." });
    const target = to;
    const verdict = judgeMover(target, curatorOf(user, existing));
    if (verdict === "lead_only")
        throw new ApiError(403, "lead_only", COPY.leadOnly);
    if (verdict === "forbidden")
        throw fail.forbidden();
    const outcome = await tx(async (db) => {
        const table = existing.type === "chapter" ? "chapters" : "events";
        const current = (await one(db, `SELECT status FROM ${table} WHERE id = $1 FOR UPDATE`, [id]));
        if (!isLegalMove(current.status, target))
            throw fail.conflict("illegal_transition", copyFor.illegalTransition(STATUS_LABELS[current.status]));
        const fields = {};
        let publishAt = null;
        if (target === "scheduled") {
            publishAt = typeof input.publish_at === "string" ? parseIsoWithOffset(input.publish_at) : null;
            if (publishAt === null || publishAt <= Date.now())
                fields.publish_at = COPY.afterNow;
        }
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (target === "withdrawn" && (reason.length < 3 || reason.length > 500))
            fields.reason = COPY.reasonField;
        assertValid(fields);
        await db.query(`UPDATE ${table} SET status = $2, publish_at = CASE WHEN $2 = 'scheduled' THEN $3::timestamptz WHEN $2 = 'draft' THEN NULL ELSE publish_at END WHERE id = $1`, [
            id,
            target,
            publishAt === null ? null : new Date(publishAt),
        ]);
        await recordAction(db, user.email, "transition", existing.type, id, { from: current.status, to: target, ...(target === "withdrawn" ? { reason } : {}) });
        let mailId = null;
        if (target === "review")
            mailId = await queueMail(db, { email: LEAD.email, name: LEAD.name }, `For review: ${existing.title}`, `${LEAD.name}\n${user.name} sent "${existing.title}" to review.\nOpen the studio to schedule it: ${config.publicUrl}/studio\n`);
        if (target === "withdrawn") {
            mailId = await queueMail(db, { email: existing.owner_email, name: nameOf(existing.owner_email) }, `Withdrawn: ${existing.title}`, `${nameOf(existing.owner_email)}\n"${existing.title}" has been withdrawn from the exhibition.\nReason: ${reason}\n`);
        }
        return { item: (await itemById(db, id)), mailId };
    });
    if (outcome.mailId !== null)
        await deliverNow([outcome.mailId]);
    return { status: 200, body: { item: itemJson(outcome.item) } };
}
export async function createSource(user, input) {
    if (!isText(input.citation, 5, 300))
        throw fail.validation({ citation: "Give a citation of 5 to 300 characters." });
    const source = await locked("sources", async (db) => {
        const next = (await one(db, "SELECT COALESCE(MAX(n), 0) + 1 AS n FROM sources")).n;
        const id = `src-${next}`;
        await db.query("INSERT INTO sources (id, n, citation) VALUES ($1, $2, $3)", [id, next, input.citation.trim()]);
        await recordAction(db, user.email, "source_created", "source", id, { citation: input.citation });
        return { id, citation: input.citation.trim() };
    });
    return { status: 201, body: { source } };
}
/** Publishes every scheduled item whose publish_at has passed, exactly once across instances. */
export async function publishDue() {
    await tx(async (db) => {
        for (const table of ["chapters", "events"]) {
            const published = await db.query(`UPDATE ${table} SET status = 'published' WHERE status = 'scheduled' AND publish_at <= now() RETURNING id`);
            for (const { id } of published.rows) {
                await recordAction(db, "system", "published", table === "chapters" ? "chapter" : "event", id, { from: "scheduled", to: "published" });
            }
        }
    });
}
