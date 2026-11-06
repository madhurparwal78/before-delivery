import { loadDay, sweepDay, emitDayEvent } from './domain.js';
import { now } from './time.js';
import { AppError } from './errors.js';
import { audit } from './audit.js';
export function splitFee(feeCents, numbers) {
    const shares = new Map();
    if (numbers.length === 0)
        return shares;
    const base = Math.floor(feeCents / numbers.length);
    let leftover = feeCents - base * numbers.length;
    const sorted = [...numbers].sort((a, b) => a - b);
    for (const n of sorted) {
        shares.set(n, base + (leftover > 0 ? 1 : 0));
        if (leftover > 0)
            leftover--;
    }
    return shares;
}
export async function startDay(tx, day, actor) {
    const t = now();
    await sweepDay(tx, day.id, actor);
    const held = await tx.query(`select * from bookings where barn_day_id = $1 and status = 'held'`, [day.id]);
    for (const b of held) {
        await tx.query(`update bookings set status = 'removed', lapse_recorded = true, updated_at = $2 where id = $1`, [b.id, t]);
        if (b.payment_id) {
            await tx.query(`update payments set status = 'voided', updated_at = $2 where id = $1 and status = 'authorized'`, [b.payment_id, t]);
            await audit(tx, actor.audit, 'void', 'payment', b.payment_id, 'authorized', 'voided', actor.requestId);
        }
        await audit(tx, actor.audit, 'remove_hold', 'booking', b.id, 'held', 'removed', actor.requestId);
    }
    const counting = await tx.query(`select * from bookings where barn_day_id = $1 and status in ('confirmed','cancelled_late') order by number`, [day.id]);
    const shares = splitFee(day.trip_fee_cents, counting.map((b) => b.number));
    for (const b of counting) {
        const s = shares.get(b.number) ?? 0;
        await tx.query(`update bookings set trip_share_cents = $2, initial_cents = $2, updated_at = $3 where id = $1`, [b.id, s, t]);
    }
    await tx.query(`update barn_days set status = 'in_progress' where id = $1`, [day.id]);
    await audit(tx, actor.audit, 'start', 'barn_day', day.id, 'published', 'in_progress', actor.requestId);
    await emitDayEvent(tx, day.id, 'farrier', 'day_status', { status: 'in_progress' });
    await emitDayEvent(tx, day.id, 'apprentice', 'day_status', { status: 'in_progress' });
    await emitDayEvent(tx, day.id, 'barn_manager', 'day_status', { status: 'in_progress' });
    return loadDay(tx, day.id);
}
export async function excuseBooking(tx, booking, actor) {
    const t = now();
    const day = await loadDay(tx, booking.barn_day_id);
    const share = booking.trip_share_cents ?? 0;
    const all = await tx.query(`select * from bookings where barn_day_id = $1 order by number`, [day.id]);
    const visitStates = new Map();
    const visits = await tx.query(`select booking_id, status from visits where booking_id = any($1)`, [all.map((b) => b.id)]);
    for (const v of visits)
        visitStates.set(v.booking_id, v.status);
    const counting = all.filter((b) => ['confirmed', 'worked', 'cancelled_late', 'no_show', 'excused'].includes(b.status));
    const others = counting.filter((b) => b.id !== booking.id);
    const openRecipients = others.filter((b) => {
        if (b.status === 'cancelled_late' || b.status === 'no_show')
            return true;
        if (b.status === 'confirmed')
            return true;
        if (b.status === 'worked')
            return visitStates.get(b.id) === 'open' || visitStates.get(b.id) === undefined;
        return false;
    });
    const changed = [];
    if (share > 0) {
        if (openRecipients.length === 0) {
            throw new AppError(409, 'no_share_recipient');
        }
        const billed = others.filter((b) => {
            if (b.status === 'cancelled_late' || b.status === 'no_show')
                return false;
            if (b.status === 'confirmed')
                return false;
            if (b.status === 'worked')
                return visitStates.get(b.id) !== 'open' && visitStates.get(b.id) !== undefined;
            return false;
        });
        const billedSum = billed.reduce((s, b) => s + (b.trip_share_cents ?? 0), 0);
        const pool = day.trip_fee_cents - billedSum;
        const split = splitFee(pool, openRecipients.map((b) => b.number));
        for (const b of openRecipients) {
            const to = split.get(b.number) ?? 0;
            changed.push({ booking: b, from: b.trip_share_cents ?? 0, to });
        }
    }
    changed.push({ booking, from: share, to: 0 });
    const seqRow = await tx.query(`select coalesce(max(seq), 0) as m from adjustments where barn_day_id = $1`, [day.id]);
    let seq = seqRow[0].m;
    for (const ch of changed) {
        seq += 1;
        await tx.query(`insert into adjustments(seq, barn_day_id, booking_id, delta_cents, cause_booking_id, at)
       values($1,$2,$3,$4,$5,$6)`, [seq, day.id, ch.booking.id, ch.to - ch.from, booking.id, t]);
        await tx.query(`update bookings set trip_share_cents = $2, updated_at = $3 where id = $1`, [ch.booking.id, ch.to, t]);
    }
    await tx.query(`update bookings set status = 'excused', updated_at = $2 where id = $1`, [booking.id, t]);
    await audit(tx, actor.audit, 'excuse', 'booking', booking.id, booking.status, 'excused', actor.requestId);
    return { changed, allocation: null };
}
