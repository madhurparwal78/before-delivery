// Usage totals, the monthly CSV export and compliance packets.
import { Router } from 'express';
import { pool, newId, newToken } from '../db.js';
import { ApiError, asRecord, conflict, notFound, readJsonBody, requireOperator, requireString, requireUser, validationFailed, optionalString, } from '../http.js';
import { kitchenNow, addDaysToKitchenDate } from '../clock.js';
import { bookingById, memberById, coverageDocument } from '../domain.js';
import { buildPdf } from '../pdf.js';
import { putObject, packetKey, StorageUnavailable } from '../storage.js';
import { csvField } from '../../shared/rules.js';
import { PACKET_MAX_DAYS, PACKET_LINK_MAX_DAYS } from '../../shared/constants.js';
import { KITCHEN_NAME, KITCHEN_TIME_ZONE, STATIONS } from '../../shared/seed.js';
import { instantInZone, KITCHEN_TZ } from '../clock.js';
export const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => DATE_RE.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
router.get('/usage', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const dateParam = typeof req.query['date'] === 'string' ? req.query['date'] : undefined;
        const today = kitchenNow().today;
        const date = dateParam ?? today;
        if (!isDate(date))
            throw validationFailed({ date: 'invalid' });
        const rows = await pool.query(`SELECT station_id, SUM(end_min - start_min) AS booked, SUM(tail_end_min - end_min) AS cleaning, COUNT(*) AS count
       FROM bookings
       WHERE date = $1 AND status IN ('confirmed', 'checked_in', 'completed')
       GROUP BY station_id`, [date]);
        const byStation = new Map();
        for (const row of rows.rows) {
            byStation.set(row.station_id, {
                booked: Number(row.booked),
                cleaning: Number(row.cleaning),
                count: Number(row.count),
            });
        }
        const stations = STATIONS.map((s) => {
            const agg = byStation.get(s.id);
            return {
                station_id: s.id,
                station_name: s.name,
                booked_minutes: agg?.booked ?? 0,
                cleaning_minutes: agg?.cleaning ?? 0,
                bookings: agg?.count ?? 0,
            };
        });
        const total = stations.reduce((sum, s) => sum + s.booked_minutes, 0);
        res.json({ date, time_zone: KITCHEN_TIME_ZONE, stations, total_booked_minutes: total });
    }
    catch (err) {
        next(err);
    }
});
router.get('/exports/usage.csv', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const month = typeof req.query['month'] === 'string' ? req.query['month'] : '';
        if (!/^\d{4}-\d{2}$/.test(month))
            throw validationFailed({ month: 'invalid' });
        const rows = await pool.query(`SELECT b.*, m.business_name FROM bookings b JOIN members m ON m.id = b.member_id
       WHERE date LIKE $1 ORDER BY date ASC, start_min ASC, station_id ASC`, [`${month}-%`]);
        const header = 'date,station,business,start,end,cleaning_until,booked_hours,prepaid_hours,overage_hours,overage_amount,status,payment';
        const lines = [header];
        for (const row of rows.rows) {
            const station = STATIONS.find((s) => s.id === row.station_id);
            const cells = [
                row.date,
                station.name,
                row.business_name,
                clock(row.start_min),
                clock(row.end_min),
                clock(row.tail_end_min),
                ((row.end_min - row.start_min) / 60).toFixed(2),
                (row.prepaid_minutes / 60).toFixed(2),
                (row.overage_minutes / 60).toFixed(2),
                (row.overage_amount_cents / 100).toFixed(2),
                row.status,
                row.payment,
            ];
            lines.push(cells.map(csvField).join(','));
        }
        res.set({
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="passboard-usage-${month}.csv"`,
        });
        res.send(lines.join('\r\n') + '\r\n');
    }
    catch (err) {
        next(err);
    }
});
function clock(m) {
    if (m === 24 * 60)
        return '24:00';
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
async function packetById(id) {
    const q = await pool.query('SELECT * FROM packets WHERE id = $1', [id]);
    const row = q.rows[0];
    if (!row)
        return null;
    const r = row;
    return {
        id: r.id,
        from: r.from,
        to: r.to,
        expires_at_epoch: r.expires_at.getTime(),
        status: r.status,
        token: r.token,
        created_at_epoch: r.created_at.getTime(),
        snapshot: r.snapshot,
    };
}
/** The snapshot: every checked-in visit in the range, nothing else. */
async function buildSnapshot(from, to) {
    const rows = await pool.query(`SELECT b.id FROM bookings b
     WHERE b.date >= $1 AND b.date <= $2
       AND EXISTS (SELECT 1 FROM check_ins c WHERE c.booking_id = b.id)
     ORDER BY b.date ASC, b.start_min ASC`, [from, to]);
    const days = [];
    const byDate = new Map();
    for (const row of rows.rows) {
        const booking = await bookingById(row.id);
        if (!booking)
            continue;
        const member = await memberById(booking.member_id);
        if (!member)
            continue;
        const insurance = await coverageDocument(undefined, booking.member_id, 'liability_insurance', booking.date);
        const crew = [];
        for (const checkIn of booking.check_ins) {
            const card = await coverageDocument(undefined, booking.member_id, 'food_handler_card', booking.date, checkIn.crew_cook_id);
            crew.push({
                name: checkIn.crew_cook_name,
                checked_in_at: checkIn.at,
                food_handler_card: { valid: !!card, expires_on: card?.expires_on ?? null },
            });
        }
        const visit = {
            business_name: member.business_name,
            station: booking.station_name,
            start: booking.start,
            end: booking.end,
            liability_insurance: { valid: !!insurance, expires_on: insurance?.expires_on ?? null },
            crew,
        };
        if (!byDate.has(booking.date)) {
            const day = { date: booking.date, visits: [] };
            byDate.set(booking.date, day);
            days.push(day);
        }
        byDate.get(booking.date).visits.push(visit);
    }
    return {
        kitchen: KITCHEN_NAME,
        time_zone: KITCHEN_TIME_ZONE,
        from,
        to,
        generated_at: instantInZone(kitchenNow().epochMillis, KITCHEN_TZ),
        days,
    };
}
function pdfFor(content) {
    const lines = [
        { text: content.kitchen, size: 18, bold: true },
        { text: `Compliance packet ${content.from} to ${content.to}`, size: 12, bold: true },
        { text: `Generated ${content.generated_at} (${content.time_zone})`, size: 10 },
        { text: '' },
    ];
    for (const day of content.days) {
        lines.push({ text: day.date, size: 13, bold: true });
        for (const visit of day.visits) {
            lines.push({ text: `${visit.business_name} — ${visit.station} ${visit.start}-${visit.end}`, size: 11 });
            lines.push({ text: `Liability insurance: ${visit.liability_insurance.valid ? 'Valid' : 'Not valid'}${visit.liability_insurance.expires_on ? ` (expires ${visit.liability_insurance.expires_on})` : ''}`, size: 10 });
            for (const cook of visit.crew) {
                lines.push({ text: `${cook.name} checked in ${cook.checked_in_at} — food handler card: ${cook.food_handler_card.valid ? 'Valid' : 'Not valid'}${cook.food_handler_card.expires_on ? ` (expires ${cook.food_handler_card.expires_on})` : ''}`, size: 10 });
            }
            lines.push({ text: '' });
        }
        lines.push({ text: '' });
    }
    return buildPdf(lines);
}
function packetView(p) {
    const now = kitchenNow().epochMillis;
    const active = p.status === 'active' && now < p.expires_at_epoch;
    return {
        id: p.id,
        from: p.from,
        to: p.to,
        expires_at: instantInZone(p.expires_at_epoch, KITCHEN_TZ),
        status: p.status === 'revoked' ? 'revoked' : active ? 'active' : 'expired',
        url: active ? `/packet/${p.token}` : null,
        token: active ? p.token : null,
        created_at: instantInZone(p.created_at_epoch, KITCHEN_TZ),
    };
}
function validateExpiresAt(raw) {
    if (!raw)
        return { errors: { expires_at: 'not_in_future' }, epoch: null };
    const epoch = Date.parse(raw);
    if (!Number.isFinite(epoch))
        return { errors: { expires_at: 'not_in_future' }, epoch: null };
    const now = kitchenNow().epochMillis;
    if (epoch <= now)
        return { errors: { expires_at: 'not_in_future' }, epoch: null };
    if (epoch > now + PACKET_LINK_MAX_DAYS * 86400000)
        return { errors: { expires_at: 'too_far' }, epoch: null };
    return { errors: {}, epoch };
}
router.post('/packets', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const body = asRecord(await readJsonBody(req));
        const from = requireString(body, 'from');
        const to = requireString(body, 'to');
        const errors = {};
        if (!isDate(from))
            errors['from'] = 'invalid';
        if (!isDate(to))
            errors['to'] = 'invalid';
        if (Object.keys(errors).length > 0)
            throw validationFailed(errors);
        if (to < from)
            throw validationFailed({ to: 'before_from' });
        if (addDaysToKitchenDate(from, PACKET_MAX_DAYS - 1) < to)
            throw validationFailed({ to: 'range_too_long' });
        const expiresCheck = validateExpiresAt(optionalString(body, 'expires_at'));
        if (Object.keys(expiresCheck.errors).length > 0)
            throw validationFailed(expiresCheck.errors);
        const snapshot = await buildSnapshot(from, to);
        const id = newId('pkt');
        const token = newToken();
        const pdf = pdfFor(snapshot);
        try {
            await putObject(packetKey(id), pdf, 'application/pdf');
        }
        catch (err) {
            if (err instanceof StorageUnavailable)
                throw new ApiError(503, 'storage_unavailable');
            throw err;
        }
        await pool.query(`INSERT INTO packets (id, "from", "to", expires_at, status, token, created_at, snapshot)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)`, [id, from, to, new Date(expiresCheck.epoch), token, new Date(kitchenNow().epochMillis), JSON.stringify(snapshot)]);
        const row = await packetById(id);
        res.status(201).json({ packet: packetView(row) });
    }
    catch (err) {
        next(err);
    }
});
router.get('/packets', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const rows = await pool.query('SELECT * FROM packets ORDER BY created_at DESC');
        const packets = [];
        for (const raw of rows.rows) {
            const row = await packetById(raw.id);
            packets.push(packetView(row));
        }
        res.json({ packets });
    }
    catch (err) {
        next(err);
    }
});
router.post('/packets/:id/revoke', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const row = await packetById(req.params['id']);
        if (!row)
            throw notFound();
        if (row.status !== 'active')
            throw conflict('invalid_transition');
        await pool.query(`UPDATE packets SET status = 'revoked', token = NULL WHERE id = $1`, [row.id]);
        const fresh = await packetById(row.id);
        res.json({ packet: packetView(fresh) });
    }
    catch (err) {
        next(err);
    }
});
router.post('/packets/:id/regenerate', async (req, res, next) => {
    try {
        requireOperator(await requireUser(req));
        const row = await packetById(req.params['id']);
        if (!row)
            throw notFound();
        if (row.status === 'revoked')
            throw conflict('invalid_transition');
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '{}';
        let body = {};
        try {
            body = JSON.parse(rawBody);
        }
        catch {
            body = {};
        }
        let expiresAt = row.expires_at_epoch;
        if (body['expires_at'] !== undefined) {
            const check = validateExpiresAt(optionalString(body, 'expires_at'));
            if (Object.keys(check.errors).length > 0)
                throw validationFailed(check.errors);
            expiresAt = check.epoch;
        }
        const snapshot = await buildSnapshot(row.from, row.to);
        const token = newToken();
        const pdf = pdfFor(snapshot);
        try {
            await putObject(packetKey(row.id), pdf, 'application/pdf');
        }
        catch (err) {
            if (err instanceof StorageUnavailable)
                throw new ApiError(503, 'storage_unavailable');
            throw err;
        }
        await pool.query(`UPDATE packets SET status = 'active', token = $1, expires_at = $2, snapshot = $3 WHERE id = $4`, [token, new Date(expiresAt), JSON.stringify(snapshot), row.id]);
        const fresh = await packetById(row.id);
        res.json({ packet: packetView(fresh) });
    }
    catch (err) {
        next(err);
    }
});
