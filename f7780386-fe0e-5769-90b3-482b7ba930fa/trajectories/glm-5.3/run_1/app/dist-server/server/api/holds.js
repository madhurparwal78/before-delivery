// Holds: paint the line, resize, release, confirm. Bookings: read, cancel,
// waive the fee, crew check-in. One winner per station cell is decided under
// the station-date advisory lock.
import { Router } from 'express';
import { pool, newId, lockStationDate, cellsAreFree } from '../db.js';
import { ApiError, asRecord, conflict, notFound, readJsonBody, requireMember, requireOperator, requireString, requireUser, validationFailed, } from '../http.js';
import { kitchenNow, kitchenInstant } from '../clock.js';
import { balanceMinutes, bookingById, bookingCostSplit, bookingFeeCents, bookingListAmountCents, coverageDocument, freeCancelUntil, holdById, holdIsLive, holdView, parseClock, stationById, stationFor, writeTransaction, } from '../domain.js';
import { addDaysToKitchenDate } from '../clock.js';
import { BOOKING_DAYS_AHEAD, BOOKINGS_RANGE_MAX_DAYS, CHECK_IN_OPENS_MINUTES } from '../../shared/constants.js';
import { loadConfig } from '../config.js';
import { recordBilling, billingJobId, dropBillingJob, sendBookingConfirmation, sendCancellationReceipt } from '../services.js';
export const router = Router();
function clockFromMin(m) {
    if (m === 24 * 60)
        return '24:00';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => DATE_RE.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
const CLOCK_RE = /^\d{2}:\d{2}$/;
// ---------------------------------------------------------------------------
// Holds.
// ---------------------------------------------------------------------------
router.post('/holds', async (req, res, next) => {
    const client = await pool.connect().catch(() => null);
    if (!client) {
        next(new ApiError(503, 'database_unavailable'));
        return;
    }
    try {
        const user = requireMember(await requireUser(req));
        const body = asRecord(await readJsonBody(req));
        const errors = {};
        const stationId = typeof body['station_id'] === 'string' ? body['station_id'] : '';
        const date = typeof body['date'] === 'string' ? body['date'] : '';
        const start = typeof body['start'] === 'string' ? body['start'] : '';
        const end = typeof body['end'] === 'string' ? body['end'] : '';
        const station = stationById(stationId);
        if (!station)
            errors['station_id'] = 'unknown';
        if (!isDate(date))
            errors['date'] = 'invalid';
        let startMin = -1;
        let endMin = -1;
        if (!CLOCK_RE.test(start))
            errors['start'] = 'not_on_grid';
        else {
            startMin = parseClock(start);
            if (startMin % 15 !== 0)
                errors['start'] = 'not_on_grid';
        }
        if (!CLOCK_RE.test(end))
            errors['end'] = 'not_on_grid';
        else {
            endMin = parseClock(end);
            if (endMin % 15 !== 0)
                errors['end'] = 'not_on_grid';
        }
        if (Object.keys(errors).length > 0)
            throw validationFailed(errors);
        const tail = station.cleaning_minutes;
        if (endMin <= startMin)
            errors['end'] = 'end_before_start';
        if (startMin < 5 * 60 || endMin + tail > 24 * 60)
            errors['end'] = 'outside_board_hours';
        const now = kitchenNow();
        if (date < now.today)
            errors['date'] = 'invalid';
        if (date > addDaysToKitchenDate(now.today, BOOKING_DAYS_AHEAD))
            errors['date'] = 'too_far_ahead';
        if (Object.keys(errors).length > 0)
            throw validationFailed(errors);
        if (kitchenInstant(date, startMin) < now.epochMillis)
            throw validationFailed({ start: 'in_the_past' });
        await client.query('BEGIN');
        await lockStationDate(client, stationId, date);
        const insurance = await coverageDocument(client, user.member_id, 'liability_insurance', date);
        if (!insurance) {
            await client.query('ROLLBACK');
            res.status(409).json({ error: 'documents_not_current', missing: ['liability_insurance'] });
            return;
        }
        const free = await cellsAreFree(client, stationId, date, startMin, endMin + tail, now.epochMillis);
        if (!free) {
            await client.query('ROLLBACK');
            res.status(409).json({ error: 'slot_taken' });
            return;
        }
        const id = newId('hold');
        const created = new Date(now.epochMillis);
        const expires = new Date(now.epochMillis + loadConfig().holdSeconds * 1000);
        await client.query(`INSERT INTO holds (id, member_id, station_id, date, start_min, end_min, tail_end_min, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'live', $8, $9)`, [id, user.member_id, stationId, date, startMin, endMin, endMin + tail, created, expires]);
        await client.query('COMMIT');
        const hold = await holdById(id);
        const balance = await balanceMinutes(user.member_id);
        res.status(201).json({ hold: holdView(hold, balance) });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        next(err);
    }
    finally {
        client.release();
    }
});
router.patch('/holds/:id', async (req, res, next) => {
    const client = await pool.connect().catch(() => null);
    if (!client) {
        next(new ApiError(503, 'database_unavailable'));
        return;
    }
    try {
        const user = requireMember(await requireUser(req));
        const hold = await holdById(req.params['id']);
        if (!hold || hold.member_id !== user.member_id)
            throw notFound();
        const now = kitchenNow();
        if (hold.status === 'confirmed' || hold.status === 'released')
            throw conflict('invalid_transition');
        if (!holdIsLive(hold, now.epochMillis))
            throw conflict('hold_expired');
        const body = asRecord(await readJsonBody(req));
        const end = requireString(body, 'end');
        const errors = {};
        if (!CLOCK_RE.test(end))
            errors['end'] = 'not_on_grid';
        let endMin = -1;
        if (CLOCK_RE.test(end)) {
            endMin = parseClock(end);
            if (endMin % 15 !== 0)
                errors['end'] = 'not_on_grid';
            if (endMin <= hold.start_min)
                errors['end'] = 'end_before_start';
            const tail = stationFor(hold).cleaning_minutes;
            if (endMin + tail > 24 * 60)
                errors['end'] = 'outside_board_hours';
        }
        if (Object.keys(errors).length > 0)
            throw validationFailed(errors);
        await client.query('BEGIN');
        await lockStationDate(client, hold.station_id, hold.date);
        const fresh = await holdById(hold.id);
        if (!fresh || fresh.status !== 'live' || !holdIsLive(fresh, now.epochMillis)) {
            await client.query('ROLLBACK');
            throw fresh && fresh.status !== 'live' && fresh.status !== 'expired' ? conflict('invalid_transition') : conflict('hold_expired');
        }
        const tail = stationFor(hold).cleaning_minutes;
        const free = await cellsAreFree(client, hold.station_id, hold.date, hold.start_min, endMin + tail, now.epochMillis, hold.id);
        if (!free) {
            await client.query('ROLLBACK');
            res.status(409).json({ error: 'slot_taken' });
            return;
        }
        // A resize keeps the hold's expiry instant.
        await client.query('UPDATE holds SET end_min = $1, tail_end_min = $2 WHERE id = $3', [endMin, endMin + tail, hold.id]);
        await client.query('COMMIT');
        const updated = await holdById(hold.id);
        const balance = await balanceMinutes(user.member_id);
        res.json({ hold: holdView(updated, balance) });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        next(err);
    }
    finally {
        client.release();
    }
});
router.delete('/holds/:id', async (req, res, next) => {
    try {
        const user = requireMember(await requireUser(req));
        const hold = await holdById(req.params['id']);
        if (!hold || hold.member_id !== user.member_id)
            throw notFound();
        const now = kitchenNow();
        if (hold.status === 'confirmed' || hold.status === 'released')
            throw conflict('invalid_transition');
        if (!holdIsLive(hold, now.epochMillis))
            throw conflict('hold_expired');
        await pool.query(`UPDATE holds SET status = 'released' WHERE id = $1`, [hold.id]);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
// ---------------------------------------------------------------------------
// Confirm a booking: all or none.
// ---------------------------------------------------------------------------
router.post('/holds/:id/confirm', async (req, res, next) => {
    const client = await pool.connect().catch(() => null);
    if (!client) {
        next(new ApiError(503, 'database_unavailable'));
        return;
    }
    try {
        const user = requireMember(await requireUser(req));
        const hold = await holdById(req.params['id']);
        if (!hold || hold.member_id !== user.member_id)
            throw notFound();
        const now = kitchenNow();
        if (hold.status === 'confirmed' || hold.status === 'released')
            throw conflict('invalid_transition');
        if (!holdIsLive(hold, now.epochMillis))
            throw conflict('hold_expired');
        await client.query('BEGIN');
        await lockStationDate(client, hold.station_id, hold.date);
        const fresh = await holdById(hold.id);
        if (!fresh || fresh.status !== 'live' || !holdIsLive(fresh, now.epochMillis)) {
            await client.query('ROLLBACK');
            throw fresh && fresh.status !== 'live' ? conflict('invalid_transition') : conflict('hold_expired');
        }
        const insurance = await coverageDocument(client, user.member_id, 'liability_insurance', hold.date);
        if (!insurance) {
            await client.query('ROLLBACK');
            res.status(409).json({ error: 'documents_not_current', missing: ['liability_insurance'] });
            return;
        }
        const station = stationFor(hold);
        const balance = await balanceMinutes(user.member_id, client);
        const split = bookingCostSplit(balance, hold.start_min, hold.end_min, station);
        const bookingId = newId('bkg');
        const listCents = bookingListAmountCents(station, hold.end_min - hold.start_min);
        const overageCents = Math.round(Number(split.overage_amount) * 100);
        const description = `Overage ${bookingId}: ${station.name} ${hold.date} ${clockFromMin(hold.start_min)}–${clockFromMin(hold.end_min)}`;
        if (split.prepaid_minutes > 0) {
            await writeTransaction(client, {
                memberId: user.member_id,
                kind: 'booking_debit',
                minutes: -split.prepaid_minutes,
                bookingId,
            });
        }
        let payment = 'paid';
        if (split.overage_minutes > 0) {
            const outcome = await recordBilling({
                kind: 'charge_and_pay',
                member_id: user.member_id,
                description,
                amount_cents: overageCents,
                booking_id: bookingId,
            });
            payment = outcome === 'recorded' ? 'paid' : 'payment_pending';
        }
        await client.query(`INSERT INTO bookings (id, hold_id, member_id, station_id, date, start_min, end_min, tail_end_min,
        status, payment, prepaid_minutes, overage_minutes, overage_amount_cents, list_amount_cents,
        fee_amount_cents, fee_status, free_cancel_until, confirmed_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11, $12, $13, NULL, NULL, $14, $15, NULL)`, [
            bookingId,
            hold.id,
            user.member_id,
            station.id,
            hold.date,
            hold.start_min,
            hold.end_min,
            hold.tail_end_min,
            payment,
            split.prepaid_minutes,
            split.overage_minutes,
            overageCents,
            listCents,
            new Date(freeCancelUntil(hold.date, hold.start_min)),
            new Date(kitchenNow().epochMillis),
        ]);
        await client.query(`UPDATE holds SET status = 'confirmed' WHERE id = $1`, [hold.id]);
        await client.query('COMMIT');
        const booking = await bookingById(bookingId);
        await sendBookingConfirmation(booking);
        res.status(201).json({ booking });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        next(err);
    }
    finally {
        client.release();
    }
});
// ---------------------------------------------------------------------------
// Bookings.
// ---------------------------------------------------------------------------
router.get('/bookings', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        const now = kitchenNow();
        const from = typeof req.query['from'] === 'string' && req.query['from'] ? req.query['from'] : now.today;
        const to = typeof req.query['to'] === 'string' && req.query['to'] ? req.query['to'] : addDaysToKitchenDate(now.today, BOOKING_DAYS_AHEAD);
        const fieldErrors = {};
        if (!isDate(from))
            fieldErrors['from'] = 'invalid';
        if (!isDate(to))
            fieldErrors['to'] = 'invalid';
        if (Object.keys(fieldErrors).length > 0)
            throw validationFailed(fieldErrors);
        if (to < from)
            throw validationFailed({ to: 'invalid' });
        if (addDaysToKitchenDate(from, BOOKINGS_RANGE_MAX_DAYS - 1) < to)
            throw validationFailed({ to: 'range_too_long' });
        let memberId = null;
        if (user.role === 'member' || user.role === 'crew_cook')
            memberId = user.member_id;
        else if (typeof req.query['member_id'] === 'string' && req.query['member_id'])
            memberId = req.query['member_id'];
        const rows = await pool.query(`SELECT id FROM bookings
       WHERE date >= $1 AND date <= $2 AND ($3::text IS NULL OR member_id = $3::text)
       ORDER BY date ASC, start_min ASC`, [from, to, memberId]);
        const bookings = [];
        for (const row of rows.rows) {
            const booking = await bookingById(row.id);
            if (booking)
                bookings.push(booking);
        }
        res.json({ bookings });
    }
    catch (err) {
        next(err);
    }
});
router.get('/bookings/:id', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        const booking = await bookingById(req.params['id']);
        if (!booking)
            throw notFound();
        if (user.role !== 'operator' && booking.member_id !== user.member_id)
            throw notFound();
        res.json({ booking });
    }
    catch (err) {
        next(err);
    }
});
router.post('/bookings/:id/cancel', async (req, res, next) => {
    const client = await pool.connect().catch(() => null);
    if (!client) {
        next(new ApiError(503, 'database_unavailable'));
        return;
    }
    try {
        const user = await requireUser(req);
        if (user.role !== 'member' && user.role !== 'operator')
            throw new ApiError(403, 'forbidden');
        const booking = await bookingById(req.params['id']);
        if (!booking)
            throw notFound();
        if (user.role === 'member' && booking.member_id !== user.member_id)
            throw notFound();
        const now = kitchenNow();
        if (booking.status !== 'confirmed')
            throw conflict('invalid_transition');
        if (now.epochMillis >= kitchenInstant(booking.date, parseClock(booking.start)))
            throw conflict('booking_started');
        await client.query('BEGIN');
        // Only one of concurrent cancellations wins.
        const winner = await client.query(`UPDATE bookings SET cancelled_at = $1 WHERE id = $2 AND status = 'confirmed' RETURNING id`, [new Date(now.epochMillis), booking.id]);
        if ((winner.rowCount ?? 0) === 0) {
            await client.query('ROLLBACK');
            throw conflict('invalid_transition');
        }
        const late = now.epochMillis > Date.parse(booking.free_cancel_until);
        const status = late ? 'cancelled_with_fee' : 'cancelled_free';
        await client.query(`UPDATE bookings SET status = $1 WHERE id = $2`, [status, booking.id]);
        // Prepaid hours come back once.
        if (booking.prepaid_minutes > 0) {
            await writeTransaction(client, {
                memberId: booking.member_id,
                kind: 'cancellation_refund',
                minutes: booking.prepaid_minutes,
                bookingId: booking.id,
            });
        }
        if (late) {
            const station = stationById(booking.station_id);
            const feeCents = bookingFeeCents(station, booking.booked_minutes);
            await client.query(`UPDATE bookings SET fee_amount_cents = $1, fee_status = 'pending' WHERE id = $2`, [feeCents, booking.id]);
            const outcome = await recordBilling({
                kind: 'charge_only',
                member_id: booking.member_id,
                description: `Late cancellation ${booking.id}`,
                amount_cents: feeCents,
                booking_id: booking.id,
            });
            if (outcome === 'recorded') {
                await client.query(`UPDATE bookings SET fee_status = 'charged' WHERE id = $1`, [booking.id]);
            }
        }
        // A pending charge never reaches Kill Bill and reads voided; a paid
        // overage gets a refund credit.
        if (booking.payment === 'payment_pending') {
            await dropBillingJob(billingJobId({ kind: 'charge_and_pay', member_id: booking.member_id, description: '', amount_cents: 0, booking_id: booking.id }));
            await client.query(`UPDATE bookings SET payment = 'voided' WHERE id = $1`, [booking.id]);
        }
        else if (booking.payment === 'paid' && booking.overage_minutes > 0) {
            await recordBilling({
                kind: 'credit',
                member_id: booking.member_id,
                description: `Refund overage ${booking.id}`,
                amount_cents: Math.round(Number(booking.overage_amount) * 100),
                booking_id: booking.id,
            });
        }
        await client.query('COMMIT');
        const result = await bookingById(booking.id);
        await sendCancellationReceipt(result);
        res.json({ booking: result });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        next(err);
    }
    finally {
        client.release();
    }
});
router.post('/bookings/:id/waive-fee', async (req, res, next) => {
    const client = await pool.connect().catch(() => null);
    if (!client) {
        next(new ApiError(503, 'database_unavailable'));
        return;
    }
    try {
        requireOperator(await requireUser(req));
        const booking = await bookingById(req.params['id']);
        if (!booking)
            throw notFound();
        if (booking.status !== 'cancelled_with_fee' || !booking.fee || booking.fee.status === 'waived') {
            throw conflict('invalid_transition');
        }
        await client.query('BEGIN');
        const winner = await client.query(`UPDATE bookings SET fee_status = 'waived' WHERE id = $1 AND fee_status IN ('pending', 'charged') RETURNING id`, [booking.id]);
        if ((winner.rowCount ?? 0) === 0) {
            await client.query('ROLLBACK');
            throw conflict('invalid_transition');
        }
        if (booking.fee.status === 'charged') {
            await recordBilling({
                kind: 'credit',
                member_id: booking.member_id,
                description: `Waived late cancellation ${booking.id}`,
                amount_cents: Math.round(Number(booking.fee.amount) * 100),
                booking_id: booking.id,
            });
        }
        else {
            await dropBillingJob(billingJobId({ kind: 'charge_only', member_id: booking.member_id, description: '', amount_cents: 0, booking_id: booking.id }));
        }
        await client.query('COMMIT');
        res.json({ booking: await bookingById(booking.id) });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        next(err);
    }
    finally {
        client.release();
    }
});
router.post('/bookings/:id/check-ins', async (req, res, next) => {
    try {
        const user = await requireUser(req);
        if (user.role !== 'crew_cook' || !user.member_id)
            throw new ApiError(403, 'forbidden');
        const booking = await bookingById(req.params['id']);
        if (!booking)
            throw notFound();
        if (booking.member_id !== user.member_id)
            throw notFound();
        const now = kitchenNow();
        const startMin = parseClock(booking.start);
        const endMin = parseClock(booking.end);
        const windowOpens = kitchenInstant(booking.date, startMin - CHECK_IN_OPENS_MINUTES);
        const windowCloses = kitchenInstant(booking.date, endMin);
        // A second check-in by the same cook returns the same record, no new row.
        const existing = booking.check_ins.find((c) => c.crew_cook_id === user.id);
        if (existing) {
            res.json({ check_in: existing, booking });
            return;
        }
        if (booking.status !== 'confirmed' && booking.status !== 'checked_in')
            throw conflict('invalid_transition');
        if (now.epochMillis < windowOpens || now.epochMillis >= windowCloses)
            throw conflict('outside_check_in_window');
        const card = await coverageDocument(undefined, user.member_id, 'food_handler_card', booking.date, user.id);
        if (!card)
            throw conflict('food_handler_card_not_current');
        await pool.query(`INSERT INTO check_ins (id, booking_id, crew_cook_id, at, card_document_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (booking_id, crew_cook_id) DO NOTHING`, [newId('chk'), booking.id, user.id, new Date(now.epochMillis), card.id]);
        if (booking.status === 'confirmed') {
            await pool.query(`UPDATE bookings SET status = 'checked_in' WHERE id = $1`, [booking.id]);
        }
        const fresh = await bookingById(booking.id);
        res.status(201).json({ check_in: fresh.check_ins.find((c) => c.crew_cook_id === user.id), booking: fresh });
    }
    catch (err) {
        next(err);
    }
});
