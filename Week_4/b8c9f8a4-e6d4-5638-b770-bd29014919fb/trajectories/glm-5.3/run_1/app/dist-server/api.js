import express from 'express';
import { pool, loadConfig } from './db.js';
import { PANELS, PANEL_BY_ID, maskedRegistration } from './panels.js';
import { readCar, readPanels, readFindings, readPublishBlockers, carView, readWorkingRecord, readAdvisoryByIdentity, findingFingerprint } from './model.js';
import { findLinkByToken, linkStatus, buyerLinkView, inspectorLinkView, offerView, readSlots, linkViewForOwnerTable } from './linkview.js';
import { sendError, sendValidation, readRawBody, sameOriginGuard, JSON_BODY_LIMIT, CAPTURE_BODY_LIMIT, UPLOAD_REQUEST_LIMIT } from './http.js';
import { randomToken, tokenHash, sha256Hex, uuid } from './crypto.js';
import { storeUpload, UploadError } from './photos.js';
import { pullRecord } from './providerRecord.js';
import { renderPdf, sendAlert } from './providers.js';
import { londonInstants, formatLondonDateTime } from './time.js';
import { diagramSvg, conditionReportHtml, handoverHtml } from './reports.js';
import bcrypt from 'bcryptjs';
const cfg = loadConfig();
export const store = new (await import('./store.js')).Store(cfg);
/** Express 4 does not catch async route throws; wrap every handler. */
function guard(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        }
        catch (err) {
            if (res.headersSent)
                return;
            if (err.code === '42P01') {
                sendError(res, 503, 'starting', 'The system is starting. Try again shortly.');
                return;
            }
            sendError(res, 500, 'internal_error', 'That could not be sent. Try again.');
        }
    };
}
const SESSION_COOKIE = 'ob_owner';
const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { sameOriginGuard(req, res, next); });
/** Body handling with published limits; JSON routes refuse other content types. */
const jsonContent = (limit) => (req, res, next) => {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
        next();
        return;
    }
    if (type !== 'application/json') {
        sendError(res, 415, 'unsupported_media_type', 'This route accepts JSON only');
        return;
    }
    readRawBody(req, limit).then(({ buffer, tooLarge }) => {
        if (tooLarge) {
            sendError(res, 413, 'body_too_large', 'That request is too large');
            return;
        }
        if (buffer.length === 0) {
            req.body = {};
            next();
            return;
        }
        try {
            req.body = JSON.parse(buffer.toString('utf8'));
            next();
        }
        catch {
            sendError(res, 422, 'validation', 'That body is not valid JSON', { errors: { body: 'That body is not valid JSON' } });
        }
    }).catch(() => sendError(res, 400, 'bad_request', 'That request could not be read'));
};
/** Route params as plain strings. */
function param(req, name) {
    const raw = req.params[name];
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
}
// ---------- sessions ----------
export function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}
export async function requireOwner(req, res) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) {
        sendError(res, 401, 'not_signed_in', 'Sign in to continue');
        return false;
    }
    const r = await pool.query('SELECT * FROM owner_session WHERE token_hash = $1 AND expires_at > now()', [tokenHash(token)]);
    if (r.rows.length === 0) {
        sendError(res, 401, 'not_signed_in', 'Sign in to continue');
        return false;
    }
    return true;
}
export async function createSession(res) {
    const token = randomToken(32);
    await pool.query('INSERT INTO owner_session (token_hash, expires_at) VALUES ($1, now() + interval \'30 days\')', [tokenHash(token)]);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}
export async function endAllSessions() {
    await pool.query('DELETE FROM owner_session');
}
// ---------- link auth ----------
export async function requireLink(req, res, token, role) {
    const found = await findLinkByToken(pool, token);
    if (!found) {
        sendError(res, 404, 'link_not_found', 'We could not find that link');
        return null;
    }
    if (found.status === 'revoked') {
        sendError(res, 410, 'link_revoked', 'This link has ended');
        return null;
    }
    if (found.status === 'expired') {
        sendError(res, 410, 'link_expired', 'This link has ended');
        return null;
    }
    if (role && found.link.role !== role) {
        sendError(res, 403, 'wrong_role', 'This link cannot do that');
        return null;
    }
    return { link: found.link };
}
// ---------- idempotency ----------
/** Wrap a state-changing action in idempotency: replay returns the stored success response. */
export async function idempotentWrap(res, scope, key, requestHash, run) {
    const existing = await pool.query('SELECT * FROM idempotency WHERE scope = $1 AND key = $2', [scope, key]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.request_hash !== requestHash) {
            sendError(res, 409, 'idempotency_conflict', 'That Idempotency-Key was used with a different body');
            return;
        }
        res.status(row.status).json(row.response_body);
        return;
    }
    await run((status, body) => {
        if (status >= 200 && status < 300) {
            pool.query('INSERT INTO idempotency (scope, key, request_hash, status, response_body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [scope, key, requestHash, status, JSON.stringify(body)]).catch(() => undefined);
        }
        res.status(status).json(body);
    });
}
/** Idempotency-Key validation, returning the header value or refusing 422. */
export async function idempotencyKey(req, res) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 1 || key.length > 128) {
        sendValidation(res, { 'Idempotency-Key': 'Send an Idempotency-Key of 1 to 128 characters' });
        return null;
    }
    return key;
}
// ---------- routes: owner session ----------
app.post('/api/owner/session', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const body = req.body;
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
    const ownerHashRow = await pool.query('SELECT value FROM app_config WHERE key = $1', ['owner_passphrase_hash']);
    const ok = ownerHashRow.rows.length > 0 && typeof passphrase === 'string'
        && await bcrypt.compare(passphrase, ownerHashRow.rows[0].value).catch(() => false);
    if (!ok) {
        sendError(res, 401, 'bad_passphrase', 'That passphrase is not right');
        return;
    }
    await createSession(res);
    res.json({ signedIn: true });
}));
app.delete('/api/owner/session', guard(async (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    await endAllSessions();
    res.status(204).end();
}));
// ---------- routes: cars ----------
app.get('/api/owner/cars', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const list = await pool.query('SELECT * FROM cars ORDER BY seed_key NULLS LAST, created_at');
    const out = [];
    for (const car of list.rows)
        out.push(await carView(cfg, pool, car));
    res.json({ cars: out });
}));
function carValidationErrors(body) {
    const errors = {};
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const name = str(body.name);
    if (name.length < 1 || name.length > 80)
        errors.name = 'Use between 1 and 80 characters';
    const rawReg = str(body.registration).toUpperCase().replace(/ /g, '');
    if (!/^[A-Z0-9]{2,7}$/.test(rawReg))
        errors.registration = 'Enter 2 to 7 letters or digits';
    const asking = body.askingPounds;
    if (typeof asking !== 'number' || !Number.isInteger(asking) || asking < 1 || asking > 10_000_000)
        errors.askingPounds = 'Enter a whole number of pounds from 1 to 10000000';
    const area = str(body.viewingArea);
    if (area.length < 1 || area.length > 80)
        errors.viewingArea = 'Use between 1 and 80 characters';
    const address = str(body.homeAddress);
    if (address.length < 1 || address.length > 200)
        errors.homeAddress = 'Use between 1 and 200 characters';
    const story = str(body.story);
    if (story.length < 1 || story.length > 1000)
        errors.story = 'Use between 1 and 1000 characters';
    return Object.keys(errors).length > 0 ? errors : null;
}
app.post('/api/owner/cars', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const body = req.body ?? {};
    const errors = carValidationErrors(body);
    if (errors) {
        sendValidation(res, errors);
        return;
    }
    const registration = String(body.registration).trim().toUpperCase().replace(/ /g, '');
    const existing = await pool.query('SELECT id FROM cars WHERE registration = $1', [registration]);
    if (existing.rows.length > 0) {
        sendValidation(res, { registration: 'That registration already has a car file' });
        return;
    }
    const id = uuid();
    await pool.query('INSERT INTO cars (id, name, registration, asking_pounds, viewing_area, home_address, story) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, String(body.name).trim(), registration, body.askingPounds, String(body.viewingArea).trim(), String(body.homeAddress).trim(), String(body.story).trim()]);
    const car = await readCar(pool, id);
    res.status(201).json(await carView(cfg, pool, car));
}));
app.get('/api/owner/cars/:id', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    res.json(await carView(cfg, pool, car));
}));
app.get('/api/owner/cars/:id/panels', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const { panels, medians } = await readPanels(pool, car.id, 'owner');
    res.json({ panels, medians });
}));
// ---------- routes: findings ----------
function findingValidationErrors(body) {
    const errors = {};
    const spec = typeof body.panelId === 'string' ? PANEL_BY_ID[body.panelId] : undefined;
    if (!spec)
        errors.panelId = 'Choose a panel';
    for (const [field, value] of [['u', body.u], ['v', body.v]]) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
            errors[field] = 'Enter a number from 0 to 1';
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length < 1 || title.length > 80)
        errors.title = 'Use between 1 and 80 characters';
    const wording = typeof body.wording === 'string' ? body.wording.trim() : '';
    if (wording.length < 1 || wording.length > 600)
        errors.wording = 'Use between 1 and 600 characters';
    if (typeof body.severity !== 'string' || !['cosmetic', 'moderate', 'serious'].includes(body.severity))
        errors.severity = 'Choose a severity';
    return Object.keys(errors).length > 0 ? errors : null;
}
async function photoBelongsToCar(photoId, carId) {
    if (typeof photoId !== 'string')
        return false;
    const r = await pool.query(`SELECT id FROM uploads WHERE id = $1 AND car_id = $2 AND kind = 'photo'`, [photoId, carId]);
    return r.rows.length > 0;
}
app.get('/api/owner/cars/:id/findings', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const findings = await readFindings(pool, car.id);
    res.json({ findings });
}));
async function walkroundPosition(carId, panelId) {
    const panelIndex = PANELS.findIndex(p => p.id === panelId);
    const samePanel = await pool.query('SELECT count(*)::int AS n FROM findings WHERE car_id = $1 AND panel_id = $2', [carId, panelId]);
    return panelIndex * 100 + samePanel.rows[0].n + 1;
}
app.post('/api/owner/cars/:id/findings', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const body = req.body ?? {};
    const errors = findingValidationErrors(body);
    if (errors) {
        sendValidation(res, errors);
        return;
    }
    if (body.photoId != null && !await photoBelongsToCar(body.photoId, car.id)) {
        sendValidation(res, { photoId: 'Choose a stored photo of this car' });
        return;
    }
    const position = await walkroundPosition(car.id, String(body.panelId));
    const id = uuid();
    await pool.query(`INSERT INTO findings (id, car_id, panel_id, u, v, title, wording, severity, photo_id, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, car.id, String(body.panelId), Math.round(Number(body.u) * 1000) / 1000, Math.round(Number(body.v) * 1000) / 1000,
        String(body.title).trim(), String(body.wording).trim(), String(body.severity), body.photoId ?? null, position]);
    const findings = await readFindings(pool, car.id);
    res.status(201).json(findings.find(f => f.id === id));
}));
app.patch('/api/owner/cars/:id/findings/:findingId', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const existing = await pool.query('SELECT * FROM findings WHERE id = $1 AND car_id = $2', [param(req, 'findingId'), car.id]);
    if (existing.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that finding');
        return;
    }
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch.trim().replace(/^"|"$/g, ''))) {
        sendError(res, 428, 'precondition_required', 'Send If-Match with the finding revision');
        return;
    }
    const clientRevision = parseInt(ifMatch.replace(/"/g, '').trim(), 10);
    const row = existing.rows[0];
    if (clientRevision !== row.revision) {
        sendError(res, 412, 'stale_finding', 'This finding has changed', { currentRevision: row.revision });
        return;
    }
    const body = req.body ?? {};
    const merged = {
        panelId: body.panelId ?? row.panel_id, u: body.u ?? row.u, v: body.v ?? row.v,
        title: body.title ?? row.title, wording: body.wording ?? row.wording,
        severity: body.severity ?? row.severity, photoId: body.photoId !== undefined ? body.photoId : row.photo_id,
    };
    const errors = findingValidationErrors(merged);
    if (errors) {
        sendValidation(res, errors);
        return;
    }
    if (merged.photoId != null && !await photoBelongsToCar(merged.photoId, car.id)) {
        sendValidation(res, { photoId: 'Choose a stored photo of this car' });
        return;
    }
    const position = merged.panelId !== row.panel_id ? await walkroundPosition(car.id, String(merged.panelId)) : row.position;
    await pool.query(`UPDATE findings SET panel_id=$2, u=$3, v=$4, title=$5, wording=$6, severity=$7, photo_id=$8, revision=revision+1, position=$9 WHERE id=$1`, [row.id, String(merged.panelId), Math.round(Number(merged.u) * 1000) / 1000, Math.round(Number(merged.v) * 1000) / 1000,
        String(merged.title).trim(), String(merged.wording).trim(), String(merged.severity), merged.photoId ?? null, position]);
    const findings = await readFindings(pool, car.id);
    res.json(findings.find(f => f.id === row.id));
}));
app.delete('/api/owner/cars/:id/findings/:findingId', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const existing = await pool.query('SELECT * FROM findings WHERE id = $1 AND car_id = $2', [param(req, 'findingId'), car.id]);
    if (existing.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that finding');
        return;
    }
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch.trim().replace(/^"|"$/g, ''))) {
        sendError(res, 428, 'precondition_required', 'Send If-Match with the finding revision');
        return;
    }
    const row = existing.rows[0];
    if (parseInt(ifMatch.replace(/"/g, '').trim(), 10) !== row.revision) {
        sendError(res, 412, 'stale_finding', 'This finding has changed', { currentRevision: row.revision });
        return;
    }
    await pool.query('DELETE FROM findings WHERE id = $1', [row.id]);
    res.status(204).end();
}));
// ---------- routes: uploads ----------
function parseUploadForm(raw, contentType) {
    const m = /boundary=(.+)$/.exec(contentType);
    if (!m)
        throw new Error('no boundary');
    const boundary = Buffer.from(`--${m[1]}`);
    const fields = new Map();
    const files = new Map();
    let idx = raw.indexOf(boundary);
    while (idx !== -1) {
        const next = raw.indexOf(boundary, idx + boundary.length);
        if (next === -1)
            break;
        const part = raw.subarray(idx + boundary.length + 2, next - 2);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headers = part.subarray(0, headerEnd).toString('utf8');
            const data = part.subarray(headerEnd + 4);
            const nameM = /name="([^"]*)"/.exec(headers);
            const fileM = /filename="([^"]*)"/.exec(headers);
            if (nameM) {
                if (fileM)
                    files.set(nameM[1], { name: fileM[1], data });
                else
                    fields.set(nameM[1], data.toString('utf8'));
            }
        }
        idx = next;
    }
    return { fields, files };
}
app.post('/api/owner/cars/:id/uploads', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const contentType = req.headers['content-type'] ?? '';
    const { buffer, tooLarge } = await readRawBody(req, UPLOAD_REQUEST_LIMIT);
    if (tooLarge) {
        sendError(res, 413, 'file_too_large', 'This file is over the size limit');
        return;
    }
    let fields;
    let files;
    try {
        ({ fields, files } = parseUploadForm(buffer, contentType));
    }
    catch {
        sendError(res, 415, 'unsupported_media_type', 'Send the file as multipart form data');
        return;
    }
    const kind = fields.get('kind');
    const file = files.get('file');
    if (!file || (kind !== 'photo' && kind !== 'invoice')) {
        sendValidation(res, { file: 'Send a kind and a file' });
        return;
    }
    if (file.data.length > 8_000_000) {
        sendError(res, 413, 'file_too_large', 'This file is over the size limit');
        return;
    }
    let plateMask = null;
    let plateMaskRaw;
    if (kind === 'photo') {
        plateMaskRaw = fields.get('plateMask');
        if (plateMaskRaw !== undefined && plateMaskRaw !== 'null') {
            try {
                const parsed = JSON.parse(plateMaskRaw);
                if (parsed !== null) {
                    const { x, y, w, h } = parsed;
                    if ([x, y, w, h].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) && x + w <= 1.0000001 && y + h <= 1.0000001) {
                        plateMask = { x, y, w, h };
                    }
                    else {
                        sendValidation(res, { plateMask: 'Mask values must be fractions of the image from 0 to 1' });
                        return;
                    }
                }
            }
            catch {
                sendValidation(res, { plateMask: 'Send the mask as JSON' });
                return;
            }
        }
    }
    let label = null;
    if (kind === 'invoice') {
        const rawLabel = fields.get('label') ?? '';
        if (rawLabel.trim().length < 1 || rawLabel.trim().length > 80) {
            sendValidation(res, { label: 'Use between 1 and 80 characters' });
            return;
        }
        label = rawLabel.trim();
    }
    try {
        const upload = await storeUpload(store, car.id, { kind, fileName: file.name, bytes: file.data, label, plateMask });
        await pool.query(`INSERT INTO uploads (id, car_id, kind, file_name, sha256, bytes, content_type, derivative_sha256, location_removed, label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [upload.id, car.id, upload.kind, upload.fileName, upload.sha256, upload.bytes, upload.contentType, upload.derivativeSha256, upload.locationRemoved, upload.label]);
        res.status(201).json(upload);
    }
    catch (err) {
        if (err instanceof UploadError) {
            if (err.code === 'bad_name') {
                sendValidation(res, { file: 'That file name is not allowed' });
                return;
            }
            sendError(res, err.status, err.code, err.message);
            return;
        }
        throw err;
    }
}));
app.get('/api/owner/cars/:id/uploads', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const rows = await pool.query('SELECT * FROM uploads WHERE car_id = $1 ORDER BY created_at', [car.id]);
    res.json({ uploads: rows.rows.map((r) => ({
            id: r.id, kind: r.kind, status: 'stored', fileName: r.file_name, sha256: r.sha256, bytes: r.bytes,
            contentType: r.content_type, derivativeSha256: r.derivative_sha256, locationRemoved: r.location_removed, label: r.label,
        })) });
}));
app.get('/api/owner/uploads/:id/original', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const row = await pool.query('SELECT * FROM uploads WHERE id = $1', [param(req, 'id')]);
    if (row.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that file');
        return;
    }
    const upload = row.rows[0];
    try {
        const bytes = await store.get(store.originalKey(upload.car_id, upload.id));
        res.setHeader('Content-Type', upload.content_type);
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'Photo storage is not answering');
    }
}));
app.get('/api/owner/uploads/:id/derivative', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const row = await pool.query('SELECT * FROM uploads WHERE id = $1', [param(req, 'id')]);
    if (row.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that file');
        return;
    }
    const upload = row.rows[0];
    if (upload.kind !== 'photo') {
        sendError(res, 404, 'not_found', 'Invoices have no photo copy');
        return;
    }
    try {
        const bytes = await store.get(store.derivativeKey(upload.car_id, upload.id));
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'Photo storage is not answering');
    }
}));
// ---------- routes: readings ----------
app.put('/api/owner/cars/:id/readings', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const body = req.body ?? {};
    const readings = body.readings;
    if (!Array.isArray(readings)) {
        sendValidation(res, { readings: 'Send an array of readings' });
        return;
    }
    const errors = {};
    for (const r of readings) {
        const spec = r && typeof r.panelId === 'string' ? PANEL_BY_ID[r.panelId] : undefined;
        if (!spec) {
            errors[String(r?.panelId ?? 'readings')] = 'Unknown panel';
            continue;
        }
        if (spec.substrate === 'plastic') {
            errors[spec.id] = 'Plastic panels cannot be gauged';
            continue;
        }
        const microns = r.microns;
        if (typeof microns !== 'number' || !Number.isInteger(microns) || microns < 1 || microns > 2000) {
            errors[spec.id] = 'Enter whole microns from 1 to 2000';
        }
    }
    if (Object.keys(errors).length > 0) {
        sendValidation(res, errors);
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const r of readings) {
            await client.query(`INSERT INTO readings (car_id, panel_id, microns, read_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (car_id, panel_id) DO UPDATE SET microns = EXCLUDED.microns, read_at = now()`, [car.id, String(r.panelId), r.microns]);
        }
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
    const { panels, medians } = await readPanels(pool, car.id, 'owner');
    res.json({ panels, medians });
}));
// ---------- routes: record ----------
app.post('/api/owner/cars/:id/record/pull', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const reply = await pullRecord(cfg, car.registration);
    if ('failure' in reply) {
        const f = reply.failure;
        if (f.kind === 'not_found') {
            sendError(res, 404, 'record_not_found', 'No test record was found for this registration.');
            return;
        }
        if (f.kind === 'throttled') {
            sendError(res, 429, 'record_throttled', 'The record service is busy. Try again in a few seconds.', { retryAfterSeconds: f.retryAfterSeconds });
            return;
        }
        sendError(res, 503, 'record_unreachable', 'The roadworthiness record service is not answering. Your last pull is still shown.');
        return;
    }
    const payload = reply.record;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO record_pulls (car_id, first_used_date, payload) VALUES ($1,$2,$3)', [car.id, payload.firstUsedDate, JSON.stringify(payload)]);
        await client.query('UPDATE cars SET pulled_at = now() WHERE id = $1', [car.id]);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
    const record = await readWorkingRecord(pool, car.id);
    res.status(201).json(record);
}));
app.get('/api/owner/cars/:id/record', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const record = await readWorkingRecord(pool, car.id);
    if (!record) {
        sendError(res, 404, 'no_record_pull', 'Pull the test record first');
        return;
    }
    res.json(record);
}));
app.put('/api/owner/cars/:id/advisories/:advisoryId', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const body = req.body ?? {};
    const stance = body.stance;
    const note = typeof body.note === 'string' ? body.note : '';
    if (typeof stance !== 'string' || !['repaired', 'monitoring', 'not_repaired'].includes(stance)) {
        sendValidation(res, { stance: 'Choose a stance' });
        return;
    }
    if (note.trim().length < 1 || note.trim().length > 500) {
        sendValidation(res, { note: 'Use between 1 and 500 characters' });
        return;
    }
    const advisory = await readAdvisoryByIdentity(pool, car.id, param(req, 'advisoryId'));
    if (!advisory) {
        sendError(res, 404, 'not_found', 'We could not find that advisory');
        return;
    }
    if (stance === 'repaired' && advisory.recurred) {
        sendValidation(res, { stance: 'Seen again at a later test' });
        return;
    }
    await pool.query(`INSERT INTO advisory_responses (car_id, advisory_key, stance, note, answered_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (car_id, advisory_key) DO UPDATE SET stance = EXCLUDED.stance, note = EXCLUDED.note, answered_at = now()`, [car.id, param(req, 'advisoryId'), stance, note.trim()]);
    const updated = await readAdvisoryByIdentity(pool, car.id, param(req, 'advisoryId'));
    res.json(updated);
}));
// ---------- routes: publish and listing ----------
app.post('/api/owner/cars/:id/publish', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'illegal_transition', 'This listing cannot be published now');
        return;
    }
    const blockers = await readPublishBlockers(cfg, pool, car.id);
    if (blockers.length > 0) {
        sendError(res, 409, 'publish_blocked', 'Some things must be settled before publishing', { reasons: blockers });
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const claim = await client.query(`UPDATE cars SET listing_status = 'rendering' WHERE id = $1 AND listing_status IN ('draft','live') RETURNING *`, [car.id]);
        if (claim.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            sendError(res, 409, 'publish_in_progress', 'This car is already publishing');
            return;
        }
        const nextVersion = (car.current_version ?? 0) + 1;
        // Freeze the version's findings, panels and record from working state.
        const findings = await readFindings(client, car.id);
        if (car.current_version !== null) {
            const prev = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
            const prevContent = prev.rows[0]?.content;
            const same = JSON.stringify(prevContent.findings.map((f) => f.fingerprint).sort()) === JSON.stringify(findings.map(f => findingFingerprint(f)).sort());
            const prevPanels = JSON.stringify(prevContent?.panels ?? null);
            const recordNow = await readWorkingRecord(client, car.id);
            const prevRecordFingerprint = JSON.stringify(prevContent?.record ?? null);
            if (same && prevPanels === JSON.stringify(await readPanels(client, car.id, 'owner')) && prevRecordFingerprint === JSON.stringify(recordNow)) {
                await client.query('ROLLBACK');
                client.release();
                sendError(res, 409, 'no_changes', 'Nothing has changed since the last version');
                return;
            }
        }
        const { panels } = await readPanels(client, car.id, 'owner');
        const record = await readWorkingRecord(client, car.id);
        const findingsFrozen = findings.map(f => ({ ...f, fingerprint: findingFingerprint(f) }));
        const content = { findings: findingsFrozen, panels, record };
        const changedFindingIds = findingsFrozen.map(f => f.id);
        let reportSha;
        try {
            const reportBody = reportBodyFor(findings, panels, record);
            const { svg } = diagramSvg(findings.map(f => ({ panelId: f.panelId, u: f.u, v: f.v, title: f.title })));
            const html = conditionReportHtml({ name: car.name, maskedRegistration: maskedRegistration(car.registration), version: nextVersion }, { ...reportBody, diagramSvg: svg });
            const pdf = await renderPdf(cfg, html);
            reportSha = await store.put(store.reportKey(car.id, nextVersion), pdf, 'application/pdf');
            const back = await store.get(store.reportKey(car.id, nextVersion));
            if (sha256Hex(back) !== reportSha)
                throw new Error('report hash mismatch');
        }
        catch (err) {
            await client.query('ROLLBACK');
            client.release();
            sendError(res, 503, err instanceof Error && err.message === 'render failed' ? 'report_render_failed' : 'report_store_failed', 'The report could not be rendered, so nothing was published.');
            return;
        }
        await client.query('INSERT INTO versions (car_id, number, report_sha256, content) VALUES ($1,$2,$3,$4)', [car.id, nextVersion, reportSha, JSON.stringify(content)]);
        await client.query(`UPDATE cars SET listing_status = 'live', current_version = $2 WHERE id = $1`, [car.id, nextVersion]);
        // An amendment clears seen status for the findings it changes; offers on those material findings need a re-read.
        if (car.current_version !== null) {
            const prevContent = (await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version])).rows[0]?.content;
            const prevByFingerprint = new Map(prevContent.findings.map((f) => [f.id, f.fingerprint]));
            const changedMaterial = findingsFrozen.filter(f => f.material && prevByFingerprint.get(f.id) !== f.fingerprint).map(f => f.id);
            if (changedMaterial.length > 0) {
                const liveOffers = await client.query(`SELECT id, link_id FROM offers WHERE car_id = $1 AND status IN ('open','needs_reread') FOR UPDATE`, [car.id]);
                for (const offer of liveOffers.rows) {
                    const unseen = await client.query(`SELECT count(*)::int AS n FROM jsonb_array_elements($1::jsonb) f
             WHERE (f->>'material')::boolean
             AND EXISTS (SELECT 1 FROM jsonb_array_elements($2::jsonb) c WHERE c = f->>'id')
             AND NOT EXISTS (SELECT 1 FROM seen_records sr WHERE sr.link_id = $3 AND sr.finding_id = f->>'id' AND sr.finding_fingerprint = f->>'fingerprint')`, [JSON.stringify(findingsFrozen), JSON.stringify(changedMaterial), offer.link_id]);
                    if (unseen.rows[0].n > 0) {
                        await client.query(`UPDATE offers SET status = 'needs_reread' WHERE id = $1`, [offer.id]);
                    }
                }
            }
        }
        await client.query('COMMIT');
        client.release();
        res.status(201).json({ version: nextVersion, listingStatus: 'live', reportSha256: reportSha, changedFindingIds: changedFindingIds });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        // The listing returns to the status it held.
        await pool.query(`UPDATE cars SET listing_status = $2 WHERE id = $1`, [car.id, car.listing_status]).catch(() => undefined);
        await store.del(store.reportKey(car.id, (car.current_version ?? 0) + 1)).catch(() => undefined);
        sendError(res, 503, 'report_store_failed', 'The report could not be stored, so nothing was published.');
    }
}));
function reportBodyFor(findings, panels, record) {
    const rows = findings.map(f => ({ title: f.title, wording: f.wording, severity: f.severity, panelLabel: f.panelLabel, band: f.band }));
    const readingRows = panels
        .map(p => ({ panel: p.label, microns: p.owner ? String(p.owner.microns) : 'No reading', band: p.owner ? p.owner.band : 'No reading' }));
    const tape = (record?.tape ?? []).map(t => ({
        date: t.completedDate.slice(0, 10), result: t.testResult,
        value: t.odometerValue ?? '', unit: t.odometerUnit ?? '',
        flag: t.flag ?? '',
    }));
    const advisories = (record?.advisories ?? []).map(a => ({ text: a.text, stance: a.stance ?? 'Unanswered', note: a.note ?? '' }));
    return { diagramSvg: '', findings: rows, readings: readingRows, tape, advisories, openAdvisories: record?.openAdvisories ?? 0 };
}
app.post('/api/owner/cars/:id/withdraw', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (!['draft', 'live', 'under_offer'].includes(car.listing_status)) {
        sendError(res, 409, 'illegal_transition', 'This listing cannot be withdrawn now');
        return;
    }
    if (car.listing_status === 'live' || car.listing_status === 'under_offer') {
        const open = await pool.query(`SELECT count(*)::int AS n FROM offers WHERE car_id = $1 AND status IN ('open','needs_reread')`, [car.id]);
        if (open.rows[0].n > 0) {
            sendError(res, 409, 'offers_open', 'There are open offers on this car');
            return;
        }
    }
    await pool.query(`UPDATE cars SET listing_status = 'withdrawn' WHERE id = $1`, [car.id]);
    const car2 = await readCar(pool, car.id);
    res.json(await carView(cfg, pool, car2));
}));
app.post('/api/owner/cars/:id/complete', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'under_offer') {
        sendError(res, 409, 'illegal_transition', 'The sale cannot be completed now');
        return;
    }
    const accepted = await pool.query(`SELECT o.*, l.name AS buyer_name FROM offers o JOIN links l ON l.id = o.link_id WHERE o.car_id = $1 AND o.status = 'accepted'`, [car.id]);
    if (accepted.rows.length === 0) {
        sendError(res, 409, 'illegal_transition', 'The sale cannot be completed now');
        return;
    }
    const winner = accepted.rows[0];
    const versionRow = await pool.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
    const frozenFindings = (versionRow.rows[0]?.content?.findings) ?? [];
    const seenRows = await pool.query('SELECT finding_id, finding_fingerprint, seen_at FROM seen_records WHERE link_id = $1', [winner.link_id]);
    const byFinding = new Map(seenRows.rows.map((r) => [r.finding_id, r]));
    const records = frozenFindings
        .filter((f) => byFinding.get(f.id)?.finding_fingerprint === f.fingerprint)
        .map((f) => ({ title: f.title, date: formatLondonDateTime(byFinding.get(f.id).seen_at) }));
    let handoverSha;
    try {
        const html = handoverHtml({ name: car.name, maskedRegistration: maskedRegistration(car.registration), version: car.current_version ?? 0 }, { price: winner.amount_pounds, buyerName: winner.buyer_name, seen: records });
        const pdf = await renderPdf(cfg, html);
        handoverSha = await store.put(store.handoverKey(car.id), pdf, 'application/pdf');
    }
    catch {
        sendError(res, 503, 'report_render_failed', 'The handover record could not be made, so the sale is not complete.');
        return;
    }
    const moved = await pool.query(`UPDATE cars SET listing_status = 'sold' WHERE id = $1 AND listing_status = 'under_offer' RETURNING id`, [car.id]);
    if (moved.rows.length === 0) {
        await store.del(store.handoverKey(car.id)).catch(() => undefined);
        sendError(res, 409, 'illegal_transition', 'The sale cannot be completed now');
        return;
    }
    res.status(201).json({ listingStatus: 'sold', handoverSha256: handoverSha });
}));
app.get('/api/owner/cars/:id/versions', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const rows = await pool.query('SELECT number, published_at, report_sha256 FROM versions WHERE car_id = $1 ORDER BY number', [car.id]);
    res.json({ versions: rows.rows.map((r) => ({
            number: r.number, publishedAt: r.published_at.toISOString(), reportSha256: r.report_sha256,
        })) });
}));
app.get('/api/owner/cars/:id/versions/:number', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const row = await pool.query('SELECT * FROM versions WHERE car_id = $1 AND number = $2', [car.id, Number(param(req, 'number'))]);
    if (row.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that version');
        return;
    }
    const v = row.rows[0];
    res.json({ number: v.number, publishedAt: v.published_at.toISOString(), ...v.content });
}));
app.get('/api/owner/cars/:id/report/:number', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    try {
        const bytes = await store.get(store.reportKey(car.id, Number(param(req, 'number'))));
        res.setHeader('Content-Type', 'application/pdf');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'The report could not be read right now');
    }
}));
app.get('/api/owner/cars/:id/handover', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'sold') {
        sendError(res, 409, 'listing_not_sold', 'This car has not been sold');
        return;
    }
    try {
        const bytes = await store.get(store.handoverKey(car.id));
        res.setHeader('Content-Type', 'application/pdf');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'The handover record could not be read right now');
    }
}));
// ---------- routes: people and links ----------
app.post('/api/owner/cars/:id/links', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'live') {
        sendError(res, 409, 'listing_not_published', 'Only a live car can have a new link');
        return;
    }
    const body = req.body ?? {};
    const role = body.role;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (role !== 'buyer' && role !== 'inspector') {
        sendValidation(res, { role: 'Choose buyer or inspector' });
        return;
    }
    if (name.length < 1 || name.length > 80) {
        sendValidation(res, { name: 'Use between 1 and 80 characters' });
        return;
    }
    const token = randomToken(24);
    const id = uuid();
    await pool.query('INSERT INTO links (id, car_id, role, name, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6 || \' seconds\')::interval)', [id, car.id, role, name, tokenHash(token), String(cfg.linkTtlSeconds)]);
    const link = await pool.query('SELECT * FROM links WHERE id = $1', [id]);
    const row = link.rows[0];
    res.status(201).json({
        id: row.id, role: row.role, name: row.name, status: 'active',
        expiresAt: row.expires_at.toISOString(),
        secondsRemaining: Math.max(0, Math.floor((row.expires_at.getTime() - Date.now()) / 1000)),
        token, path: `/l/${token}`,
    });
}));
app.get('/api/owner/cars/:id/links', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    res.json({ links: await linkViewForOwnerTable(pool, car.id) });
}));
app.post('/api/owner/links/:id/revoke', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const link = await pool.query('SELECT * FROM links WHERE id = $1', [param(req, 'id')]);
    if (link.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that link');
        return;
    }
    const row = link.rows[0];
    if (linkStatus(row) !== 'active') {
        sendError(res, 409, 'link_already_ended', 'This link has already ended');
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE links SET status = 'revoked' WHERE id = $1`, [row.id]);
        await client.query('UPDATE slots SET holder_link_id = NULL WHERE holder_link_id = $1', [row.id]);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
    res.json(await linkSummary(row.id));
}));
app.post('/api/owner/links/:id/renew', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const link = await pool.query('SELECT * FROM links WHERE id = $1', [param(req, 'id')]);
    if (link.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that link');
        return;
    }
    const row = link.rows[0];
    if (row.status === 'revoked') {
        sendError(res, 409, 'link_revoked', 'A revoked link cannot be renewed');
        return;
    }
    await pool.query(`UPDATE links SET expires_at = now() + ($2 || ' seconds')::interval, status = 'active' WHERE id = $1`, [row.id, String(cfg.linkTtlSeconds)]);
    res.json(await linkSummary(row.id));
}));
app.post('/api/owner/links/:id/replace', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const link = await pool.query('SELECT * FROM links WHERE id = $1', [param(req, 'id')]);
    if (link.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that link');
        return;
    }
    const row = link.rows[0];
    if (row.status === 'revoked') {
        sendError(res, 409, 'link_revoked', 'A revoked link cannot be replaced');
        return;
    }
    const token = randomToken(24);
    await pool.query(`UPDATE links SET token_hash = $2, status = 'active', expires_at = now() + ($3 || ' seconds')::interval WHERE id = $1`, [row.id, tokenHash(token), String(cfg.linkTtlSeconds)]);
    const updated = await pool.query('SELECT * FROM links WHERE id = $1', [row.id]);
    const fresh = updated.rows[0];
    res.json({
        id: fresh.id, role: fresh.role, name: fresh.name, status: 'active',
        expiresAt: fresh.expires_at.toISOString(),
        secondsRemaining: Math.max(0, Math.floor((fresh.expires_at.getTime() - Date.now()) / 1000)),
        token, path: `/l/${token}`,
    });
}));
async function linkSummary(linkId) {
    const carId = (await pool.query('SELECT car_id FROM links WHERE id = $1', [linkId])).rows[0].car_id;
    const rows = (await linkViewForOwnerTable(pool, carId));
    return rows.find(r => r.id === linkId);
}
// ---------- routes: viewings ----------
app.get('/api/owner/cars/:id/slots', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    res.json({ slots: await readSlots(pool, car.id, 'owner') });
}));
app.post('/api/owner/cars/:id/slots', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'draft' && car.listing_status !== 'live') {
        sendError(res, 409, 'listing_closed', 'This car is not taking changes right now');
        return;
    }
    const body = req.body ?? {};
    const localStart = typeof body.localStart === 'string' ? body.localStart : '';
    const duration = body.durationMinutes;
    const errors = {};
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localStart))
        errors.localStart = 'Type the date and time as YYYY-MM-DDTHH:mm';
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 15 || duration > 240)
        errors.durationMinutes = 'Enter minutes from 15 to 240';
    if (Object.keys(errors).length > 0) {
        sendValidation(res, errors);
        return;
    }
    const instants = londonInstants(localStart);
    if (instants.length === 0) {
        sendValidation(res, { localStart: 'That time does not exist in London on that date' });
        return;
    }
    const startsAt = instants[0];
    if (startsAt.getTime() <= Date.now()) {
        sendValidation(res, { localStart: 'Choose a time in the future' });
        return;
    }
    const id = uuid();
    await pool.query('INSERT INTO slots (id, car_id, starts_at, duration_minutes) VALUES ($1,$2,$3,$4)', [id, car.id, startsAt, duration]);
    const slots = await readSlots(pool, car.id, 'owner');
    res.status(201).json(slots.find(s => s.id === id));
}));
app.delete('/api/owner/cars/:id/slots/:slotId', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const slot = await pool.query('SELECT * FROM slots WHERE id = $1 AND car_id = $2', [param(req, 'slotId'), car.id]);
    if (slot.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that slot');
        return;
    }
    if (slot.rows[0].holder_link_id !== null) {
        sendError(res, 409, 'slot_held', 'That slot is held by a buyer');
        return;
    }
    await pool.query('DELETE FROM slots WHERE id = $1', [param(req, 'slotId')]);
    res.status(204).end();
}));
// ---------- routes: link (buyer and inspector) ----------
app.get('/api/link/:token', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'));
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const client = await pool.connect();
    try {
        if (link.role === 'buyer') {
            await client.query('UPDATE links SET last_seen_at = now() WHERE id = $1', [link.id]);
            res.json(await buyerLinkView(cfg, client, link, car));
        }
        else {
            res.json(await inspectorLinkView(cfg, client, link, car));
        }
    }
    finally {
        client.release();
    }
}));
app.post('/api/link/:token/seen', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const body = req.body ?? {};
    const car = await readCar(pool, link.car_id);
    if (!car || car.current_version === null) {
        sendError(res, 404, 'not_found', 'We could not find that finding');
        return;
    }
    const versionRow = await pool.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
    const content = versionRow.rows[0]?.content;
    const finding = (content?.findings ?? []).find((f) => f.id === body.findingId);
    if (!finding) {
        sendError(res, 404, 'not_found', 'We could not find that finding');
        return;
    }
    const existing = await pool.query('SELECT * FROM seen_records WHERE link_id = $1 AND finding_id = $2', [link.id, finding.id]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.finding_fingerprint === finding.fingerprint) {
            res.json({ findingId: finding.id, seenAt: row.seen_at.toISOString(), progress: await progressFor(pool, link.id, car) });
            return;
        }
        await pool.query('UPDATE seen_records SET finding_fingerprint = $3, seen_at = now() WHERE link_id = $1 AND finding_id = $2', [link.id, finding.id, finding.fingerprint]);
        const fresh = await pool.query('SELECT seen_at FROM seen_records WHERE link_id = $1 AND finding_id = $2', [link.id, finding.id]);
        res.json({ findingId: finding.id, seenAt: fresh.rows[0].seen_at.toISOString(), progress: await progressFor(pool, link.id, car) });
        return;
    }
    const inserted = await pool.query(`INSERT INTO seen_records (link_id, finding_id, finding_fingerprint, seen_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (link_id, finding_id) DO UPDATE SET finding_fingerprint = EXCLUDED.finding_fingerprint, seen_at = now()
     RETURNING seen_at`, [link.id, finding.id, finding.fingerprint]);
    await pool.query('UPDATE links SET last_seen_at = now() WHERE id = $1', [link.id]);
    // A needs_reread offer returns to open when its buyer has again seen every material finding.
    await reopenOfferIfCaughtUp(link.id, car.id);
    res.status(201).json({ findingId: finding.id, seenAt: inserted.rows[0].seen_at.toISOString(), progress: await progressFor(pool, link.id, car) });
}));
async function progressFor(client, linkId, car) {
    if (car.current_version === null)
        return { seen: 0, total: 0, materialUnseen: 0 };
    const versionRow = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
    const content = versionRow.rows[0]?.content;
    const findings = content?.findings ?? [];
    const seen = await client.query('SELECT finding_id, finding_fingerprint FROM seen_records WHERE link_id = $1', [linkId]);
    const map = new Map(seen.rows.map((r) => [r.finding_id, r.finding_fingerprint]));
    const isSeen = (f) => map.get(f.id) === f.fingerprint;
    return {
        seen: findings.filter(isSeen).length,
        total: findings.length,
        materialUnseen: findings.filter(f => f.material && !isSeen(f)).length,
    };
}
async function reopenOfferIfCaughtUp(linkId, carId) {
    await pool.query('BEGIN').catch(() => undefined);
    const offer = await pool.query(`SELECT id FROM offers WHERE link_id = $1 AND car_id = $2 AND status = 'needs_reread' ORDER BY stamped_at DESC LIMIT 1`, [linkId, carId]);
    if (offer.rows.length === 0) {
        await pool.query('COMMIT').catch(() => undefined);
        return;
    }
    const car = await readCar(pool, carId);
    const progress = await progressFor(pool, linkId, car);
    if (progress.materialUnseen === 0) {
        await pool.query(`UPDATE offers SET status = 'open' WHERE id = $1`, [offer.rows[0].id]);
    }
    await pool.query('COMMIT').catch(() => undefined);
}
app.get('/api/link/:token/photos/:uploadId', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'));
    if (!found)
        return;
    const row = await pool.query(`SELECT * FROM uploads WHERE id = $1 AND kind = 'photo'`, [param(req, 'uploadId')]);
    if (row.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that photo');
        return;
    }
    const upload = row.rows[0];
    try {
        const bytes = await store.get(store.derivativeKey(upload.car_id, upload.id));
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'Photos are unavailable right now');
    }
}));
app.get('/api/link/:token/report', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car || car.current_version === null) {
        sendError(res, 404, 'not_found', 'We could not find that report');
        return;
    }
    try {
        const bytes = await store.get(store.reportKey(car.id, car.current_version));
        res.setHeader('Content-Type', 'application/pdf');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'The report could not be read right now');
    }
}));
app.get('/api/link/:token/report/:number', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that report');
        return;
    }
    const number = Number(param(req, 'number'));
    const seen = await pool.query(`
    SELECT 1 FROM versions v
    WHERE v.car_id = $1 AND v.number = $2
    AND EXISTS (SELECT 1 FROM seen_records sr WHERE sr.link_id = $3 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.content->'findings') f WHERE f->>'id' = sr.finding_id))
    LIMIT 1`, [car.id, number, link.id]);
    if (seen.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that report');
        return;
    }
    try {
        const bytes = await store.get(store.reportKey(car.id, number));
        res.setHeader('Content-Type', 'application/pdf');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'The report could not be read right now');
    }
}));
app.get('/api/link/:token/versions/:number', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that version');
        return;
    }
    const number = Number(param(req, 'number'));
    const seen = await pool.query(`
    SELECT 1 FROM versions v
    WHERE v.car_id = $1 AND v.number = $2
    AND EXISTS (SELECT 1 FROM seen_records sr WHERE sr.link_id = $3 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.content->'findings') f WHERE f->>'id' = sr.finding_id))
    LIMIT 1`, [car.id, number, link.id]);
    if (seen.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that version');
        return;
    }
    const versionRow = await pool.query('SELECT * FROM versions WHERE car_id = $1 AND number = $2', [car.id, number]);
    const v = versionRow.rows[0];
    const findings = v.content.findings;
    const seenRows = await pool.query('SELECT finding_id, finding_fingerprint, seen_at FROM seen_records WHERE link_id = $1', [link.id]);
    const map = new Map(seenRows.rows.map((r) => [r.finding_id, r]));
    res.json({
        number: v.number, publishedAt: v.published_at.toISOString(),
        findings: findings.map((f) => ({
            ...f,
            seen: map.get(f.id)?.finding_fingerprint === f.fingerprint,
            seenAt: map.get(f.id)?.finding_fingerprint === f.fingerprint ? map.get(f.id)?.seen_at?.toISOString() ?? null : null,
        })),
    });
}));
app.get('/api/link/:token/handover', guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    if (car.listing_status !== 'sold') {
        sendError(res, 409, 'listing_not_sold', 'This car has not been sold');
        return;
    }
    const accepted = await pool.query(`SELECT link_id FROM offers WHERE car_id = $1 AND status = 'accepted'`, [car.id]);
    if (accepted.rows[0]?.link_id !== link.id) {
        sendError(res, 403, 'not_the_buyer', 'This record belongs to the winning buyer');
        return;
    }
    try {
        const bytes = await store.get(store.handoverKey(car.id));
        res.setHeader('Content-Type', 'application/pdf');
        res.send(bytes);
    }
    catch {
        sendError(res, 503, 'storage_unavailable', 'The handover record could not be read right now');
    }
}));
// ---------- routes: claims, offers, capture through links ----------
app.post('/api/link/:token/slots/:slotId/claim', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const key = await idempotencyKey(req, res);
    if (key === null)
        return;
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    await idempotentWrap(res, `claim:${link.id}`, key, 'claim', async (finish) => {
        if (car.listing_status !== 'live' && car.listing_status !== 'under_offer') {
            finish(409, { error: 'listing_closed', message: 'This car is not taking viewings or offers right now' });
            return;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const held = await client.query('SELECT id FROM slots WHERE car_id = $1 AND holder_link_id = $2 FOR UPDATE', [car.id, link.id]);
            if (held.rows.length > 0) {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'already_holding_slot', message: 'You already hold a viewing. Release it first.' });
                return;
            }
            const slot = await client.query('SELECT * FROM slots WHERE id = $1 AND car_id = $2 FOR UPDATE', [param(req, 'slotId'), car.id]);
            if (slot.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                finish(404, { error: 'not_found', message: 'We could not find that slot' });
                return;
            }
            const row = slot.rows[0];
            if (row.holder_link_id !== null) {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'slot_taken', message: 'That slot has just gone' });
                return;
            }
            if (row.starts_at.getTime() <= Date.now()) {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'slot_past', message: 'That slot has just gone' });
                return;
            }
            await client.query('UPDATE slots SET holder_link_id = $2 WHERE id = $1', [row.id, link.id]);
            await client.query('COMMIT');
            client.release();
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw err;
        }
        await raiseAlert(car.id, 'viewing_claim');
        const slots = await readSlots(pool, car.id, { linkId: link.id });
        finish(201, slots.find(s => s.id === param(req, 'slotId')));
    });
}));
app.post('/api/link/:token/slots/:slotId/release', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const slot = await pool.query('SELECT * FROM slots WHERE id = $1 AND car_id = $2', [param(req, 'slotId'), car.id]);
    if (slot.rows.length === 0 || slot.rows[0].holder_link_id !== link.id) {
        sendError(res, 403, 'not_slot_holder', 'You do not hold that viewing');
        return;
    }
    await pool.query('UPDATE slots SET holder_link_id = NULL WHERE id = $1', [slot.rows[0].id]);
    const slots = await readSlots(pool, car.id, { linkId: link.id });
    res.json(slots.find(s => s.id === param(req, 'slotId')));
}));
app.post('/api/link/:token/offers', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const key = await idempotencyKey(req, res);
    if (key === null)
        return;
    const found = await requireLink(req, res, param(req, 'token'), 'buyer');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const body = req.body ?? {};
    const amount = body.amountPounds;
    const requestHash = sha256Hex(JSON.stringify(body));
    const badAmount = typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 10_000_000;
    if (badAmount) {
        // Validation happens before the replay check only when the key exists with a different body.
        const existing = await pool.query('SELECT request_hash FROM idempotency WHERE scope = $1 AND key = $2', [`offer:${link.id}`, key]);
        if (existing.rows.length === 0) {
            sendValidation(res, { amountPounds: 'Enter a whole number of pounds from 1 to 10000000' });
            return;
        }
    }
    await idempotentWrap(res, `offer:${link.id}`, key, requestHash, async (finish) => {
        await applyLapseFor(car.id);
        if (car.listing_status !== 'live' && car.listing_status !== 'under_offer') {
            finish(409, { error: 'listing_closed', message: 'This car is not taking viewings or offers right now' });
            return;
        }
        if (badAmount) {
            finish(422, { error: 'validation', message: 'Some fields need attention', errors: { amountPounds: 'Enter a whole number of pounds from 1 to 10000000' } });
            return;
        }
        const open = await pool.query(`SELECT id FROM offers WHERE car_id = $1 AND link_id = $2 AND status IN ('open','needs_reread')`, [car.id, link.id]);
        if (open.rows.length > 0) {
            finish(409, { error: 'offer_exists', message: 'You already have an offer on this car' });
            return;
        }
        const progress = await progressFor(pool, link.id, car);
        if (progress.materialUnseen > 0) {
            const unseen = await pool.query(`
        SELECT f->>'id' AS id FROM versions v, jsonb_array_elements(v.content->'findings') f
        WHERE v.car_id = $1 AND v.number = $2 AND (f->>'material')::boolean
        AND NOT EXISTS (SELECT 1 FROM seen_records sr WHERE sr.link_id = $3 AND sr.finding_id = f->>'id' AND sr.finding_fingerprint = f->>'fingerprint')`, [car.id, car.current_version, link.id]);
            finish(409, { error: 'material_findings_unseen', message: 'Read every material finding before making an offer', unseen: unseen.rows.map((r) => r.id) });
            return;
        }
        const id = uuid();
        await pool.query(`INSERT INTO offers (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
       VALUES ($1,$2,$3,$4,'open', now(), now() + ($5 || ' seconds')::interval)`, [id, car.id, link.id, amount, String(cfg.offerLapseSeconds)]);
        await raiseAlert(car.id, 'new_offer');
        const row = await pool.query('SELECT * FROM offers WHERE id = $1', [id]);
        finish(201, offerView(row.rows[0]));
    });
}));
// ---------- routes: capture ----------
app.post('/api/link/:token/capture', jsonContent(CAPTURE_BODY_LIMIT), guard(async (req, res) => {
    const found = await requireLink(req, res, param(req, 'token'), 'inspector');
    if (!found)
        return;
    const { link } = found;
    const car = await readCar(pool, link.car_id);
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    const body = req.body ?? {};
    const items = body.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 100 || typeof body.batchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.batchId)) {
        sendValidation(res, { items: 'Send a batch of 1 to 100 items with a batchId' });
        return;
    }
    const results = [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const rawItem of items) {
            const item = rawItem;
            const clientId = typeof item.clientId === 'string' ? item.clientId : '';
            const base = { clientId };
            if (!/^[0-9a-f-]{36}$/i.test(clientId) || typeof item.panelId !== 'string' || !PANEL_BY_ID[item.panelId]
                || (item.kind !== 'reading' && item.kind !== 'finding') || typeof item.capturedAt !== 'string' || Number.isNaN(Date.parse(item.capturedAt))) {
                results.push({ ...base, state: 'rejected', errors: { item: 'That item is not valid' } });
                continue;
            }
            const capturedAt = new Date(String(item.capturedAt));
            if (item.kind === 'reading') {
                const microns = item.microns;
                const panel = PANEL_BY_ID[item.panelId];
                if (panel.substrate === 'plastic' || typeof microns !== 'number' || !Number.isInteger(microns) || microns < 1 || microns > 2000) {
                    results.push({ ...base, state: 'rejected', errors: { microns: 'Enter whole microns from 1 to 2000 on a gaugeable panel' } });
                    continue;
                }
                const payload = JSON.stringify({ panelId: item.panelId, microns, capturedAt: item.capturedAt });
                const existing = await client.query('SELECT payload_hash FROM inspector_readings WHERE link_id = $1 AND client_id = $2', [link.id, clientId]);
                if (existing.rows.length > 0) {
                    results.push({ ...base, state: existing.rows[0].payload_hash === sha256Hex(payload) ? 'duplicate' : 'conflict' });
                    continue;
                }
                await client.query('INSERT INTO inspector_readings (car_id, link_id, client_id, panel_id, microns, captured_at, payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)', [car.id, link.id, clientId, item.panelId, microns, capturedAt, sha256Hex(payload)]);
                results.push({ ...base, state: 'applied' });
            }
            else {
                if (typeof item.u !== 'number' || typeof item.v !== 'number' || item.u < 0 || item.u > 1 || item.v < 0 || item.v > 1
                    || typeof item.wording !== 'string' || item.wording.trim().length < 1 || item.wording.trim().length > 600) {
                    results.push({ ...base, state: 'rejected', errors: { finding: 'Send a wording of 1 to 600 characters and a panel point from 0 to 1' } });
                    continue;
                }
                const payload = JSON.stringify({ panelId: item.panelId, u: item.u, v: item.v, wording: item.wording.trim(), capturedAt: item.capturedAt });
                const existing = await client.query('SELECT payload_hash FROM inspector_findings WHERE link_id = $1 AND client_id = $2', [link.id, clientId]);
                if (existing.rows.length > 0) {
                    results.push({ ...base, state: existing.rows[0].payload_hash === sha256Hex(payload) ? 'applied' : 'conflict' });
                    continue;
                }
                await client.query('INSERT INTO inspector_findings (car_id, link_id, client_id, panel_id, u, v, wording, captured_at, payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [car.id, link.id, clientId, item.panelId, item.u, item.v, item.wording.trim(), capturedAt, sha256Hex(payload)]);
                results.push({ ...base, state: 'applied' });
            }
        }
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
    res.json({ batchId: body.batchId, results });
}));
// ---------- routes: offers and alerts for the owner ----------
app.get('/api/owner/cars/:id/offers', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const car = await readCar(pool, param(req, 'id'));
    if (!car) {
        sendError(res, 404, 'not_found', 'We could not find that car file');
        return;
    }
    await applyLapseFor(car.id);
    const rows = await pool.query('SELECT o.*, l.name AS buyer_name, l.id AS link_id FROM offers o JOIN links l ON l.id = o.link_id WHERE o.car_id = $1 ORDER BY o.stamped_at DESC', [car.id]);
    const out = [];
    for (const row of rows.rows) {
        const progress = await progressFor(pool, row.link_id, car);
        out.push({
            ...offerView(row), linkId: row.link_id, buyerName: row.buyer_name,
            seen: progress.seen, total: progress.total,
        });
    }
    res.json({ offers: out });
}));
app.post('/api/owner/offers/:id/accept', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    const key = await idempotencyKey(req, res);
    if (key === null)
        return;
    if (!await requireOwner(req, res))
        return;
    const offerRow = await pool.query('SELECT * FROM offers WHERE id = $1', [param(req, 'id')]);
    if (offerRow.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that offer');
        return;
    }
    const offer = offerRow.rows[0];
    await idempotentWrap(res, `accept:${offer.id}`, key, 'accept', async (finish) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const claim = await client.query(`SELECT * FROM offers WHERE id = $1 FOR UPDATE`, [offer.id]);
            const fresh = claim.rows[0];
            const anyAccepted = await client.query(`SELECT count(*)::int AS n FROM offers WHERE car_id = $1 AND status = 'accepted'`, [fresh.car_id]);
            if (anyAccepted.rows[0].n > 0) {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'offer_already_accepted', message: 'Another offer has already been accepted' });
                return;
            }
            await applyLapseClient(client, fresh.car_id);
            const afterLapse = await client.query('SELECT status FROM offers WHERE id = $1', [offer.id]);
            const status = afterLapse.rows[0].status;
            if (status === 'lapsed') {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'offer_lapsed', message: 'This offer has lapsed' });
                return;
            }
            if (status === 'needs_reread') {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'offer_needs_reread', message: 'This offer is waiting for the buyer to re-read the changes' });
                return;
            }
            if (status !== 'open') {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'offer_not_open', message: 'This offer is no longer open' });
                return;
            }
            const carRow = await client.query('SELECT * FROM cars WHERE id = $1 FOR UPDATE', [fresh.car_id]);
            const car = carRow.rows[0];
            if (car.listing_status !== 'live') {
                await client.query('ROLLBACK');
                client.release();
                finish(409, { error: 'offer_not_open', message: 'This offer is no longer open' });
                return;
            }
            const closed = await client.query(`SELECT id FROM offers WHERE car_id = $1 AND id <> $2 AND status IN ('open','needs_reread') FOR UPDATE`, [fresh.car_id, offer.id]);
            await client.query(`UPDATE offers SET status = 'accepted' WHERE id = $1`, [offer.id]);
            for (const c of closed.rows) {
                await client.query(`UPDATE offers SET status = 'closed_by_acceptance' WHERE id = $1`, [c.id]);
            }
            await client.query(`UPDATE cars SET listing_status = 'under_offer' WHERE id = $1`, [fresh.car_id]);
            await client.query('COMMIT');
            client.release();
            const row = await pool.query('SELECT * FROM offers WHERE id = $1', [offer.id]);
            finish(200, {
                offer: offerView(row.rows[0]),
                closedOfferIds: closed.rows.map((c) => c.id),
                listingStatus: 'under_offer',
            });
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw err;
        }
    });
}));
async function applyLapseFor(carId) {
    await pool.query(`UPDATE offers SET status = 'lapsed' WHERE car_id = $1 AND status IN ('open','needs_reread') AND lapses_at <= now()`, [carId]);
}
async function applyLapseClient(client, carId) {
    await client.query(`UPDATE offers SET status = 'lapsed' WHERE car_id = $1 AND status IN ('open','needs_reread') AND lapses_at <= now()`, [carId]);
}
app.post('/api/owner/offers/:id/decline', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const offerRow = await pool.query('SELECT * FROM offers WHERE id = $1', [param(req, 'id')]);
    if (offerRow.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that offer');
        return;
    }
    const offer = offerRow.rows[0];
    await applyLapseFor(offer.car_id);
    const fresh = await pool.query('SELECT * FROM offers WHERE id = $1', [offer.id]);
    const status = fresh.rows[0].status;
    if (status === 'lapsed') {
        sendError(res, 409, 'offer_lapsed', 'This offer has lapsed');
        return;
    }
    if (status !== 'open' && status !== 'needs_reread') {
        sendError(res, 409, 'offer_not_open', 'This offer is no longer open');
        return;
    }
    await pool.query(`UPDATE offers SET status = 'declined' WHERE id = $1`, [offer.id]);
    const row = await pool.query('SELECT * FROM offers WHERE id = $1', [offer.id]);
    res.json(offerView(row.rows[0]));
}));
app.get('/api/owner/alerts', guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const rows = await pool.query('SELECT * FROM alerts ORDER BY created_at DESC');
    res.json({ alerts: rows.rows.map((r) => ({
            id: r.id, carId: r.car_id, kind: r.kind, state: r.state, attempts: r.attempts,
            createdAt: r.created_at.toISOString(), deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
        })) });
}));
app.post('/api/owner/alerts/:id/retry', jsonContent(JSON_BODY_LIMIT), guard(async (req, res) => {
    if (!await requireOwner(req, res))
        return;
    const row = await pool.query('SELECT * FROM alerts WHERE id = $1', [param(req, 'id')]);
    if (row.rows.length === 0) {
        sendError(res, 404, 'not_found', 'We could not find that alert');
        return;
    }
    const alert = row.rows[0];
    if (alert.state === 'delivered') {
        sendError(res, 409, 'alert_already_delivered', 'This alert is already being sent');
        return;
    }
    if (alert.state === 'waiting') {
        sendError(res, 409, 'alert_retry_in_progress', 'This alert is already being sent');
        return;
    }
    // Only the request that moves failed -> waiting sends.
    const moved = await pool.query(`UPDATE alerts SET state = 'waiting', attempts = attempts + 1 WHERE id = $1 AND state = 'failed' RETURNING *`, [alert.id]);
    if (moved.rows.length === 0) {
        sendError(res, 409, 'alert_retry_in_progress', 'This alert is already being sent');
        return;
    }
    const message = alertMessageFor(alert.kind);
    const delivered = await sendAlert(cfg, message);
    if (delivered) {
        await pool.query(`UPDATE alerts SET state = 'delivered', delivered_at = now() WHERE id = $1`, [alert.id]);
    }
    else {
        await pool.query(`UPDATE alerts SET state = 'failed' WHERE id = $1`, [alert.id]);
        const fresh = await pool.query('SELECT * FROM alerts WHERE id = $1', [alert.id]);
        sendError(res, 503, 'alert_undelivered', 'Phone alert failed. It stays in your alert list.', { alert: alertOut(fresh.rows[0]) });
        return;
    }
    const fresh = await pool.query('SELECT * FROM alerts WHERE id = $1', [alert.id]);
    res.json(alertOut(fresh.rows[0]));
}));
function alertOut(r) {
    return {
        id: r.id, carId: r.car_id, kind: r.kind, state: r.state, attempts: r.attempts,
        createdAt: r.created_at.toISOString(), deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
    };
}
function alertMessageFor(kind) {
    if (kind === 'viewing_claim')
        return 'New viewing claim';
    if (kind === 'new_offer')
        return 'New offer';
    return 'Offer about to lapse';
}
async function raiseAlert(carId, kind) {
    const id = uuid();
    await pool.query('INSERT INTO alerts (id, car_id, kind, state) VALUES ($1,$2,$3,\'waiting\')', [id, carId, kind]);
    const message = alertMessageFor(kind);
    const delivered = await sendAlert(cfg, message);
    if (delivered) {
        await pool.query(`UPDATE alerts SET state = 'delivered', delivered_at = now() WHERE id = $1`, [id]);
    }
    else {
        await pool.query(`UPDATE alerts SET state = 'failed' WHERE id = $1`, [id]);
    }
}
// ---------- health ----------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});
