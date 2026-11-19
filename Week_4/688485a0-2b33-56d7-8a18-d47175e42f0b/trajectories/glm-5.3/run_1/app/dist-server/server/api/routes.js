import { readSessionToken, sessionCookieHeader, clearSessionCookieHeader, roleIn } from "./state.js";
import { status, RAW_RESPONSE } from "./http.js";
import { fail } from "../../shared/errors.js";
import { hashPassword, verifyPassword, newCode, findUserByEmail, createSession, destroySession, isValidEmail, } from "./auth.js";
import { sendMail } from "../services/smtp.js";
import { newId, checkDocument } from "../../shared/document-rules.js";
import { parseValidator, validateDocument } from "../../shared/query/validator.js";
import { schemaSummary } from "../../shared/query/schema.js";
import { parseFilter, matches, parseSort } from "../../shared/query/filter.js";
import { sortDocs } from "../../shared/query/sort.js";
import { loadDocs, runQuery, collectionById, insertDocument, updateDocument, deleteDocument, loadDoc, rebuildUniqueEntries, loadValidator, recordChange, docRefusal, validationText } from "./documents.js";
import { withTransaction } from "../db/db.js";
import { defaultIndexName } from "../db/unique-index.js";
import { compileStage, parseStage, runPipeline } from "../../shared/query/pipeline.js";
import { parseCsv, parseJsonLines, rowToDocument, docsToCsvText, docsToJsonlText } from "../../shared/files.js";
import { sampleSieve } from "./sample.js";
function jsonBody(ctx) {
    if (ctx.body.length === 0)
        return {};
    try {
        return JSON.parse(ctx.body.toString("utf8"));
    }
    catch {
        fail("invalid_body", 400);
    }
}
function stringField(body, name) {
    const v = body[name];
    return typeof v === "string" ? v : "";
}
export function loadRoutes(state) {
    const L = state.limits;
    async function signedIn(ctx) {
        const token = readSessionToken(ctx.req);
        if (token === null)
            fail("unauthenticated", 401);
        const rows = await state.db.query("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1", [token]);
        if (rows.rows.length === 0)
            fail("unauthenticated", 401);
        return rows.rows[0];
    }
    async function projectOf(ctx, min) {
        const user = await signedIn(ctx);
        const pid = ctx.params["pid"];
        const role = await roleIn(state, pid, user.id);
        if (role === null)
            fail("not_found", 404);
        const order = { owner: 3, editor: 2, reader: 1 };
        if (order[role] < order[min])
            fail("read_only", 403);
        return { pid, role, user };
    }
    async function collectionOf(ctx, min) {
        const p = await projectOf(ctx, min);
        const cid = ctx.params["cid"];
        const col = await collectionById(state.db, p.pid, cid);
        if (col === null)
            fail("not_found", 404);
        return { ...p, cid };
    }
    const api = [];
    // ---------- accounts ----------
    api.push({
        method: "POST", pattern: "/api/auth/signup",
        handler: async (ctx) => {
            const body = jsonBody(ctx);
            const email = stringField(body, "email").toLowerCase();
            const password = stringField(body, "password");
            const name = stringField(body, "name");
            if (!isValidEmail(email) || password.length < 8 || name.length < 1 || name.length > 80) {
                fail("invalid_field", 422, { field: "email" });
            }
            const existing = await findUserByEmail(state.db, email);
            if (existing !== null) {
                if (existing.confirmed)
                    fail("email_taken", 409);
                // an unconfirmed address gets a new code
                const code = newCode();
                await state.db.query("INSERT INTO signup_codes (email, code) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET code = $2, created_at = now()", [email, code]);
                void sendMail(state.env.smtp, email, "Your Jarful code", ["Your code is " + code]).catch(() => { });
                return status(201, { status: "code_sent" });
            }
            const code = newCode();
            const id = newId();
            await state.db.query("INSERT INTO users (id, email, name, password_hash, confirmed) VALUES ($1, $2, $3, $4, FALSE)", [id, email, name, hashPassword(password)]);
            await state.db.query("INSERT INTO signup_codes (email, code) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET code = $2, created_at = now()", [email, code]);
            void sendMail(state.env.smtp, email, "Your Jarful code", ["Your code is " + code]).catch(() => { });
            return status(201, { status: "code_sent" });
        },
    });
    api.push({
        method: "POST", pattern: "/api/auth/confirm",
        handler: async (ctx) => {
            const body = jsonBody(ctx);
            const email = stringField(body, "email").toLowerCase();
            const code = stringField(body, "code");
            const r = await state.db.query("SELECT code FROM signup_codes WHERE email = $1", [email]);
            if (r.rows.length === 0 || r.rows[0].code !== code)
                fail("invalid_code", 422);
            const user = await findUserByEmail(state.db, email);
            if (user === null)
                fail("invalid_code", 422);
            await state.db.query("UPDATE users SET confirmed = TRUE WHERE email = $1", [email]);
            await state.db.query("DELETE FROM signup_codes WHERE email = $1", [email]);
            const token = await createSession(state.db, user.id);
            ctx.res.setHeader("set-cookie", sessionCookieHeader(token));
            return { user: { id: user.id, email: user.email, name: user.name } };
        },
    });
    api.push({
        method: "POST", pattern: "/api/auth/resend",
        handler: async (ctx) => {
            const body = jsonBody(ctx);
            const email = stringField(body, "email").toLowerCase();
            const user = await findUserByEmail(state.db, email);
            if (user !== null && !user.confirmed) {
                const code = newCode();
                await state.db.query("INSERT INTO signup_codes (email, code) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET code = $2, created_at = now()", [email, code]);
                void sendMail(state.env.smtp, email, "Your Jarful code", ["Your code is " + code]).catch(() => { });
            }
            return status(202, { status: "code_sent" });
        },
    });
    api.push({
        method: "POST", pattern: "/api/auth/signin",
        handler: async (ctx) => {
            const body = jsonBody(ctx);
            const email = stringField(body, "email").toLowerCase();
            const password = stringField(body, "password");
            const user = await findUserByEmail(state.db, email);
            if (user === null || !verifyPassword(password, user.password_hash))
                fail("invalid_credentials", 401);
            if (!user.confirmed)
                fail("not_confirmed", 409);
            const token = await createSession(state.db, user.id);
            ctx.res.setHeader("set-cookie", sessionCookieHeader(token));
            return { user: { id: user.id, email: user.email, name: user.name } };
        },
    });
    api.push({
        method: "POST", pattern: "/api/auth/signout",
        handler: async (ctx) => {
            const token = readSessionToken(ctx.req);
            if (token !== null)
                await destroySession(state.db, token);
            ctx.res.setHeader("set-cookie", clearSessionCookieHeader());
            return status(204, "");
        },
    });
    api.push({
        method: "GET", pattern: "/api/me",
        handler: async (ctx) => {
            const user = await signedIn(ctx);
            return { user: { id: user.id, email: user.email, name: user.name } };
        },
    });
    // ---------- projects ----------
    api.push({
        method: "GET", pattern: "/api/projects",
        handler: async (ctx) => {
            const user = await signedIn(ctx);
            const r = await state.db.query(`SELECT p.id, p.name, m.role FROM projects p
         JOIN memberships m ON m.project_id = p.id AND m.user_id = $1
         ORDER BY p.name ASC`, [user.id]);
            return { projects: r.rows };
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects",
        handler: async (ctx) => {
            const user = await signedIn(ctx);
            const body = jsonBody(ctx);
            const name = stringField(body, "name");
            const collection = stringField(body, "collection");
            if (name.length < 1 || name.length > 80)
                fail("invalid_field", 422, { field: "name" });
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(collection))
                fail("invalid_field", 422, { field: "collection" });
            const dup = await state.db.query("SELECT 1 FROM projects p JOIN memberships m ON m.project_id = p.id WHERE p.owner_id = $1 AND p.name = $2", [user.id, name]);
            if (dup.rows.length > 0)
                fail("name_taken", 409);
            const pid = newId();
            const cid = newId();
            await withTransaction(state.db, async (client) => {
                await client.query("INSERT INTO projects (id, name, owner_id) VALUES ($1, $2, $3)", [pid, name, user.id]);
                await client.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3)", [pid, user.id, "owner"]);
                await client.query("INSERT INTO collections (id, project_id, name) VALUES ($1, $2, $3)", [cid, pid, collection]);
            });
            return status(201, { project: { id: pid, name }, collection: { id: cid, name: collection, count: 0 } });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid",
        handler: async (ctx) => {
            const { pid } = await projectOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT p.id, p.name, m.role, u.email, u.name AS owner_name FROM projects p JOIN memberships m ON m.project_id = p.id JOIN users u ON u.id = p.owner_id WHERE p.id = $1 AND m.user_id = $2", [pid, (await signedIn(ctx)).id]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            const row = r.rows[0];
            return { id: row.id, name: row.name, role: row.role, owner: { email: row.email, name: row.owner_name } };
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid",
        handler: async (ctx) => {
            await projectOf(ctx, "owner" /* Role.Owner */);
            await state.db.query("DELETE FROM projects WHERE id = $1", [ctx.params["pid"]]);
            return status(204, "");
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/members",
        handler: async (ctx) => {
            const { pid, role } = await projectOf(ctx, "reader" /* Role.Reader */);
            const members = await state.db.query(`SELECT m.user_id, u.email, u.name, m.role FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.project_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.email ASC`, [pid]);
            let invitations = [];
            if (role === "owner" /* Role.Owner */) {
                const inv = await state.db.query("SELECT id, email, role, state FROM invitations WHERE project_id = $1 AND state = 'pending' ORDER BY email ASC", [pid]);
                invitations = inv.rows;
            }
            return { members: members.rows, invitations };
        },
    });
    api.push({
        method: "PATCH", pattern: "/api/projects/:pid/members/:uid",
        handler: async (ctx) => {
            await projectOf(ctx, "owner" /* Role.Owner */);
            const uid = ctx.params["uid"];
            const body = jsonBody(ctx);
            const role = body["role"];
            if (role !== "editor" && role !== "reader")
                fail("invalid_field", 422, { field: "role" });
            const target = await state.db.query("SELECT m.user_id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.user_id = $2", [ctx.params["pid"], uid]);
            if (target.rows.length === 0)
                fail("not_found", 404);
            if (target.rows[0].role === "owner")
                fail("owner_role_fixed", 422);
            await state.db.query("UPDATE memberships SET role = $3 WHERE project_id = $1 AND user_id = $2", [ctx.params["pid"], uid, role]);
            return { user_id: uid, email: target.rows[0].email, name: target.rows[0].name, role: role };
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/members/:uid",
        handler: async (ctx) => {
            await projectOf(ctx, "owner" /* Role.Owner */);
            const uid = ctx.params["uid"];
            const target = await state.db.query("SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2", [ctx.params["pid"], uid]);
            if (target.rows.length === 0)
                fail("not_found", 404);
            if (target.rows[0].role === "owner")
                fail("owner_role_fixed", 422);
            await state.db.query("DELETE FROM memberships WHERE project_id = $1 AND user_id = $2", [ctx.params["pid"], uid]);
            return status(204, "");
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/invitations",
        handler: async (ctx) => {
            const { pid, user } = await projectOf(ctx, "owner" /* Role.Owner */);
            const body = jsonBody(ctx);
            const email = stringField(body, "email").toLowerCase();
            const role = body["role"];
            if (role !== "editor" && role !== "reader")
                fail("invalid_field", 422, { field: "role" });
            if (!isValidEmail(email))
                fail("invalid_field", 422, { field: "email" });
            const member = await findUserByEmail(state.db, email);
            if (member !== null) {
                const m = await state.db.query("SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2", [pid, member.id]);
                if (m.rows.length > 0)
                    fail("already_member", 409);
            }
            const pending = await state.db.query("SELECT 1 FROM invitations WHERE project_id = $1 AND email = $2 AND state = 'pending'", [pid, email]);
            if (pending.rows.length > 0)
                fail("already_invited", 409);
            const iid = newId();
            await state.db.query("INSERT INTO invitations (id, project_id, email, role, state, inviter_id) VALUES ($1, $2, $3, $4, 'pending', $5)", [iid, pid, email, role, user.id]);
            const project = await state.db.query("SELECT name FROM projects WHERE id = $1", [pid]);
            const projectName = project.rows[0].name;
            void sendMail(state.env.smtp, email, `You're invited to ${projectName} on Jarful`, [
                `${user.name} invited you to ${projectName} as ${role}.`,
                `${state.env.publicUrl}/invites`,
            ]).catch(() => { });
            return status(201, { invitation: { id: iid, email, role: role, state: "pending" } });
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/invitations/:iid",
        handler: async (ctx) => {
            await projectOf(ctx, "owner" /* Role.Owner */);
            const r = await state.db.query("UPDATE invitations SET state = 'revoked' WHERE id = $1 AND project_id = $2 AND state = 'pending' RETURNING id, email, role", [ctx.params["iid"], ctx.params["pid"]]);
            if (r.rows.length === 0)
                fail("invitation_closed", 409);
            return { invitation: { ...r.rows[0], state: "revoked" } };
        },
    });
    api.push({
        method: "GET", pattern: "/api/invitations",
        handler: async (ctx) => {
            const user = await signedIn(ctx);
            const r = await state.db.query(`SELECT i.id, i.role, p.id AS project_id, p.name AS project_name, u.name AS inviter_name
         FROM invitations i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.inviter_id
         WHERE i.email = $1 AND i.state = 'pending' ORDER BY p.name ASC`, [user.email]);
            return {
                invitations: r.rows.map(row => ({
                    id: row.id,
                    project: { id: row.project_id, name: row.project_name },
                    role: row.role,
                    inviter: { name: row.inviter_name },
                })),
            };
        },
    });
    api.push({
        method: "POST", pattern: "/api/invitations/:iid/accept",
        handler: async (ctx) => {
            const user = await signedIn(ctx);
            const r = await state.db.query("SELECT id, project_id, email, role, state FROM invitations WHERE id = $1", [ctx.params["iid"]]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            const inv = r.rows[0];
            if (inv.email !== user.email)
                fail("not_found", 404);
            if (inv.state !== "pending")
                fail("invitation_closed", 409);
            const upd = await state.db.query("UPDATE invitations SET state = 'accepted' WHERE id = $1 AND state = 'pending' RETURNING id", [ctx.params["iid"]]);
            if (upd.rows.length === 0)
                fail("invitation_closed", 409);
            await state.db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3", [inv.project_id, user.id, inv.role]);
            return { project_id: inv.project_id };
        },
    });
    // ---------- collections ----------
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections",
        handler: async (ctx) => {
            const { pid } = await projectOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query(`SELECT c.id, c.name, (SELECT count(*)::int FROM documents WHERE collection_id = c.id) AS count
         FROM collections c WHERE c.project_id = $1 ORDER BY c.name ASC`, [pid]);
            return { collections: r.rows };
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections",
        handler: async (ctx) => {
            await projectOf(ctx, "owner" /* Role.Owner */);
            const body = jsonBody(ctx);
            const name = stringField(body, "name");
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(name))
                fail("invalid_field", 422, { field: "name" });
            const dup = await state.db.query("SELECT 1 FROM collections WHERE project_id = $1 AND name = $2", [ctx.params["pid"], name]);
            if (dup.rows.length > 0)
                fail("name_taken", 409);
            const cid = newId();
            await state.db.query("INSERT INTO collections (id, project_id, name) VALUES ($1, $2, $3)", [cid, ctx.params["pid"], name]);
            return status(201, { collection: { id: cid, name, count: 0 } });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const col = await collectionById(state.db, ctx.params["pid"], cid);
            const val = await state.db.query("SELECT validator FROM validators WHERE collection_id = $1", [cid]);
            return {
                id: col?.id, name: col?.name, count: col?.count, sequence: col?.sequence,
                validator: val.rows.length > 0 ? val.rows[0].validator : null,
            };
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/collections/:cid",
        handler: async (ctx) => {
            await collectionOf(ctx, "owner" /* Role.Owner */);
            await state.db.query("DELETE FROM collections WHERE id = $1", [ctx.params["cid"]]);
            return status(204, "");
        },
    });
    // ---------- documents ----------
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/documents",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const body = jsonBody(ctx);
            const doc = body["document"];
            const check = checkDocument(doc, L, undefined);
            if (!check.ok)
                docRefusal(check.message);
            let id = check.id;
            if (id === "") {
                id = newId();
                check.doc["_id"] = id;
            }
            const validator = await loadValidator(state.db, cid);
            if (validator !== null) {
                const v = validateDocument(check.doc, validator);
                if (v !== null)
                    fail("validation_failed", 422, { path: v.path, rule: v.rule });
            }
            const result = await withTransaction(state.db, async (client) => {
                const existing = await client.query("SELECT 1 FROM documents WHERE collection_id = $1 AND _id = $2", [cid, id]);
                if (existing.rows.length > 0)
                    fail("id_mismatch", 422);
                const out = await insertDocument(client, cid, check.doc, id);
                await recordChange(client, cid, "insert", id, check.doc, 1);
                return out;
            });
            return status(201, { document: result.document, version: result.version });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/documents/:did",
        handler: async (ctx) => {
            await collectionOf(ctx, "reader" /* Role.Reader */);
            const doc = await loadDoc(state.db, ctx.params["cid"], ctx.params["did"]);
            if (doc === null)
                fail("not_found", 404);
            return { document: doc.doc, version: doc.version };
        },
    });
    api.push({
        method: "PUT", pattern: "/api/projects/:pid/collections/:cid/documents/:did",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const did = ctx.params["did"];
            const body = jsonBody(ctx);
            const doc = body["document"];
            const version = body["version"];
            if (typeof version !== "number" || !Number.isInteger(version))
                fail("invalid_field", 422, { field: "version" });
            const check = checkDocument(doc, L, did);
            if (!check.ok)
                docRefusal(check.message);
            if (check.id === "") {
                check.doc["_id"] = did;
            }
            const validator = await loadValidator(state.db, cid);
            if (validator !== null) {
                const v = validateDocument(check.doc, validator);
                if (v !== null)
                    fail("validation_failed", 422, { path: v.path, rule: v.rule });
            }
            const result = await withTransaction(state.db, async (client) => {
                const cur = await client.query("SELECT version, body FROM documents WHERE collection_id = $1 AND _id = $2 FOR UPDATE", [cid, did]);
                if (cur.rows.length === 0)
                    fail("not_found", 404);
                const storedVersion = cur.rows[0].version;
                if (storedVersion !== version) {
                    fail("version_conflict", 409, { current_version: storedVersion, current: cur.rows[0].body });
                }
                const out = await updateDocument(client, cid, did, check.doc);
                await recordChange(client, cid, "update", did, check.doc, out.version);
                return out;
            });
            return { document: result.document, version: result.version };
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/collections/:cid/documents/:did",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const did = ctx.params["did"];
            await withTransaction(state.db, async (client) => {
                await deleteDocument(client, cid, did);
                await recordChange(client, cid, "delete", did, null, null);
            });
            return status(204, "");
        },
    });
    // ---------- query, aggregation, pipeline draft ----------
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/query",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const body = jsonBody(ctx);
            const filter = body["filter"] ?? {};
            const projection = body["projection"] ?? null;
            const sort = body["sort"] ?? null;
            const limit = body["limit"] ?? 0;
            const page = body["page"] ?? 1;
            if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
                fail("invalid_query", 422, { field: "filter" });
            }
            if (projection !== null && (typeof projection !== "object" || Array.isArray(projection))) {
                fail("invalid_query", 422, { field: "projection" });
            }
            if (sort !== null && (typeof sort !== "object" || Array.isArray(sort))) {
                fail("invalid_query", 422, { field: "sort" });
            }
            if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
                fail("invalid_query", 422, { field: "limit" });
            }
            if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
                fail("invalid_query", 422, { field: "page" });
            }
            return runQuery(state.db, cid, { filter, projection, sort, limit, page }, L);
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/aggregate",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const body = jsonBody(ctx);
            const pipeline = body["pipeline"];
            const disabled = Array.isArray(body["disabled"]) ? body["disabled"] : [];
            const preview = body["preview"] === true;
            const pin = typeof body["pin"] === "string" ? body["pin"] : undefined;
            const page = typeof body["page"] === "number" ? body["page"] : 1;
            if (!Array.isArray(pipeline))
                fail("invalid_stage", 422, { index: 0 });
            if (pipeline.length > L.maxStages)
                fail("too_many_stages", 422, { limit: L.maxStages });
            const docs = await loadDocs(state.db, cid);
            const compiled = pipeline.map((s, i) => {
                const { op, body: stageBody } = parseStage(s, i);
                return { ...compileStage(op, stageBody, i), disabled: disabled.includes(i) };
            });
            // scan guard: the first enabled stage's examined count (DP-78)
            const firstEnabled = compiled.find(s => !s.disabled);
            let examined = docs.length;
            if (firstEnabled !== undefined && firstEnabled.op === "$match" && firstEnabled.match !== undefined) {
                examined = docs.filter(d => matches(firstEnabled.match, d)).length;
            }
            if (examined > L.scanLimit)
                fail("scan_limit", 422, { limit: L.scanLimit });
            const result = runPipeline(docs, compiled, pin === undefined ? { previewDocs: L.previewDocs } : { previewDocs: L.previewDocs, pin });
            if (preview) {
                const input = docs.length;
                return {
                    input,
                    stages: result.stages.map(s => ({
                        index: s.index,
                        count: s.count,
                        disabled: compiled[s.index].disabled,
                        documents: s.documents,
                    })),
                    pin: result.pin ?? null,
                };
            }
            const outDocs = result.stages.length > 0 ? result.stages[result.stages.length - 1].documents : [];
            // paged aggregation needs the full output, so rerun with a large preview
            const full = runPipeline(docs, compiled, { previewDocs: Number.MAX_SAFE_INTEGER });
            const all = full.stages.length > 0 ? full.stages[full.stages.length - 1].documents : [];
            const pageSize = L.pageSize;
            const start = (page - 1) * pageSize;
            return {
                count: all.length,
                page,
                page_size: pageSize,
                documents: all.slice(start, start + pageSize),
            };
            void outDocs;
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/pipeline",
        handler: async (ctx) => {
            const { cid, user } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT stages, disabled FROM pipeline_drafts WHERE collection_id = $1 AND user_id = $2", [cid, user.id]);
            if (r.rows.length === 0)
                return { stages: [], disabled: [] };
            return { stages: r.rows[0].stages, disabled: r.rows[0].disabled };
        },
    });
    api.push({
        method: "PUT", pattern: "/api/projects/:pid/collections/:cid/pipeline",
        handler: async (ctx) => {
            const { cid, user } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const body = jsonBody(ctx);
            const stages = body["stages"];
            const disabled = body["disabled"];
            if (!Array.isArray(stages) || stages.some(s => typeof s !== "string"))
                fail("invalid_field", 422, { field: "stages" });
            if (!Array.isArray(disabled) || disabled.some(d => typeof d !== "number"))
                fail("invalid_field", 422, { field: "disabled" });
            if (stages.length > L.maxStages)
                fail("too_many_stages", 422, { limit: L.maxStages });
            for (const s of stages) {
                if (Buffer.byteLength(s, "utf8") > L.maxDocBytes)
                    fail("invalid_field", 422, { field: "stages" });
            }
            await state.db.query(`INSERT INTO pipeline_drafts (collection_id, user_id, stages, disabled) VALUES ($1, $2, $3, $4)
         ON CONFLICT (collection_id, user_id) DO UPDATE SET stages = $3, disabled = $4`, [cid, user.id, JSON.stringify(stages), JSON.stringify(disabled)]);
            return { stages, disabled };
        },
    });
    // ---------- indexes ----------
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/indexes",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT name, keys, unique_flag AS unique FROM indexes WHERE collection_id = $1 ORDER BY name ASC", [cid]);
            const all = [{ name: "_id_", keys: { _id: 1 }, unique: true }, ...r.rows];
            return { indexes: all };
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/indexes",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "owner" /* Role.Owner */);
            const body = jsonBody(ctx);
            const keys = body["keys"];
            const unique = body["unique"] === true;
            const name = typeof body["name"] === "string" && body["name"].length > 0 ? body["name"] : undefined;
            if (typeof keys !== "object" || keys === null || Array.isArray(keys) || Object.keys(keys).length === 0) {
                fail("invalid_index", 422);
            }
            const keysObj = keys;
            const keyList = [];
            for (const k of Object.keys(keysObj)) {
                const v = keysObj[k];
                if (v !== 1 && v !== -1)
                    fail("invalid_index", 422);
                keyList.push({ path: k, dir: v });
            }
            const finalName = name ?? defaultIndexName(keyList);
            const dup = await state.db.query("SELECT 1 FROM indexes WHERE collection_id = $1 AND name = $2", [cid, finalName]);
            if (dup.rows.length > 0)
                fail("name_taken", 409);
            if (unique) {
                const dupResult = await withTransaction(state.db, async (client) => {
                    const r = await rebuildUniqueEntries(client, cid, finalName, keyList);
                    if (r !== null)
                        return r;
                    await client.query("INSERT INTO indexes (collection_id, name, keys, unique_flag) VALUES ($1, $2, $3, TRUE)", [cid, finalName, JSON.stringify(keys)]);
                    return null;
                });
                if (dupResult !== null)
                    fail("duplicate_key", 409, { index: finalName, value: dupResult.value });
            }
            else {
                await state.db.query("INSERT INTO indexes (collection_id, name, keys, unique_flag) VALUES ($1, $2, $3, FALSE)", [cid, finalName, JSON.stringify(keys)]);
            }
            return status(201, { index: { name: finalName, keys, unique } });
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/collections/:cid/indexes/:name",
        handler: async (ctx) => {
            await collectionOf(ctx, "owner" /* Role.Owner */);
            const name = ctx.params["name"];
            if (name === "_id_")
                fail("cannot_drop_id_index", 422);
            const r = await state.db.query("DELETE FROM indexes WHERE collection_id = $1 AND name = $2", [ctx.params["cid"], name]);
            if (r.rowCount === 0)
                fail("not_found", 404);
            await state.db.query("DELETE FROM unique_entries WHERE collection_id = $1 AND index_name = $2", [ctx.params["cid"], name]);
            return status(204, "");
        },
    });
    // ---------- validator, schema, saved queries ----------
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/validator",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT validator FROM validators WHERE collection_id = $1", [cid]);
            return { validator: r.rows.length > 0 ? r.rows[0].validator : null };
        },
    });
    api.push({
        method: "PUT", pattern: "/api/projects/:pid/collections/:cid/validator",
        handler: async (ctx) => {
            await collectionOf(ctx, "owner" /* Role.Owner */);
            const body = jsonBody(ctx);
            const validator = body["validator"];
            const spec = parseValidator(validator);
            await state.db.query("INSERT INTO validators (collection_id, validator) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET validator = $2", [ctx.params["cid"], spec === null ? null : JSON.stringify(validator)]);
            return { validator };
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/schema",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const docs = await loadDocs(state.db, cid);
            const sample = docs.slice(0, L.schemaSample);
            return schemaSummary(sample);
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/saved-queries",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT id, name, filter, projection, sort, \"limit\", last_run_at, last_count FROM saved_queries WHERE collection_id = $1 ORDER BY name ASC", [cid]);
            return {
                saved_queries: r.rows.map(row => ({
                    ...row,
                    last_run_at: row.last_run_at === null ? null : utcText(new Date(row.last_run_at)),
                })),
            };
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/saved-queries",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const body = jsonBody(ctx);
            const saved = savedQueryFrom(body);
            const dup = await state.db.query("SELECT 1 FROM saved_queries WHERE collection_id = $1 AND name = $2", [cid, saved.name]);
            if (dup.rows.length > 0)
                fail("name_taken", 409);
            const id = newId();
            await state.db.query("INSERT INTO saved_queries (id, collection_id, name, filter, projection, sort, \"limit\") VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, cid, saved.name, JSON.stringify(saved.filter), saved.projection === null ? null : JSON.stringify(saved.projection), saved.sort === null ? null : JSON.stringify(saved.sort), saved.limit]);
            return status(201, { saved_query: { id, ...saved, last_run_at: null, last_count: null } });
        },
    });
    api.push({
        method: "PUT", pattern: "/api/projects/:pid/collections/:cid/saved-queries/:qid",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const qid = ctx.params["qid"];
            const body = jsonBody(ctx);
            const saved = savedQueryFrom(body);
            const other = await state.db.query("SELECT 1 FROM saved_queries WHERE collection_id = $1 AND name = $2 AND id <> $3", [cid, saved.name, qid]);
            if (other.rows.length > 0)
                fail("name_taken", 409);
            const r = await state.db.query("UPDATE saved_queries SET name = $3, filter = $4, projection = $5, sort = $6, \"limit\" = $7 WHERE id = $1 AND collection_id = $2 RETURNING id", [qid, cid, saved.name, JSON.stringify(saved.filter), saved.projection === null ? null : JSON.stringify(saved.projection), saved.sort === null ? null : JSON.stringify(saved.sort), saved.limit]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            return { saved_query: { id: qid, ...saved } };
        },
    });
    api.push({
        method: "DELETE", pattern: "/api/projects/:pid/collections/:cid/saved-queries/:qid",
        handler: async (ctx) => {
            await collectionOf(ctx, "editor" /* Role.Editor */);
            const r = await state.db.query("DELETE FROM saved_queries WHERE id = $1 AND collection_id = $2", [ctx.params["qid"], ctx.params["cid"]]);
            if (r.rowCount === 0)
                fail("not_found", 404);
            return status(204, "");
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/saved-queries/:qid/run",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const qid = ctx.params["qid"];
            const body = jsonBody(ctx);
            const page = typeof body["page"] === "number" && Number.isInteger(body["page"]) && body["page"] > 0 ? body["page"] : 1;
            const r = await state.db.query("SELECT name, filter, projection, sort, \"limit\" FROM saved_queries WHERE id = $1 AND collection_id = $2", [qid, cid]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            const q = r.rows[0];
            const answer = await runQuery(state.db, cid, {
                filter: q.filter, projection: q.projection, sort: q.sort, limit: q.limit, page,
            }, L);
            const now = new Date();
            await state.db.query("UPDATE saved_queries SET last_run_at = $2, last_count = $3 WHERE id = $1", [qid, now, answer.matched]);
            return {
                ...answer,
                saved_query: {
                    id: qid, name: q.name, filter: q.filter, projection: q.projection, sort: q.sort, limit: q.limit,
                    last_run_at: utcText(now), last_count: answer.matched,
                },
            };
        },
    });
    // ---------- files ----------
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/imports", raw: true,
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "editor" /* Role.Editor */);
            const format = ctx.query.get("format");
            if (format !== "jsonl" && format !== "csv")
                fail("invalid_field", 422, { field: "format" });
            const fileNameHeader = ctx.req.headers["x-file-name"];
            const name = typeof fileNameHeader === "string" && fileNameHeader.length > 0 ? fileNameHeader : "upload";
            const bytes = ctx.body;
            const importId = newId();
            // storage must confirm it holds the exact bytes before parsing (DP-69)
            let stored = false;
            try {
                await state.s3.putObject("imports/" + importId, bytes, "application/octet-stream");
                const back = await state.s3.getObject("imports/" + importId);
                stored = back !== null && back.equals(bytes);
            }
            catch {
                stored = false;
            }
            if (!stored) {
                await recordImport(state, importId, cid, name, format, "refused", bytes.length, 0, []);
                fail("storage_unavailable", 503);
            }
            const text = bytes.toString("utf8");
            const items = [];
            if (format === "jsonl") {
                const parsed = parseJsonLines(text);
                parsed.docs.forEach((doc, i) => items.push({ line: i + 1, doc, message: parsed.errors[i] }));
            }
            else {
                const csv = parseCsv(text);
                if (csv.header === null || csv.headerError !== null) {
                    const message = csv.headerError ?? "missing header row";
                    await recordImport(state, importId, cid, name, format, "finished", bytes.length, 0, [{ line: 1, message }]);
                    fail("import_failed", 422, { import_id: importId, errors: [{ line: 1, message }] });
                }
                for (const rec of csv.records) {
                    if (rec.cells.length !== csv.header.length) {
                        items.push({ line: rec.line, doc: null, message: `row has ${rec.cells.length} cells, header has ${csv.header.length}` });
                        continue;
                    }
                    items.push({ line: rec.line, doc: rowToDocument(csv.header, rec.cells), message: null });
                }
            }
            const dataLines = items.filter(it => it.doc !== null || it.message !== null);
            if (dataLines.length > L.importMaxLines) {
                await recordImport(state, importId, cid, name, format, "finished", bytes.length, 0, []);
                fail("too_many_lines", 422, { limit: L.importMaxLines });
            }
            // every data line in order; all or nothing (DP-72)
            const validator = await loadValidator(state.db, cid);
            const errors = [];
            const checked = [];
            const seenIds = new Set();
            for (const item of dataLines) {
                if (item.doc === null) {
                    errors.push({ line: item.line, message: item.message ?? "not valid JSON" });
                    continue;
                }
                const check = checkDocument(item.doc, L, undefined);
                if (!check.ok) {
                    errors.push({ line: item.line, message: check.message });
                    continue;
                }
                let id = check.id;
                if (id === "") {
                    id = newId();
                    check.doc["_id"] = id;
                }
                if (seenIds.has(id)) {
                    errors.push({ line: item.line, message: "invalid _id" });
                    continue;
                }
                if (validator !== null) {
                    const v = validateDocument(check.doc, validator);
                    if (v !== null) {
                        errors.push({ line: item.line, message: validationText(v.path, v.rule, v.expected) });
                        continue;
                    }
                }
                seenIds.add(id);
                checked.push({ line: item.line, doc: check.doc, id });
            }
            if (errors.length > 0) {
                await recordImport(state, importId, cid, name, format, "finished", bytes.length, 0, errors.slice(0, 20));
                fail("import_failed", 422, { import_id: importId, errors: errors.slice(0, 20) });
            }
            const inserted = await withTransaction(state.db, async (client) => {
                let count = 0;
                for (const item of checked) {
                    const out = await insertDocument(client, cid, item.doc, item.id);
                    await recordChange(client, cid, "insert", item.id, item.doc, out.version);
                    count++;
                }
                return count;
            });
            await recordImport(state, importId, cid, name, format, "finished", bytes.length, inserted, []);
            return status(201, { import_id: importId, inserted });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/imports",
        handler: async (ctx) => {
            const { cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT id, file_name, format, state, bytes::int AS bytes, inserted, errors, created_at FROM imports WHERE collection_id = $1 ORDER BY created_at DESC", [cid]);
            return {
                imports: r.rows.map(row => ({ ...row, created_at: utcText(new Date(row.created_at)) })),
            };
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/imports/:iid",
        handler: async (ctx) => {
            await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT id, file_name, format, state, bytes::int AS bytes, inserted, errors, created_at FROM imports WHERE id = $1 AND collection_id = $2", [ctx.params["iid"], ctx.params["cid"]]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            const row = r.rows[0];
            return { ...row, created_at: utcText(new Date(row.created_at)) };
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/imports/:iid/original", raw: true,
        handler: async (ctx) => {
            await collectionOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query("SELECT id, file_name FROM imports WHERE id = $1 AND collection_id = $2", [ctx.params["iid"], ctx.params["cid"]]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            let data = null;
            try {
                data = await state.s3.getObject("imports/" + r.rows[0].id);
            }
            catch {
                fail("storage_unavailable", 503);
            }
            if (data === null)
                fail("storage_unavailable", 503);
            ctx.res.writeHead(200, {
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename="${r.rows[0].file_name}"`,
                "content-length": String(data.length),
            });
            ctx.res.end(data);
            return RAW_RESPONSE;
        },
    });
    api.push({
        method: "POST", pattern: "/api/projects/:pid/collections/:cid/exports",
        handler: async (ctx) => {
            const { pid, cid } = await collectionOf(ctx, "reader" /* Role.Reader */);
            const body = jsonBody(ctx);
            const format = body["format"];
            if (format !== "jsonl" && format !== "csv")
                fail("invalid_field", 422, { field: "format" });
            const filter = body["filter"] ?? {};
            const sort = body["sort"] ?? null;
            if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
                fail("invalid_query", 422, { field: "filter" });
            }
            const plan = parseFilter(filter);
            const docs = await loadDocs(state.db, cid);
            if (docs.length > L.scanLimit)
                fail("scan_limit", 422, { limit: L.scanLimit });
            const matched = docs.filter(d => matches(plan, d));
            const sorted = sortDocs(matched, parseSort(sort));
            const text = format === "jsonl" ? docsToJsonlText(sorted) : docsToCsvText(sorted);
            const exportId = newId();
            try {
                await state.s3.putObject(`exports/${exportId}.${format}`, Buffer.from(text, "utf8"), "application/octet-stream");
            }
            catch {
                fail("storage_unavailable", 503);
            }
            const col = await collectionById(state.db, pid, cid);
            const fileName = `${col?.name ?? "export"}.${format}`;
            await state.db.query("INSERT INTO exports (id, collection_id, format, file_name) VALUES ($1, $2, $3, $4)", [exportId, cid, format, fileName]);
            return status(201, { export_id: exportId, download_url: `/api/projects/${pid}/exports/${exportId}` });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/exports/:eid", raw: true,
        handler: async (ctx) => {
            const { pid } = await projectOf(ctx, "reader" /* Role.Reader */);
            const r = await state.db.query(`SELECT e.id, e.file_name, e.format FROM exports e
         JOIN collections c ON c.id = e.collection_id
         WHERE e.id = $1 AND c.project_id = $2`, [ctx.params["eid"], pid]);
            if (r.rows.length === 0)
                fail("not_found", 404);
            let data = null;
            try {
                data = await state.s3.getObject(`exports/${r.rows[0].id}.${r.rows[0].format}`);
            }
            catch {
                fail("storage_unavailable", 503);
            }
            if (data === null)
                fail("storage_unavailable", 503);
            ctx.res.writeHead(200, {
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename="${r.rows[0].file_name}"`,
                "content-length": String(data.length),
            });
            ctx.res.end(data);
            return RAW_RESPONSE;
        },
    });
    // ---------- public ----------
    api.push({
        method: "GET", pattern: "/api/sample/sieve",
        handler: () => sampleSieve(),
    });
    api.push({
        method: "POST", pattern: "/api/grading/seed", raw: true,
        handler: async (ctx) => {
            const key = ctx.req.headers["x-grading-key"];
            if (typeof key !== "string" || key !== state.env.gradingKey)
                fail("not_found", 404);
            const body = JSON.parse(ctx.body.toString("utf8"));
            const users = {};
            for (const u of body.users ?? []) {
                const email = u.email.toLowerCase();
                const existing = await findUserByEmail(state.db, email);
                if (existing === null) {
                    const id = newId();
                    await state.db.query("INSERT INTO users (id, email, name, password_hash, confirmed) VALUES ($1, $2, $3, $4, TRUE)", [id, email, u.name, hashPassword(u.password)]);
                    users[email] = id;
                }
                else {
                    users[email] = existing.id;
                }
            }
            const projects = {};
            for (const p of body.projects ?? []) {
                const ownerId = users[p.owner.toLowerCase()];
                if (ownerId === undefined)
                    fail("invalid_field", 422, { field: "owner" });
                const pid = newId();
                await state.db.query("INSERT INTO projects (id, name, owner_id) VALUES ($1, $2, $3)", [pid, p.name, ownerId]);
                await state.db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'owner')", [pid, ownerId]);
                for (const m of p.members ?? []) {
                    const mid = users[m.email.toLowerCase()];
                    if (mid === undefined)
                        fail("invalid_field", 422, { field: "members" });
                    if (m.role !== "editor" && m.role !== "reader" && m.role !== "owner")
                        fail("invalid_field", 422, { field: "role" });
                    await state.db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3)", [pid, mid, m.role]);
                }
                const collections = {};
                for (const c of p.collections ?? []) {
                    const cid = newId();
                    await state.db.query("INSERT INTO collections (id, project_id, name) VALUES ($1, $2, $3)", [cid, pid, c.name]);
                    const docIds = [];
                    for (const d of c.documents ?? []) {
                        const check = checkDocument(d, L, undefined);
                        if (!check.ok)
                            docRefusal(check.message);
                        let id = check.id;
                        if (id === "") {
                            id = newId();
                            check.doc["_id"] = id;
                        }
                        await withTransaction(state.db, async (client) => {
                            const out = await insertDocument(client, cid, check.doc, id);
                            await recordChange(client, cid, "insert", id, check.doc, out.version);
                        });
                        docIds.push(id);
                    }
                    for (const idx of c.indexes ?? []) {
                        const keyList = Object.keys(idx.keys).map(k => ({ path: k, dir: idx.keys[k] === -1 ? -1 : 1 }));
                        const name = idx.name ?? keyList.map(k => k.path + "_" + k.dir).join("_");
                        const dup = await state.db.query("SELECT 1 FROM indexes WHERE collection_id = $1 AND name = $2", [cid, name]);
                        if (dup.rows.length > 0)
                            fail("name_taken", 409);
                        if (idx.unique) {
                            const dupResult = await withTransaction(state.db, async (client) => {
                                const r = await rebuildUniqueEntries(client, cid, name, keyList);
                                if (r !== null)
                                    return r;
                                await client.query("INSERT INTO indexes (collection_id, name, keys, unique_flag) VALUES ($1, $2, $3, TRUE)", [cid, name, JSON.stringify(idx.keys)]);
                                return null;
                            });
                            if (dupResult !== null) {
                                fail("duplicate_key", 409, { index: name, value: dupResult.value });
                            }
                        }
                        else {
                            await state.db.query("INSERT INTO indexes (collection_id, name, keys, unique_flag) VALUES ($1, $2, $3, FALSE)", [cid, name, JSON.stringify(idx.keys)]);
                        }
                    }
                    if (c.validator !== null && c.validator !== undefined) {
                        parseValidator(c.validator);
                        await state.db.query("INSERT INTO validators (collection_id, validator) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET validator = $2", [cid, JSON.stringify(c.validator)]);
                    }
                    const saved = {};
                    for (const q of c.saved_queries ?? []) {
                        const qid = newId();
                        await state.db.query("INSERT INTO saved_queries (id, collection_id, name, filter, projection, sort, \"limit\") VALUES ($1, $2, $3, $4, $5, $6, $7)", [qid, cid, q.name, JSON.stringify(q.filter ?? {}), q.projection ? JSON.stringify(q.projection) : null, q.sort ? JSON.stringify(q.sort) : null, q.limit ?? 0]);
                        saved[q.name] = qid;
                    }
                    collections[c.name] = { id: cid, documents: docIds, saved_queries: saved };
                }
                projects[p.name] = { id: pid, collections };
            }
            return status(201, { users, projects });
        },
    });
    api.push({
        method: "GET", pattern: "/api/projects/:pid/collections/:cid/events", raw: true,
        handler: async (ctx) => {
            const { cid, user } = await collectionOf(ctx, "reader" /* Role.Reader */);
            ctx.res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
                connection: "keep-alive",
            });
            let lastSeq = Number(ctx.query.get("after") ?? readLastEventId(ctx) ?? 0);
            if (!Number.isFinite(lastSeq) || lastSeq < 0)
                lastSeq = 0;
            if (ctx.query.get("after") === null && readLastEventId(ctx) === null) {
                const cur = await state.db.query("SELECT sequence FROM collections WHERE id = $1", [cid]);
                lastSeq = Number(cur.rows[0]?.sequence ?? 0);
            }
            let closed = false;
            ctx.res.on("close", () => {
                closed = true;
            });
            const deliver = () => {
                void (async () => {
                    if (closed)
                        return;
                    const rows = await state.db.query("SELECT seq, op, _id, document, version FROM changes WHERE collection_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 100", [cid, lastSeq]);
                    for (const row of rows.rows) {
                        ctx.res.write(`id: ${row.seq}\nevent: change\ndata: ${JSON.stringify({ seq: Number(row.seq), op: row.op, _id: row._id, document: row.document ?? null, version: row.version ?? null })}\n\n`);
                        lastSeq = Number(row.seq);
                    }
                    // role events for the listening member (DP-65)
                    const role = await roleIn(state, ctx.params["pid"], user.id);
                    if (role !== null && role !== lastRole) {
                        ctx.res.write(`event: role\ndata: ${JSON.stringify({ role })}\n\n`);
                        lastRole = role;
                    }
                    if (!closed)
                        timer = setTimeout(deliver, 400);
                })().catch(() => {
                    if (!closed)
                        timer = setTimeout(deliver, 2000);
                });
            };
            let lastRole = await roleIn(state, ctx.params["pid"], user.id);
            let timer = undefined;
            deliver();
            const keepAlive = setInterval(() => {
                if (!closed)
                    ctx.res.write(": keep-alive\n\n");
            }, 15000);
            ctx.res.on("close", () => {
                clearInterval(keepAlive);
                if (timer !== undefined)
                    clearTimeout(timer);
            });
            return RAW_RESPONSE;
        },
    });
    return { api };
}
function readLastEventId(ctx) {
    const h = ctx.req.headers["last-event-id"];
    if (typeof h === "string" && /^\d+$/.test(h))
        return Number(h);
    return null;
}
async function recordImport(state, importId, cid, fileName, format, st, bytes, inserted, errors) {
    await state.db.query("INSERT INTO imports (id, collection_id, file_name, format, state, bytes, inserted, errors) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [importId, cid, fileName, format, st, bytes, inserted, JSON.stringify(errors)]);
}
/** UTC text in the published form. */
function utcText(d) {
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
/** Validate a saved-query body (the query route's rules, DP-80). */
function savedQueryFrom(body) {
    const name = stringField(body, "name");
    if (name.length < 1 || name.length > 80)
        fail("invalid_field", 422, { field: "name" });
    const filter = body["filter"] ?? {};
    const projection = body["projection"] ?? null;
    const sort = body["sort"] ?? null;
    const limit = body["limit"] ?? 0;
    if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
        fail("invalid_query", 422, { field: "filter" });
    }
    if (projection !== null && (typeof projection !== "object" || projection === null || Array.isArray(projection))) {
        fail("invalid_query", 422, { field: "projection" });
    }
    if (sort !== null && (typeof sort !== "object" || sort === null || Array.isArray(sort))) {
        fail("invalid_query", 422, { field: "sort" });
    }
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
        fail("invalid_query", 422, { field: "limit" });
    }
    parseFilter(filter);
    parseSort(sort);
    return { name, filter: filter, projection: projection, sort: sort, limit };
}
