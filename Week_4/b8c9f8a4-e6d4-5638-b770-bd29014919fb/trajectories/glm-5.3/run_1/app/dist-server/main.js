import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './api.js';
import { pool, loadConfig } from './db.js';
import { Store } from './store.js';
import { startBackgroundPass } from './background.js';
import { seedIfEmpty } from './seed.js';
const cfg = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(process.cwd(), 'dist');
let ready = false;
app.get('/api/health', (req, res) => {
    if (!ready) {
        res.status(503).json({ status: 'starting' });
        return;
    }
    res.json({ status: 'ok' });
});
// The server never serves source files, the manifest, lockfiles, environment files or credentials.
const forbidden = (p) => /^\/(src|scripts|node_modules|public\/fonts\/src)(\/|$)|\/(package(-lock)?\.json|run\.json|tsconfig\.json|\.env[^/]*|THIRD_PARTY_NOTICES\.md)(\/|$)/.test(p);
const staticFiles = [];
function loadStatic() {
    staticFiles.length = 0;
    if (!fs.existsSync(distDir))
        return;
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const route = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) {
                walk(full, route);
                continue;
            }
            if (forbidden(route))
                continue;
            const ext = path.extname(entry.name).slice(1);
            const types = {
                html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
                woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png',
                jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', webmanifest: 'application/manifest+json',
                jsMap: 'application/json', map: 'application/json', ico: 'image/x-icon',
            };
            staticFiles.push({ path: route, body: fs.readFileSync(full), type: types[ext] ?? 'application/octet-stream' });
        }
    };
    walk(distDir, '');
}
const htmlFallback = () => {
    const entry = staticFiles.find(f => f.path === '/index.html');
    return entry ? entry.body : null;
};
function isOwnerPage(p) {
    return p === '/owner' || p.startsWith('/owner/');
}
function isLinkPage(p) {
    return /^\/l\/[A-Za-z0-9_-]+$/.test(p);
}
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
    }
    const p = req.path.split('?')[0];
    if (p.startsWith('/api/')) {
        next();
        return;
    }
    const direct = staticFiles.find(f => f.path === p);
    if (direct) {
        res.setHeader('Content-Type', direct.type);
        res.setHeader('Cache-Control', 'no-store');
        res.send(direct.body);
        return;
    }
    if (forbidden(p)) {
        res.status(404).send('Not found');
        return;
    }
    const shell = htmlFallback();
    if (!shell) {
        res.status(404).send('Not found');
        return;
    }
    // Owner pages, link pages and the root all serve the shell; the client decides from the address.
    if (isOwnerPage(p) || isLinkPage(p) || p === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(shell);
        return;
    }
    res.status(404).send('Not found');
});
async function applySchema() {
    const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
    await pool.query(sql);
}
async function boot() {
    for (;;) {
        try {
            await pool.query('SELECT 1');
            break;
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
    }
    await applySchema();
    const store = new Store(cfg);
    try {
        await store.ensureBucket();
    }
    catch { /* MinIO unreachable; uploads will answer 503 */ }
    loadStatic();
    try {
        await seedIfEmpty(cfg, store);
    }
    catch (err) {
        console.error('seed skipped:', err instanceof Error ? err.message : err);
    }
    ready = true;
    startBackgroundPass(cfg);
    surviveSchemaDrop();
}
/** Recover when another process drops the schema out from under a live instance: re-apply, re-seed. */
function surviveSchemaDrop() {
    setInterval(() => {
        void (async () => {
            try {
                await pool.query('SELECT 1 FROM app_config LIMIT 1');
            }
            catch {
                ready = false;
                try {
                    await applySchema();
                    await seedIfEmpty(cfg, new Store(cfg));
                }
                catch { /* retried on the next tick */ }
                ready = true;
            }
        })();
    }, 2_000);
}
const port = cfg.publicPort || 4173;
app.listen(port, '0.0.0.0', () => {
    console.log(`Open Bonnet serving on 0.0.0.0:${port}`);
});
void boot();
