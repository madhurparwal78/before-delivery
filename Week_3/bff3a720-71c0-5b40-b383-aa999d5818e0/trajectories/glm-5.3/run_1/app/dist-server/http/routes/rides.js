import { err, notFound, forbidden } from '../../http/errors.js';
import { newId } from '../../services/ids.js';
import { buildRoute, priceRange, segmentPrice, wholePriceValid } from '../../domain/route.js';
import { money } from '../../domain/money.js';
import { shortDate } from '../../domain/model.js';
import { bookingCutoff, seatsFreeOnSpan } from '../../domain/seats.js';
import { brusselsDayRange, brusselsHHMM, isoInBrussels, parseBrusselsLocal } from '../../domain/time.js';
import { audienceFor } from '../../services/live.js';
import { CITY_SET } from '../../domain/cities.js';
export function ridePublic(model, ride, stops, withDriver) {
    return (async () => {
        const bookings = await model.activeBookingsForRide(model.db, ride.id);
        const seatMap = model.seatMap(ride, stops, bookings);
        const driver = await model.memberById(ride.driver_id);
        const rating = driver ? await model.memberRating(model.db, driver.id) : { average: null, count: 0 };
        const vehicle = await model.vehicleById(ride.vehicle_id);
        return {
            id: ride.id,
            state: ride.state,
            version: ride.version,
            driver: driver ? model.memberPublic(driver, rating) : null,
            vehicle: vehicle ? { id: vehicle.id, make_model: vehicle.make_model, colour: vehicle.colour, seats: vehicle.seats } : null,
            booking_mode: ride.booking_mode,
            seats: ride.seats,
            price_cents: ride.price_cents,
            route_km: ride.route_km,
            stops: stops.map(s => ({ city: s.city, km: s.km, time: isoInBrussels(s.time) })),
            legs: legsOf(stops),
            seat_map: seatMap.map(row => ({ seat: row.seat, legs: row.legs })),
            server_now: isoInBrussels(model.now()),
        };
    })();
}
function legsOf(stops) {
    const out = [];
    for (let i = 0; i + 1 < stops.length; i++) {
        out.push({ index: i, from: stops[i].city, to: stops[i + 1].city, km: stops[i + 1].km - stops[i].km });
    }
    return out;
}
export function registerRideRoutes(model, router) {
    const { db, cfg, clock, mailer, live } = model;
    // ---------- vehicles ----------
    router.add('GET', '/api/vehicles', async (ctx) => {
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        const vehicles = await model.vehiclesOf(member.id);
        return { status: 200, payload: { vehicles: vehicles.map(v => ({ id: v.id, make_model: v.make_model, colour: v.colour, seats: v.seats })) } };
    }, { member: true, json: false });
    router.add('POST', '/api/vehicles', async (ctx) => {
        const member = await model.memberById(ctx.memberId);
        if (!member || !member.roles.includes('driver'))
            throw forbidden();
        const body = ctx.body;
        const fields = {};
        const makeModel = typeof body.make_model === 'string' ? body.make_model.trim() : '';
        const colour = typeof body.colour === 'string' ? body.colour.trim() : '';
        const seats = typeof body.seats === 'number' ? body.seats : Number(body.seats);
        if (makeModel.length < 1 || makeModel.length > 60)
            fields.make_model = 'Enter the make and model, 1 to 60 characters.';
        if (colour.length < 1 || colour.length > 30)
            fields.colour = 'Enter the colour, 1 to 30 characters.';
        if (!Number.isInteger(seats) || seats < 1 || seats > 4)
            fields.seats = 'Choose 1 to 4 seats.';
        if (Object.keys(fields).length > 0)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        const vehicle = await model.createVehicle(member.id, makeModel, colour, seats);
        return { status: 201, payload: { id: vehicle.id, make_model: vehicle.make_model, colour: vehicle.colour, seats: vehicle.seats } };
    });
    // ---------- publish ----------
    router.add('POST', '/api/rides', async (ctx) => {
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (!member.roles.includes('driver'))
            throw forbidden();
        if (member.id_state !== 'verified')
            throw forbidden('Your ID must be verified before you can offer a ride.');
        const body = ctx.body;
        const fields = {};
        const vehicle = typeof body.vehicle_id === 'string' ? await model.vehicleById(body.vehicle_id) : null;
        if (!vehicle || vehicle.owner_id !== member.id)
            fields.vehicle_id = 'Choose one of your cars.';
        const stops = Array.isArray(body.stops) ? body.stops.map(String) : [];
        if (stops.length < 2)
            fields.stops = 'Choose an origin and a destination.';
        if (stops.length > 2 + cfg.maxStopovers) {
            throw err(422, 'too_many_stopovers', `A ride can have at most ${cfg.maxStopovers} stopovers.`);
        }
        for (const s of stops)
            if (!CITY_SET.has(s)) {
                fields.stops = 'Choose towns from the table.';
                break;
            }
        if (new Set(stops).size !== stops.length)
            fields.stops = 'Each town can be used once.';
        const departureStr = typeof body.departure === 'string' ? body.departure : '';
        const departureMs = parseBrusselsOrIso(departureStr);
        if (!Number.isFinite(departureMs))
            fields.departure = 'Choose a departure time.';
        const seats = typeof body.seats === 'number' ? body.seats : NaN;
        if (!Number.isInteger(seats) || seats < 1 || seats > 4 || (vehicle !== null && seats > vehicle.seats))
            fields.seats = 'Choose 1 to 4 seats.';
        const priceCents = typeof body.price_cents === 'number' ? body.price_cents : NaN;
        if (!Number.isInteger(priceCents))
            fields.price_cents = 'Choose a price.';
        if (Object.keys(fields).length > 0 || vehicle === null)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        const spec = buildRoute(stops, departureMs, cfg);
        if (!spec)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { stops: 'Choose towns the table connects.' });
        const now = clock.nowMs();
        if (departureMs <= now)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { departure: 'Choose a time later than now.' });
        const range = priceRange(spec.routeKm, cfg);
        if (!wholePriceValid(priceCents, spec.routeKm, cfg)) {
            throw err(422, 'price_out_of_range', `Set a price between ${money(range.lowCents)} and ${money(range.highCents)} for ${spec.routeKm} km.`);
        }
        const mode = body.booking_mode === 'request' ? 'request' : 'instant';
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const rideId = newId();
            await client.query(`INSERT INTO rides (id, driver_id, vehicle_id, state, version, booking_mode, seats, price_cents, route_km, departure, arrival, created_at)
         VALUES ($1,$2,$3,'published',1,$4,$5,$6,$7,$8,$9,$10)`, [rideId, member.id, vehicle.id, mode, seats, priceCents, spec.routeKm, departureMs, spec.stops[spec.stops.length - 1].time, now]);
            for (let i = 0; i < spec.stops.length; i++) {
                await client.query('INSERT INTO ride_stops (ride_id, idx, city, km, time) VALUES ($1,$2,$3,$4,$5)', [rideId, i, spec.stops[i].city, spec.stops[i].km, spec.stops[i].time]);
            }
            await client.query('COMMIT');
            const ride = await model.rideById(rideId);
            const stopsOut = await model.stopsOf(rideId);
            return { status: 201, payload: await ridePublic(model, ride, stopsOut, true) };
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
    });
    // ---------- search ----------
    router.add('GET', '/api/rides/search', async (ctx) => {
        const from = ctx.query.get('from') ?? '';
        const to = ctx.query.get('to') ?? '';
        const date = ctx.query.get('date') ?? '';
        const seats = Number(ctx.query.get('seats') ?? '1');
        const instant = ctx.query.get('instant') === '1';
        const verified = ctx.query.get('verified') === '1';
        const sort = ctx.query.get('sort') ?? 'earliest';
        const fields = {};
        if (!CITY_SET.has(from))
            fields.from = 'Choose a town you are leaving from.';
        if (!CITY_SET.has(to))
            fields.to = 'Choose a town you are going to.';
        if (from === to)
            fields.to = 'Choose two different towns.';
        if (!Number.isInteger(seats) || seats < 1 || seats > 4)
            fields.seats = 'Choose 1 to 4 seats.';
        const dayRange = brusselsDayRange(date);
        if (!dayRange)
            fields.date = 'Choose a date.';
        if (Object.keys(fields).length > 0)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        const range = dayRange;
        const now = clock.nowMs();
        const rides = await db.query(`SELECT * FROM rides WHERE state IN ('published','changed')`);
        const out = [];
        for (const r of rides.rows) {
            const ride = r;
            if (instant && ride.booking_mode !== 'instant')
                continue;
            const driver = await model.memberById(ride.driver_id);
            if (!driver)
                continue;
            if (verified && driver.id_state !== 'verified')
                continue;
            const stops = await model.stopsOf(ride.id);
            const i = stops.findIndex(s => s.city === from);
            const j = stops.findIndex(s => s.city === to);
            if (i < 0 || j <= i)
                continue;
            const boardingTime = stops[i].time;
            if (boardingTime < range.start || boardingTime >= range.end)
                continue;
            const bookings = await model.activeBookingsForRide(db, ride.id);
            const seatMap = model.seatMap(ride, stops, bookings);
            const free = seatsFreeOnSpan(seatMap, i, j);
            if (free < seats)
                continue;
            const segKm = stops[j].km - stops[i].km;
            const segPrice = segmentPrice(ride.price_cents, segKm, ride.route_km);
            if (now >= bookingCutoff(boardingTime, ride.booking_mode, cfg))
                continue;
            out.push({
                id: ride.id,
                driver: model.memberPublic(driver, await model.memberRating(db, driver.id)),
                from, to,
                boarding_time: isoInBrussels(boardingTime),
                alighting_time: isoInBrussels(stops[j].time),
                segment_km: segKm,
                segment_price_cents: segPrice,
                seats_left: free,
                booking_mode: ride.booking_mode,
                version: ride.version,
            });
        }
        out.sort((a, b) => {
            const at = Date.parse(String(a.boarding_time));
            const bt = Date.parse(String(b.boarding_time));
            if (sort === 'price') {
                const ap = a.segment_price_cents;
                const bp = b.segment_price_cents;
                if (ap !== bp)
                    return ap - bp;
                return at - bt;
            }
            if (sort === 'shortest') {
                const ad = Date.parse(String(a.alighting_time)) - at;
                const bd = Date.parse(String(b.alighting_time)) - bt;
                if (ad !== bd)
                    return ad - bd;
                return at - bt;
            }
            if (at !== bt)
                return at - bt;
            return String(a.id).localeCompare(String(b.id));
        });
        return { status: 200, payload: { rides: out, server_now: isoInBrussels(now) } };
    }, { member: false, json: false });
    // ---------- one ride ----------
    router.add('GET', '/api/rides/:id', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const stops = await model.stopsOf(ride.id);
        const member = ctx.memberId ? await model.memberById(ctx.memberId) : null;
        const isDriver = member?.id === ride.driver_id;
        if (!isDriver && ride.state !== 'published' && ride.state !== 'changed') {
            const isFounder = member?.roles.includes('founder') ?? false;
            let isPassenger = false;
            if (member) {
                const b = await db.query(`SELECT 1 FROM bookings WHERE ride_id = $1 AND passenger_id = $2 LIMIT 1`, [ride.id, member.id]);
                isPassenger = b.rows.length > 0;
            }
            if (!isFounder && !isPassenger)
                throw notFound();
        }
        return { status: 200, payload: await ridePublic(model, ride, stops, true) };
    }, { member: false, json: false });
    // ---------- driver: patch ----------
    router.add('PATCH', '/api/rides/:id', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (ride.driver_id !== member.id)
            throw forbidden();
        const ifMatch = ctx.req.headers['if-match'];
        if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch.trim())) {
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { if_match: 'Send the ride version in If-Match.' });
        }
        if (Number(ifMatch.trim()) !== ride.version)
            throw err(409, 'edit_conflict');
        if (ride.state === 'departed' || ride.state === 'arrived' || ride.state === 'cancelled')
            throw err(409, 'invalid_transition');
        const body = ctx.body;
        const stops = await model.stopsOf(ride.id);
        const now = clock.nowMs();
        const newDepartureMs = typeof body.departure === 'string' && body.departure.length > 0 ? parseBrusselsOrIso(body.departure) : ride.departure;
        const newSeats = typeof body.seats === 'number' ? body.seats : ride.seats;
        const fields = {};
        if (typeof body.departure === 'string' && body.departure.length > 0) {
            if (!Number.isFinite(newDepartureMs) || newDepartureMs <= now)
                fields.departure = 'Choose a time later than now.';
        }
        if (typeof body.seats === 'number') {
            const bookings = await model.activeBookingsForRide(db, ride.id);
            const seatMap = model.seatMap(ride, stops, bookings);
            let maxUsed = 0;
            for (let leg = 0; leg < stops.length - 1; leg++) {
                let used = 0;
                for (const row of seatMap)
                    if (row.legs[leg] === 'taken')
                        used++;
                maxUsed = Math.max(maxUsed, used);
            }
            const vehicle = await model.vehicleById(ride.vehicle_id);
            if (newSeats < maxUsed)
                fields.seats = `Seats cannot go below the ${maxUsed} already taken on one leg.`;
            else if (newSeats > (vehicle?.seats ?? 4) || newSeats > 4 || newSeats < 1)
                fields.seats = 'Seats cannot be more than the car has.';
        }
        if (Object.keys(fields).length > 0)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT * FROM rides WHERE id = $1 FOR UPDATE', [ride.id]);
            const timeChanged = newDepartureMs !== ride.departure;
            const seatsChanged = newSeats !== ride.seats;
            let freeUntil = ride.free_cancel_until;
            let kind = 'time_change';
            if (timeChanged) {
                const oldShift = ride.departure;
                const spec = buildRoute(stops.map(s => s.city), newDepartureMs, cfg);
                if (spec) {
                    for (let i = 0; i < spec.stops.length; i++) {
                        await client.query('UPDATE ride_stops SET time = $3, km = $4 WHERE ride_id = $1 AND idx = $2', [ride.id, i, spec.stops[i].time, spec.stops[i].km]);
                    }
                    await client.query('UPDATE rides SET arrival = $2 WHERE id = $1', [ride.id, spec.stops[spec.stops.length - 1].time]);
                }
                if (Math.abs(newDepartureMs - oldShift) > cfg.freeCancelShiftMinutes * 60_000) {
                    freeUntil = newDepartureMs - 2 * 3_600_000;
                    await client.query('UPDATE bookings SET free_cancel_until = $2 WHERE ride_id = $1 AND state = \'confirmed\'', [ride.id, freeUntil]);
                }
            }
            if (timeChanged || seatsChanged) {
                await client.query('UPDATE rides SET state = \'changed\', version = version + 1 WHERE id = $1', [ride.id]);
                if (timeChanged) {
                    await client.query('UPDATE rides SET departure = $2 WHERE id = $1', [ride.id, newDepartureMs]);
                }
                if (seatsChanged) {
                    await client.query('UPDATE rides SET seats = $2 WHERE id = $1', [ride.id, newSeats]);
                }
                // recompute request deadlines against the new boarding times
                const reqRows = await client.query(`SELECT id, boarding, created_at FROM bookings WHERE ride_id = $1 AND state = 'requested'`, [ride.id]);
                for (const rb of reqRows.rows) {
                    const stopIdx = stops.findIndex(s => s.city === rb.boarding);
                    if (stopIdx < 0)
                        continue;
                    const boardingTime = timeChanged ? newDepartureMs + (stops[stopIdx].km * 60_000) / cfg.averageSpeedKmh : stops[stopIdx].time;
                    const dl = requestDeadlineLocal(Number(rb.created_at), boardingTime, cfg);
                    await client.query('UPDATE bookings SET request_expires_at = $2, boarding_time = $3 WHERE id = $1', [rb.id, dl, boardingTime]);
                }
            }
            // queue one email per affected passenger
            const affected = await client.query(`SELECT DISTINCT ON (b.passenger_id) b.passenger_id, m.email, m.display_name
         FROM bookings b JOIN members m ON m.id = b.passenger_id
         WHERE b.ride_id = $1 AND b.state IN ('confirmed','requested')`, [ride.id]);
            const notices = [];
            const freshIds = [];
            if (timeChanged) {
                for (const p of affected.rows) {
                    const subject = `Your Longseat ride on ${shortDateText(ride.departure)} now leaves at ${brusselsHHMM(newDepartureMs)}`;
                    const lines = [`${member.display_name} moved the departure from ${brusselsHHMM(ride.departure)} to ${brusselsHHMM(newDepartureMs)}.`];
                    if (freeUntil !== null)
                        lines.push(`You can cancel for free until ${brusselsHHMM(freeUntil)} on ${shortDateText(freeUntil)}.`);
                    const id = await mailer.queue(client, 'time_change', p.email, subject, lines.join(' '), now);
                    freshIds.push({ id, passengerId: p.passenger_id, kind });
                    notices.push({ passenger_id: p.passenger_id, name: p.display_name, kind, status: 'queued', sent_at: null });
                }
            }
            await client.query('COMMIT');
            client.release();
            // after commit: try each fresh row once within 2 seconds
            const deadline = Date.now() + 2000;
            for (const f of freshIds) {
                if (Date.now() > deadline)
                    break;
                const ok = await mailer.trySend(db, f.id, now).catch(() => false);
                if (ok) {
                    const n = notices.find(x => x.passenger_id === f.passengerId);
                    if (n) {
                        n.status = 'sent';
                        n.sent_at = isoInBrussels(now);
                    }
                    live.push({ type: 'notice', data: { ride_id: ride.id, passenger_id: f.passengerId, kind: f.kind, status: 'sent', sent_at: isoInBrussels(now) }, audience: audienceFor({ memberIds: [ride.driver_id, f.passengerId], rideId: ride.id }) });
                }
            }
            const updated = await model.rideById(ride.id);
            const stopsOut = await model.stopsOf(ride.id);
            const payload = { ride: await ridePublic(model, updated, stopsOut, true), notices };
            live.push({ type: 'ride', data: { ride: payload.ride }, audience: audienceFor({ rideId: ride.id, isPublic: true }) });
            return { status: 200, payload };
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
    });
    // ---------- driver: cancel ride ----------
    router.add('POST', '/api/rides/:id/cancel', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const member = await model.memberById(ctx.memberId);
        if (!member)
            throw notFound();
        if (ride.driver_id !== member.id)
            throw forbidden();
        if (ride.state === 'departed' || ride.state === 'arrived' || ride.state === 'cancelled')
            throw err(409, 'invalid_transition');
        const now = clock.nowMs();
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT * FROM rides WHERE id = $1 FOR UPDATE', [ride.id]);
            await client.query('UPDATE rides SET state = \'cancelled\' WHERE id = $1', [ride.id]);
            const bookings = await client.query(`SELECT * FROM bookings WHERE ride_id = $1 AND state IN ('confirmed','requested','held')`, [ride.id]);
            const affected = [];
            for (const b of bookings.rows) {
                await client.query('UPDATE bookings SET state = $2 WHERE id = $1', [b.id, b.state === 'confirmed' ? 'cancelled_by_driver' : 'withdrawn']);
                await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, b.state === 'confirmed' ? 'cancelled_by_driver' : 'withdrawn', now]);
                if (b.state === 'confirmed') {
                    await model.ledgerEntry(client, 'refund:100', b.id, now, [
                        { account: `held:${b.id}`, amount_cents: -Number(b.price_cents) },
                        { account: `wallet:${b.passenger_id}`, amount_cents: Number(b.price_cents) },
                        { account: `earnings:${ride.driver_id}`, amount_cents: 0 },
                    ]);
                }
                else if (b.state === 'requested') {
                    await model.ledgerEntry(client, 'refund:100', b.id, now, [
                        { account: `held:${b.id}`, amount_cents: -Number(b.price_cents) },
                        { account: `wallet:${b.passenger_id}`, amount_cents: Number(b.price_cents) },
                    ]);
                }
                affected.push({ id: b.id, passenger_id: b.passenger_id, state: b.state, price_cents: Number(b.price_cents), boarding: b.boarding, alighting: b.alighting, boarding_time: Number(b.boarding_time) });
            }
            const notices = [];
            const freshIds = [];
            for (const b of affected) {
                const p = await client.query('SELECT email, display_name FROM members WHERE id = $1', [b.passenger_id]);
                if (p.rows.length === 0)
                    continue;
                const subject = `Your Longseat ride on ${shortDateText(b.boarding_time)} was cancelled`;
                const body = `${money(b.price_cents)} has been refunded to your Longseat wallet.`;
                const id = await mailer.queue(client, 'cancellation', p.rows[0].email, subject, body, now);
                freshIds.push({ id, passengerId: b.passenger_id, kind: 'cancellation' });
                notices.push({ passenger_id: b.passenger_id, name: p.rows[0].display_name, kind: 'cancellation', status: 'queued', sent_at: null });
            }
            await client.query('COMMIT');
            client.release();
            const deadline = Date.now() + 2000;
            for (const f of freshIds) {
                if (Date.now() > deadline)
                    break;
                const ok = await mailer.trySend(db, f.id, now).catch(() => false);
                if (ok) {
                    const n = notices.find(x => x.passenger_id === f.passengerId);
                    if (n) {
                        n.status = 'sent';
                        n.sent_at = isoInBrussels(now);
                    }
                }
            }
            const updated = await model.rideById(ride.id);
            const stopsOut = await model.stopsOf(ride.id);
            const payload = { ride: await ridePublic(model, updated, stopsOut, true), notices };
            live.push({ type: 'ride', data: { ride: payload.ride }, audience: audienceFor({ rideId: ride.id, isPublic: true }) });
            return { status: 200, payload };
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
    });
    // ---------- driver: bookings, notices ----------
    router.add('GET', '/api/rides/:id/bookings', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const member = await model.memberById(ctx.memberId);
        if (!member || member.id !== ride.driver_id)
            throw notFound();
        const rows = await db.query('SELECT * FROM bookings WHERE ride_id = $1 ORDER BY created_at', [ride.id]);
        const { bookingOut } = await import('./bookings.js');
        const out = [];
        for (const b of rows.rows)
            out.push(await bookingOut(model, ctx.memberId, b));
        return { status: 200, payload: { bookings: out } };
    }, { member: true, json: false });
    router.add('GET', '/api/rides/:id/notices', async (ctx) => {
        const ride = await model.rideById(ctx.params.id);
        if (!ride)
            throw notFound();
        const member = await model.memberById(ctx.memberId);
        if (!member || member.id !== ride.driver_id)
            throw notFound();
        const rows = await db.query(`SELECT o.id, o.kind, o.to_email, o.status, o.sent_at, m.id AS passenger_id, m.display_name
       FROM outbox o JOIN members m ON m.email = o.to_email
       WHERE o.kind IN ('time_change','cancellation') AND EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = $1 AND b.passenger_id = m.id)
       ORDER BY o.created_at DESC`, [ride.id]);
        return {
            status: 200,
            payload: {
                notices: rows.rows.map(r => ({
                    passenger_id: r.passenger_id,
                    name: r.display_name,
                    kind: r.kind === 'time_change' ? 'time_change' : 'cancellation',
                    status: r.status,
                    sent_at: r.sent_at ? isoInBrussels(Number(r.sent_at)) : null,
                })),
            },
        };
    }, { member: true, json: false });
}
function requestDeadlineLocal(createdAt, boardingTime, cfg) {
    const byExpiry = createdAt + cfg.requestExpiryHours * 3_600_000;
    const byCutoff = boardingTime - cfg.requestCutoffMinutes * 60_000;
    return Math.min(byExpiry, byCutoff);
}
function shortDateText(epochMs) {
    return shortDate(epochMs);
}
/** Parses an ISO 8601 time with an offset, or a local Brussels time without one. */
function parseBrusselsOrIso(value) {
    if (/[+]\d{2}:?\d{2}$/.test(value) || value.endsWith('Z'))
        return Date.parse(value);
    return parseBrusselsLocal(value) ?? NaN;
}
