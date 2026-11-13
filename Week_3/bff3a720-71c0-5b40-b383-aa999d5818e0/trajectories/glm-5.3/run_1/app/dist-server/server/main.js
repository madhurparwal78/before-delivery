import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../domain/config.js';
import { Clock } from '../domain/clock.js';
import { makePool, applySchema } from '../db/schema.js';
import { seed } from '../db/seed.js';
import { Model } from '../domain/model.js';
import { Valkey } from '../db/valkey.js';
import { ValkeyStore } from '../services/valkeys.js';
import { S3 } from '../services/s3.js';
import { Smtp } from '../services/smtp.js';
import { Mailer } from '../services/mailer.js';
import { LiveHub } from '../services/live.js';
import { Router, sendError } from '../http/router.js';
import { handleApi } from '../http/api.js';
import { handleLive } from '../http/live.js';
import { registerAuthRoutes } from '../http/routes/auth.js';
import { registerRideRoutes } from '../http/routes/rides.js';
import { registerBookingRoutes } from '../http/routes/bookings.js';
import { registerThreadRoutes } from '../http/routes/threads.js';
import { registerFileRoutes } from '../http/routes/files.js';
import { registerGradingRoutes, runDueJobs } from '../http/routes/grading.js';
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist-client');
async function waitFor(name, check, seconds = 60) {
    for (let i = 0; i < seconds; i++) {
        if (await check())
            return;
        await new Promise(r => setTimeout(r, 1000));
    }
    console.error(`${name} unreachable after ${seconds}s`);
    process.exit(1);
}
async function main() {
    const cfg = loadConfig(process.env);
    const clock = new Clock();
    const db = makePool(cfg.databaseUrl);
    await waitFor('postgresql', async () => {
        try {
            await db.query('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    });
    await applySchema(db);
    clock.attach(db);
    await clock.load();
    const valkeyClient = new Valkey(cfg.valkeyUrl);
    await waitFor('valkey', () => valkeyClient.connect().then(() => true).catch(() => false));
    const valkey = new ValkeyStore(valkeyClient);
    const s3 = new S3({ endpoint: cfg.s3Endpoint, region: cfg.s3Region, bucket: cfg.s3Bucket, accessKeyId: cfg.s3AccessKeyId, secretAccessKey: cfg.s3SecretAccessKey });
    const smtp = new Smtp(cfg.smtpHost, cfg.smtpPort, process.env.MAIL_FROM ?? 'Longseat <rides@longseat.test>');
    const mailer = new Mailer(smtp);
    const live = new LiveHub();
    const model = new Model(db, cfg, clock, valkey, mailer, live);
    await seed(db, cfg, clock, s3);
    const router = new Router();
    registerAuthRoutes(model, router);
    registerRideRoutes(model, router);
    registerBookingRoutes(model, router);
    registerThreadRoutes(model, router);
    registerFileRoutes(model, router, s3);
    registerGradingRoutes(model, router, s3);
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://local');
            if (url.pathname === '/health') {
                const [pgUp, valkeyUp, minioUp, mailUp] = await Promise.all([
                    db.query('SELECT 1').then(() => true).catch(() => false),
                    valkeyClient.cmd('PING').then(r => r === 'PONG').catch(() => false),
                    s3.healthy().catch(() => false),
                    smtp.healthy().catch(() => false),
                ]);
                const ok = pgUp && valkeyUp && minioUp && mailUp;
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
                return;
            }
            if (url.pathname === '/api/live') {
                await handleLive(req, res, model);
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                const origin = req.headers.origin;
                if (origin && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE')) {
                    try {
                        const o = new URL(origin);
                        const host = req.headers.host ?? '';
                        if (o.origin !== `http://${host}` && o.origin !== `https://${host}`) {
                            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: 'forbidden', message: 'You do not have access to this.' }));
                            return;
                        }
                    }
                    catch { /* malformed origin falls through */ }
                }
                const handled = await handleApi({
                    req, res, router,
                    sessionLookup: async (t) => {
                        const m = await model.sessionMember(t);
                        return m ? { id: m.id } : null;
                    },
                });
                if (!handled) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'not_found', message: 'We could not find that.' }));
                }
                return;
            }
            await serveStatic(res, url.pathname);
        }
        catch (e) {
            sendError(res, e);
        }
    });
    setInterval(() => { runDueJobs(model, s3).catch(() => undefined); }, 5000);
    server.listen(cfg.port, '0.0.0.0', () => {
        console.log(`longseat listening on 0.0.0.0:${cfg.port}`);
    });
}
async function serveStatic(res, pathname) {
    const blocked = /(\.ts$|\.tsx$|\.env|\.lock$|\.md$|^\/server|^\/client|\/run\.json$|^\/package(-lock)?\.json$|\.\.)/i.test(pathname);
    if (blocked) {
        await serveIndex(res, 404);
        return;
    }
    let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(DIST)) {
        await serveIndex(res, 404);
        return;
    }
    if (pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        await serveIndex(res, pathname === '/' ? 200 : 404);
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}
async function serveIndex(res, status = 200) {
    const index = path.join(DIST, 'index.html');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    if (!fs.existsSync(index)) {
        res.end('<!doctype html><title>Longseat</title>');
        return;
    }
    fs.createReadStream(index).pipe(res);
}
main().catch(e => { console.error(e); process.exit(1); });
