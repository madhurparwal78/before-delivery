// Sessions, the kitchen clock endpoint and the board.
import { Router } from 'express';
import { pool, verifyPassword, isDbUp, newToken } from '../db.js';
import { ApiError, asRecord, currentUser, requireUser, readJsonBody, requireMember, requireString, sessionToken, unauthenticated, validationFailed, } from '../http.js';
import { kitchenNow } from '../clock.js';
import { balanceMinutes, findUserByEmail, userFromRow } from '../domain.js';
import { SESSION_COOKIE, BOOKING_DAYS_AHEAD, CHECK_IN_OPENS_MINUTES, FREE_CANCEL_DAYS } from '../../shared/constants.js';
import { KITCHEN_NAME, KITCHEN_TIME_ZONE, STATIONS, PACKS } from '../../shared/seed.js';
import { loadConfig } from '../config.js';
import { billingUp } from '../services.js';
import { boardSegments } from './board.js';
export const router = Router();
router.post('/session', async (req, res, next) => {
    try {
        if (!isDbUp())
            throw new ApiError(503, 'database_unavailable');
        const body = asRecord(await readJsonBody(req));
        const email = requireString(body, 'email');
        const password = requireString(body, 'password');
        const found = await findUserByEmail(email);
        if (!found || !verifyPassword(password, found.password_hash)) {
            throw new ApiError(401, 'invalid_credentials');
        }
        const token = newToken();
        await pool.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [
            token,
            found.id,
            new Date(kitchenNow().epochMillis),
        ]);
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
        const full = await pool.query(`SELECT u.id, u.name, u.email, u.role, u.member_id, m.business_name
       FROM users u LEFT JOIN members m ON m.id = u.member_id WHERE u.id = $1`, [found.id]);
        const row = full.rows[0];
        const user = userFromRow(row);
        const balance = user.role === 'member' && user.member_id ? await balanceMinutes(user.member_id) : null;
        res.json({ user, balance_minutes: balance });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/session', async (req, res, next) => {
    try {
        const token = sessionToken(req);
        if (typeof token === 'string' && token) {
            await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
        }
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', async (req, res, next) => {
    try {
        const user = await currentUser(req);
        if (!user)
            throw unauthenticated();
        const balance = user.role === 'member' && user.member_id ? await balanceMinutes(user.member_id) : null;
        res.json({ user, balance_minutes: balance });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/members/me', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        requireMember(user);
        const body = asRecord(await readJsonBody(req));
        const name = requireString(body, 'business_name');
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > 80) {
            throw validationFailed({ business_name: 'length' });
        }
        await pool.query('UPDATE members SET business_name = $1 WHERE id = $2', [trimmed, user.member_id]);
        res.json({ member: { id: user.member_id, business_name: trimmed } });
    }
    catch (err) {
        next(err);
    }
});
router.get('/members', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        if (user.role !== 'operator')
            throw new ApiError(403, 'forbidden');
        const members = await pool.query('SELECT id, business_name, contact_email FROM members ORDER BY business_name');
        const out = [];
        for (const m of members.rows) {
            const balance = await balanceMinutes(m.id);
            const insurance = await pool.query(`SELECT expires_on FROM documents
         WHERE member_id = $1 AND kind = 'liability_insurance' AND status = 'approved'
         ORDER BY expires_on DESC LIMIT 1`, [m.id]);
            const ins = insurance.rows[0];
            const today = kitchenNow().today;
            out.push({
                id: m.id,
                business_name: m.business_name,
                contact_email: m.contact_email,
                balance_minutes: balance,
                liability_insurance: ins ? { status: ins.expires_on < today ? 'expired' : 'approved', expires_on: ins.expires_on } : null,
            });
        }
        res.json({ members: out });
    }
    catch (err) {
        next(err);
    }
});
router.get('/kitchen', async (_req, res, next) => {
    try {
        const now = kitchenNow();
        res.json({
            name: KITCHEN_NAME,
            time_zone: KITCHEN_TIME_ZONE,
            now: now.instant,
            today: now.today,
            hold_seconds: loadConfig().holdSeconds,
            free_cancel_days: FREE_CANCEL_DAYS,
            check_in_opens_minutes: CHECK_IN_OPENS_MINUTES,
            booking_days_ahead: BOOKING_DAYS_AHEAD,
            board: { opens: '05:00', closes: '24:00', cell_minutes: 15 },
            stations: STATIONS,
            packs: PACKS,
            billing: billingUp() ? 'up' : 'down',
        });
    }
    catch (err) {
        next(err);
    }
});
router.get('/board', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
        const now = kitchenNow();
        let date = now.today;
        if (dateParam !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || !Number.isFinite(Date.parse(dateParam + 'T00:00:00Z'))) {
                throw validationFailed({ date: 'invalid' });
            }
            date = dateParam;
        }
        const segments = await boardSegments(user, date, now);
        res.json({
            date,
            today: now.today,
            now: now.instant,
            time_zone: KITCHEN_TIME_ZONE,
            billing: billingUp() ? 'up' : 'down',
            stations: STATIONS.map((s) => ({ id: s.id, name: s.name, segments: segments[s.id] ?? [] })),
        });
    }
    catch (err) {
        next(err);
    }
});
