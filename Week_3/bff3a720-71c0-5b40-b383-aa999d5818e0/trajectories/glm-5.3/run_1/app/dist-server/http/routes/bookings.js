import { castBooking, shortDate } from '../../domain/model.js';
import { err, notFound, forbidden, ApiError } from '../../http/errors.js';
import { newId } from '../../services/ids.js';
import { money } from '../../domain/money.js';
import { isoInBrussels } from '../../domain/time.js';
import { bookingCutoff, chooseSeats, holdDeadline, requestDeadline } from '../../domain/seats.js';
import { cancelQuote } from '../../domain/refunds.js';
import { audienceFor } from '../../services/live.js';
import { CITY_SET } from '../../domain/cities.js';
import crypto from 'crypto';
export async function bookingOut(model, viewerId, row) {
    const b = castBooking(row);
    const passenger = await model.memberById(b.passenger_id);
    const ride = await model.rideById(b.ride_id);
    const driver = ride ? await model.memberById(ride.driver_id) : null;
    const now = model.now();
    const history = await model.db.query('SELECT state, at FROM booking_history WHERE booking_id = $1 ORDER BY at', [b.id]);
    const isPassenger = viewerId === b.passenger_id;
    const out = {
        id: b.id,
        ride_id: b.ride_id,
        passenger: passenger ? model.memberPublic(passenger, await model.memberRating(model.db, passenger.id)) : null,
        driver: driver ? model.memberPublic(driver, await model.memberRating(model.db, driver.id)) : null,
        boarding: b.boarding,
        alighting: b.alighting,
        boarding_time: isoInBrussels(b.boarding_time),
        alighting_time: isoInBrussels(b.alighting_time),
        seats: b.seats,
        seat_numbers: b.seat_numbers,
        segment_km: b.segment_km,
        price_cents: b.price_cents,
        state: b.state,
        history: history.rows.map((h) => ({ state: h.state, at: isoInBrussels(Number(h.at)) })),
        hold_expires_at: b.hold_expires_at === null ? null : isoInBrussels(b.hold_expires_at),
        expires_at: b.request_expires_at === null ? null : isoInBrussels(b.request_expires_at),
        expires_in_seconds: b.request_expires_at === null ? null : Math.max(0, Math.floor((b.request_expires_at - now) / 1000)),
        free_cancel_until: b.free_cancel_until === null ? null : isoInBrussels(b.free_cancel_until),
        server_now: isoInBrussels(now),
    };
    if (isPassenger && b.state === 'confirmed') {
        const q = cancelQuote(b.price_cents, now, b.boarding_time, b.free_cancel_until, model.cfg);
        out.cancel_quote = {
            refund_cents: q.refundCents,
            kept_cents: q.keptCents,
            percent: q.percent,
            hours_before: q.hoursBefore,
            reason: q.reason,
        };
    }
    return out;
}
export function registerBookingRoutes(model, router) {
    const { db, cfg, clock, valkey, mailer, live } = model;
    // POST /api/rides/:id/bookings
    router.add('POST', '/api/rides/:id/bookings', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (ride.driver_id === member.id)
            throw forbidden();
        if (!member.roles.includes('passenger'))
            throw forbidden();
        const key = idempotencyKey(ctx);
        const replay = await replayStored(model, ctx, key, ctx.path);
        if (replay)
            return replay;
        const body = ctx.body;
        const fields = {};
        const boarding = typeof body.boarding === 'string' ? body.boarding : '';
        const alighting = typeof body.alighting === 'string' ? body.alighting : '';
        const seats = typeof body.seats === 'number' ? body.seats : Number(body.seats);
        if (!CITY_SET.has(boarding))
            fields.boarding = 'Choose a boarding stop.';
        if (!CITY_SET.has(alighting))
            fields.alighting = 'Choose an alighting stop.';
        if (!Number.isInteger(seats) || seats < 1 || seats > 4)
            fields.seats = 'Choose 1 to 4 seats.';
        if (Object.keys(fields).length > 0)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        // booking attempt limit (counts before the outcome)
        const now0 = clock.nowMs();
        const counted = await db.query(`SELECT * FROM idempotency_keys WHERE member_id = $1 AND route_path = $2`, [member.id, 'booking-attempt']);
        const attemptRows = (await valkey.zRangeByScore(valkey.rateKey('requests', member.id), now0 - 3_600_000, now0));
        const attemptTimes = attemptRows.map(r => Number(r.split(':')[0]));
        if (attemptTimes.length >= cfg.requestRatePerHour) {
            const oldest = Math.min(...attemptTimes);
            const retryAfter = Math.max(1, Math.ceil((oldest + 3_600_000 - now0) / 1000));
            throw err(429, 'rate_limited', `You have made ${cfg.requestRatePerHour} booking requests in the last hour. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, undefined, { 'Retry-After': String(retryAfter) });
        }
        void counted;
        await valkey.zAdd(valkey.rateKey('requests', member.id), now0, `${now0}:${newId()}`);
        const stops = await model.stopsOf(ride.id);
        const i = stops.findIndex(s => s.city === boarding);
        const j = stops.findIndex(s => s.city === alighting);
        if (i < 0 || j <= i)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { boarding: 'Choose stops on this ride in order.' });
        if (ride.state !== 'published' && ride.state !== 'changed')
            throw err(409, 'invalid_transition');
        const rideVersion = typeof body.ride_version === 'number' ? body.ride_version : Number(body.ride_version);
        if (!Number.isInteger(rideVersion) || rideVersion < 1) {
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { ride_version: 'Send the ride version.' });
        }
        if (rideVersion !== ride.version) {
            const { ridePublic } = await import('./rides.js');
            throw new ApiError(409, 'ride_changed', undefined, undefined, { ride: await ridePublic(model, ride, stops, true) });
        }
        const now = clock.nowMs();
        if (now >= bookingCutoff(stops[i].time, ride.booking_mode, cfg)) {
            const minutes = ride.booking_mode === 'instant' ? cfg.bookingCutoffMinutes : cfg.requestCutoffMinutes;
            throw err(409, 'booking_closed', `Booking for this ride closed ${minutes} minutes before departure.`);
        }
        const segKm = stops[j].km - stops[i].km;
        const segPrice = Math.floor((ride.price_cents * segKm) / ride.route_km);
        const total = segPrice * seats;
        const balance = await model.walletBalance(db, member.id);
        if (ride.booking_mode === 'request' && balance < total) {
            throw err(422, 'insufficient_funds', `Your wallet has ${money(balance)}. Add money to book this seat.`);
        }
        const client = await db.connect();
        let clientReleased = false;
        try {
            await client.query('BEGIN');
            await client.query('SELECT * FROM rides WHERE id = $1 FOR UPDATE', [ride.id]);
            const active = await model.activeBookingsForRide(client, ride.id);
            const seatMap = model.seatMap(ride, stops, active);
            const free = chooseSeats(seatMap, i, j, seats);
            if (free === null) {
                throw err(409, 'seat_taken');
            }
            const bookingId = newId();
            const createdAt = clock.nowMs();
            const holdUntil = ride.booking_mode === 'instant' ? holdDeadline(createdAt, cfg) : null;
            const requestDeadlineMs = ride.booking_mode === 'request' ? requestDeadline(createdAt, stops[i].time, cfg) : null;
            await client.query(`INSERT INTO bookings (id, ride_id, passenger_id, boarding, alighting, boarding_time, alighting_time, seats, seat_numbers, segment_km, price_cents, state, created_at, hold_expires_at, request_expires_at, ride_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [bookingId, ride.id, member.id, boarding, alighting, stops[i].time, stops[j].time, seats, free, segKm, total, ride.booking_mode === 'instant' ? 'held' : 'requested', createdAt, holdUntil, requestDeadlineMs, ride.version]);
            await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [bookingId, ride.booking_mode === 'instant' ? 'held' : 'requested', createdAt]);
            if (ride.booking_mode === 'request') {
                await model.ledgerEntry(client, 'request_payment', bookingId, createdAt, [
                    { account: `wallet:${member.id}`, amount_cents: -total },
                    { account: `held:${bookingId}`, amount_cents: total },
                ]);
                await valkey.zAdd(valkey.requestDeadlinesKey(), requestDeadlineMs, bookingId);
            }
            else {
                for (let leg = i; leg < j; leg++)
                    for (const seat of free)
                        await valkey.putHold(ride.id, leg, seat, bookingId, cfg.seatHoldSeconds);
            }
            await client.query('COMMIT');
            client.release();
            clientReleased = true;
            const row = await db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
            const out = await bookingOut(model, member.id, row.rows[0]);
            const payload = { status: 201, payload: out };
            await storeIdempotent(model, ctx, key, ctx.path, payload);
            const seatMapOut = await currentSeatMap(model, ride.id);
            live.push({ type: 'seat', data: { ride_id: ride.id, seat_map: seatMapOut }, audience: audienceFor({ rideId: ride.id, isPublic: true }) });
            live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [member.id, ride.driver_id] }) });
            live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(db, member.id) }, audience: audienceFor({ memberIds: [member.id] }) });
            return payload;
        }
        catch (e) {
            if (!clientReleased) {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }
            throw e;
        }
    });
    // POST /api/bookings/:id/confirm
    router.add('POST', '/api/bookings/:id/confirm', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        if (b.passenger_id !== ctx.memberId)
            throw notFound();
        const key = idempotencyKey(ctx);
        const replay = await replayStored(model, ctx, key, ctx.path);
        if (replay)
            return replay;
        const now = clock.nowMs();
        if (b.state === 'held' && b.hold_expires_at !== null && now >= b.hold_expires_at) {
            await expireHold(model, b);
            throw err(409, 'hold_expired');
        }
        if (b.state !== 'held')
            throw err(409, 'invalid_transition');
        const balance = await model.walletBalance(db, b.passenger_id);
        if (balance < b.price_cents)
            throw err(422, 'insufficient_funds', `Your wallet has ${money(balance)}. Add money to book this seat.`);
        const client = await db.connect();
        let clientReleased = false;
        try {
            await client.query('BEGIN');
            await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
            await model.ledgerEntry(client, 'payment', b.id, now, [
                { account: `wallet:${b.passenger_id}`, amount_cents: -b.price_cents },
                { account: `held:${b.id}`, amount_cents: b.price_cents },
            ]);
            await client.query(`UPDATE bookings SET state = 'confirmed' WHERE id = $1`, [b.id]);
            await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'confirmed', now]);
            const stops = await model.stopsOf(b.ride_id);
            const fromIdx = stops.findIndex(s => s.city === b.boarding);
            const toIdx = stops.findIndex(s => s.city === b.alighting);
            for (let leg = fromIdx; leg < toIdx; leg++)
                for (const seat of b.seat_numbers)
                    await valkey.dropHold(b.ride_id, leg, seat);
            const p = await model.memberById(b.passenger_id);
            if (!p)
                throw notFound();
            const outboxId = await mailer.queue(client, 'booking_confirmed', p.email, `Seat booked: ${b.boarding} to ${b.alighting}, ${shortDate(b.boarding_time)}`, `${money(b.price_cents)} was paid from your Longseat wallet.`, now);
            await client.query('COMMIT');
            client.release();
            clientReleased = true;
            await mailer.trySend(db, outboxId, now).catch(() => undefined);
            const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
            const out = await bookingOut(model, ctx.memberId, fresh.rows[0]);
            const payload = { status: 200, payload: out };
            await storeIdempotent(model, ctx, key, ctx.path, payload);
            const seatMapOut = await currentSeatMap(model, b.ride_id);
            live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: seatMapOut }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
            const driverIdOfBooking = await driverIdFor(model, b.ride_id);
            live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
            live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(db, b.passenger_id) }, audience: audienceFor({ memberIds: [b.passenger_id] }) });
            return payload;
        }
        catch (e) {
            if (!clientReleased) {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }
            throw e;
        }
    }, { member: true });
    // POST /api/bookings/:id/release
    router.add('POST', '/api/bookings/:id/release', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        if (b.passenger_id !== ctx.memberId)
            throw notFound();
        if (b.state !== 'held')
            throw err(409, 'invalid_transition');
        await releaseBooking(model, b, 'expired');
        const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        return { status: 200, payload: await bookingOut(model, ctx.memberId, fresh.rows[0]) };
    }, { member: true });
    // POST /api/bookings/:id/withdraw
    router.add('POST', '/api/bookings/:id/withdraw', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        if (b.passenger_id !== ctx.memberId)
            throw notFound();
        if (b.state === 'requested' && b.request_expires_at !== null && model.now() >= b.request_expires_at) {
            await expireRequest(model, b);
            throw err(409, 'request_expired');
        }
        if (b.state !== 'requested')
            throw err(409, 'invalid_transition');
        await withdrawRequest(model, b);
        const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        return { status: 200, payload: await bookingOut(model, ctx.memberId, fresh.rows[0]) };
    }, { member: true });
    // POST /api/bookings/:id/accept
    router.add('POST', '/api/bookings/:id/accept', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        const ride = await model.rideById(b.ride_id);
        if (!ride || ride.driver_id !== ctx.memberId)
            throw notFound();
        if (b.state === 'requested' && b.request_expires_at !== null && model.now() >= b.request_expires_at) {
            await expireRequest(model, b);
            throw err(409, 'request_expired');
        }
        if (b.state === 'expired')
            throw err(409, 'request_expired');
        if (b.state !== 'requested') {
            if (b.state === 'declined' || b.state === 'confirmed' || b.state === 'withdrawn')
                throw err(409, 'already_decided');
            throw err(409, 'invalid_transition');
        }
        await acceptRequest(model, b);
        const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, ctx.memberId, fresh.rows[0]);
        return { status: 200, payload: out };
    }, { member: true });
    // POST /api/bookings/:id/decline
    router.add('POST', '/api/bookings/:id/decline', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        const ride = await model.rideById(b.ride_id);
        if (!ride || ride.driver_id !== ctx.memberId)
            throw notFound();
        if (b.state === 'requested' && b.request_expires_at !== null && model.now() >= b.request_expires_at) {
            await expireRequest(model, b);
            throw err(409, 'request_expired');
        }
        if (b.state === 'expired')
            throw err(409, 'request_expired');
        if (b.state !== 'requested') {
            if (b.state === 'declined' || b.state === 'confirmed' || b.state === 'withdrawn')
                throw err(409, 'already_decided');
            throw err(409, 'invalid_transition');
        }
        await declineRequest(model, b);
        const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, ctx.memberId, fresh.rows[0]);
        return { status: 200, payload: out };
    }, { member: true });
    // POST /api/bookings/:id/cancel
    router.add('POST', '/api/bookings/:id/cancel', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        if (b.passenger_id !== ctx.memberId)
            throw notFound();
        const key = idempotencyKey(ctx);
        const replay = await replayStored(model, ctx, key, ctx.path);
        if (replay)
            return replay;
        if (b.state !== 'confirmed')
            throw err(409, 'invalid_transition');
        if (model.now() >= b.boarding_time)
            throw err(409, 'invalid_transition');
        const q = cancelQuote(b.price_cents, model.now(), b.boarding_time, b.free_cancel_until, cfg);
        const client = await db.connect();
        let clientReleased = false;
        try {
            await client.query('BEGIN');
            await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
            await client.query(`UPDATE bookings SET state = 'cancelled_by_passenger' WHERE id = $1`, [b.id]);
            await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'cancelled_by_passenger', model.now()]);
            await model.ledgerEntry(client, `refund:${q.percent}`, b.id, model.now(), [
                { account: `held:${b.id}`, amount_cents: -b.price_cents },
                { account: `wallet:${b.passenger_id}`, amount_cents: q.refundCents },
                { account: `earnings:${(await model.rideById(b.ride_id)).driver_id}`, amount_cents: q.keptCents },
            ]);
            await client.query('COMMIT');
            client.release();
            clientReleased = true;
            const fresh = await db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
            const out = await bookingOut(model, ctx.memberId, fresh.rows[0]);
            const payload = { status: 200, payload: { booking: out, refund_cents: q.refundCents, kept_cents: q.keptCents } };
            await storeIdempotent(model, ctx, key, ctx.path, payload);
            const seatMapOut = await currentSeatMap(model, b.ride_id);
            live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: seatMapOut }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
            const driverIdOfBooking = await driverIdFor(model, b.ride_id);
            live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
            live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(db, b.passenger_id) }, audience: audienceFor({ memberIds: [b.passenger_id] }) });
            return payload;
        }
        catch (e) {
            if (!clientReleased) {
                await client.query('ROLLBACK').catch(() => undefined);
                client.release();
            }
            throw e;
        }
    }, { member: true });
    // GET /api/bookings/:id
    router.add('GET', '/api/bookings/:id', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        const ride = await model.rideById(b.ride_id);
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (!ride)
            throw notFound();
        const allowed = member.id === b.passenger_id || ride.driver_id === member.id || member.roles.includes('founder');
        if (!allowed)
            throw notFound();
        return { status: 200, payload: await bookingOut(model, ctx.memberId, row.rows[0]) };
    }, { member: true, json: false });
    // GET /api/bookings/:id/ledger
    router.add('GET', '/api/bookings/:id/ledger', async (ctx) => {
        const row = await db.query('SELECT * FROM bookings WHERE id = $1', [ctx.params.id]);
        if (row.rows.length === 0)
            throw notFound();
        const b = castBooking(row.rows[0]);
        const ride = await model.rideById(b.ride_id);
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (!ride)
            throw notFound();
        const allowed = member.id === b.passenger_id || ride.driver_id === member.id || member.roles.includes('founder');
        if (!allowed)
            throw notFound();
        const entries = await db.query('SELECT * FROM ledger_entries WHERE booking_id = $1 ORDER BY at', [b.id]);
        const out = [];
        for (const e of entries.rows) {
            const lines = await db.query('SELECT account, amount_cents FROM ledger_lines WHERE entry_id = $1', [e.id]);
            out.push({ id: e.id, kind: e.kind, at: isoInBrussels(Number(e.at)), lines: lines.rows });
        }
        return { status: 200, payload: { entries: out } };
    }, { member: true, json: false });
    // GET /api/me/bookings
    router.add('GET', '/api/me/bookings', async (ctx) => {
        const tab = ctx.query.get('tab') === 'past' ? 'past' : 'upcoming';
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        const now = model.now();
        const rows = await db.query('SELECT * FROM bookings WHERE passenger_id = $1 ORDER BY created_at DESC', [member.id]);
        const bookings = [];
        for (const r of rows.rows) {
            const b = castBooking(r);
            const ride = await model.rideById(b.ride_id);
            if (!ride)
                continue;
            const ended = ['expired', 'declined', 'withdrawn', 'cancelled_by_passenger', 'cancelled_by_driver'].includes(b.state);
            const upcoming = !ended && ride.state !== 'arrived' && ride.state !== 'cancelled' && b.alighting_time > now;
            if (tab === 'upcoming' && upcoming)
                bookings.push(await bookingOut(model, member.id, r));
            if (tab === 'past' && !upcoming)
                bookings.push(await bookingOut(model, member.id, r));
        }
        const ridesOut = [];
        const ridesDriven = await db.query('SELECT * FROM rides WHERE driver_id = $1 ORDER BY departure DESC', [member.id]);
        for (const r of ridesDriven.rows) {
            const ride = r;
            const isUpcoming = (ride.state === 'published' || ride.state === 'changed' || ride.state === 'departed') && ride.arrival > now;
            if (tab === 'upcoming' && isUpcoming)
                ridesOut.push(await (await import('./rides.js')).ridePublic(model, ride, await model.stopsOf(ride.id), true));
            if (tab === 'past' && !isUpcoming)
                ridesOut.push(await (await import('./rides.js')).ridePublic(model, ride, await model.stopsOf(ride.id), true));
        }
        return { status: 200, payload: { bookings, rides: ridesOut } };
    }, { member: true, json: false });
}
// ---------- shared booking state moves ----------
async function releaseBooking(model, b, toState) {
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        await client.query('UPDATE bookings SET state = $2 WHERE id = $1', [b.id, toState]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, toState, now]);
        const stops = await model.stopsOf(b.ride_id);
        const fromIdx = stops.findIndex(s => s.city === b.boarding);
        const toIdx = stops.findIndex(s => s.city === b.alighting);
        for (let leg = fromIdx; leg < toIdx; leg++)
            for (const seat of b.seat_numbers)
                await model.valkey.dropHold(b.ride_id, leg, seat);
        await client.query('COMMIT');
        client.release();
        const seatMapOut = await currentSeatMap(model, b.ride_id);
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: seatMapOut }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
async function expireHold(model, b) {
    await releaseBooking(model, b, 'expired');
}
export async function expireRequest(model, b) {
    const p0 = await model.memberById(b.passenger_id);
    if (!p0)
        return;
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        const cur = await client.query('SELECT state FROM bookings WHERE id = $1', [b.id]);
        if (cur.rows[0].state !== 'requested') {
            await client.query('COMMIT');
            client.release();
            return;
        }
        await client.query(`UPDATE bookings SET state = 'expired' WHERE id = $1`, [b.id]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'expired', now]);
        await model.ledgerEntry(client, 'refund:100', b.id, now, [
            { account: `held:${b.id}`, amount_cents: -b.price_cents },
            { account: `wallet:${b.passenger_id}`, amount_cents: b.price_cents },
        ]);
        const p = p0;
        const outboxId = await model.mailer.queue(client, 'request_expired', p.email, 'Your request expired', `${money(b.price_cents)} is back in your Longseat wallet.`, now);
        await model.valkey.zRemove(model.valkey.requestDeadlinesKey(), b.id);
        await client.query('COMMIT');
        client.release();
        await model.mailer.trySend(model.db, outboxId, now).catch(() => undefined);
        const fresh = await model.db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, b.passenger_id, fresh.rows[0]);
        const driverIdOfBooking = await driverIdFor(model, b.ride_id);
        model.live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
        model.live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(model.db, b.passenger_id) }, audience: audienceFor({ memberIds: [b.passenger_id] }) });
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: await currentSeatMap(model, b.ride_id) }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
async function withdrawRequest(model, b) {
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        await client.query(`UPDATE bookings SET state = 'withdrawn' WHERE id = $1`, [b.id]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'withdrawn', now]);
        await model.ledgerEntry(client, 'refund:100', b.id, now, [
            { account: `held:${b.id}`, amount_cents: -b.price_cents },
            { account: `wallet:${b.passenger_id}`, amount_cents: b.price_cents },
        ]);
        await model.valkey.zRemove(model.valkey.requestDeadlinesKey(), b.id);
        await client.query('COMMIT');
        client.release();
        const fresh = await model.db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, b.passenger_id, fresh.rows[0]);
        const driverIdOfBooking = await driverIdFor(model, b.ride_id);
        model.live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
        model.live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(model.db, b.passenger_id) }, audience: audienceFor({ memberIds: [b.passenger_id] }) });
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: await currentSeatMap(model, b.ride_id) }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
async function declineRequest(model, b) {
    const pPre = await model.memberById(b.passenger_id);
    if (!pPre)
        return;
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        await client.query(`UPDATE bookings SET state = 'declined' WHERE id = $1`, [b.id]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'declined', now]);
        await model.ledgerEntry(client, 'refund:100', b.id, now, [
            { account: `held:${b.id}`, amount_cents: -b.price_cents },
            { account: `wallet:${b.passenger_id}`, amount_cents: b.price_cents },
        ]);
        const p = pPre;
        const outboxId = await model.mailer.queue(client, 'request_declined', p.email, 'Your request was declined', `${money(b.price_cents)} is back in your Longseat wallet.`, now);
        await model.valkey.zRemove(model.valkey.requestDeadlinesKey(), b.id);
        await client.query('COMMIT');
        client.release();
        await model.mailer.trySend(model.db, outboxId, now).catch(() => undefined);
        const fresh = await model.db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, b.passenger_id, fresh.rows[0]);
        const driverIdOfBooking = await driverIdFor(model, b.ride_id);
        model.live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
        model.live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(model.db, b.passenger_id) }, audience: audienceFor({ memberIds: [b.passenger_id] }) });
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: await currentSeatMap(model, b.ride_id) }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
async function acceptRequest(model, b) {
    const pPre = await model.memberById(b.passenger_id);
    const dPre = await model.rideById(b.ride_id);
    if (!pPre || !dPre)
        return;
    const drvPre = await model.memberById(dPre.driver_id);
    if (!drvPre)
        return;
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        await client.query(`UPDATE bookings SET state = 'confirmed' WHERE id = $1`, [b.id]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'confirmed', now]);
        await model.valkey.zRemove(model.valkey.requestDeadlinesKey(), b.id);
        const p = pPre;
        const driver = drvPre;
        const outboxId = await model.mailer.queue(client, 'request_accepted', p.email, 'Your request was accepted', `${driver.display_name} accepted your request: ${b.boarding} to ${b.alighting}, ${shortDate(b.boarding_time)}.`, now);
        await client.query('COMMIT');
        client.release();
        await model.mailer.trySend(model.db, outboxId, now).catch(() => undefined);
        const fresh = await model.db.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const out = await bookingOut(model, b.passenger_id, fresh.rows[0]);
        const driverIdOfBooking = await driverIdFor(model, b.ride_id);
        model.live.push({ type: 'booking', data: { booking: out }, audience: audienceFor({ memberIds: [b.passenger_id, driverIdOfBooking] }) });
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: await currentSeatMap(model, b.ride_id) }, audience: audienceFor({ rideId: b.ride_id, isPublic: true }) });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
export async function currentSeatMap(model, rideId) {
    const ride = await model.rideById(rideId);
    if (!ride)
        return [];
    const stops = await model.stopsOf(rideId);
    const bookings = await model.activeBookingsForRide(model.db, rideId);
    return model.seatMap(ride, stops, bookings).map(r => ({ seat: r.seat, legs: r.legs }));
}
// ---------- idempotency ----------
function idempotencyKey(ctx) {
    const raw = ctx.req.headers['idempotency-key'];
    const key = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    if (key.length < 1 || key.length > 100) {
        throw err(422, 'validation_failed', 'Check the highlighted fields.', { idempotency_key: 'Send an Idempotency-Key header.' });
    }
    return key;
}
async function replayStored(model, ctx, key, routePath) {
    const r = await model.db.query(`SELECT * FROM idempotency_keys WHERE member_id = $1 AND route_path = $2 AND key = $3`, [ctx.memberId, routePath, key]);
    if (r.rows.length === 0)
        return null;
    const row = r.rows[0];
    const hash = hashBody(ctx.rawBody);
    if (row.body_hash !== hash)
        throw err(409, 'idempotency_conflict');
    ctx.res.setHeader('Idempotent-Replay', 'true');
    return { status: row.status, payload: JSON.parse(row.response) };
}
async function storeIdempotent(model, ctx, key, routePath, payload) {
    await model.db.query(`INSERT INTO idempotency_keys (member_id, route_path, key, body_hash, status, response, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (member_id, route_path, key) DO NOTHING`, [ctx.memberId, routePath, key, hashBody(ctx.rawBody), payload.status, JSON.stringify(payload.payload), model.now(), model.now() + 86_400_000]);
}
function hashBody(body) {
    return crypto.createHash('sha256').update(body).digest('hex');
}
async function driverIdFor(model, rideId) {
    const ride = await model.rideById(rideId);
    return ride?.driver_id ?? '';
}
