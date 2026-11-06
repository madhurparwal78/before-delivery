// Pages: the built public assets (and nothing else) and the HTML shell, with 404 for unknown or not-yours pages.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { parseCookies, requestLocale, sessionId } from './http.js';
const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
};
function collect(dir, into) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory())
            collect(path, into);
        else {
            const ext = name.slice(name.lastIndexOf('.'));
            const type = TYPES[ext];
            if (type)
                into.set(`/${relative(PUBLIC_DIR, path).split('\\').join('/')}`, { body: readFileSync(path), type });
        }
    }
    return into;
}
const assets = collect(PUBLIC_DIR, new Map());
const PAGES = [
    /^\/$/,
    /^\/checkout$/,
    /^\/subscribe$/,
    /^\/account$/,
    /^\/contact$/,
    /^\/studio$/,
    /^\/studio\/(batches|packing|finance|reconciliation|audit|notices)$/,
];
const OWNED = [
    { pattern: /^\/checkout\/placed\/([^/]+)$/, table: 'orders' },
    { pattern: /^\/account\/orders\/([^/]+)$/, table: 'orders' },
    { pattern: /^\/account\/subscriptions\/([^/]+)$/, table: 'subscriptions' },
];
/** 200 for a known page, 404 for an unknown one or a record that is not the signed-in customer's. */
async function pageStatus(path, cookies) {
    if (PAGES.some((p) => p.test(path)))
        return 200;
    for (const { pattern, table } of OWNED) {
        const match = pattern.exec(path);
        if (!match)
            continue;
        const customer = sessionId(cookies, 'customer', new Date());
        if (customer === null)
            return 200;
        const owned = (await pool.query(`SELECT 1 FROM ${table} WHERE number = $1 AND customer_id = $2`, [decodeURIComponent(match[1] ?? ''), customer])).rows[0];
        return owned ? 200 : 404;
    }
    return 404;
}
const shell = (lang, status) => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Pain de Lune</title>
<link rel="preload" href="/fonts/fraunces-latin-full-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body data-page-status="${status}"><div id="app"></div></body>
</html>`;
export async function handlePage(req, res, url) {
    const asset = req.method === 'GET' || req.method === 'HEAD' ? assets.get(url.pathname) : undefined;
    if (asset) {
        const cache = url.pathname.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : asset.body);
        return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const status = req.method === 'GET' || req.method === 'HEAD' ? await pageStatus(url.pathname, cookies) : 404;
    const html = shell(requestLocale(cookies, req.headers['accept-language']), status);
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
}
