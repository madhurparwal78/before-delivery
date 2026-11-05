"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const db_1 = require("./db");
const http_1 = require("./http/http");
const routes_1 = require("./http/routes");
const static_1 = require("./http/static");
const mailworker_1 = require("./providers/mailworker");
const documents_1 = require("./domain/documents");
(0, db_1.applySchema)();
(0, db_1.seedIfEmpty)();
(0, mailworker_1.startMailWorker)();
(0, documents_1.scheduleSlipCleanup)();
const server = (0, node_http_1.createServer)((req, res) => {
    void (async () => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
            const viewer = (0, http_1.viewerOf)(req);
            const handled = await (0, routes_1.handleApi)(req, res, url, viewer);
            if (!handled) {
                (0, http_1.sendJson)(res, 404, { error: { code: "not_found", message: "Nothing is at that address." } });
            }
            return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            if (!(0, static_1.serveStatic)(req, res, url.pathname)) {
                res.writeHead(405, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
                res.end("Method not allowed");
            }
            return;
        }
        if (!(0, static_1.serveStatic)(req, res, url.pathname)) {
            (0, static_1.serveStatic)(req, res, "/");
        }
    })();
});
server.listen(db_1.config.port, "0.0.0.0", () => {
    console.log(`tare-and-tally listening on 0.0.0.0:${db_1.config.port}`);
});
