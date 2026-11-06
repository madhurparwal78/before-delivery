"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serveStatic = serveStatic;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const PUBLIC_ROOT = (0, node_path_1.resolve)(process.cwd(), "public");
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
};
const SHELL = "index.html";
/** Serves only files inside public/, never source or data. */
function serveStatic(req, res, pathname) {
    const clean = decodeURIComponent(pathname);
    if (clean.includes("\0"))
        return false;
    const rel = (0, node_path_1.normalize)(clean).replace(/^([/\\.])+/, "");
    const abs = (0, node_path_1.join)(PUBLIC_ROOT, rel);
    if (abs !== PUBLIC_ROOT && !abs.startsWith(PUBLIC_ROOT + "/"))
        return false;
    let filePath;
    let isShell = false;
    try {
        const stat = (0, node_fs_1.statSync)(abs);
        if (stat.isDirectory()) {
            filePath = (0, node_path_1.join)(PUBLIC_ROOT, SHELL);
            isShell = true;
        }
        else {
            filePath = abs;
        }
    }
    catch {
        if ((0, node_path_1.extname)(clean) === "") {
            // App path: the shell page answers at the same address.
            filePath = (0, node_path_1.join)(PUBLIC_ROOT, SHELL);
            isShell = true;
        }
        else {
            return false;
        }
    }
    const ext = (0, node_path_1.extname)(filePath);
    const type = MIME[ext] ?? "application/octet-stream";
    const stat = (0, node_fs_1.statSync)(filePath);
    res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": String(stat.size),
        "Cache-Control": isShell || type.startsWith("text/html") ? "no-store" : "public, max-age=86400",
    });
    if (req.method === "HEAD") {
        res.end();
        return true;
    }
    (0, node_fs_1.createReadStream)(filePath).pipe(res);
    return true;
}
