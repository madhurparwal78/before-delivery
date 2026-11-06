import http from 'node:http';
import { config } from './config.js';
import { connectDb, withTx } from './db.js';
import { seedIfEmpty } from './schema.js';
import { setPracticeZone } from './time.js';
import { AppError, sendError, Handled } from './errors.js';
import { resolveCaller, newRequestId, logRequest, redactPath } from './request.js';
import { send, sendHtml } from './respond.js';
import { peerAddress } from './headers.js';
import { serveBrowser, serveAsset } from './browser/assets.js';
import { handleApi } from './routes/index.js';
import { serveMedia } from './routes/media.js';
import { readyz } from './routes/health.js';
import { startWorkers, stopWorkers, releaseClaims } from './jobs.js';
import { runMigrationsSafe } from './boot.js';
import { loadAssets } from './browser/assets.js';
import { startReconciler, stopReconciler, releaseClaimedEmails } from './reconciler.js';
export let draining = false;
export function isDraining() { return draining; }
const JSON_LIMIT = 65536;
const MULTIPART_LIMIT = 8500000;
const IMPORT_LIMIT = 1000000;
async function readBody(req, limit) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (c) => {
            total += c.length;
            if (total > limit) {
                reject(new AppError(413, 'payload_too_large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolveBody(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
export async function startServer() {
    await runMigrationsSafe();
    await seedIfEmpty();
    const zone = await withTx(tx => tx.query(`select time_zone from practice where id = 1`));
    if (zone.length > 0)
        setPracticeZone(zone[0].time_zone);
    const server = http.createServer(async (req, res) => {
        const start = performance.now();
        const method = (req.method ?? 'GET').toUpperCase();
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const requestId = (() => {
            const h = req.headers['x-request-id'];
            if (typeof h === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(h))
                return h;
            return newRequestId();
        })();
        const address = peerAddress(req);
        try {
            if (draining && url.pathname !== '/readyz') {
                send(res, requestId, 503, { error: 'shutting_down' });
                logRequest({ requestId, method, path: redactPath(url.pathname), status: 503, start });
                return;
            }
            const origin = req.headers.origin;
            if (method !== 'GET' && method !== 'HEAD' && origin) {
                const host = req.headers.host;
                try {
                    const o = new URL(origin);
                    if (!host || o.host !== host) {
                        send(res, requestId, 403, { error: 'cross_origin' });
                        logRequest({ requestId, method, path: redactPath(url.pathname), status: 403, start });
                        return;
                    }
                }
                catch {
                    send(res, requestId, 403, { error: 'cross_origin' });
                    logRequest({ requestId, method, path: redactPath(url.pathname), status: 403, start });
                    return;
                }
            }
            if (url.pathname === '/healthz' || url.pathname === '/api/health') {
                send(res, requestId, 200, { status: 'ok' });
                logRequest({ requestId, method, path: url.pathname, status: 200, start });
                return;
            }
            if (url.pathname === '/readyz') {
                await readyz(res, requestId, draining);
                logRequest({ requestId, method, path: url.pathname, status: res.statusCode, start });
                return;
            }
            if (url.pathname.startsWith('/media/')) {
                await serveMedia(req, res, url, requestId);
                logRequest({ requestId, method, path: url.pathname, status: res.statusCode, start });
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                const caller = await resolveCaller(req);
                const result = await handleApi(req, res, url, requestId, address, caller);
                logRequest({ requestId, method, path: redactPath(url.pathname), status: result, start });
                return;
            }
            if (url.pathname.startsWith('/assets/')) {
                const status = serveAsset(res, url.pathname);
                logRequest({ requestId, method, path: url.pathname, status, start });
                return;
            }
            const decoded = url.pathname.replace(/%2e/gi, '.');
            if (decoded.includes('..') || decoded === '/run.json' || decoded === '/package.json'
                || decoded === '/package-lock.json' || decoded === '/tsconfig.json' || decoded.startsWith('/.')
                || decoded.startsWith('/src/') || decoded.startsWith('/build/') || decoded.startsWith('/browser-dist/')
                || decoded.startsWith('/fonts/') || decoded.startsWith('/licenses/') || decoded.startsWith('/node_modules/')) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Request-Id': requestId });
                res.end('Not found');
                logRequest({ requestId, method, path: url.pathname, status: 404, start });
                return;
            }
            const html = serveBrowser(url.pathname);
            sendHtml(res, requestId, html);
            logRequest({ requestId, method, path: url.pathname, status: 200, start });
        }
        catch (err) {
            if (err instanceof Handled) {
                logRequest({ requestId, method, path: redactPath(url.pathname), status: res.statusCode, start });
                return;
            }
            sendError(res, requestId, err);
            logRequest({ requestId, method, path: redactPath(url.pathname), status: res.statusCode, start });
        }
    });
    server.listen(config.port, '0.0.0.0');
    loadAssets();
    startWorkers();
    startReconciler();
    const shutdown = () => {
        if (draining)
            return;
        draining = true;
        stopWorkers();
        stopReconciler();
        releaseClaimedEmails().finally(() => {
            const timer = setTimeout(async () => {
                try {
                    await releaseClaims();
                    const db = connectDb();
                    await db.end();
                }
                finally {
                    process.exit(0);
                }
            }, Math.max(0, config.shutdownGraceSeconds * 1000 - 1500));
            timer.unref();
            setTimeout(() => process.exit(0), config.shutdownGraceSeconds * 1000).unref();
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
