import { ApiError, validationError } from './errors.js';
import { BookingRepository, assignmentDateOf, nextLineRef } from './bookings.js';
import { insertBooking, readNewBooking, requireOrg } from './bookingActions.js';
import { verifyPassword } from './passwords.js';
import { createSession, endSession, sessionTokenOf, sessionCookieHeader, clearSessionCookieHeader, } from './http.js';
import { parseMultipart, boundaryOf } from './multipart.js';
import { queueEmail } from './mailer.js';
import { detectKind, KIND_MEDIA_TYPES } from '../domain/filekind.js';
import { displayName } from '../domain/text.js';
import { isQualified } from '../domain/qualification.js';
import { formatDate, formatInstant, weekMondayOf, todayLocal, dateNoon, addDaysToDateString } from '../domain/time.js';
import { selectRate, computeLineAmounts, billableMinutes, formatCents } from '../domain/billing.js';
import { FIELD_MESSAGES, TEXT_LIMITS, UPLOAD_LIMIT_BYTES, MAX_FILES_PER_BOOKING, ACCEPTED_TYPES, AGENCY_NAME, AGENCY_TIME_ZONE, SOLO_THRESHOLD_MINUTES, STATUS_LABELS, } from '../shared/terms.js';
import { countCodePoints } from '../domain/text.js';
import { randomToken, objectKey, sha256Hex } from './passwords.js';
import { PrepStorage } from './storage.js';
import { KillBillClient, chargeTotalCents } from './killbill.js';
import { LINE_SELECT, serializeLine } from './lines.js';
import { assignBillingWeek } from './billingWeek.js';
const routes = [];
function route(method, path, requiresAuth, handler) {
    const paramNames = [];
    const source = path
        .split('/')
        .map((segment) => {
        if (segment.length > 1 && segment.startsWith(':')) {
            paramNames.push(segment.slice(1));
            return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
        .join('/');
    routes.push({ method, pattern: new RegExp(`^${source}$`), paramNames, handler, requiresAuth });
}
export function matchRoute(method, pathname) {
    for (const r of routes) {
        if (r.method !== method)
            continue;
        const match = r.pattern.exec(pathname);
        if (!match)
            continue;
        const params = {};
        r.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1]);
        });
        return { route: r, params };
    }
    return null;
}
// ---------- session ----------
route('POST', '/api/session', false, async (req, app) => {
    const body = (req.body.json ?? {});
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const res = await app.db.query('SELECT id, name, email, role, org_id, password_hash FROM users WHERE lower(email) = $1', [email]);
    if (res.rowCount === 0 || !verifyPassword(password, res.rows[0].password_hash)) {
        throw new ApiError('invalid_credentials', 'Email or password is wrong.');
    }
    const user = res.rows[0];
    const token = await createSession(app.db, user.id);
    return {
        status: 200,
        body: { user: { id: user.id, name: user.name, email: user.email, role: user.role, org_id: user.org_id } },
        headers: { 'Set-Cookie': sessionCookieHeader(token) },
    };
});
route('DELETE', '/api/session', true, async (req, app) => {
    await endSession(app.db, sessionTokenOf(req.cookies));
    return { status: 204, headers: { 'Set-Cookie': clearSessionCookieHeader() } };
});
route('GET', '/api/me', true, async (req) => {
    return { status: 200, body: req.user };
});
route('GET', '/api/agency', true, async (_req, app) => {
    const nowMs = Date.now();
    return {
        status: 200,
        body: {
            name: AGENCY_NAME,
            time_zone: AGENCY_TIME_ZONE,
            now: formatInstant(nowMs),
            today: todayLocal(nowMs),
            solo_threshold_minutes: SOLO_THRESHOLD_MINUTES,
            open_call_lead_minutes: app.config.openCallLeadMinutes,
            prep_access_grace_minutes: app.config.prepAccessGraceMinutes,
            prep_link_ttl_seconds: app.config.prepLinkTtlSeconds,
            upload_limit_bytes: UPLOAD_LIMIT_BYTES,
            max_files_per_booking: MAX_FILES_PER_BOOKING,
            accepted_types: ACCEPTED_TYPES,
        },
    };
});
route('GET', '/api/health', false, async () => {
    return { status: 200, body: { status: 'ok' } };
});
// ---------- bookings ----------
route('GET', '/api/bookings', true, async (req, app) => {
    const repo = new BookingRepository();
    const from = req.query.get('from') ?? todayLocal(Date.now());
    const to = req.query.get('to') ?? addDaysToDateString(from, 13);
    const fields = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        fields.from = FIELD_MESSAGES.range;
        fields.to = FIELD_MESSAGES.range;
        throw validationError(fields);
    }
    const spanDays = Math.round((dateNoon(to) - dateNoon(from)) / 86400_000);
    if (spanDays < 0 || spanDays > 31) {
        fields.from = FIELD_MESSAGES.range;
        throw validationError(fields);
    }
    // The SQL window is generous; the agency-local date check below decides membership,
    // so a 23:30 booking on the last day stays on that date whatever the offset.
    const startLo = dateNoon(from) - 24 * 3600_000;
    const startHi = dateNoon(to) + 24 * 3600_000;
    const rows = await app.db.query('SELECT id FROM bookings WHERE start_instant >= $1 AND start_instant < $2 ORDER BY start_instant, ref', [new Date(startLo), new Date(startHi)]);
    const bookings = [];
    for (const row of rows.rows) {
        // Interpreters' lists hold only bookings they hold; offered work comes from /api/open-calls.
        if (req.user.role === 'interpreter') {
            const seats = await app.db.query('SELECT holder_id FROM seats WHERE booking_id = $1', [row.id]);
            if (!seats.rows.some((s) => s.holder_id === req.user.id))
                continue;
        }
        const visible = await repo.visibleTo(app.db, req.user, row.id);
        if (visible === null)
            continue;
        const startLocal = assignmentDateOf(visible);
        if (startLocal < from || startLocal > to)
            continue;
        bookings.push(await repo.serialize(app.db, req.user, visible));
    }
    return { status: 200, body: { bookings } };
});
route('POST', '/api/bookings', true, async (req, app) => {
    if (req.user.role !== 'requester' && req.user.role !== 'coordinator') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const { input, fields } = readNewBooking(req.body.json, req.user, Date.now());
    if (Object.keys(fields).length > 0)
        throw validationError(fields);
    const repo = new BookingRepository();
    const row = await app.db.transaction(async (client) => {
        await requireOrg(client, input.orgId);
        return insertBooking(client, new BookingRepository(), input);
    });
    return { status: 201, body: await repo.serialize(app.db, req.user, row) };
});
route('GET', '/api/bookings/:id', true, async (req, app) => {
    const repo = new BookingRepository();
    const visible = await repo.visibleTo(app.db, req.user, req.params.id);
    if (visible === null)
        throw new ApiError('not_found', 'That booking is not available to you.');
    return { status: 200, body: await repo.serialize(app.db, req.user, visible) };
});
// ---------- team, open call, claim, assign, release ----------
route('POST', '/api/bookings/:id/team', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const updated = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        if (row.seat_count === 2)
            throw new ApiError('already_team', 'This booking already needs a team of two.');
        const status = await repo.currentStatus(client, row);
        if (!['submitted', 'open', 'partially_covered', 'covered'].includes(status)) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        const fromStatus = status;
        await client.query('UPDATE bookings SET seat_count = 2 WHERE id = $1', [row.id]);
        await client.query('INSERT INTO seats (booking_id, seat, holder_id) VALUES ($1, 2, NULL)', [row.id]);
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'made_team', fromStatus, fromStatus, null, null);
        return repo.loadBooking(client, row.id);
    });
    return { status: 200, body: await repo.serialize(app.db, req.user, updated) };
});
route('POST', '/api/bookings/:id/open-call', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const updated = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const status = await repo.currentStatus(client, row);
        if (status !== 'submitted') {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        const closesAt = new Date(row.start_instant.getTime() - app.config.openCallLeadMinutes * 60000);
        if (Date.now() >= closesAt.getTime()) {
            throw new ApiError('open_call_closed', 'The open call for this booking has closed.');
        }
        await client.query('UPDATE bookings SET open_call_posted_at = now(), open_call_closes_at = $2 WHERE id = $1', [row.id, closesAt]);
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'open_call_published', 'submitted', 'open', null, null);
        return repo.loadBooking(client, row.id);
    });
    return { status: 200, body: await repo.serialize(app.db, req.user, updated) };
});
route('POST', '/api/bookings/:id/claim', true, async (req, app) => {
    if (req.user.role !== 'interpreter')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const result = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const seats = await repo.loadSeats(client, row.id);
        const creds = await repo.holderCredentials(client, req.user.id);
        const assignmentDate = assignmentDateOf(row);
        const offered = row.open_call_posted_at !== null && !['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(row.status);
        if (!(seats.some((s) => s.holder_id === req.user.id) || (offered && isQualified(row.setting, creds, assignmentDate)))) {
            throw new ApiError('not_found', 'That booking is not available to you.');
        }
        // Claim checks run in the published order.
        if (seats.some((s) => s.holder_id === req.user.id))
            throw new ApiError('already_holding', 'You already hold a seat on this booking.');
        // Lock the booking's seats so concurrent claims for the last seat run one after another.
        await client.query('SELECT 1 FROM seats WHERE booking_id = $1 ORDER BY seat FOR UPDATE', [row.id]);
        const fresh = await repo.loadSeats(client, row.id);
        const vacant = fresh.find((s) => s.holder_id === null);
        if (!vacant)
            throw new ApiError('seat_filled', 'Already filled — another interpreter took this seat.');
        if (row.open_call_closes_at === null || Date.now() >= row.open_call_closes_at.getTime()) {
            throw new ApiError('open_call_closed', 'This open call has closed.');
        }
        if (await repo.isBusy(client, req.user.id, row.start_instant.getTime(), row.end_instant.getTime(), row.id)) {
            throw new ApiError('schedule_conflict', 'You already have an assignment at that time.');
        }
        const fromStatus = await repo.currentStatus(client, row);
        if (!['submitted', 'open', 'partially_covered'].includes(fromStatus)) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[fromStatus]}.`, { extra: { status: fromStatus } });
        }
        await client.query('UPDATE seats SET holder_id = $1, held_since = now() WHERE booking_id = $2 AND seat = $3', [req.user.id, row.id, vacant.seat]);
        const toStatus = fresh.filter((s) => s.holder_id !== null).length + 1 >= row.seat_count
            ? 'covered'
            : 'partially_covered';
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'seat_filled', fromStatus, toStatus, vacant.seat, req.user.name);
        return { row, seat: vacant.seat, coveredNow: fresh.filter((s) => s.holder_id !== null).length + 1 >= row.seat_count };
    });
    // Emails are queued in the same step as the state change, outside the serialization read.
    await queueAssignmentEmail(app.db, req.user.email, result.row, result.seat, []);
    if (result.coveredNow) {
        await queueCoverageEmailIfFirst(app.db, app.db, result.row, app.config);
    }
    const fresh = await repo.visibleTo(app.db, req.user, req.params.id);
    return { status: 200, body: await repo.serialize(app.db, req.user, fresh) };
});
route('POST', '/api/bookings/:id/assign', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const body = (req.body.json ?? {});
    const fields = {};
    const interpreterId = typeof body.interpreter_id === 'string' ? body.interpreter_id : '';
    const seat = typeof body.seat === 'number' ? body.seat : NaN;
    if (!interpreterId)
        fields.interpreter_id = FIELD_MESSAGES.interpreter_id;
    if (!Number.isInteger(seat) || seat < 1)
        fields.seat = FIELD_MESSAGES.seat;
    if (Object.keys(fields).length > 0)
        throw validationError(fields);
    const repo = new BookingRepository();
    const result = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        if (!Number.isInteger(seat) || seat > row.seat_count) {
            throw validationError({ seat: FIELD_MESSAGES.seat });
        }
        const interp = await client.query("SELECT id, name, email FROM users WHERE id = $1 AND role = 'interpreter'", [interpreterId]);
        if (interp.rowCount === 0)
            throw new ApiError('not_found', 'That interpreter is not known to the agency.');
        // Lock the named seat so concurrent assignments for it run one after another.
        await client.query('SELECT 1 FROM seats WHERE booking_id = $1 AND seat = $2 FOR UPDATE', [req.params.id, seat]);
        const seats = await repo.loadSeats(client, row.id);
        if (seats.some((s) => s.holder_id === interpreterId)) {
            throw new ApiError('already_holding', 'That interpreter already holds a seat on this booking.');
        }
        const target = seats.find((s) => s.seat === seat);
        if (target.holder_id !== null)
            throw new ApiError('seat_filled', 'Already filled — another interpreter took this seat.');
        const creds = await repo.holderCredentials(client, interpreterId);
        if (!isQualified(row.setting, creds, assignmentDateOf(row))) {
            throw new ApiError('not_qualified', "That interpreter's credentials don't cover this setting.");
        }
        if (await repo.isBusy(client, interpreterId, row.start_instant.getTime(), row.end_instant.getTime(), row.id)) {
            throw new ApiError('schedule_conflict', 'That interpreter already has an assignment at this time.');
        }
        const fromStatus = await repo.currentStatus(client, row);
        if (!['submitted', 'open', 'partially_covered', 'covered'].includes(fromStatus)) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[fromStatus]}.`, { extra: { status: fromStatus } });
        }
        await client.query('UPDATE seats SET holder_id = $1, held_since = now() WHERE booking_id = $2 AND seat = $3', [interpreterId, row.id, seat]);
        const heldAfter = seats.filter((s) => s.holder_id !== null).length + 1;
        const toStatus = heldAfter >= row.seat_count ? 'covered' : 'partially_covered';
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'seat_filled', fromStatus, toStatus, seat, interp.rows[0].name);
        return { row, seat, coveredNow: heldAfter >= row.seat_count, interpreterName: interp.rows[0].name, interpreterEmail: interp.rows[0].email };
    });
    await queueAssignmentEmail(app.db, result.interpreterEmail, result.row, result.seat, []);
    if (result.coveredNow) {
        await queueCoverageEmailIfFirst(app.db, app.db, result.row, app.config);
    }
    const fresh = await repo.loadBooking(app.db, req.params.id);
    return { status: 200, body: await repo.serialize(app.db, req.user, fresh) };
});
route('POST', '/api/bookings/:id/seats/:seat/release', true, async (req, app) => {
    const repo = new BookingRepository();
    const seat = Number(req.params.seat);
    const result = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const seats = await repo.loadSeats(client, row.id);
        if (!Number.isInteger(seat) || seat < 1 || seat > row.seat_count) {
            throw validationError({ seat: FIELD_MESSAGES.seat });
        }
        const target = seats.find((s) => s.seat === seat);
        if (target.holder_id === null) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[await repo.currentStatus(client, row)]}.`);
        }
        if (req.user.role === 'interpreter' && target.holder_id !== req.user.id) {
            throw new ApiError('not_found', 'That booking is not available to you.');
        }
        if (req.user.role !== 'coordinator' && req.user.role !== 'interpreter') {
            throw new ApiError('forbidden', 'Your role can not do that.');
        }
        const status = await repo.currentStatus(client, row);
        if (!['partially_covered', 'covered'].includes(status)) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        const fromStatus = status;
        await client.query('UPDATE seats SET holder_id = NULL, held_since = NULL WHERE booking_id = $1 AND seat = $2', [row.id, seat]);
        const heldAfter = seats.filter((s) => s.holder_id !== null).length - 1;
        const toStatus = heldAfter === 0 ? (row.open_call_posted_at !== null ? 'open' : 'submitted') : 'partially_covered';
        const holderName = target.holder_name;
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'seat_released', fromStatus, toStatus, seat, holderName);
        return { row, seat, holderName, toStatus };
    });
    const fresh = await repo.loadBooking(app.db, req.params.id);
    return { status: 200, body: await repo.serialize(app.db, req.user, fresh) };
});
route('GET', '/api/open-calls', true, async (req, app) => {
    if (req.user.role !== 'interpreter')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const res = await app.db.query(`SELECT id FROM bookings WHERE open_call_posted_at IS NOT NULL AND open_call_closes_at > now()
       AND status IN ('submitted', 'open', 'partially_covered', 'covered') ORDER BY start_instant`);
    const bookings = [];
    for (const row of res.rows) {
        const full = await repo.visibleTo(app.db, req.user, row.id);
        if (full === null)
            continue;
        const serialized = await repo.serialize(app.db, req.user, full);
        if (serialized.open_call_status !== 'open')
            continue;
        if (!serialized.seats.some((s) => s.holder === null))
            continue;
        if (serialized.seats.some((s) => s.holder?.is_me))
            continue;
        bookings.push(serialized);
    }
    return { status: 200, body: { bookings } };
});
// ---------- check-in, complete ----------
route('POST', '/api/bookings/:id/check-in', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const updated = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const status = await repo.currentStatus(client, row);
        if (status !== 'covered') {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        await client.query("UPDATE bookings SET status = 'in_progress', checked_in_at = now() WHERE id = $1", [row.id]);
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'checked_in', 'covered', 'in_progress', null, null);
        return repo.loadBooking(client, row.id);
    });
    return { status: 200, body: await repo.serialize(app.db, req.user, updated) };
});
route('POST', '/api/bookings/:id/complete', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const body = (req.body.json ?? {});
    const fields = {};
    const worked = body.worked_minutes;
    const mileage = body.mileage_miles;
    const workedMinutes = typeof worked === 'number' && Number.isInteger(worked) ? worked : NaN;
    const mileageMiles = typeof mileage === 'number' && Number.isInteger(mileage) ? mileage : NaN;
    if (!(workedMinutes >= 1 && workedMinutes <= 720))
        fields.worked_minutes = FIELD_MESSAGES.worked_minutes;
    if (!(mileageMiles >= 0 && mileageMiles <= 500))
        fields.mileage_miles = FIELD_MESSAGES.mileage_miles;
    if (Object.keys(fields).length > 0)
        throw validationError(fields);
    const repo = new BookingRepository();
    const result = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const status = await repo.currentStatus(client, row);
        if (status !== 'in_progress') {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        const seats = await repo.loadSeats(client, row.id);
        const heldCount = seats.filter((s) => s.holder_id !== null).length;
        const rates = await repo.ratesFor(client, row.contract_id);
        const contract = {
            minimum_minutes: 120,
            increment_minutes: 15,
            rotation_interval_minutes: row.contract_interval,
            rates,
        };
        const assignmentDate = assignmentDateOf(row);
        const rate = selectRate(contract, assignmentDate);
        const basis = Math.max(row.duration_minutes, workedMinutes);
        const amounts = computeLineAmounts(contract, rate, basis, heldCount, mileageMiles);
        const { line_ref: lineRef, seq } = await nextLineRef(client);
        const id = `ln_${seq}`;
        const createdInstant = new Date();
        const billingWeek = await assignBillingWeek(client, createdInstant, row.org_id);
        await client.query(`INSERT INTO invoice_lines (id, line_ref, seq, booking_id, booking_ref, org_id, kind,
         assignment_date, rate_effective_from, hourly_rate_cents, team_surcharge_bp,
         basis_minutes, billable_minutes, interpreter_count, time_amount_cents,
         mileage_miles, mileage_cents_per_mile, mileage_amount_cents, amount_cents,
         billing_week, sync_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'pending_sync', $20)`, [
            id, lineRef, seq, row.id, row.ref, row.org_id,
            assignmentDate, rate.effective_from, rate.hourly_rate_cents, rate.team_surcharge_bp,
            basis, amounts.billableMinutes, heldCount, amounts.timeAmountCents,
            mileageMiles, rate.mileage_cents_per_mile, amounts.mileageAmountCents, amounts.amountCents,
            billingWeek, createdInstant,
        ]);
        await client.query("UPDATE bookings SET status = 'completed', completed_at = now() WHERE id = $1", [row.id]);
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'completed', 'in_progress', 'completed', null, null);
        return { lineRef, row };
    });
    const fresh = await repo.loadBooking(app.db, req.params.id);
    return { status: 200, body: await repo.serialize(app.db, req.user, fresh) };
});
// ---------- cancellation ----------
async function buildQuote(app, repo, row) {
    const nowMs = Date.now();
    const seats = await repo.loadSeats(app.db, row.id);
    const heldCount = seats.filter((s) => s.holder_id !== null).length;
    const cutoff = repo.cancellationCutoff(row.start_instant.getTime());
    const late = nowMs > cutoff.getTime();
    const rates = await repo.ratesFor(app.db, row.contract_id);
    const contract = {
        minimum_minutes: 120,
        increment_minutes: 15,
        rotation_interval_minutes: row.contract_interval,
        rates,
    };
    const assignmentDate = assignmentDateOf(row);
    const rate = selectRate(contract, assignmentDate);
    const basis = row.duration_minutes;
    const billable = billableMinutes(contract, basis);
    let charge = 0;
    if (late && heldCount > 0) {
        const amounts = computeLineAmounts(contract, rate, basis, heldCount, 0);
        charge = amounts.amountCents;
    }
    return {
        late,
        cutoff: formatInstant(cutoff.getTime()),
        interpreter_count: heldCount,
        billable_minutes: billable,
        charge_cents: charge,
    };
}
route('GET', '/api/bookings/:id/cancellation-quote', true, async (req, app) => {
    if (req.user.role !== 'requester' && req.user.role !== 'coordinator') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const repo = new BookingRepository();
    const visible = await repo.visibleTo(app.db, req.user, req.params.id);
    if (visible === null)
        throw new ApiError('not_found', 'That booking is not available to you.');
    const status = await repo.currentStatus(app.db, visible);
    if (!['submitted', 'open', 'partially_covered', 'covered'].includes(status)) {
        throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
    }
    return { status: 200, body: await buildQuote(app, repo, visible) };
});
route('POST', '/api/bookings/:id/cancel', true, async (req, app) => {
    if (req.user.role !== 'requester' && req.user.role !== 'coordinator') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const body = (req.body.json ?? {});
    if (typeof body.quoted_charge_cents !== 'number' || !Number.isInteger(body.quoted_charge_cents) || body.quoted_charge_cents < 0) {
        throw validationError({ quoted_charge_cents: FIELD_MESSAGES.quoted_charge_cents });
    }
    const repo = new BookingRepository();
    const result = await app.db.transaction(async (client) => {
        const row = await repo.loadBooking(client, req.params.id);
        const status = await repo.currentStatus(client, row);
        if (!['submitted', 'open', 'partially_covered', 'covered'].includes(status)) {
            throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
        }
        const seats = await repo.loadSeats(client, row.id);
        const heldCount = seats.filter((s) => s.holder_id !== null).length;
        const rates = await repo.ratesFor(client, row.contract_id);
        const contract = {
            minimum_minutes: 120,
            increment_minutes: 15,
            rotation_interval_minutes: row.contract_interval,
            rates,
        };
        const cutoff = repo.cancellationCutoff(row.start_instant.getTime());
        const late = Date.now() > cutoff.getTime();
        const rate = selectRate(contract, assignmentDateOf(row));
        let charge = 0;
        if (late && heldCount > 0) {
            charge = computeLineAmounts(contract, rate, row.duration_minutes, heldCount, 0).amountCents;
        }
        if (charge !== body.quoted_charge_cents) {
            const billable = billableMinutes(contract, row.duration_minutes);
            const quote = {
                late,
                cutoff: formatInstant(cutoff.getTime()),
                interpreter_count: heldCount,
                billable_minutes: billable,
                charge_cents: charge,
            };
            throw new ApiError('quote_changed', 'The cancellation window just changed.', { extra: { quote } });
        }
        const toStatus = late && heldCount > 0 ? 'cancelled_late' : 'cancelled';
        if (late && heldCount > 0) {
            const { line_ref: lineRef, seq } = await nextLineRef(client);
            const amounts = computeLineAmounts(contract, rate, row.duration_minutes, heldCount, 0);
            const createdInstant = new Date();
            await client.query(`INSERT INTO invoice_lines (id, line_ref, seq, booking_id, booking_ref, org_id, kind,
           assignment_date, rate_effective_from, hourly_rate_cents, team_surcharge_bp,
           basis_minutes, billable_minutes, interpreter_count, time_amount_cents,
           mileage_miles, mileage_cents_per_mile, mileage_amount_cents, amount_cents,
           billing_week, sync_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'late_cancellation', $7, $8, $9, $10, $11, $12, $13, $14, 0, $15, $16, $17, $18, 'pending_sync', $19)`, [
                `ln_${seq}`, lineRef, seq, row.id, row.ref, row.org_id,
                assignmentDateOf(row), rate.effective_from, rate.hourly_rate_cents, rate.team_surcharge_bp,
                row.duration_minutes, amounts.billableMinutes, heldCount, amounts.timeAmountCents,
                rate.mileage_cents_per_mile, 0, amounts.amountCents,
                await assignBillingWeek(client, createdInstant, row.org_id), createdInstant,
            ]);
        }
        await client.query('UPDATE bookings SET status = $2, cancelled_at = now() WHERE id = $1', [row.id, toStatus]);
        await repo.auditEntry(client, row.id, { id: req.user.id, name: req.user.name }, 'cancelled', status, toStatus, null, null);
        const holderEmails = [];
        for (const s of seats) {
            if (s.holder_id !== null)
                holderEmails.push(await holderEmail(client, s.holder_id));
        }
        return { row, toStatus, late, charge, holders: holderEmails };
    });
    // Notices: one to the requester and one to each seat holder.
    const requesterEmail = await requesterEmailFor(app.db, result.row);
    if (requesterEmail) {
        await queueCancellationEmail(app.db, requesterEmail, result.row, result.late && result.charge > 0, result.charge);
    }
    for (const holderEmail of result.holders) {
        await queueCancellationEmail(app.db, holderEmail, result.row, false, 0, true);
    }
    const fresh = await repo.loadBooking(app.db, req.params.id);
    return { status: 200, body: await repo.serialize(app.db, req.user, fresh) };
});
async function holderEmail(client, userId) {
    const res = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
    return res.rows[0].email;
}
/** The requester for notices: the person who submitted the booking, or the organisation's
 * seeded requester when the coordinator submitted it. */
async function requesterEmailFor(db, row) {
    if (row.requester_id) {
        const res = await db.query('SELECT email, role FROM users WHERE id = $1', [row.requester_id]);
        if (res.rowCount !== 0 && res.rows[0].role === 'requester')
            return res.rows[0].email;
    }
    const res = await db.query("SELECT email FROM users WHERE role = 'requester' AND org_id = $1 LIMIT 1", [row.org_id]);
    return res.rowCount === 0 ? null : res.rows[0].email;
}
// ---------- audit ----------
route('GET', '/api/bookings/:id/audit', true, async (req, app) => {
    if (req.user.role !== 'coordinator' && req.user.role !== 'billing_manager') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const res = await app.db.query('SELECT at, actor_name, action, from_status, to_status, seat, interpreter_name FROM audit_trail WHERE booking_id = $1 ORDER BY id', [req.params.id]);
    const exists = await app.db.query('SELECT id FROM bookings WHERE id = $1', [req.params.id]);
    if (exists.rowCount === 0)
        throw new ApiError('not_found', 'That booking is not available to you.');
    const entries = res.rows.map((row) => ({
        at: formatInstant(row.at.getTime()),
        actor_name: row.actor_name,
        action: row.action,
        from_status: (row.from_status ?? null),
        to_status: (row.to_status ?? null),
        seat: row.seat,
        interpreter_name: row.interpreter_name,
    }));
    return { status: 200, body: { entries } };
});
// ---------- interpreters search ----------
route('GET', '/api/interpreters', true, async (req, app) => {
    if (req.user.role !== 'coordinator')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const q = req.query.get('q') ?? '';
    if (countCodePoints(q) > TEXT_LIMITS.search_q)
        throw validationError({ q: FIELD_MESSAGES.q });
    const trimmed = q.trim();
    const bookingId = req.query.get('booking_id');
    const repo = new BookingRepository();
    const res = await app.db.query("SELECT id, name, initials, phone, email, home_city, pay_rate_cents FROM users WHERE role = 'interpreter' ORDER BY name");
    const interpreters = [];
    let qualifiedSet = null;
    let busySet = null;
    let startMs = 0;
    let endMs = 0;
    let excludeId = '';
    if (bookingId) {
        const row = await repo.loadBooking(app.db, bookingId);
        startMs = row.start_instant.getTime();
        endMs = row.end_instant.getTime();
        excludeId = row.id;
        qualifiedSet = new Set();
        const credsAll = await app.db.query('SELECT interpreter_id, code, expires_on::text AS expires_on FROM interpreter_credentials');
        const byInterpreter = new Map();
        for (const c of credsAll.rows) {
            const list = byInterpreter.get(c.interpreter_id) ?? [];
            list.push({ code: c.code, expires_on: c.expires_on });
            byInterpreter.set(c.interpreter_id, list);
        }
        for (const [id, creds] of byInterpreter) {
            if (isQualified(row.setting, creds, assignmentDateOf(row)))
                qualifiedSet.add(id);
        }
        busySet = new Set();
        const busyRes = await app.db.query(`SELECT s.holder_id FROM seats s JOIN bookings b ON b.id = s.booking_id
       WHERE s.holder_id IS NOT NULL AND s.booking_id <> $1 AND b.status NOT IN ('cancelled', 'cancelled_late')
         AND b.start_instant < $2 AND $3 < b.end_instant`, [excludeId, new Date(endMs), new Date(startMs)]);
        for (const b of busyRes.rows)
            busySet.add(b.holder_id);
    }
    for (const row of res.rows) {
        if (trimmed && !row.name.toLowerCase().includes(trimmed.toLowerCase()))
            continue;
        const creds = await repo.holderCredentials(app.db, row.id);
        interpreters.push({
            id: row.id,
            name: row.name,
            initials: row.initials,
            credentials: creds,
            phone: row.phone,
            email: row.email,
            home_city: row.home_city,
            pay_rate_cents: row.pay_rate_cents,
            qualified: qualifiedSet === null ? null : qualifiedSet.has(row.id),
            busy: busySet === null ? null : busySet.has(row.id),
        });
    }
    return { status: 200, body: { interpreters } };
});
// ---------- contracts ----------
route('GET', '/api/contracts', true, async (req, app) => {
    if (req.user.role !== 'coordinator' && req.user.role !== 'billing_manager') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const res = await app.db.query('SELECT c.id, c.org_id, o.name AS org_name, c.minimum_minutes, c.increment_minutes, c.rotation_interval_minutes FROM contracts c JOIN organisations o ON o.id = c.org_id ORDER BY c.id');
    const contracts = [];
    for (const row of res.rows) {
        const rates = await app.db.query('SELECT effective_from::text AS effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile FROM contract_rates WHERE contract_id = $1 ORDER BY effective_from', [row.id]);
        contracts.push({
            id: row.id,
            org_id: row.org_id,
            org_name: row.org_name,
            minimum_minutes: row.minimum_minutes,
            increment_minutes: row.increment_minutes,
            rotation_interval_minutes: row.rotation_interval_minutes,
            rates: rates.rows,
        });
    }
    return { status: 200, body: { contracts } };
});
route('POST', '/api/contracts/:id/rates', true, async (req, app) => {
    if (req.user.role !== 'billing_manager')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const body = (req.body.json ?? {});
    const fields = {};
    const effectiveFrom = typeof body.effective_from === 'string' ? body.effective_from : '';
    const hourly = body.hourly_rate_cents;
    const surcharge = body.team_surcharge_bp;
    const mileage = body.mileage_cents_per_mile;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))
        fields.effective_from = FIELD_MESSAGES.effective_from;
    const hourlyCents = typeof hourly === 'number' && Number.isInteger(hourly) ? hourly : NaN;
    if (!(hourlyCents >= 1 && hourlyCents <= 100000))
        fields.hourly_rate_cents = FIELD_MESSAGES.hourly_rate_cents;
    const surchargeBp = typeof surcharge === 'number' && Number.isInteger(surcharge) ? surcharge : NaN;
    if (!(surchargeBp >= 0 && surchargeBp <= 10000))
        fields.team_surcharge_bp = FIELD_MESSAGES.team_surcharge_bp;
    const mileageCpm = typeof mileage === 'number' && Number.isInteger(mileage) ? mileage : NaN;
    if (!(mileageCpm >= 0 && mileageCpm <= 1000))
        fields.mileage_cents_per_mile = FIELD_MESSAGES.mileage_cents_per_mile;
    if (Object.keys(fields).length > 0)
        throw validationError(fields);
    const today = todayLocal(Date.now());
    if (effectiveFrom <= today) {
        throw validationError({ effective_from: FIELD_MESSAGES.effective_from });
    }
    const result = await app.db.transaction(async (client) => {
        const contractRes = await client.query('SELECT id, org_id FROM contracts WHERE id = $1', [req.params.id]);
        if (contractRes.rowCount === 0)
            throw new ApiError('not_found', 'That contract is not known.');
        const contract = contractRes.rows[0];
        const existing = await client.query('SELECT effective_from::text AS effective_from FROM contract_rates WHERE contract_id = $1', [contract.id]);
        if (existing.rows.some((r) => r.effective_from === effectiveFrom)) {
            throw validationError({ effective_from: FIELD_MESSAGES.effective_from_taken });
        }
        const billed = await client.query('SELECT assignment_date::text AS assignment_date FROM invoice_lines WHERE org_id = $1 AND assignment_date >= $2 ORDER BY assignment_date DESC LIMIT 1', [contract.org_id, effectiveFrom]);
        let earliestAllowed = null;
        if (billed.rowCount !== 0) {
            const dayAfter = addDaysToDateString(billed.rows[0].assignment_date, 1);
            const tomorrow = addDaysToDateString(today, 1);
            earliestAllowed = dayAfter > tomorrow ? dayAfter : tomorrow;
            throw new ApiError('rate_would_reprice', 'That date would reprice billed work.', { extra: { earliest_allowed: earliestAllowed } });
        }
        await client.query('INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile) VALUES ($1, $2, $3, $4, $5)', [contract.id, effectiveFrom, hourlyCents, surchargeBp, mileageCpm]);
        return contract.id;
    });
    const contract = await loadContract(app.db, result);
    return { status: 201, body: contract };
});
async function loadContract(db, contractId) {
    const res = await db.query('SELECT c.id, c.org_id, o.name AS org_name, c.minimum_minutes, c.increment_minutes, c.rotation_interval_minutes FROM contracts c JOIN organisations o ON o.id = c.org_id WHERE c.id = $1', [contractId]);
    const row = res.rows[0];
    const rates = await db.query('SELECT effective_from::text AS effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile FROM contract_rates WHERE contract_id = $1 ORDER BY effective_from', [contractId]);
    return {
        id: row.id,
        org_id: row.org_id,
        org_name: row.org_name,
        minimum_minutes: row.minimum_minutes,
        increment_minutes: row.increment_minutes,
        rotation_interval_minutes: row.rotation_interval_minutes,
        rates: rates.rows,
    };
}
// ---------- email bodies ----------
function startLine(row) {
    const start = row.start_instant;
    return `${formatDate(start.getTime())} ${formatInstant(start.getTime()).slice(11, 16)}`;
}
async function queueAssignmentEmail(db, toEmail, row, seat, extra) {
    const subject = `Assignment confirmed: ${row.ref} on ${formatDate(row.start_instant.getTime())} at ${formatInstant(row.start_instant.getTime()).slice(11, 16)}`;
    const end = formatInstant(row.end_instant.getTime()).slice(11, 16);
    const body = [
        `Your assignment is confirmed.`,
        ``,
        `Reference: ${row.ref}`,
        `Setting: ${row.setting}`,
        `Title: ${row.title}`,
        `Location: ${row.location}`,
        `On-site contact: ${row.onsite_contact_name}, ${row.onsite_contact_phone}`,
        `Deaf consumer: ${row.consumer_name}`,
        `Time: ${formatInstant(row.start_instant.getTime()).slice(11, 16)} to ${end}`,
        `Seat: ${seat}`,
        ...extra,
    ].join('\n');
    await queueEmail(db, { to: toEmail, subject, body });
}
async function queueCoverageEmailIfFirst(db, _db2, row, _config) {
    // One coverage confirmation each time the booking enters covered. The requester is the
    // person who submitted the booking, or the organisation's seeded requester when the
    // coordinator submitted it.
    let requesterEmail = null;
    if (row.requester_id) {
        const res = await db.query('SELECT email, role FROM users WHERE id = $1', [row.requester_id]);
        if (res.rowCount !== 0 && res.rows[0].role === 'requester')
            requesterEmail = res.rows[0].email;
    }
    if (requesterEmail === null) {
        const res = await db.query("SELECT email FROM users WHERE role = 'requester' AND org_id = $1 LIMIT 1", [row.org_id]);
        requesterEmail = res.rowCount === 0 ? null : res.rows[0].email;
    }
    if (requesterEmail === null)
        return;
    const subject = `Booking covered: ${row.ref} on ${formatDate(row.start_instant.getTime())} at ${formatInstant(row.start_instant.getTime()).slice(11, 16)}`;
    const seats = await db.query('SELECT u.name AS holder_name FROM seats s LEFT JOIN users u ON u.id = s.holder_id WHERE s.booking_id = $1 ORDER BY s.seat', [row.id]);
    const holderLines = seats.rows.filter((s) => s.holder_name !== null).map((s) => `Interpreter: ${s.holder_name}`);
    const body = [
        `Your booking is covered.`,
        ``,
        `Reference: ${row.ref}`,
        `Title: ${row.title}`,
        `Time: ${startLine(row)}`,
        ...holderLines,
    ].join('\n');
    await queueEmail(db, { to: requesterEmail, subject, body });
}
async function queueCancellationEmail(db, toEmail, row, late, chargeCents, interpreterCopy = false) {
    const subject = `Booking cancelled: ${row.ref} on ${formatDate(row.start_instant.getTime())} at ${formatInstant(row.start_instant.getTime()).slice(11, 16)}`;
    const lines = [];
    if (interpreterCopy) {
        lines.push('The booking you were assigned to has been cancelled.');
        lines.push('');
        lines.push(`Reference: ${row.ref}`);
        lines.push(`Title: ${row.title}`);
        lines.push(`Time: ${startLine(row)}`);
        lines.push('This was a late cancellation.');
    }
    else {
        lines.push('Your booking has been cancelled.');
        lines.push('');
        lines.push(`Reference: ${row.ref}`);
        lines.push(`Title: ${row.title}`);
        lines.push(`Time: ${startLine(row)}`);
        lines.push(late ? `Late cancellation charge: ${formatCents(chargeCents)}` : 'No cancellation charge.');
    }
    await queueEmail(db, { to: toEmail, subject, body: lines.join('\n') });
}
// ---------- prep materials ----------
route('POST', '/api/bookings/:id/materials', true, async (req, app) => {
    if (req.user.role !== 'requester' && req.user.role !== 'coordinator') {
        throw new ApiError('forbidden', 'Your role can not do that.');
    }
    const contentType = req.req.headers['content-type'] ?? '';
    const boundary = boundaryOf(contentType);
    if (boundary === null || req.rawBody === null) {
        throw validationError({ file: FIELD_MESSAGES.file });
    }
    const parsed = parseMultipart(req.rawBody, boundary);
    const filePart = parsed.files.find((f) => f.name === 'file');
    if (!filePart || filePart.bytes.length === 0) {
        throw validationError({ file: FIELD_MESSAGES.file });
    }
    if (filePart.bytes.length > UPLOAD_LIMIT_BYTES) {
        throw new ApiError('payload_too_large', 'Files must be 10,000,000 bytes or smaller.');
    }
    const kind = detectKind(filePart.bytes);
    if (kind === null) {
        throw new ApiError('unsupported_type', 'Only PDF, PNG, JPEG, Word (.docx) and PowerPoint (.pptx) files are accepted.');
    }
    const repo = new BookingRepository();
    const storage = new PrepStorage(app.config.s3);
    // The record and its object exist together or not at all: the object is stored first, the
    // record commits second, and a failed commit removes the object so nothing is left behind.
    const materialId = randomToken(12);
    const key = objectKey();
    const uploadName = displayName(filePart.filename);
    const sha = sha256Hex(filePart.bytes);
    const materialContentType = KIND_MEDIA_TYPES[kind];
    try {
        await storage.put(req.params.id, key, filePart.bytes, materialContentType);
    }
    catch {
        throw new ApiError('storage_unavailable', 'File storage is unavailable. Try the upload again shortly.');
    }
    try {
        await app.db.transaction(async (client) => {
            const row = await repo.loadBooking(client, req.params.id);
            if (row.org_id !== req.user.org_id && req.user.role !== 'coordinator') {
                throw new ApiError('not_found', 'That booking is not available to you.');
            }
            if (row.status === 'cancelled' || row.status === 'cancelled_late' || row.status === 'completed') {
                const status = row.status;
                throw new ApiError('invalid_transition', `This booking is now ${STATUS_LABELS[status]}.`, { extra: { status } });
            }
            // Lock the booking's materials so concurrent uploads see one count and the limit holds.
            await client.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [row.id]);
            const countRes = await client.query('SELECT count(*) AS count FROM materials WHERE booking_id = $1', [row.id]);
            if (Number(countRes.rows[0].count) >= MAX_FILES_PER_BOOKING) {
                throw validationError({ file: FIELD_MESSAGES.file_full });
            }
            const seqRes = await client.query("SELECT nextval('material_seq') AS nextval");
            await client.query(`INSERT INTO materials (id, booking_id, object_key, name, size_bytes, content_type, sha256, uploaded_at, uploaded_by, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)`, [materialId, row.id, key, uploadName, filePart.bytes.length, materialContentType, sha, req.user.id, Number(seqRes.rows[0].nextval)]);
        });
    }
    catch (err) {
        // Nothing is left behind: the stored object is removed when the record was not written.
        await storage.remove(req.params.id, key).catch(() => undefined);
        throw err;
    }
    const mat = await app.db.query('SELECT id, name, size_bytes, content_type, sha256, uploaded_at FROM materials WHERE id = $1', [materialId]);
    const m = mat.rows[0];
    return {
        status: 201,
        body: {
            id: m.id,
            name: m.name,
            size_bytes: Number(m.size_bytes),
            content_type: m.content_type,
            sha256: m.sha256,
            uploaded_at: formatInstant(m.uploaded_at.getTime()),
        },
    };
});
route('POST', '/api/bookings/:id/materials/:mid/link', true, async (req, app) => {
    if (req.user.role !== 'interpreter')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const repo = new BookingRepository();
    const visible = await repo.visibleTo(app.db, req.user, req.params.id);
    if (visible === null)
        throw new ApiError('not_found', 'That booking is not available to you.');
    const seats = await repo.loadSeats(app.db, visible.id);
    const holds = seats.some((s) => s.holder_id === req.user.id);
    if (!holds)
        throw new ApiError('access_ended', 'Your access to these materials has ended.');
    const assignmentEnd = visible.completed_at ?? visible.end_instant;
    if (Date.now() > assignmentEnd.getTime() + app.config.prepAccessGraceMinutes * 60000 || visible.status === 'cancelled' || visible.status === 'cancelled_late') {
        throw new ApiError('access_ended', 'Your access to these materials has ended.');
    }
    const mat = await app.db.query('SELECT id FROM materials WHERE id = $1 AND booking_id = $2', [req.params.mid, visible.id]);
    if (mat.rowCount === 0)
        throw new ApiError('not_found', 'That booking is not available to you.');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + app.config.prepLinkTtlSeconds * 1000);
    await app.db.query('INSERT INTO prep_links (token, material_id, issued_to, expires_at) VALUES ($1, $2, $3, $4)', [token, req.params.mid, req.user.id, expiresAt]);
    return { status: 201, body: { url: `/api/prep/${token}`, expires_at: formatInstant(expiresAt.getTime()) } };
});
route('GET', '/api/prep/:token', true, async (req, app) => {
    const link = await app.db.query('SELECT token, material_id, issued_to, expires_at FROM prep_links WHERE token = $1', [req.params.token]);
    if (link.rowCount === 0)
        throw new ApiError('not_found', 'That download link is not available to you.');
    const l = link.rows[0];
    const mat = await app.db.query('SELECT id, booking_id, name, size_bytes, content_type, object_key FROM materials WHERE id = $1', [l.material_id]);
    if (mat.rowCount === 0)
        throw new ApiError('not_found', 'That download link is not available to you.');
    const m = mat.rows[0];
    // Access checks: expiry first when both fail, per the access-window rule.
    const expired = Date.now() >= l.expires_at.getTime();
    const booking = await new BookingRepository().loadBooking(app.db, m.booking_id);
    const seats = await app.db.query('SELECT holder_id FROM seats WHERE booking_id = $1', [m.booking_id]);
    const holds = seats.rows.some((s) => s.holder_id === l.issued_to);
    const assignmentEnd = booking.completed_at ?? booking.end_instant;
    const windowOpen = booking.status !== 'cancelled' && booking.status !== 'cancelled_late' &&
        Date.now() <= assignmentEnd.getTime() + app.config.prepAccessGraceMinutes * 60000;
    if (!holds || !windowOpen)
        throw new ApiError('access_ended', 'Your access to these materials has ended.');
    if (expired)
        throw new ApiError('link_expired', 'That download link has expired. Press Download again.');
    const storage = new PrepStorage(app.config.s3);
    let stored;
    try {
        stored = await storage.get(m.booking_id, m.object_key);
    }
    catch {
        throw new ApiError('storage_unavailable', 'Prep materials are unavailable right now. Try again shortly.');
    }
    const { downloadFallbackName, downloadEncodedName } = await import('../domain/text.js');
    return {
        status: 200,
        body: stored.stream,
        headers: {
            'Content-Type': m.content_type,
            'Content-Length': String(Number(m.size_bytes)),
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `attachment; filename="${downloadFallbackName(m.name)}"; filename*=UTF-8''${downloadEncodedName(m.name)}`,
        },
    };
});
// ---------- billing ----------
async function buildWeekStatement(app, orgId, weekStart) {
    const kb = new KillBillClient(app.config.killbill);
    const orgRes = await app.db.query('SELECT name FROM organisations WHERE id = $1', [orgId]);
    const orgName = orgRes.rows[0]?.name ?? '';
    const weekRes = await app.db.query('SELECT status, relayline_total_cents, billing_total_cents, closed_at FROM billing_weeks WHERE org_id = $1 AND week_start = $2', [orgId, weekStart]);
    const weekRow = weekRes.rows[0];
    const linesRes = await app.db.query(`${LINE_SELECT} WHERE org_id = $1 AND billing_week = $2 ORDER BY seq`, [orgId, weekStart]);
    const lines = linesRes.rows.map(serializeLine);
    // Kill Bill is read for every line on each statement build, so adjustments show at once.
    let billingReachable = true;
    if (weekRow?.status !== 'closed') {
        for (const line of lines) {
            if (line.sync_status === 'pending_sync') {
                line.billing_amount_cents = null;
                continue;
            }
            const fresh = await readBillingAmount(app, kb, line);
            if (fresh === null) {
                billingReachable = false;
                line.billing_amount_cents = null;
                continue;
            }
            line.billing_amount_cents = fresh;
            await app.db.query('UPDATE invoice_lines SET billing_amount_cents = $2 WHERE line_ref = $1', [line.line_ref, fresh]);
        }
    }
    const relaylineTotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
    let billingTotal = null;
    if (weekRow && weekRow.status === 'closed') {
        billingTotal = weekRow.billing_total_cents;
    }
    else if (!billingReachable) {
        billingTotal = null;
    }
    else if (lines.length === 0) {
        billingTotal = 0;
    }
    else {
        billingTotal = lines.reduce((sum, l) => sum + (l.billing_amount_cents ?? 0), 0);
    }
    return {
        org_id: orgId,
        org_name: orgName,
        week_start: weekStart,
        status: (weekRow?.status ?? 'open'),
        lines,
        relayline_total_cents: weekRow?.status === 'closed' ? weekRow.relayline_total_cents : relaylineTotal,
        billing_total_cents: billingTotal,
        billing_reachable: billingReachable,
        closed_at: weekRow?.closed_at ? formatInstant(weekRow.closed_at.getTime()) : null,
    };
}
/** Kill Bill's current amount for a synced line, or null when it cannot be read. */
async function readBillingAmount(app, kb, line) {
    const itemId = await app.db.query('SELECT kb_item_id FROM invoice_lines WHERE line_ref = $1', [line.line_ref]);
    const kbItemId = itemId.rows[0]?.kb_item_id ?? null;
    if (kbItemId === null)
        return null;
    const accountId = await ensureKbAccount(app, kb, line.org_id);
    try {
        const charges = await kb.listCharges(accountId);
        const charge = charges.find((c) => c.invoiceItemId === kbItemId);
        return charge ? chargeTotalCents(charge) : null;
    }
    catch {
        return null;
    }
}
async function ensureKbAccount(app, kb, orgId) {
    const cached = await app.db.query('SELECT kb_account_id FROM kb_accounts WHERE org_id = $1', [orgId]);
    if (cached.rowCount !== 0 && cached.rows[0].kb_account_id)
        return cached.rows[0].kb_account_id;
    const orgRes = await app.db.query('SELECT name FROM organisations WHERE id = $1', [orgId]);
    const accountId = await kb.ensureAccount(orgId, orgRes.rows[0].name);
    await app.db.query('INSERT INTO kb_accounts (org_id, kb_account_id) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET kb_account_id = EXCLUDED.kb_account_id', [orgId, accountId]);
    return accountId;
}
route('GET', '/api/billing/weeks/:org_id/:week_start', true, async (req, app) => {
    const weekStart = req.params.week_start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekMondayOf(weekStart) !== weekStart) {
        throw validationError({ week_start: FIELD_MESSAGES.week_start });
    }
    const today = todayLocal(Date.now());
    const thisWeek = weekMondayOf(today);
    if (weekStart > thisWeek)
        throw validationError({ week_start: FIELD_MESSAGES.week_start });
    const orgRes = await app.db.query('SELECT id FROM organisations WHERE id = $1', [req.params.org_id]);
    if (orgRes.rowCount === 0)
        throw new ApiError('not_found', 'That organisation is not known.');
    if (req.user.role === 'billing_manager' || (req.user.role === 'requester' && req.user.org_id === req.params.org_id)) {
        return { status: 200, body: await buildWeekStatement(app, req.params.org_id, weekStart) };
    }
    throw new ApiError('forbidden', 'Your role can not do that.');
});
route('POST', '/api/billing/weeks/:org_id/:week_start/close', true, async (req, app) => {
    if (req.user.role !== 'billing_manager')
        throw new ApiError('forbidden', 'Your role can not do that.');
    const weekStart = req.params.week_start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekMondayOf(weekStart) !== weekStart) {
        throw validationError({ week_start: FIELD_MESSAGES.week_start });
    }
    const today = todayLocal(Date.now());
    const thisWeek = weekMondayOf(today);
    if (weekStart > thisWeek)
        throw validationError({ week_start: FIELD_MESSAGES.week_start });
    const orgRes = await app.db.query('SELECT id FROM organisations WHERE id = $1', [req.params.org_id]);
    if (orgRes.rowCount === 0)
        throw new ApiError('not_found', 'That organisation is not known.');
    const kb = new KillBillClient(app.config.killbill);
    const weekRes = await app.db.query('SELECT status FROM billing_weeks WHERE org_id = $1 AND week_start = $2', [req.params.org_id, weekStart]);
    if (weekRes.rowCount !== 0 && weekRes.rows[0].status === 'closed') {
        throw new ApiError('week_closed', 'This week is already closed.');
    }
    const linesRes = await app.db.query(`${LINE_SELECT} WHERE org_id = $1 AND billing_week = $2 ORDER BY seq`, [req.params.org_id, weekStart]);
    const lines = linesRes.rows.map(serializeLine);
    const pending = lines.filter((l) => l.sync_status === 'pending_sync').map((l) => l.line_ref);
    if (pending.length > 0) {
        throw new ApiError('pending_sync', 'Some lines are still waiting to sync with billing.', { extra: { pending_line_refs: pending } });
    }
    let billingReachable = true;
    const amounts = [];
    for (const line of lines) {
        const amount = await readBillingAmount(app, kb, line);
        if (amount === null) {
            billingReachable = false;
            break;
        }
        amounts.push(amount);
        await app.db.query('UPDATE invoice_lines SET billing_amount_cents = $2 WHERE line_ref = $1', [line.line_ref, amount]);
    }
    if (!billingReachable)
        throw new ApiError('billing_unavailable', 'Billing is unreachable. Nothing was closed; try again shortly.');
    const relaylineTotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
    const billingTotal = amounts.reduce((sum, a) => sum + a, 0);
    if (relaylineTotal !== billingTotal) {
        throw new ApiError('total_mismatch', 'Relayline and billing totals differ. Nothing was closed.', {
            extra: { relayline_total_cents: relaylineTotal, billing_total_cents: billingTotal },
        });
    }
    const closedAt = new Date();
    await app.db.query(`INSERT INTO billing_weeks (org_id, week_start, status, relayline_total_cents, billing_total_cents, closed_at)
     VALUES ($1, $2, 'closed', $3, $4, $5)
     ON CONFLICT (org_id, week_start) DO UPDATE SET status = 'closed',
       relayline_total_cents = EXCLUDED.relayline_total_cents,
       billing_total_cents = EXCLUDED.billing_total_cents, closed_at = EXCLUDED.closed_at`, [req.params.org_id, weekStart, relaylineTotal, billingTotal, closedAt]);
    return { status: 200, body: await buildWeekStatement(app, req.params.org_id, weekStart) };
});
export { routes };
