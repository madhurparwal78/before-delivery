"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleApi = handleApi;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const errors_1 = require("../errors");
const http_1 = require("./http");
const club_1 = require("../domain/club");
const shapes_1 = require("../domain/shapes");
const cycles_1 = require("../domain/cycles");
const pledge_1 = require("../domain/pledge");
const resolution_1 = require("../domain/resolution");
const shorts_1 = require("../domain/shorts");
const topup_1 = require("../domain/topup");
const documents_1 = require("../domain/documents");
const bags_1 = require("../domain/bags");
const daily_1 = require("../domain/daily");
const close_1 = require("../domain/close");
const ledger_1 = require("../domain/ledger");
const money_1 = require("../money");
const idem_1 = require("../util/idem");
const killbill_1 = require("../providers/killbill");
const s3_1 = require("../providers/s3");
const mailworker_1 = require("../providers/mailworker");
const personOf = (v) => (v.householdCode ? `${v.role}:${v.householdCode}` : `${v.role}:${v.name}`);
function requireCoordinator(ctx) {
    if (ctx.viewer.role !== "coordinator")
        throw errors_1.errors.forbidden();
}
function requireVolunteerOrCoordinator(ctx) {
    if (ctx.viewer.role !== "volunteer" && ctx.viewer.role !== "coordinator")
        throw errors_1.errors.forbidden();
}
function requireMember(ctx) {
    if (ctx.viewer.role !== "member" || !ctx.viewer.householdCode)
        throw errors_1.errors.forbidden();
    return ctx.viewer.householdCode;
}
function getCycleOr404(id) {
    const c = (0, club_1.cycle)(id);
    if (!c)
        throw errors_1.errors.notFound();
    return c;
}
/** Compare-and-set status change with its revision bump. */
function transitionStatus(cycleId, from, to) {
    return (0, db_1.tx)(() => {
        const c = (0, db_1.one)("SELECT * FROM cycles WHERE id = ?", cycleId);
        const effNow = Math.floor(Date.now() / 1000);
        const eff = c.status === "open" && c.cutoff_at !== null && effNow >= c.cutoff_at ? "sealing" : c.status;
        if (!from.includes(eff))
            throw errors_1.errors.illegalTransition();
        (0, db_1.run)("UPDATE cycles SET status = ?, revision = revision + 1 WHERE id = ?", to, cycleId);
        return (0, club_1.cycle)(cycleId);
    });
}
const routes = [];
function route(method, pattern, handler) {
    routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });
}
const SEG = "[^/]+";
function sendCycle(ctx, c) {
    (0, http_1.sendJson)(ctx.res, 200, (0, shapes_1.buildCycle)(c, ctx.viewer), { ETag: (0, http_1.etagOf)(c.revision) });
}
// ---------- session ----------
route("POST", "/api/session", async (ctx) => {
    const body = await (0, http_1.readJsonBody)(ctx.req);
    if (typeof body.code !== "string" || body.code.length === 0) {
        throw errors_1.errors.validation({ code: "Enter your access code." });
    }
    const person = (0, db_1.one)("SELECT role, name FROM people WHERE access_code = ?", body.code);
    let viewer = null;
    if (person) {
        viewer = { role: person.role, name: person.name, householdCode: null };
    }
    else {
        const hh = (0, db_1.one)("SELECT code, name FROM households WHERE access_code = ?", body.code);
        if (hh)
            viewer = { role: "member", name: hh.name, householdCode: hh.code };
    }
    if (!viewer)
        throw errors_1.errors.invalidCode();
    const token = (0, node_crypto_1.randomBytes)(24).toString("hex");
    (0, db_1.tx)(() => {
        (0, db_1.run)("INSERT INTO sessions (token, role, person_name, household_code, created_at) VALUES (?, ?, ?, ?, ?)", token, viewer.role, viewer.name, viewer.householdCode, Math.floor(Date.now() / 1000));
    });
    (0, http_1.sendJson)(ctx.res, 200, { role: viewer.role, name: viewer.name, household_code: viewer.householdCode }, {
        "Set-Cookie": `tally_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
    });
});
route("GET", "/api/me", async (ctx) => {
    (0, http_1.sendJson)(ctx.res, 200, { role: ctx.viewer.role, name: ctx.viewer.name, household_code: ctx.viewer.householdCode });
});
route("DELETE", "/api/session", async (ctx) => {
    const token = (0, http_1.parseCookies)(ctx.req.headers.cookie)["tally_session"];
    if (token) {
        (0, db_1.tx)(() => {
            (0, db_1.run)("DELETE FROM sessions WHERE token = ?", token);
        });
    }
    ctx.res.writeHead(204, {
        "Set-Cookie": "tally_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        "Cache-Control": "no-store",
    });
    ctx.res.end();
});
route("GET", "/api/club", async (ctx) => {
    (0, http_1.sendJson)(ctx.res, 200, (0, club_1.clubInfo)());
});
route("GET", "/api/catalog", async (ctx) => {
    requireCoordinator(ctx);
    (0, http_1.sendJson)(ctx.res, 200, {
        products: (0, club_1.catalogue)().map((p) => ({
            id: p.id,
            case_name: p.case_name,
            pack: p.pack,
            unit: p.unit,
            price_cents: p.price_cents,
        })),
    });
});
route("GET", "/api/payments/status", async (ctx) => {
    const state = await (0, killbill_1.paymentsStatus)();
    (0, http_1.sendJson)(ctx.res, 200, { payments: state });
});
// ---------- cycles ----------
route("GET", "/api/cycles", async (ctx) => {
    const rows = (0, db_1.all)("SELECT * FROM cycles ORDER BY sort_order DESC");
    const visible = ctx.viewer.role === "coordinator" ? rows : rows.filter((c) => c.status !== "draft");
    (0, http_1.sendJson)(ctx.res, 200, { cycles: visible.map(shapes_1.cycleSummary) });
});
route("POST", "/api/cycles", async (ctx) => {
    requireCoordinator(ctx);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (typeof raw.name !== "string") {
        throw errors_1.errors.validation({ name: "Name the cycle in 1 to 60 characters on one line." });
    }
    const fields = (0, cycles_1.parseCycleFields)(raw);
    const { resolved, fieldErrors, products } = (0, cycles_1.draftValidation)(fields, {
        cutoffSec: null,
        pickupStartSec: null,
        pickupEndSec: null,
    });
    if (Object.keys(fieldErrors).length > 0)
        throw errors_1.errors.validation(fieldErrors);
    const c = (0, cycles_1.createDraft)(fields, resolved, products);
    (0, http_1.sendJson)(ctx.res, 201, (0, shapes_1.buildCycle)(c, ctx.viewer), { ETag: (0, http_1.etagOf)(c.revision) });
});
route("GET", `/api/cycles/(${SEG})`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    const c = getCycleOr404(id);
    if (c.status === "draft" && ctx.viewer.role !== "coordinator")
        throw errors_1.errors.notFound();
    sendCycle(ctx, c);
});
route("PATCH", `/api/cycles/(${SEG})`, async (ctx) => {
    const id = ctx.params[0];
    const c = getCycleOr404(id);
    requireCoordinator(ctx);
    const { revision } = (0, http_1.parseIfMatch)(ctx.req.headers["if-match"]);
    if (revision === null)
        throw errors_1.errors.preconditionRequired();
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (revision < 0 || revision !== c.revision) {
        throw errors_1.errors.staleCycle((0, http_1.etagOf)(c.revision));
    }
    const fields = (0, cycles_1.parseCycleFields)(raw);
    const updated = (0, cycles_1.patchCycle)(c, fields, Math.floor(Date.now() / 1000));
    sendCycle(ctx, updated);
});
route("POST", `/api/cycles/(${SEG})/transitions`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    const to = typeof raw.to === "string" ? raw.to : "";
    const c = getCycleOr404(id);
    requireCoordinator(ctx);
    if (to === "open") {
        const hasFields = ["name", "cutoff_local", "pickup_start_local", "pickup_end_local", "product_ids"].some((k) => k in raw);
        const { revision } = (0, http_1.parseIfMatch)(ctx.req.headers["if-match"]);
        if (hasFields && revision === null)
            throw errors_1.errors.preconditionRequired();
        if (hasFields && revision !== null && (revision < 0 || revision !== c.revision)) {
            throw errors_1.errors.staleCycle((0, http_1.etagOf)(c.revision));
        }
        const fields = hasFields ? (0, cycles_1.parseCycleFields)(raw) : {};
        const opened = (0, cycles_1.openCycle)(c, fields, Math.floor(Date.now() / 1000));
        sendCycle(ctx, opened);
        return;
    }
    if (to === "ordered") {
        const lineStatuses = (0, db_1.all)("SELECT status FROM lines WHERE cycle_id = ?", c.id);
        if (lineStatuses.some((l) => l.status === "filling"))
            throw errors_1.errors.unresolvedLines();
        if (lineStatuses.length > 0 && lineStatuses.every((l) => l.status === "dropped")) {
            throw errors_1.errors.nothingToOrder();
        }
        const updated = transitionStatus(c.id, ["sealing"], "ordered");
        sendCycle(ctx, updated);
        return;
    }
    if (to === "received") {
        sendCycle(ctx, transitionStatus(c.id, ["ordered"], "received"));
        return;
    }
    if (to === "breakdown") {
        sendCycle(ctx, transitionStatus(c.id, ["received"], "breakdown"));
        return;
    }
    if (to === "closed") {
        const keyError = (0, idem_1.checkIdempotencyKey)(ctx.idempotencyKey);
        if (keyError)
            throw keyError;
        const result = await (0, idem_1.withIdempotency)({
            person: personOf(ctx.viewer),
            key: ctx.idempotencyKey,
            method: "POST",
            path: `/api/cycles/${c.id}/transitions`,
            body: JSON.stringify({ to: "closed" }),
        }, async () => {
            const outcome = await (0, close_1.closeCycle)(c).catch((e) => {
                if (e instanceof killbill_1.KbTimeout || e instanceof killbill_1.KbUnreachable)
                    throw errors_1.errors.paymentsPaused();
                if (e instanceof s3_1.S3Unavailable || e instanceof s3_1.S3Error)
                    throw errors_1.errors.storageUnavailable();
                throw e;
            });
            const closed = (0, club_1.cycle)(c.id);
            return {
                status: 200,
                body: { cycle: (0, shapes_1.buildCycle)(closed, ctx.viewer), receipts_queued: outcome.receiptsQueued },
            };
        });
        (0, mailworker_1.deliverSoon)();
        (0, http_1.sendJson)(ctx.res, result.status, result.body, {
            ETag: (0, http_1.etagOf)((0, club_1.cycle)(c.id).revision),
            ...(result.replay ? { "Idempotent-Replay": "true" } : {}),
        });
        return;
    }
    throw errors_1.errors.illegalTransition();
});
// ---------- pledges ----------
route("PUT", `/api/cycles/(${SEG})/lines/(${SEG})/pledge`, async (ctx) => {
    const id = ctx.params[0];
    const pid = ctx.params[1];
    const keyError = (0, idem_1.checkIdempotencyKey)(ctx.idempotencyKey);
    if (keyError)
        throw keyError;
    const c = getCycleOr404(id);
    const code = requireMember(ctx);
    const p = (0, club_1.product)(pid);
    if (!p)
        throw errors_1.errors.notFound();
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    const units = raw.units;
    if (typeof units !== "number" || !Number.isInteger(units) || units < 1) {
        throw errors_1.errors.validation({ units: `Choose at least 1 unit.` });
    }
    const result = await (0, idem_1.withIdempotency)({
        person: personOf(ctx.viewer),
        key: ctx.idempotencyKey,
        method: "PUT",
        path: `/api/cycles/${id}/lines/${pid}/pledge`,
        body: JSON.stringify(raw),
    }, async () => {
        (0, pledge_1.putPledge)(c, pid, code, units, Math.floor(Date.now() / 1000));
        const ln = (0, club_1.line)(c.id, pid);
        return { status: 200, body: { line: (0, shapes_1.buildLine)(c, ln, p, ctx.viewer), credit: (0, ledger_1.creditOf)(code) } };
    });
    (0, http_1.sendJson)(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});
route("DELETE", `/api/cycles/(${SEG})/lines/(${SEG})/pledge`, async (ctx) => {
    const id = ctx.params[0];
    const pid = ctx.params[1];
    const keyError = (0, idem_1.checkIdempotencyKey)(ctx.idempotencyKey);
    if (keyError)
        throw keyError;
    const c = getCycleOr404(id);
    const code = requireMember(ctx);
    const p = (0, club_1.product)(pid);
    if (!p)
        throw errors_1.errors.notFound();
    const result = await (0, idem_1.withIdempotency)({
        person: personOf(ctx.viewer),
        key: ctx.idempotencyKey,
        method: "DELETE",
        path: `/api/cycles/${id}/lines/${pid}/pledge`,
        body: "",
    }, async () => {
        (0, pledge_1.withdrawPledge)(c, pid, code, Math.floor(Date.now() / 1000));
        const ln = (0, club_1.line)(c.id, pid);
        return { status: 200, body: { line: (0, shapes_1.buildLine)(c, ln, p, ctx.viewer), credit: (0, ledger_1.creditOf)(code) } };
    });
    (0, http_1.sendJson)(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});
route("GET", `/api/cycles/(${SEG})/lines/(${SEG})/shares`, async (ctx) => {
    if (ctx.viewer.role === "volunteer")
        throw errors_1.errors.forbidden();
    const id = decodeURIComponent(ctx.params[0]);
    const pid = decodeURIComponent(ctx.params[1]);
    const c = getCycleOr404(id);
    const ln = (0, club_1.line)(c.id, pid);
    if (!ln)
        throw errors_1.errors.notFound();
    if (ln.status !== "sealed" && ln.status !== "taken_up")
        throw errors_1.errors.lineNotSealed();
    (0, http_1.sendJson)(ctx.res, 200, (0, pledge_1.lineShares)(c, pid));
});
// ---------- resolution and shorts ----------
route("POST", `/api/cycles/(${SEG})/lines/(${SEG})/resolution`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    const pid = decodeURIComponent(ctx.params[1]);
    const c = getCycleOr404(id);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (raw.action !== "drop" && raw.action !== "take_up") {
        throw errors_1.errors.validation({ action: "Choose drop or take up." });
    }
    (0, resolution_1.resolveLine)(c, pid, raw.action);
    const ln = (0, club_1.line)(c.id, pid);
    (0, http_1.sendJson)(ctx.res, 200, (0, shapes_1.buildLine)(c, ln, (0, club_1.product)(pid), ctx.viewer));
});
route("POST", `/api/cycles/(${SEG})/lines/(${SEG})/shorts`, async (ctx) => {
    const id = ctx.params[0];
    const pid = ctx.params[1];
    const keyError = (0, idem_1.checkIdempotencyKey)(ctx.idempotencyKey);
    if (keyError)
        throw keyError;
    const c = getCycleOr404(id);
    requireCoordinator(ctx);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    const p = (0, club_1.product)(pid);
    if (!p)
        throw errors_1.errors.notFound();
    if (typeof raw.units !== "number" || !Number.isInteger(raw.units)) {
        throw errors_1.errors.validation({ units: `Enter whole units.` });
    }
    const result = await (0, idem_1.withIdempotency)({
        person: personOf(ctx.viewer),
        key: ctx.idempotencyKey,
        method: "POST",
        path: `/api/cycles/${id}/lines/${pid}/shorts`,
        body: JSON.stringify(raw),
    }, async () => {
        const outcome = (0, shorts_1.recordShort)(c, pid, raw.units);
        (0, mailworker_1.deliverSoon)();
        const ln = (0, club_1.line)(c.id, pid);
        return {
            status: 201,
            body: {
                short_id: outcome.shortId,
                line: (0, shapes_1.buildLine)(c, ln, p, ctx.viewer),
                affected: outcome.affected,
            },
        };
    });
    (0, http_1.sendJson)(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});
// ---------- documents ----------
route("PUT", `/api/cycles/(${SEG})/documents/invoice`, async (ctx) => {
    await handleUpload(ctx, "invoice");
});
route("PUT", `/api/cycles/(${SEG})/documents/packing-slip`, async (ctx) => {
    await handleUpload(ctx, "packing-slip");
});
async function handleUpload(ctx, kind) {
    const id = decodeURIComponent(ctx.params[0]);
    const c = getCycleOr404(id);
    requireCoordinator(ctx);
    if (!(0, documents_1.uploadsAllowed)(c))
        throw errors_1.errors.wrongCycleState();
    const body = await (0, http_1.readRawBody)(ctx.req);
    const check = (0, documents_1.checkUpload)(ctx.req.headers["content-type"], body);
    if (check instanceof errors_1.ApiError)
        throw check;
    try {
        const stored = await (0, documents_1.uploadDocument)(c, kind, body, check.type, check.ext);
        (0, http_1.sendJson)(ctx.res, 201, {
            kind: stored.kind,
            key: stored.key,
            bytes: stored.bytes,
            sha256: stored.sha256,
        });
    }
    catch (e) {
        if (e instanceof s3_1.S3Unavailable || e instanceof s3_1.S3Error)
            throw errors_1.errors.storageUnavailable();
        throw e;
    }
}
route("GET", `/api/cycles/(${SEG})/documents`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    getCycleOr404(id);
    requireCoordinator(ctx);
    const docs = (0, documents_1.documentsOf)(id).map((d) => ({
        kind: d.kind,
        key: d.key,
        bytes: d.bytes,
        sha256: d.sha256,
        uploaded_at: new Date(d.uploaded_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }));
    (0, http_1.sendJson)(ctx.res, 200, { documents: docs });
});
route("GET", `/api/cycles/(${SEG})/documents/(${SEG})`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    const kindPath = decodeURIComponent(ctx.params[1]);
    getCycleOr404(id);
    requireCoordinator(ctx);
    if (kindPath !== "invoice" && kindPath !== "packing-slip")
        throw errors_1.errors.notFound();
    const kind = kindPath;
    const record = (0, documents_1.documentRecord)(id, kind);
    if (!record)
        throw errors_1.errors.notFound();
    let bytes;
    try {
        bytes = await (0, s3_1.getObject)(record.key);
    }
    catch (e) {
        if (e instanceof s3_1.S3Unavailable || e instanceof s3_1.S3Error)
            throw errors_1.errors.storageUnavailable();
        throw e;
    }
    if (bytes === null)
        throw errors_1.errors.notFound();
    const filename = kind === "invoice" ? "invoice.pdf" : record.key.endsWith(".png") ? "packing-slip.png" : "packing-slip.jpg";
    const contentType = kind === "invoice" ? "application/pdf" : record.key.endsWith(".png") ? "image/png" : "image/jpeg";
    ctx.res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    });
    ctx.res.end(bytes);
});
// ---------- bags and flags ----------
route("GET", `/api/cycles/(${SEG})/bags`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    const c = getCycleOr404(id);
    requireVolunteerOrCoordinator(ctx);
    if (c.status !== "breakdown")
        throw errors_1.errors.wrongCycleState();
    (0, http_1.sendJson)(ctx.res, 200, { bags: (0, bags_1.bagsOf)(c) });
});
route("PUT", `/api/cycles/(${SEG})/bags/(${SEG})/items/(${SEG})`, async (ctx) => {
    const id = ctx.params[0];
    const hh = ctx.params[1];
    const pid = ctx.params[2];
    const c = getCycleOr404(id);
    requireVolunteerOrCoordinator(ctx);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (typeof raw.packed !== "boolean")
        throw errors_1.errors.validation({ packed: "Say whether the item is packed." });
    const bag = (0, bags_1.setBagItem)(c, hh, pid, raw.packed, Math.floor(Date.now() / 1000));
    (0, http_1.sendJson)(ctx.res, 200, bag);
});
route("POST", `/api/cycles/(${SEG})/bags/(${SEG})/flags`, async (ctx) => {
    const id = ctx.params[0];
    const hh = ctx.params[1];
    const c = getCycleOr404(id);
    if (ctx.viewer.role !== "volunteer")
        throw errors_1.errors.forbidden();
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (typeof raw.product_id !== "string")
        throw errors_1.errors.validation({ product_id: "Choose a case." });
    if (typeof raw.units !== "number" || !Number.isInteger(raw.units)) {
        throw errors_1.errors.validation({ units: "Enter whole units." });
    }
    const flag = (0, bags_1.addFlag)(c, hh, raw.product_id, raw.units, Math.floor(Date.now() / 1000));
    (0, http_1.sendJson)(ctx.res, 201, { flag });
});
route("GET", `/api/cycles/(${SEG})/flags`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    getCycleOr404(id);
    requireCoordinator(ctx);
    (0, http_1.sendJson)(ctx.res, 200, { flags: (0, bags_1.flagsOf)(id) });
});
// ---------- daily and receipts ----------
route("GET", `/api/cycles/(${SEG})/daily`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    getCycleOr404(id);
    requireCoordinator(ctx);
    (0, http_1.sendJson)(ctx.res, 200, (0, daily_1.pledgesByDay)(id));
});
route("GET", `/api/cycles/(${SEG})/receipts`, async (ctx) => {
    const id = decodeURIComponent(ctx.params[0]);
    getCycleOr404(id);
    requireCoordinator(ctx);
    const rows = (0, db_1.all)("SELECT household_code, to_email, status, failed_attempts FROM emails WHERE cycle_id = ? AND kind = 'receipt' ORDER BY household_code", id);
    (0, http_1.sendJson)(ctx.res, 200, {
        receipts: rows.map((r) => ({
            household_code: r.household_code,
            email: r.to_email,
            status: r.status,
            failed_attempts: r.failed_attempts,
        })),
    });
});
// ---------- top-ups ----------
route("POST", "/api/topups", async (ctx) => {
    const keyError = (0, idem_1.checkIdempotencyKey)(ctx.idempotencyKey);
    if (keyError)
        throw keyError;
    const code = requireMember(ctx);
    const raw = await (0, http_1.readJsonBody)(ctx.req);
    if (typeof raw.amount !== "string")
        throw errors_1.errors.validation({ amount: "Enter an amount from $5.00 to $500.00." });
    const cents = (0, money_1.dollarsTextToCents)(raw.amount);
    if (cents === null || cents < 500 || cents > 50000) {
        throw errors_1.errors.validation({ amount: "Enter an amount from $5.00 to $500.00." });
    }
    const result = await (0, idem_1.withIdempotency)({
        person: personOf(ctx.viewer),
        key: ctx.idempotencyKey,
        method: "POST",
        path: "/api/topups",
        body: JSON.stringify(raw),
    }, async () => {
        try {
            return { status: 201, body: await (0, topup_1.confirmTopup)(code, ctx.idempotencyKey, cents) };
        }
        catch (e) {
            if (e instanceof killbill_1.KbTimeout || e instanceof killbill_1.KbUnreachable)
                throw errors_1.errors.paymentsPaused();
            throw e;
        }
    });
    (0, http_1.sendJson)(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});
route("GET", "/api/topups", async (ctx) => {
    const code = requireMember(ctx);
    const rows = (0, topup_1.topupsOf)(code).map((t) => ({
        id: t.id,
        amount_cents: t.amount_cents,
        status: t.status,
        created_at: new Date(t.created_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }));
    (0, http_1.sendJson)(ctx.res, 200, { topups: rows });
});
// ---------- ledger ----------
route("GET", `/api/households/(${SEG})/ledger`, async (ctx) => {
    const hh = decodeURIComponent(ctx.params[0]);
    if (ctx.viewer.role !== "coordinator" && !(ctx.viewer.role === "member" && ctx.viewer.householdCode === hh)) {
        throw errors_1.errors.forbidden();
    }
    if (!(0, club_1.household)(hh))
        throw errors_1.errors.notFound();
    let limit = 20;
    const limitParam = ctx.url.searchParams.get("limit");
    if (limitParam !== null) {
        if (!/^\d+$/.test(limitParam) || parseInt(limitParam, 10) < 1 || parseInt(limitParam, 10) > 50) {
            throw errors_1.errors.validation({ limit: "Ask for 1 to 50 movements." });
        }
        limit = parseInt(limitParam, 10);
    }
    let beforeId = null;
    const beforeParam = ctx.url.searchParams.get("before");
    if (beforeParam !== null) {
        beforeId = decodeCursor(beforeParam);
        if (beforeId === null)
            throw errors_1.errors.validation({ before: "That page marker isn't valid." });
    }
    const { movements, nextBefore, total } = (0, ledger_1.movementsOf)(hh, beforeId, limit);
    const credit = (0, ledger_1.creditOf)(hh);
    (0, http_1.sendJson)(ctx.res, 200, {
        household_code: hh,
        balance_cents: credit.balance_cents,
        held_cents: credit.held_cents,
        spendable_cents: credit.spendable_cents,
        total_movements: total,
        next_before: nextBefore === null ? null : encodeCursor(nextBefore),
        movements: movements.map((m) => ({
            id: m.id,
            kind: m.kind,
            cycle_id: m.cycle_id,
            memo: m.memo,
            created_at: new Date(m.created_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
            legs: m.legs,
        })),
    });
});
function encodeCursor(id) {
    return Buffer.from(`tally:${id}`, "utf8").toString("base64");
}
function decodeCursor(value) {
    try {
        const text = Buffer.from(value, "base64").toString("utf8");
        const m = /^tally:(\d+)$/.exec(text);
        if (!m)
            return null;
        const id = parseInt(m[1], 10);
        if (!(0, db_1.one)("SELECT id FROM movements WHERE id = ?", id))
            return null;
        return id;
    }
    catch {
        return null;
    }
}
route("GET", "/api/health", async (ctx) => {
    (0, http_1.sendJson)(ctx.res, 200, { status: "ok" });
});
function isUploadPath(pathname) {
    return /^\/api\/cycles\/[^/]+\/documents\/(invoice|packing-slip)$/.test(pathname);
}
function handleApi(req, res, url, viewer) {
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/") && pathname !== "/api")
        return Promise.resolve(false);
    const match = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
    const ctx = {
        req,
        res,
        url,
        viewer: viewer ?? { role: "volunteer", name: "", householdCode: null },
        params: {},
        idempotencyKey: req.headers["idempotency-key"],
    };
    return (async () => {
        try {
            if (!match)
                throw errors_1.errors.notFound();
            const groups = match.pattern.exec(pathname).slice(1);
            ctx.params = groups.map(decodeURIComponentSafe);
            if (req.method !== "GET" && req.method !== "HEAD" && !(0, http_1.originAllowed)(req)) {
                throw errors_1.errors.forbidden();
            }
            const isUpload = req.method === "PUT" && isUploadPath(pathname);
            const declared = req.headers["content-length"];
            const declaredLength = declared !== undefined ? parseInt(declared, 10) : NaN;
            if (!Number.isNaN(declaredLength) && declaredLength > (isUpload ? http_1.MAX_UPLOAD_BYTES : http_1.MAX_JSON_BYTES)) {
                throw errors_1.errors.tooLarge();
            }
            const hasBody = declaredLength > 0 || (declared === undefined && req.method !== "GET" && req.method !== "HEAD");
            if (hasBody && !isUpload) {
                const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
                if (ct !== "application/json")
                    throw errors_1.errors.unsupportedMediaType();
            }
            if (isUpload) {
                const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
                if (!["application/pdf", "image/jpeg", "image/png"].includes(ct))
                    throw errors_1.errors.unsupportedMediaType();
            }
            const isPublicPath = pathname === "/api/health" || (req.method === "POST" && pathname === "/api/session");
            if (!isPublicPath && !viewer)
                throw errors_1.errors.unauthenticated();
            await match.handler(ctx);
        }
        catch (e) {
            if (res.headersSent) {
                res.destroy();
                return true;
            }
            if (e instanceof errors_1.ApiError) {
                (0, http_1.sendJson)(res, e.status, JSON.parse(e.body()), e.headers);
            }
            else {
                console.error("internal error", e);
                (0, http_1.sendJson)(res, 500, { error: { code: "internal", message: "Something went wrong." } });
            }
        }
        return true;
    })();
}
function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
