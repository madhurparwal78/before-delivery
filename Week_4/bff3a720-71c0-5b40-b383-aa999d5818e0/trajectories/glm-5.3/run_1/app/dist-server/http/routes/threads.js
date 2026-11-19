import { castBooking, shortDate } from '../../domain/model.js';
import { err, notFound, forbidden } from '../../http/errors.js';
import { newId } from '../../services/ids.js';
import { csvMoney } from '../../domain/money.js';
import { isoInBrussels, brusselsMonthRange, brusselsParts } from '../../domain/time.js';
import { ratingCloses } from '../../domain/ratings.js';
import { audienceFor } from '../../services/live.js';
async function threadAccess(model, ctx, bookingId) {
    const row = await model.db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    if (row.rows.length === 0)
        throw notFound();
    const b = castBooking(row.rows[0]);
    const ride = await model.rideById(b.ride_id);
    if (!ride)
        throw notFound();
    const member = await model.memberById(ctx.memberId);
    if (!member)
        throw notFound();
    const allowed = member.id === b.passenger_id || ride.driver_id === member.id || member.roles.includes('founder');
    if (!allowed)
        throw notFound();
    return { passengerId: b.passenger_id, driverId: ride.driver_id, booking: b };
}
export function registerThreadRoutes(model, router) {
    const { db, cfg, clock, valkey, live } = model;
    router.add('GET', '/api/bookings/:id/messages', async (ctx) => {
        const t = await threadAccess(model, ctx, ctx.params.id);
        const rows = await db.query('SELECT * FROM messages WHERE booking_id = $1 ORDER BY sent_at', [ctx.params.id]);
        const otherId = ctx.memberId === t.passengerId ? t.driverId : t.passengerId;
        const other = await model.memberById(otherId);
        if (!other)
            throw notFound();
        const presenceKey = valkey.presenceKey(ctx.params.id);
        const online = (await valkey.sMembers(presenceKey)).includes(other.id);
        const lastSeenRaw = await valkey.hGet(valkey.lastSeenHash(), `${ctx.params.id}:${other.id}`);
        return {
            status: 200,
            payload: {
                messages: rows.rows.map(m => ({ id: m.id, author_id: m.author_id, body: m.body, sent_at: isoInBrussels(Number(m.sent_at)) })),
                presence: { member_id: other.id, online, last_seen_at: lastSeenRaw ? isoInBrussels(Date.parse(lastSeenRaw)) : null },
            },
        };
    }, { member: true, json: false });
    router.add('POST', '/api/bookings/:id/messages', async (ctx) => {
        const t = await threadAccess(model, ctx, ctx.params.id);
        const body = ctx.body;
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (text.length < 1 || text.length > 1000)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { body: 'Write a message of 1 to 1000 characters.' });
        const now = clock.nowMs();
        const recent = await valkey.zRangeByScore(valkey.rateKey('messages', ctx.memberId), now - 60_000, now);
        if (recent.length >= cfg.messageRatePerMinute) {
            const oldest = Math.min(...recent.map(r => Number(r.split(':')[0])));
            const retryAfter = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
            throw err(429, 'rate_limited', `You are sending messages too fast. Try again in ${retryAfter} seconds.`, undefined, { 'Retry-After': String(retryAfter) });
        }
        await valkey.zAdd(valkey.rateKey('messages', ctx.memberId), now, `${now}:${newId()}`);
        const id = newId();
        await db.query('INSERT INTO messages (id, booking_id, author_id, body, sent_at) VALUES ($1,$2,$3,$4,$5)', [id, ctx.params.id, ctx.memberId, text, now]);
        live.push({
            type: 'message',
            data: { booking_id: ctx.params.id, message: { id, author_id: ctx.memberId, body: text, sent_at: isoInBrussels(now) } },
            audience: audienceFor({ memberIds: [t.passengerId, t.driverId], bookingId: ctx.params.id }),
        });
        return { status: 201, payload: { id, author_id: ctx.memberId, body: text, sent_at: isoInBrussels(now) } };
    });
    // ---------- ratings ----------
    router.add('GET', '/api/bookings/:id/rating', async (ctx) => {
        const t = await threadAccess(model, ctx, ctx.params.id);
        const ride = await model.rideById(t.booking.ride_id);
        if (!ride)
            throw notFound();
        const closesAt = ratingCloses(ride.arrival, cfg);
        const now = clock.nowMs();
        const rows = await db.query('SELECT * FROM ratings WHERE booking_id = $1', [ctx.params.id]);
        const mine = rows.rows.find(r => r.by_member_id === ctx.memberId) ?? null;
        const otherId = ctx.memberId === t.passengerId ? t.driverId : t.passengerId;
        const theirs = rows.rows.find(r => r.by_member_id === otherId) ?? null;
        const arrived = ride.state === 'arrived';
        let state;
        if (!arrived)
            state = 'not_open';
        else if (mine && theirs)
            state = 'revealed';
        else if (mine && !theirs && now < closesAt)
            state = 'waiting';
        else if (!mine && !theirs && now < closesAt)
            state = 'open';
        else if (!mine && theirs && now < closesAt)
            state = 'open';
        else if (mine && !theirs)
            state = 'revealed';
        else if (!mine && theirs)
            state = 'revealed';
        else
            state = 'closed';
        const revealed = state === 'revealed' || (t.booking.state === 'rated');
        return {
            status: 200,
            payload: {
                state,
                mine: mine ? { stars: mine.stars, comment: mine.comment } : null,
                other_submitted: Boolean(theirs),
                theirs: revealed && theirs ? { stars: theirs.stars, comment: theirs.comment } : null,
                closes_at: isoInBrussels(closesAt),
                server_now: isoInBrussels(now),
            },
        };
    }, { member: true, json: false });
    router.add('POST', '/api/bookings/:id/rating', async (ctx) => {
        const t = await threadAccess(model, ctx, ctx.params.id);
        const ride = await model.rideById(t.booking.ride_id);
        if (!ride)
            throw notFound();
        const closesAt = ratingCloses(ride.arrival, cfg);
        const now = clock.nowMs();
        if (ride.state !== 'arrived' && t.booking.state !== 'completed' && t.booking.state !== 'rated')
            throw err(409, 'rating_not_open');
        if (now >= closesAt)
            throw err(409, 'rating_closed');
        const existing = await db.query('SELECT 1 FROM ratings WHERE booking_id = $1 AND by_member_id = $2', [ctx.params.id, ctx.memberId]);
        if (existing.rows.length > 0)
            throw err(409, 'already_rated');
        const body = ctx.body;
        const fields = {};
        const stars = typeof body.stars === 'number' ? body.stars : Number(body.stars);
        if (!Number.isInteger(stars) || stars < 1 || stars > 5)
            fields.stars = 'Choose 1 to 5 stars.';
        const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
        if (comment.length > 280)
            fields.comment = 'Comments are at most 280 characters.';
        if (Object.keys(fields).length > 0)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', fields);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('INSERT INTO ratings (booking_id, by_member_id, stars, comment, submitted_at) VALUES ($1,$2,$3,$4,$5)', [ctx.params.id, ctx.memberId, stars, comment, now]);
            // reveal when both sides are in
            const both = await client.query('SELECT COUNT(*)::int AS n FROM ratings WHERE booking_id = $1', [ctx.params.id]);
            const isPassenger = ctx.memberId === t.passengerId;
            const partyCount = 2;
            const otherId = isPassenger ? t.driverId : t.passengerId;
            let revealed = Number(both.rows[0].n) >= partyCount;
            if (revealed) {
                await client.query(`UPDATE bookings SET state = 'rated' WHERE id = $1`, [ctx.params.id]);
                await client.query('INSERT INTO booking_history (booking_id, state, at) VALUES ($1,$2,$3)', [ctx.params.id, 'rated', now]);
                const subject = `Your Longseat ratings are in`;
                const text = `Ratings are revealed for ${t.booking.boarding} to ${t.booking.alighting}, ${shortDate(t.booking.boarding_time)}.`;
                for (const mid of [t.passengerId, otherId]) {
                    const m = await model.memberById(mid);
                    if (m)
                        await model.mailer.queue(client, 'ratings_revealed', m.email, subject, text, now);
                }
            }
            await client.query('COMMIT');
            client.release();
            if (revealed) {
                const ids = [t.passengerId, otherId];
                const rows = await db.query('SELECT id, to_email FROM outbox WHERE kind = \'ratings_revealed\' AND created_at = $1', [now]);
                for (const r of rows.rows)
                    await model.mailer.trySend(db, r.id, now).catch(() => undefined);
                live.push({ type: 'rating', data: { booking_id: ctx.params.id, state: 'revealed' }, audience: audienceFor({ memberIds: ids, bookingId: ctx.params.id }) });
            }
            else {
                live.push({ type: 'rating', data: { booking_id: ctx.params.id, state: 'waiting' }, audience: audienceFor({ memberIds: [t.passengerId, t.driverId], bookingId: ctx.params.id }) });
            }
            return { status: 201, payload: { submitted: true } };
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
    });
    // ---------- wallet ----------
    router.add('GET', '/api/wallet', async (ctx) => {
        const lines = await model.walletLines(ctx.memberId);
        return { status: 200, payload: { balance_cents: await model.walletBalance(db, ctx.memberId), lines: lines.map(l => ({ ...l, at: isoInBrussels(l.at) })) } };
    }, { member: true, json: false });
    router.add('POST', '/api/wallet/top-ups', async (ctx) => {
        const body = ctx.body;
        const amount = typeof body.amount_cents === 'number' ? body.amount_cents : Number(body.amount_cents);
        if (!Number.isInteger(amount) || amount < 500 || amount > 20_000 || amount % 500 !== 0) {
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { amount_cents: 'Choose a multiple of €5.00 between €5.00 and €200.00.' });
        }
        const now = clock.nowMs();
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await model.ledgerEntry(client, 'topup', null, now, [
                { account: 'network:topups', amount_cents: -amount },
                { account: `wallet:${ctx.memberId}`, amount_cents: amount },
            ]);
            await client.query('COMMIT');
            client.release();
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw e;
        }
        live.push({ type: 'wallet', data: { balance_cents: await model.walletBalance(db, ctx.memberId) }, audience: audienceFor({ memberIds: [ctx.memberId] }) });
        const lines = await model.walletLines(ctx.memberId);
        return { status: 201, payload: { balance_cents: await model.walletBalance(db, ctx.memberId), lines: lines.map(l => ({ ...l, at: isoInBrussels(l.at) })) } };
    });
    // ---------- earnings ----------
    router.add('GET', '/api/driver/earnings', async (ctx) => {
        const member = await model.memberById(ctx.memberId);
        if (!member || !member.roles.includes('driver'))
            throw forbidden();
        const month = ctx.query.get('month') ?? `${brusselsParts(model.now()).y}-${String(brusselsParts(model.now()).m).padStart(2, '0')}`;
        const range = brusselsMonthRange(month);
        if (!range)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { month: 'Choose a month.' });
        const rows = await earningsRows(model, member.id, month);
        return { status: 200, payload: { month, rows: rows.map(r => ({ ...r, departure: isoDateTime(r.departure) })), total_earned_cents: rows.reduce((a, r) => a + r.earned_cents, 0) } };
    }, { member: true, json: false });
    router.add('GET', '/api/driver/earnings.csv', async (ctx) => {
        const member = await model.memberById(ctx.memberId);
        if (!member || !member.roles.includes('driver'))
            throw forbidden();
        const month = ctx.query.get('month') ?? '';
        const range = brusselsMonthRange(month);
        if (!range)
            throw err(422, 'validation_failed', 'Check the highlighted fields.', { month: 'Choose a month.' });
        const rows = await earningsRows(model, member.id, month);
        const lines = ['booking_id,departure,from,to,passenger,seats,paid,refunded,earned,status'];
        for (const r of rows) {
            lines.push(csvLine([r.booking_id, brusselsCsvDateTime(r.departure), r.from, r.to, r.passenger, String(r.seats), csvMoney(r.paid_cents), csvMoney(r.refunded_cents), csvMoney(r.earned_cents), r.status]));
        }
        const csv = lines.join('\r\n') + '\r\n';
        ctx.res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="longseat-earnings-${month}.csv"`,
        });
        ctx.res.end(csv, 'utf8');
        return null;
    }, { member: true, json: false });
}
function csvLine(fields) {
    return fields.map(f => {
        if (/[",\r\n]/.test(f))
            return '"' + f.replaceAll('"', '""') + '"';
        return f;
    }).join(',');
}
function isoDateTime(epochMs) { return isoInBrussels(epochMs); }
function brusselsCsvDateTime(epochMs) { return isoInBrussels(epochMs).slice(0, 16).replace('T', ' '); }
async function earningsRows(model, driverId, month) {
    const range = brusselsMonthRange(month);
    const rows = await model.db.query(`SELECT b.*, r.departure AS ride_departure, r.arrival AS ride_arrival, m.display_name
     FROM bookings b
     JOIN rides r ON r.id = b.ride_id
     JOIN members m ON m.id = b.passenger_id
     WHERE r.driver_id = $1 AND b.state IN ('confirmed','completed','rated','cancelled_by_passenger','cancelled_by_driver')
       AND b.boarding_time >= $2 AND b.boarding_time < $3
     ORDER BY b.boarding_time, b.id`, [driverId, range.start, range.end]);
    const out = [];
    for (const b of rows.rows) {
        const paid = Number(b.price_cents);
        const refundRow = await model.db.query(`SELECT l.amount_cents FROM ledger_lines l
       JOIN ledger_entries e ON e.id = l.entry_id
       WHERE e.booking_id = $1 AND l.account = $2 AND e.kind LIKE 'refund:%'`, [b.id, `wallet:${b.passenger_id}`]);
        const refunded = refundRow.rows.reduce((a, r) => a + Number(r.amount_cents), 0);
        const earnedRow = await model.db.query(`SELECT l.amount_cents FROM ledger_lines l
       JOIN ledger_entries e ON e.id = l.entry_id
       WHERE e.booking_id = $1 AND l.account = $2`, [b.id, `earnings:${driverId}`]);
        const earned = earnedRow.rows.reduce((a, r) => a + Number(r.amount_cents), 0);
        out.push({
            booking_id: b.id,
            departure: Number(b.boarding_time),
            from: b.boarding,
            to: b.alighting,
            passenger: b.display_name,
            seats: Number(b.seats),
            paid_cents: paid,
            refunded_cents: refunded,
            earned_cents: earned,
            status: b.state,
        });
    }
    return out;
}
