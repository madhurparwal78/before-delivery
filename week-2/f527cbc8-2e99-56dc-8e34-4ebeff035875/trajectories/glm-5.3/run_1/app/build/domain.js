import crypto from 'node:crypto';
import { config } from './config.js';
import { now } from './time.js';
import { AppError } from './errors.js';
import { audit, sessionActor, systemActor } from './audit.js';
export function newId(prefix) {
    return prefix + '_' + crypto.randomBytes(12).toString('hex');
}
export function userActor(userId, requestId) {
    return { audit: sessionActor(userId), requestId };
}
export function systemRequest(requestId) {
    return { audit: systemActor(), requestId };
}
export async function lockDay(tx, dayId) {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`day:${dayId}`]);
    return loadDay(tx, dayId);
}
export async function loadDay(tx, dayId) {
    const rows = await tx.query(`select * from barn_days where id = $1`, [dayId]);
    return rows[0] ?? null;
}
export function isHoldLive(row, t) {
    if (row.status !== 'held')
        return false;
    return row.hold_expires_at.getTime() > t.getTime();
}
export function liveBookingStatus(row, t) {
    if (!['held', 'confirmed', 'worked', 'no_show'].includes(row.status))
        return null;
    if (row.status === 'held' && !isHoldLive(row, t))
        return null;
    return row.status;
}
export async function bookedCount(tx, dayId) {
    const t = now();
    const rows = await tx.query(`select slot_id from bookings where barn_day_id = $1 and status in ('held','confirmed','worked','no_show') and (status <> 'held' or hold_expires_at > $2)`, [dayId, t]);
    return { count: rows.length, slotIds: new Set(rows.map((r) => r.slot_id)) };
}
export function derivedStatus(stored, booked, slotCount) {
    if (stored === 'published' && booked >= slotCount)
        return 'full';
    return stored === 'published' || stored === 'in_progress' || stored === 'draft' || stored === 'closed' || stored === 'cancelled'
        ? (stored === 'in_progress' || stored === 'draft' || stored === 'closed' || stored === 'cancelled' ? stored : (booked >= slotCount ? 'full' : 'published'))
        : stored;
}
export async function emitDayEvent(tx, dayId, role, event, data) {
    const stream = `day:${dayId}:${role}`;
    const next = await tx.query(`select coalesce(max(id), 0) + 1 as n from stream_events where stream = $1`, [stream]);
    await tx.query(`insert into stream_events(stream, id, event, data, created_at) values($1,$2,$3,$4,$5)`, [stream, next[0].n, event, JSON.stringify(data), now()]);
}
export async function emitHorseEvent(tx, horseId, audience, event, data) {
    const stream = `horse:${horseId}:${audience}`;
    const next = await tx.query(`select coalesce(max(id), 0) + 1 as n from stream_events where stream = $1`, [stream]);
    await tx.query(`insert into stream_events(stream, id, event, data, created_at) values($1,$2,$3,$4,$5)`, [stream, next[0].n, event, JSON.stringify(data), now()]);
}
export async function sweepDay(tx, dayId, actor) {
    const t = now();
    const lapsed = await tx.query(`select * from bookings where barn_day_id = $1 and status = 'held' and lapse_recorded = false and hold_expires_at <= $2`, [dayId, t]);
    for (const b of lapsed) {
        await tx.query(`update bookings set status = 'lapsed', lapse_recorded = true, updated_at = $2 where id = $1`, [b.id, t]);
        if (b.payment_id) {
            await tx.query(`update payments set status = 'voided', updated_at = $2 where id = $1 and status = 'authorized'`, [b.payment_id, t]);
            await audit(tx, systemActor(), 'lapse', 'payment', b.payment_id, 'authorized', 'voided', actor?.requestId ?? 'system');
        }
        await audit(tx, systemActor(), 'lapse', 'booking', b.id, 'held', 'lapsed', actor?.requestId ?? 'system');
    }
}
export async function offerPass(tx, dayId, actor) {
    await sweepDay(tx, dayId, actor);
    const day = await loadDay(tx, dayId);
    if (!day || day.status !== 'published')
        return;
    if (now().getTime() >= day.starts_at.getTime())
        return;
    const { count, slotIds } = await bookedCount(tx, dayId);
    if (count >= day.slot_count)
        return;
    const waiting = await tx.query(`select w.*, u.email as owner_email, u.name as owner_name, u.card_token, u.card_last4
     from waitlist w join users u on u.id = w.owner_id
     where w.barn_day_id = $1 order by w.joined_at, w.seq`, [dayId]);
    if (waiting.length === 0)
        return;
    const slots = await tx.query(`select * from slots where barn_day_id = $1 order by idx`, [dayId]);
    const deposit = await depositForDay(tx, day);
    for (const slot of slots) {
        if (slotIds.has(slot.id))
            continue;
        let pick = null;
        for (const w of waiting) {
            const blocked = await ownerBlocked(tx, w.owner_id);
            if (!blocked) {
                pick = w;
                break;
            }
        }
        if (!pick)
            return;
        await createHoldBooking(tx, day, slot, pick.horse_id, pick.owner_id, pick.card_token, deposit, true, actor);
        await tx.query(`delete from waitlist where id = $1`, [pick.id]);
        const idx = waiting.indexOf(pick);
        waiting.splice(idx, 1);
        slotIds.add(slot.id);
        if (waiting.length === 0)
            return;
    }
}
async function depositForDay(tx, day) {
    const rows = await tx.query(`select deposit_cents from price_lists where effective_from <= $1 order by effective_from desc limit 1`, [day.business_date]);
    return rows[0]?.deposit_cents ?? 0;
}
export async function ownerBlocked(tx, ownerId) {
    const rows = await tx.query(`select 1 from invoices where owner_id = $1 and dunning_state = 'blocked' limit 1`, [ownerId]);
    return rows.length > 0;
}
export function cardOutcome(token) {
    switch (token) {
        case 'tok_approve_4242': return { approved: true, last4: '4242' };
        case 'tok_decline_0002': return { approved: false, declineCode: 'do_not_honor', last4: '0002' };
        case 'tok_funds_9995': return { approved: false, declineCode: 'insufficient_funds', last4: '9995' };
        default: return { approved: false, declineCode: 'unknown_card', last4: '0000' };
    }
}
export async function createHoldBooking(tx, day, slot, horseId, ownerId, cardToken, deposit, offer, actor) {
    const t = now();
    const bookingId = newId('bkg');
    const next = await tx.query(`update counters set next_booking_number = next_booking_number + 1 where id = 1 returning next_booking_number - 1 as n`);
    const number = next[0].n;
    const holdEnds = new Date(Math.ceil(t.getTime() / 1000) * 1000 + (offer ? config.waitlistOfferSeconds : config.holdSeconds) * 1000);
    await tx.query(`insert into bookings(id, number, status, barn_day_id, slot_id, horse_id, owner_id, hold_expires_at, offer, deposit_cents, created_at, updated_at)
     values($1,$2,'held',$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [bookingId, number, day.id, slot.id, horseId, ownerId, holdEnds, offer, deposit, t]);
    let paymentId = null;
    if (deposit > 0) {
        const outcome = cardOutcome(cardToken ?? '');
        const pid = newId('pay');
        if (outcome.approved) {
            await tx.query(`insert into payments(id, kind, status, owner_id, booking_id, amount_cents, disposition, card_last4, killbill_status, created_at, updated_at)
         values($1,'deposit','authorized',$2,$3,$4,'held',$5,'not_recorded',$6,$6)`, [pid, ownerId, bookingId, deposit, outcome.last4, t]);
            await audit(tx, actor?.audit ?? systemActor(), 'authorise', 'payment', pid, null, 'authorized', actor?.requestId ?? 'system');
            paymentId = pid;
        }
        else {
            await tx.query(`insert into payments(id, kind, status, owner_id, booking_id, amount_cents, card_last4, decline_code, killbill_status, created_at, updated_at)
         values($1,'deposit','declined',$2,$3,$4,$5,$6,'not_recorded',$7,$7)`, [pid, ownerId, bookingId, deposit, outcome.last4, outcome.declineCode ?? '', t]);
            await audit(tx, actor?.audit ?? systemActor(), 'authorise', 'payment', pid, null, 'declined', actor?.requestId ?? 'system');
            throw new AppError(402, 'card_declined', { decline_code: outcome.declineCode ?? 'unknown_card' });
        }
    }
    await tx.query(`update bookings set payment_id = $2 where id = $1`, [bookingId, paymentId]);
    await audit(tx, actor?.audit ?? systemActor(), 'hold', 'booking', bookingId, null, 'held', actor?.requestId ?? 'system');
    return (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
}
