// Vet comparison links: each shows its horse's live pair (the two most recent visits that are not open, judged at
// every read), is read-only, dies at once on every instance by revoke, regenerate or expiry, and keeps a view log
// with the pair each view served, under the guess limit (brief: API, Vet links; Business rules, Vet links,
// Vet-link guess limit).
import { randomBytes, randomUUID } from "node:crypto";
import { recordMiss } from "../allowances.js";
import { audit } from "../audit.js";
import { secretHash } from "../auth.js";
import { config } from "../config.js";
import { db, first, transaction } from "../db.js";
import { HOOVES } from "../domain/hoofMarks.js";
import { FIELD_COPY, conflict, notFound, refuseInvalid } from "../errors.js";
import { json, openRoute, route } from "../http.js";
import { vetLinkMail } from "../mail/messages.js";
import { queueEmail } from "../mail/outbox.js";
import { stamp, wallClock } from "../practice.js";
import { signer } from "../signedPaths.js";
import { livePair, visibleHorse } from "../views.js";
import { comparisonOf, markedSides, sideLines } from "./horses.js";
import { isBlank, isEmail, objectBody } from "./input.js";
const LINK_SELECT = `
  SELECT l.*, h.name AS horse_name, (SELECT count(*)::int FROM vet_link_views w WHERE w.link_id = l.id) AS view_count
    FROM vet_links l JOIN horses h ON h.id = l.horse_id`;
const linkStatus = (link, at) => link.revoked_at ? "revoked" : at >= link.expires_at.getTime() ? "expired" : "active";
const entryJson = (link, pair, at) => ({
    id: link.id,
    vet_name: link.vet_name,
    vet_email: link.vet_email,
    status: linkStatus(link, at),
    expires_at: stamp(link.expires_at),
    view_count: link.view_count,
    previous_date: pair?.[0].business_date ?? null,
    current_date: pair?.[1].business_date ?? null,
});
/** The live pair at this moment; a horse with fewer than two visits that are not open has no link to show. */
async function pairNow(client, horseId) {
    const pair = await livePair(client, horseId);
    if (!pair)
        throw conflict("not_enough_visits");
    return pair;
}
/** A new token for the link (the old one dies at once), a fresh expiry, and the email to the vet. */
async function issueToken(client, link, origin, at) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(at + config.vetLinkTtlSeconds * 1000);
    await client.query(`UPDATE vet_link_tokens SET superseded_at = $2 WHERE link_id = $1 AND superseded_at IS NULL`, [link.id, new Date(at)]);
    await client.query(`INSERT INTO vet_link_tokens (id, token_hash, link_id, issued_at) VALUES ($1, $2, $3, $4)`, [
        randomUUID(),
        secretHash(token),
        link.id,
        new Date(at),
    ]);
    await client.query(`UPDATE vet_links SET expires_at = $2, revoked_at = NULL WHERE id = $1`, [link.id, expiresAt]);
    const url = `${origin}/vet/${token}`;
    await queueEmail(client, `vet-link:${secretHash(token)}`, vetLinkMail({ to: link.vet_email, name: link.vet_name, horse: link.horse_name, url, until: wallClock(expiresAt) }));
    return { url, expiresAt };
}
/** The issue and regenerate answer: the pair as it stood at that moment, never changed afterwards. */
const issued = (id, pair, url, expiresAt) => ({
    id,
    url,
    expires_at: stamp(expiresAt),
    previous_visit_id: pair[0].id,
    current_visit_id: pair[1].id,
});
route("POST", "/api/horses/:id/vet-links", ["farrier"], async ({ caller, params, body, now, origin }) => {
    const horse = await visibleHorse(db, caller, params.id ?? "");
    const pair = await pairNow(db, horse.id);
    const fields = objectBody(body);
    const errors = {};
    if (isBlank(fields.vet_name))
        errors.vet_name = FIELD_COPY.required;
    if (isBlank(fields.vet_email))
        errors.vet_email = FIELD_COPY.required;
    else if (!isEmail(fields.vet_email))
        errors.vet_email = FIELD_COPY.email;
    refuseInvalid(errors);
    const link = {
        id: randomUUID(),
        vet_name: String(fields.vet_name).trim(),
        vet_email: String(fields.vet_email).trim(),
        horse_name: horse.name,
    };
    const result = await transaction(async (client) => {
        await client.query(`INSERT INTO vet_links (id, horse_id, vet_name, vet_email, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $5)`, [link.id, horse.id, link.vet_name, link.vet_email, new Date(now)]);
        const made = await issueToken(client, link, origin, now);
        await audit(client, { action: "issue", entityType: "vet_link", entityId: link.id, from: null, to: "active" });
        return made;
    });
    return json(201, issued(link.id, pair, result.url, result.expiresAt));
});
route("GET", "/api/horses/:id/vet-links", ["farrier"], async ({ caller, params, now }) => {
    const horse = await visibleHorse(db, caller, params.id ?? "");
    const { rows } = await db.query(`${LINK_SELECT} WHERE l.horse_id = $1 ORDER BY l.created_at DESC`, [horse.id]);
    const pair = await livePair(db, horse.id);
    return json(200, rows.map((link) => entryJson(link, pair, now)));
});
async function lockLink(client, id) {
    const locked = await client.query(`SELECT 1 FROM vet_links WHERE id = $1 FOR UPDATE`, [id]);
    if (!locked.rowCount)
        throw notFound();
    return first((await client.query(`${LINK_SELECT} WHERE l.id = $1`, [id])).rows);
}
route("POST", "/api/vet-links/:id/revoke", ["farrier"], async ({ params, now }) => {
    const link = await transaction(async (client) => {
        const current = await lockLink(client, params.id ?? "");
        if (!current.revoked_at) {
            await client.query(`UPDATE vet_links SET revoked_at = $2 WHERE id = $1`, [current.id, new Date(now)]);
            await audit(client, { action: "revoke", entityType: "vet_link", entityId: current.id, from: linkStatus(current, now), to: "revoked" });
        }
        return first((await client.query(`${LINK_SELECT} WHERE l.id = $1`, [current.id])).rows);
    });
    return json(200, entryJson(link, await livePair(db, link.horse_id), now));
});
route("POST", "/api/vet-links/:id/regenerate", ["farrier"], async ({ params, now, origin }) => {
    const result = await transaction(async (client) => {
        const link = await lockLink(client, params.id ?? "");
        const pair = await pairNow(client, link.horse_id);
        const made = await issueToken(client, link, origin, now);
        await audit(client, { action: "regenerate", entityType: "vet_link", entityId: link.id, from: linkStatus(link, now), to: "active" });
        return { link, pair, ...made };
    });
    return json(200, issued(result.link.id, result.pair, result.url, result.expiresAt));
});
route("GET", "/api/vet-links/:id/views", ["farrier"], async ({ params }) => {
    const link = await db.query(`SELECT 1 FROM vet_links WHERE id = $1`, [params.id]);
    if (!link.rowCount)
        throw notFound();
    const { rows } = await db.query(`SELECT w.at, w.address, w.outcome, w.user_agent, p.business_date AS previous_date, c.business_date AS current_date
       FROM vet_link_views w LEFT JOIN visits p ON p.id = w.previous_visit_id LEFT JOIN visits c ON c.id = w.current_visit_id
      WHERE w.link_id = $1 ORDER BY w.at DESC, w.id DESC`, [params.id]);
    return json(200, rows.map((view) => ({
        at: stamp(view.at),
        address: view.address,
        outcome: view.outcome,
        user_agent: view.user_agent,
        previous_date: view.previous_date,
        current_date: view.current_date,
    })));
});
// ---- The vet's read ----
openRoute("GET", "/api/vet/:token", async ({ params, req, address, now }) => {
    const { rows } = await db.query(`SELECT l.*, h.name AS horse_name, 0 AS view_count, t.superseded_at
       FROM vet_link_tokens t JOIN vet_links l ON l.id = t.link_id JOIN horses h ON h.id = l.horse_id
      WHERE t.token_hash = $1`, [secretHash(params.token ?? "")]);
    const link = rows[0];
    const agent = String(req.headers["user-agent"] ?? "");
    if (!link) {
        await recordMiss(db, address, now);
        throw notFound();
    }
    const VIEW_OUTCOME = { active: "viewed", revoked: "revoked", expired: "expired" };
    const outcome = link.superseded_at ? "revoked" : VIEW_OUTCOME[linkStatus(link, now)];
    const pair = outcome === "viewed" ? await pairNow(db, link.horse_id) : null;
    await transaction(async (client) => {
        await client.query(`INSERT INTO vet_link_views (link_id, at, address, outcome, user_agent, previous_visit_id, current_visit_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [link.id, new Date(now), address, outcome, agent, pair?.[0].id ?? null, pair?.[1].id ?? null]);
        if (outcome !== "viewed")
            await recordMiss(client, address, now);
    });
    if (!pair)
        throw notFound();
    const [previousVisit, currentVisit] = pair;
    const sign = await signer(db, now);
    const hooves = {};
    for (const hoof of HOOVES) {
        const sides = await markedSides(link.horse_id, hoof, false, [previousVisit.id, currentVisit.id]);
        const previous = sides.find((side) => side.visit_id === previousVisit.id);
        const current = sides.find((side) => side.visit_id === currentVisit.id);
        if (!previous || !current) {
            hooves[hoof] = null;
            continue;
        }
        const { difference, readout } = comparisonOf(previous.marks, current.marks);
        const side = (entry) => {
            const signed = sign("photo", entry.photo.id, link.id);
            return {
                business_date: entry.business_date,
                photo: {
                    hoof,
                    phase: "after",
                    content_type: entry.photo.content_type,
                    width: entry.photo.width,
                    height: entry.photo.height,
                    url: signed.url,
                    url_expires_at: stamp(signed.expiresAt),
                },
                ...sideLines(entry.marks),
            };
        };
        hooves[hoof] = { hoof, previous: side(previous), current: side(current), difference, readout };
    }
    return json(200, {
        horse: { name: link.horse_name },
        previous_date: previousVisit.business_date,
        current_date: currentVisit.business_date,
        expires_at: stamp(link.expires_at),
        hooves,
    });
});
