import { ApiError } from './errors.js';
import { seatCountForRule, resolveStart, nextBookingRef, localWall } from './bookings.js';
import { countCodePoints, isBlank } from '../domain/text.js';
import { FIELD_MESSAGES, TEXT_LIMITS } from '../shared/terms.js';
/** `start` is agency wall-clock time; the checks run in the published order and report the
 * first failure only. */
export function validateStart(start, nowMs, fields) {
    if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) {
        fields.start = FIELD_MESSAGES.start;
        return null;
    }
    const startMs = resolveStart(start);
    if (Number.isNaN(startMs)) {
        fields.start = FIELD_MESSAGES.start_skipped;
        return null;
    }
    if (startMs < nowMs + 15 * 60000) {
        fields.start = FIELD_MESSAGES.start_too_soon;
        return null;
    }
    return startMs;
}
export function readNewBooking(body, user, nowMs) {
    const b = (body ?? {});
    const fields = {};
    let orgId;
    if (user.role === 'coordinator') {
        orgId = typeof b.org_id === 'string' ? b.org_id : '';
        if (!orgId)
            fields.org_id = FIELD_MESSAGES.org_id;
    }
    else {
        orgId = user.org_id ?? '';
        if (!orgId)
            fields.org_id = FIELD_MESSAGES.org_id;
    }
    const setting = typeof b.setting === 'string' ? b.setting : '';
    if (!['medical', 'educational', 'legal', 'workplace'].includes(setting)) {
        fields.setting = FIELD_MESSAGES.setting;
    }
    const title = typeof b.title === 'string' ? b.title : '';
    if (isBlank(title) || countCodePoints(title) > TEXT_LIMITS.title)
        fields.title = FIELD_MESSAGES.title;
    const location = typeof b.location === 'string' ? b.location : '';
    if (isBlank(location) || countCodePoints(location) > TEXT_LIMITS.location)
        fields.location = FIELD_MESSAGES.location;
    const onsiteName = typeof b.onsite_contact_name === 'string' ? b.onsite_contact_name : '';
    if (isBlank(onsiteName) || countCodePoints(onsiteName) > TEXT_LIMITS.onsite_contact_name)
        fields.onsite_contact_name = FIELD_MESSAGES.onsite_contact_name;
    const onsitePhone = typeof b.onsite_contact_phone === 'string' ? b.onsite_contact_phone : '';
    if (onsitePhone.length < 7 || onsitePhone.length > TEXT_LIMITS.onsite_contact_phone || !/^[0-9 +\-()]+$/.test(onsitePhone)) {
        fields.onsite_contact_phone = FIELD_MESSAGES.onsite_contact_phone;
    }
    const consumerName = typeof b.consumer_name === 'string' ? b.consumer_name : '';
    if (isBlank(consumerName) || countCodePoints(consumerName) > TEXT_LIMITS.consumer_name)
        fields.consumer_name = FIELD_MESSAGES.consumer_name;
    const startMs = validateStart(b.start, nowMs, fields);
    const durationRaw = b.duration_minutes;
    const duration = typeof durationRaw === 'number' && Number.isInteger(durationRaw) ? durationRaw : NaN;
    if (!(duration >= 30 && duration <= 480 && duration % 15 === 0)) {
        fields.duration_minutes = FIELD_MESSAGES.duration_minutes;
    }
    const notes = typeof b.requester_notes === 'string' ? b.requester_notes : '';
    if (countCodePoints(notes) > TEXT_LIMITS.requester_notes)
        fields.requester_notes = FIELD_MESSAGES.requester_notes;
    const input = {
        orgId,
        setting,
        title,
        location,
        onsiteName,
        onsitePhone,
        consumerName,
        startMs: startMs ?? 0,
        durationMinutes: duration,
        notes,
        requesterId: user.id,
    };
    return { input, fields };
}
/** Create the booking and its seats, with the submitted audit entry, inside the transaction. */
export async function insertBooking(client, repo, input) {
    const { ref, seq } = await nextBookingRef(client);
    const id = `bk_${seq}`;
    const seatCount = seatCountForRule(input.durationMinutes, input.setting);
    const endMs = input.startMs + input.durationMinutes * 60000;
    await client.query(`INSERT INTO bookings (id, ref, seq, org_id, requester_id, setting, title, location,
       onsite_contact_name, onsite_contact_phone, consumer_name, start_instant, start_wall,
       end_instant, duration_minutes, seat_count, status, requester_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'submitted', $17)`, [
        id, ref, seq, input.orgId, input.requesterId, input.setting, input.title, input.location,
        input.onsiteName, input.onsitePhone, input.consumerName,
        new Date(input.startMs), localWall(input.startMs), new Date(endMs),
        input.durationMinutes, seatCount, input.notes,
    ]);
    for (let seat = 1; seat <= seatCount; seat++) {
        await client.query('INSERT INTO seats (booking_id, seat, holder_id) VALUES ($1, $2, NULL)', [id, seat]);
    }
    await repo.auditEntry(client, id, { id: input.requesterId, name: '' }, 'submitted', null, 'submitted', null, null);
    const row = await repo.loadBooking(client, id);
    return row;
}
export async function requireOrg(client, orgId) {
    const res = await client.query('SELECT id FROM organisations WHERE id = $1', [orgId]);
    if (res.rowCount === 0)
        throw new ApiError('not_found', 'That organisation is not known.');
}
