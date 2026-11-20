import { err, notFound } from '../../http/errors.js';
import { newId, newToken } from '../../services/ids.js';
import { buildRoute, segmentPrice } from '../../domain/route.js';
import { CITY_SET } from '../../domain/cities.js';
import { requestDeadline, holdDeadline } from '../../domain/seats.js';
import { isoInBrussels, parseBrusselsLocal } from '../../domain/time.js';
import { castBooking } from '../../domain/model.js';
import { generatedPng } from '../../services/png.js';
export function registerGradingRoutes(model, router, s3) {
    const { db, cfg, clock, live } = model;
    const guard = (ctx) => {
        if (!cfg.gradingToken)
            throw notFound();
        const header = ctx.req.headers['x-grading-token'];
        const token = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : '';
        if (token !== cfg.gradingToken)
            throw notFound();
    };
    router.add('POST', '/api/grading/setup', async (ctx) => {
        guard(ctx);
        const body = ctx.body;
        const membersIn = Array.isArray(body.members) ? body.members : [];
        const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
        const ridesIn = Array.isArray(body.rides) ? body.rides : [];
        const bookingsIn = Array.isArray(body.bookings) ? body.bookings : [];
        const messagesIn = Array.isArray(body.messages) ? body.messages : [];
        const ratingsIn = Array.isArray(body.ratings) ? body.ratings : [];
        const emails = membersIn.map(m => String(m.email ?? '').toLowerCase());
        if (new Set(emails).size !== emails.length)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { members: 'Emails must be new.' });
        for (const e of emails) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
                throw err(422, 'validation_failed', 'Check the highlighted fields.', { members: 'Enter a valid email.' });
            const existing = await model.memberByEmail(e);
            if (existing)
                throw err(422, 'validation_failed', 'Check the highlighted fields.', { members: 'Emails must be new.' });
        }
        const keys = new Map();
        const vehicleIds = new Map();
        const rideIds = new Map();
        const bookingIds = new Map();
        const now = clock.nowMs();
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            for (const m of membersIn) {
                const key = String(m.key ?? '');
                const email = String(m.email ?? '').toLowerCase();
                const displayName = String(m.display_name ?? '');
                const rolesIn = Array.isArray(m.roles) ? m.roles.map(String) : [];
                const roles = rolesIn.length > 0 ? rolesIn : ['driver', 'passenger'];
                const idState = ['none', 'pending', 'verified', 'rejected'].includes(String(m.id_state)) ? String(m.id_state) : 'none';
                const wallet = typeof m.wallet_cents === 'number' ? Math.round(m.wallet_cents) : 0;
                const id = newId();
                await client.query(`INSERT INTO members (id, email, display_name, roles, id_state, id_reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, email, displayName, roles, idState, idState === 'rejected' ? 'Please upload a clearer image.' : null, now]);
                const session = newToken();
                await client.query('INSERT INTO sessions (token, member_id, created_at) VALUES ($1,$2,$3)', [session, id, now]);
                if (wallet !== 0) {
                    const entryId = newId();
                    await client.query('INSERT INTO ledger_entries (id, kind, booking_id, at) VALUES ($1,$2,NULL,$3)', [entryId, 'topup', now]);
                    await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [entryId, `wallet:${id}`, wallet]);
                    await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [entryId, 'network:topups', -wallet]);
                }
                if (m.photo === true) {
                    const png = generatedPng(id, 64, 64);
                    const fileId = newId();
                    const keyPath = `photos/${id}/${fileId}`;
                    await s3.putObject(keyPath, png, 'image/png');
                    await client.query('INSERT INTO files (id, kind, owner_id, content_type, bytes, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [fileId, 'photo', id, 'image/png', png.length, keyPath, now]);
                    await client.query('UPDATE members SET photo_file_id = $2 WHERE id = $1', [id, fileId]);
                }
                if (idState === 'pending' || idState === 'rejected') {
                    const png = generatedPng(id + ':id', 64, 64);
                    const fileId = newId();
                    const keyPath = `id-documents/${id}/${fileId}`;
                    const put = await s3.putObject(keyPath, png, 'image/png');
                    if (put) {
                        await client.query('INSERT INTO files (id, kind, owner_id, content_type, bytes, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [fileId, 'id_document', id, 'image/png', png.length, keyPath, now]);
                        const docId = newId();
                        await client.query('INSERT INTO id_documents (id, member_id, file_id, state, reason, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6)', [docId, id, fileId, idState === 'pending' ? 'pending' : 'rejected', idState === 'rejected' ? 'Please upload a clearer image.' : null, now]);
                    }
                }
                keys.set(key, { id, session });
            }
            for (const v of vehiclesIn) {
                const key = String(v.key ?? '');
                const owner = keys.get(String(v.owner ?? ''));
                if (!owner)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { vehicles: 'Unknown owner key.' });
                const makeModel = String(v.make_model ?? '');
                const colour = String(v.colour ?? '');
                const seats = Number(v.seats ?? 3);
                const id = newId();
                await client.query('INSERT INTO vehicles (id, owner_id, make_model, colour, seats) VALUES ($1,$2,$3,$4,$5)', [id, owner.id, makeModel, colour, seats]);
                vehicleIds.set(key, id);
            }
            for (const r of ridesIn) {
                const key = String(r.key ?? '');
                const driver = keys.get(String(r.driver ?? ''));
                if (!driver)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'Unknown driver key.' });
                const vehicleKey = String(r.vehicle ?? '');
                const vehicleId = vehicleIds.get(vehicleKey);
                const vehicleRow = vehicleId ? await client.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId]) : null;
                if (!vehicleRow || vehicleRow.rows.length === 0)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'Unknown vehicle key.' });
                const stopsIn = Array.isArray(r.stops) ? r.stops.map(String) : [];
                if (stopsIn.length < 2)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'A ride needs two or more stops.' });
                for (const s of stopsIn)
                    if (!CITY_SET.has(s))
                        throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'Unknown town.' });
                const departureRaw = String(r.departure ?? '');
                const departureMs = parseBrusselsLocal(departureRaw) ?? (Number.isFinite(Date.parse(departureRaw)) ? Date.parse(departureRaw) : null);
                if (departureMs === null)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'Choose a departure time.' });
                const seats = Number(r.seats ?? 3);
                const price = Number(r.price_cents ?? 0);
                const mode = String(r.booking_mode) === 'request' ? 'request' : 'instant';
                const state = ['published', 'changed', 'departed', 'arrived', 'cancelled'].includes(String(r.state)) ? String(r.state) : 'published';
                const spec = buildRoute(stopsIn, departureMs, cfg);
                if (!spec)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { rides: 'The towns are not connected.' });
                const id = newId();
                await client.query(`INSERT INTO rides (id, driver_id, vehicle_id, state, version, booking_mode, seats, price_cents, route_km, departure, arrival, created_at)
           VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11)`, [id, driver.id, vehicleId, state, mode, seats, price, spec.routeKm, departureMs, spec.stops[spec.stops.length - 1].time, now]);
                for (let i = 0; i < spec.stops.length; i++) {
                    await client.query('INSERT INTO ride_stops (ride_id, idx, city, km, time) VALUES ($1,$2,$3,$4,$5)', [id, i, spec.stops[i].city, spec.stops[i].km, spec.stops[i].time]);
                }
                rideIds.set(key, { id, seats, stops: spec.stops.map(s => ({ city: s.city, time: s.time, km: s.km })), driverId: driver.id, price, routeKm: spec.routeKm, mode, version: 1 });
            }
            for (const b of bookingsIn) {
                const key = String(b.key ?? '');
                const rideKey = String(b.ride ?? '');
                const ride = rideIds.get(rideKey);
                if (!ride)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { bookings: 'Unknown ride key.' });
                const passengerKey = String(b.passenger ?? '');
                const passenger = keys.get(passengerKey);
                if (!passenger)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { bookings: 'Unknown passenger key.' });
                if (passenger.id === ride.driverId)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { bookings: 'The driver cannot book their own ride.' });
                const boarding = String(b.boarding ?? '');
                const alighting = String(b.alighting ?? '');
                const seats = Number(b.seats ?? 1);
                const state = String(b.state ?? 'confirmed');
                const createdAtRaw = typeof b.created_at === 'string' ? b.created_at : null;
                const createdAt = createdAtRaw ? (parseBrusselsLocal(createdAtRaw) ?? Date.parse(createdAtRaw)) : now;
                const i = ride.stops.findIndex(s => s.city === boarding);
                const j = ride.stops.findIndex(s => s.city === alighting);
                if (i < 0 || j <= i)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { bookings: 'Stops must be on the ride in order.' });
                const segKm = ride.stops[j].km - ride.stops[i].km;
                const segPrice = segmentPrice(ride.price, segKm, ride.routeKm);
                const total = segPrice * seats;
                const id = newId();
                const seatNumbers = [];
                for (let s = 1; s <= seats; s++)
                    seatNumbers.push(s);
                const holdUntil = state === 'held' ? holdDeadline(createdAt, cfg) : null;
                const deadline = state === 'requested' ? requestDeadline(createdAt, ride.stops[i].time, cfg) : null;
                const boardingTime = ride.stops[i].time;
                const alightingTime = ride.stops[j].time;
                await client.query(`INSERT INTO bookings (id, ride_id, passenger_id, boarding, alighting, boarding_time, alighting_time, seats, seat_numbers, segment_km, price_cents, state, created_at, hold_expires_at, request_expires_at, ride_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1)`, [id, ride.id, passenger.id, boarding, alighting, boardingTime, alightingTime, seats, seatNumbers, segKm, total, state, createdAt, holdUntil, deadline,]);
                await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [id, state, createdAt]);
                if (['confirmed', 'completed', 'rated', 'cancelled_by_passenger', 'cancelled_by_driver'].includes(state)) {
                    await model.ledgerEntry(client, 'payment', id, createdAt, [
                        { account: `wallet:${passenger.id}`, amount_cents: -total },
                        { account: `held:${id}`, amount_cents: total },
                    ]);
                }
                if (state === 'requested') {
                    await model.ledgerEntry(client, 'request_payment', id, createdAt, [
                        { account: `wallet:${passenger.id}`, amount_cents: -total },
                        { account: `held:${id}`, amount_cents: total },
                    ]);
                    await model.valkey.zAdd(model.valkey.requestDeadlinesKey(), deadline, id);
                }
                if (state === 'cancelled_by_passenger') {
                    const percent = Number(b.refund_percent ?? 100);
                    const refund = percent === 100 ? total : percent === 50 ? Math.floor(total * 50 / 100) : 0;
                    await model.ledgerEntry(client, `refund:${percent}`, id, createdAt, [
                        { account: `held:${id}`, amount_cents: -total },
                        { account: `wallet:${passenger.id}`, amount_cents: refund },
                        { account: `earnings:${ride.driverId}`, amount_cents: total - refund },
                    ]);
                }
                else if (state === 'cancelled_by_driver') {
                    await model.ledgerEntry(client, 'refund:100', id, createdAt, [
                        { account: `held:${id}`, amount_cents: -total },
                        { account: `wallet:${passenger.id}`, amount_cents: total },
                        { account: `earnings:${ride.driverId}`, amount_cents: 0 },
                    ]);
                }
                else if (state === 'completed' || state === 'rated') {
                    await model.ledgerEntry(client, 'completion', id, createdAt, [
                        { account: `held:${id}`, amount_cents: -total },
                        { account: `earnings:${ride.driverId}`, amount_cents: total },
                    ]);
                }
                bookingIds.set(key, id);
            }
            for (const msg of messagesIn) {
                const bookingId = bookingIds.get(String(msg.booking ?? ''));
                if (!bookingId)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { messages: 'Unknown booking key.' });
                const author = keys.get(String(msg.author ?? ''));
                if (!author)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { messages: 'Unknown author key.' });
                const sentAtRaw = String(msg.sent_at ?? '');
                const sentAt = parseBrusselsLocal(sentAtRaw) ?? (Number.isFinite(Date.parse(sentAtRaw)) ? Date.parse(sentAtRaw) : now);
                await client.query('INSERT INTO messages (id, booking_id, author_id, body, sent_at) VALUES ($1,$2,$3,$4,$5)', [newId(), bookingId, author.id, String(msg.body ?? ''), sentAt]);
            }
            for (const rt of ratingsIn) {
                const bookingId = bookingIds.get(String(rt.booking ?? ''));
                if (!bookingId)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { ratings: 'Unknown booking key.' });
                const by = keys.get(String(rt.by ?? ''));
                if (!by)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { ratings: 'Unknown member key.' });
                const stars = Number(rt.stars ?? 5);
                if (stars < 1 || stars > 5)
                    throw err(422, 'validation_failed', 'Check the highlighted fields.', { ratings: 'Stars must be 1 to 5.' });
                await client.query('INSERT INTO ratings (booking_id, by_member_id, stars, comment, submitted_at) VALUES ($1,$2,$3,$4,$5)', [bookingId, by.id, stars, String(rt.comment ?? ''), now]);
            }
            await client.query('COMMIT');
            client.release();
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
        const membersOut = {};
        for (const [k, v] of keys)
            membersOut[k] = { id: v.id, session: v.session };
        const vehiclesOut = {};
        for (const [k, v] of vehicleIds)
            vehiclesOut[k] = v;
        const ridesOut = {};
        for (const [k, v] of rideIds)
            ridesOut[k] = v.id;
        const bookingsOut = {};
        for (const [k, v] of bookingIds)
            bookingsOut[k] = v;
        return { status: 201, payload: { now: isoInBrussels(now), members: membersOut, vehicles: vehiclesOut, rides: ridesOut, bookings: bookingsOut } };
    }, { member: false });
    router.add('POST', '/api/grading/clock', async (ctx) => {
        guard(ctx);
        const body = ctx.body;
        const n = typeof body.advance_seconds === 'number' ? body.advance_seconds : Number(body.advance_seconds);
        if (!Number.isInteger(n) || n < 0 || n > 31_536_000) {
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { advance_seconds: 'Send a whole number of seconds from 0 to 31536000.' });
        }
        await clock.advance(n);
        const now = model.now();
        await runDueJobs(model, s3);
        live.push({ type: 'clock', data: { server_now: isoInBrussels(now) }, audience: { memberIds: null, rideId: null, bookingId: null, isPublic: true } });
        return { status: 200, payload: { now: isoInBrussels(model.now()) } };
    }, { member: false });
}
/** Runs every due job: request expiry, hold expiry, ride state moves, rating windows, outbox sends. */
export async function runDueJobs(model, s3) {
    const { db, cfg, mailer, live } = model;
    const now = model.now();
    // 1. expire holds
    const held = await db.query(`SELECT * FROM bookings WHERE state = 'held'`);
    for (const r of held.rows) {
        const b = castBooking(r);
        if (b.hold_expires_at !== null && now >= b.hold_expires_at) {
            await expireHoldRow(model, b);
        }
    }
    // 2. expire requests
    const requested = await db.query(`SELECT * FROM bookings WHERE state = 'requested'`);
    for (const r of requested.rows) {
        const b = castBooking(r);
        if (b.request_expires_at !== null && now >= b.request_expires_at) {
            await expireRequestRow(model, b);
        }
    }
    // 3. ride state moves
    const rides = await db.query(`SELECT * FROM rides WHERE state IN ('published','changed','departed')`);
    for (const r of rides.rows) {
        const ride = r;
        if ((ride.state === 'published' || ride.state === 'changed') && now >= ride.departure) {
            await db.query(`UPDATE rides SET state = 'departed' WHERE id = $1`, [ride.id]);
        }
        else if (ride.state === 'departed' && now >= ride.arrival) {
            await db.query(`UPDATE rides SET state = 'arrived' WHERE id = $1`, [ride.id]);
        }
    }
    // 4. complete bookings at arrival
    const arrivedRides = await db.query(`SELECT id FROM rides WHERE state = 'arrived'`);
    for (const rr of arrivedRides.rows) {
        const confirmed = await db.query(`SELECT * FROM bookings WHERE ride_id = $1 AND state = 'confirmed'`, [rr.id]);
        for (const c of confirmed.rows) {
            const b = castBooking(c);
            if (now >= b.alighting_time) {
                const client = await db.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(`UPDATE bookings SET state = 'completed' WHERE id = $1`, [b.id]);
                    await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'completed', now]);
                    const ride = await model.rideById(b.ride_id);
                    if (!ride) {
                        await client.query('COMMIT');
                        client.release();
                        continue;
                    }
                    await model.ledgerEntry(client, 'completion', b.id, now, [
                        { account: `held:${b.id}`, amount_cents: -b.price_cents },
                        { account: `earnings:${ride.driver_id}`, amount_cents: b.price_cents },
                    ]);
                    await client.query('COMMIT');
                    client.release();
                    live.push({ type: 'booking', data: { booking_id: b.id, state: 'completed' }, audience: { memberIds: null, rideId: null, bookingId: null, isPublic: true } });
                }
                catch {
                    await client.query('ROLLBACK').catch(() => undefined);
                    client.release();
                }
            }
        }
    }
    // 5. rating window closes
    const ratedCandidates = await db.query(`SELECT b.* FROM bookings b JOIN rides r ON r.id = b.ride_id
     WHERE b.state IN ('completed','rated') AND r.state = 'arrived'`);
    for (const rc of ratedCandidates.rows) {
        const b = castBooking(rc);
        const ride = await model.rideById(b.ride_id);
        if (!ride)
            continue;
        const closes = ride.arrival + cfg.ratingWindowDays * 86_400_000;
        if (now < closes)
            continue;
        if (b.state === 'completed') {
            const ratings = await db.query('SELECT * FROM ratings WHERE booking_id = $1', [b.id]);
            if (ratings.rows.length === 0) {
                live.push({ type: 'rating', data: { booking_id: b.id, state: 'closed' }, audience: { memberIds: null, rideId: null, bookingId: null, isPublic: true } });
            }
            else {
                const client = await db.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(`UPDATE bookings SET state = 'rated' WHERE id = $1`, [b.id]);
                    await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'rated', now]);
                    const subject = 'Your Longseat ratings are in';
                    const text = `Ratings are revealed for ${b.boarding} to ${b.alighting}, ${shortDateLocal(b.boarding_time)}.`;
                    for (const mid of [b.passenger_id, ride.driver_id]) {
                        const m = await model.memberById(mid);
                        if (m)
                            await model.mailer.queue(client, 'ratings_revealed', m.email, subject, text, now);
                    }
                    await client.query('COMMIT');
                    client.release();
                    live.push({ type: 'rating', data: { booking_id: b.id, state: 'revealed' }, audience: { memberIds: null, rideId: null, bookingId: null, isPublic: true } });
                }
                catch {
                    await client.query('ROLLBACK').catch(() => undefined);
                    client.release();
                }
            }
        }
    }
    // 6. outbox sends
    await mailer.drain(db);
    // 7. rebuild Valkey fast state if it was lost
    await rebuildValkey(model);
}
function shortDateLocal(epochMs) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(epochMs));
    return `${p.find(x => x.type === 'weekday')?.value ?? ''} ${p.find(x => x.type === 'day')?.value ?? ''} ${p.find(x => x.type === 'month')?.value ?? ''}`;
}
async function expireHoldRow(model, b) {
    const now = model.now();
    const client = await model.db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [b.id]);
        const cur = await client.query('SELECT state FROM bookings WHERE id = $1', [b.id]);
        if (cur.rows[0].state !== 'held') {
            await client.query('COMMIT');
            client.release();
            return;
        }
        await client.query(`UPDATE bookings SET state = 'expired' WHERE id = $1`, [b.id]);
        await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [b.id, 'expired', now]);
        const stops = await model.stopsOf(b.ride_id);
        const fromIdx = stops.findIndex(s => s.city === b.boarding);
        const toIdx = stops.findIndex(s => s.city === b.alighting);
        for (let leg = fromIdx; leg < toIdx; leg++)
            for (const seat of b.seat_numbers)
                await model.valkey.dropHold(b.ride_id, leg, seat);
        await client.query('COMMIT');
        client.release();
        const { currentSeatMap } = await import('./bookings.js');
        model.live.push({ type: 'seat', data: { ride_id: b.ride_id, seat_map: await currentSeatMap(model, b.ride_id) }, audience: { memberIds: null, rideId: b.ride_id, bookingId: null, isPublic: true } });
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw e;
    }
}
async function expireRequestRow(model, b) {
    const { expireRequest } = await import('./bookings.js');
    await expireRequest(model, b);
}
async function rebuildValkey(model) {
    const { db, valkey } = model;
    const now = model.now();
    const held = await db.query(`SELECT * FROM bookings WHERE state = 'held'`);
    for (const r of held.rows) {
        const b = castBooking(r);
        const stops = await model.stopsOf(b.ride_id);
        const fromIdx = stops.findIndex(s => s.city === b.boarding);
        const toIdx = stops.findIndex(s => s.city === b.alighting);
        const ttl = Math.max(1, Math.floor(((b.hold_expires_at ?? now) - now) / 1000));
        for (let leg = fromIdx; leg < toIdx; leg++)
            for (const seat of b.seat_numbers)
                await valkey.putHold(b.ride_id, leg, seat, b.id, ttl);
    }
    const requested = await db.query(`SELECT * FROM bookings WHERE state = 'requested'`);
    for (const r of requested.rows) {
        const b = castBooking(r);
        if (b.request_expires_at !== null)
            await valkey.zAdd(valkey.requestDeadlinesKey(), b.request_expires_at, b.id);
    }
}
