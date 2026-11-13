import express from "express";
import path from "node:path";
import fs from "node:fs";
import pg from "pg";
import { loadConfig } from "./config.js";
import { migrateAndSeed } from "./db.js";
import { Store } from "./store.js";
import { KillBillClient } from "./killbill.js";
import { StorageClient } from "./storage.js";
import { MailClient } from "./mail.js";
import { buildApi } from "./routes.js";
import { AppError, crossOrigin, methodNotAllowed, tooLarge, unsupportedType } from "./errors.js";
const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
const store = new Store(pool, cfg);
const kb = new KillBillClient(cfg);
const storage = new StorageClient(cfg);
const mail = new MailClient(cfg);
const ctx = { cfg, store, kb, storage, mail };
let dbReady = false;
async function connectDb() {
    // Retry every 2 seconds until Postgres is reachable, then apply schema and seed.
    for (;;) {
        try {
            await pool.query("SELECT 1");
            await migrateAndSeed(pool);
            dbReady = true;
            return;
        }
        catch {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
}
const app = express();
app.disable("x-powered-by");
// --- Session middleware ---
function sessionToken(req) {
    const header = req.headers.cookie;
    if (!header)
        return null;
    for (const part of header.split(";")) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf("=");
        if (eq === -1)
            continue;
        if (trimmed.slice(0, eq) === "shelfmark_session") {
            return decodeURIComponent(trimmed.slice(eq + 1));
        }
    }
    return null;
}
app.use((req, _res, next) => {
    const token = sessionToken(req);
    void (async () => {
        if (token && dbReady) {
            try {
                const user = await store.userBySession(token);
                if (user)
                    req.user = user;
            }
            catch {
                // database hiccup: request proceeds unauthenticated
            }
        }
        next();
    })();
});
// --- Server boundary ---
// Health, answered before anything else.
app.get("/api/health", (_req, res) => {
    if (dbReady) {
        res.status(200).json({ status: "ok" });
    }
    else {
        res.status(503).json({ status: "starting" });
    }
});
// Same-origin: a state-changing request whose Origin names another origin is refused.
app.use((req, res, next) => {
    const stateChanging = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    if (!stateChanging) {
        next();
        return;
    }
    const origin = req.headers.origin;
    if (!origin) {
        next();
        return;
    }
    let originHost = null;
    try {
        originHost = new URL(origin).host;
    }
    catch {
        originHost = null;
    }
    const ownHost = req.headers.host ?? "";
    if (originHost && originHost !== ownHost) {
        const err = crossOrigin();
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
    }
    next();
});
// Content-type and body-size limits for JSON endpoints. A request with no
// content-type carries no body and is treated as an empty JSON object.
app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/photos") && req.method === "POST") {
        // multipart, handled by multer in the route
        next();
        return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
        next();
        return;
    }
    const contentType = req.headers["content-type"];
    if (contentType !== undefined && !String(contentType).startsWith("application/json")) {
        const err = unsupportedType();
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
    }
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > 65_536) {
        const err = tooLarge();
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
    }
    if (contentType === undefined) {
        req.body = {};
    }
    next();
});
app.use(express.json({ limit: "256kb" }));
// API routes
app.use("/api", buildApi(ctx));
// Method not allowed on unknown API paths
app.use("/api", (req, res) => {
    const err = methodNotAllowed();
    res.status(err.status).json({ error: err.code, message: err.message });
});
// --- Static assets: only the built browser bundle ---
const webRoot = path.resolve("dist-web");
const FORBIDDEN_STATIC = [
    "run.json",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.server.json",
    "tsconfig.web.json",
    "THIRD_PARTY_NOTICES.md"
];
const FORBIDDEN_PREFIXES = ["server/", "src/", "web/", "node_modules/", ".env", "dist-server/"];
const FORBIDDEN_SUFFIXES = [".ts", ".tsx", ".mts", ".cts", ".map", ".env"];
app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(404).json({ error: "not_found", message: "Not found." });
        return;
    }
    const rel = req.path.replace(/^\/+/, "");
    const lower = rel.toLowerCase();
    if (FORBIDDEN_STATIC.includes(rel) ||
        FORBIDDEN_PREFIXES.some((p) => lower.startsWith(p)) ||
        FORBIDDEN_SUFFIXES.some((s) => lower.endsWith(s)) ||
        rel.includes("..")) {
        res.status(404).json({ error: "not_found", message: "Not found." });
        return;
    }
    if (rel === "") {
        serveIndex(res);
        return;
    }
    const candidate = path.join(webRoot, rel);
    if (!candidate.startsWith(webRoot)) {
        res.status(404).json({ error: "not_found", message: "Not found." });
        return;
    }
    fs.stat(candidate, (err, stat) => {
        if (!err && stat.isFile()) {
            res.sendFile(candidate);
            return;
        }
        // SPA routes fall back to the built index.
        serveIndex(res);
    });
});
function serveIndex(res) {
    const index = path.join(webRoot, "index.html");
    fs.stat(index, (err) => {
        if (err) {
            res.status(404).send("Not built");
            return;
        }
        res.sendFile(index);
    });
}
// Error handler: every error leaves in the one error body shape.
app.use((err, _req, res, _next) => {
    if (res.headersSent)
        return;
    if (err instanceof AppError) {
        const body = { error: err.code, message: err.message };
        if (err.extra)
            Object.assign(body, err.extra);
        if (err.fields)
            body.fields = err.fields;
        res.status(err.status).json(body);
        return;
    }
    const anyErr = err;
    if (anyErr?.type === "entity.too.large") {
        res.status(413).json({ error: "too_large", message: "Body too large." });
        return;
    }
    if (anyErr?.type === "entity.parse.failed" || anyErr?.type === "charset.unsupported" || anyErr?.status === 400) {
        res.status(400).json({ error: "bad_request", message: "Bad request." });
        return;
    }
    res.status(500).json({ error: "internal", message: "Something went wrong." });
    console.error("internal error:", err);
});
// --- Background workers ---
async function sweepOnce() {
    if (!dbReady)
        return;
    const now = new Date();
    try {
        await store.sweepFiringStatus(now);
        await store.sweepPickups(now);
    }
    catch {
        // sweep retries on the next tick
    }
}
async function outboxOnce() {
    if (!dbReady)
        return;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const rows = await client.query(`SELECT id, to_email, subject, body FROM outbox
       WHERE sent_at IS NULL
       ORDER BY id
       LIMIT 20
       FOR UPDATE SKIP LOCKED`);
        await client.query("COMMIT");
        for (const row of rows.rows) {
            const ok = await mail.send({ to: row.to_email, subject: row.subject, body: row.body });
            if (ok) {
                await store.markEmailSent(row.id);
            }
            else {
                await store.markEmailAttempt(row.id);
            }
        }
    }
    catch {
        await client.query("ROLLBACK").catch(() => undefined);
    }
    finally {
        client.release();
    }
}
let started = false;
async function start() {
    await connectDb();
    if (!started) {
        started = true;
        // Member accounts exist in Kill Bill at each start, exactly once each.
        const members = await store.members();
        for (const m of members) {
            if (m.member_number) {
                await kb.ensureAccount(`member-${m.member_number}`, m.name, m.email).catch(() => undefined);
            }
        }
        setInterval(() => void sweepOnce(), 3000);
        setInterval(() => void outboxOnce(), 10000);
    }
}
app.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Shelfmark serving on port ${cfg.port}`);
});
void start();
