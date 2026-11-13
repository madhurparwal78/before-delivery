export function refundTier(paidCents, now, boardingTime, cfg) {
    const msLeft = boardingTime - now;
    const hours = msLeft / 3_600_000;
    if (hours > cfg.refundFullHours) {
        return { refundCents: paidCents, keptCents: 0, percent: 100, hoursBefore: Math.floor(hours), reason: 'tier' };
    }
    if (hours >= cfg.refundHalfHours) {
        const refund = Math.floor((paidCents * cfg.refundHalfPercent) / 100);
        return { refundCents: paidCents - refund, keptCents: refund, percent: cfg.refundHalfPercent, hoursBefore: Math.floor(hours), reason: 'tier' };
    }
    return { refundCents: 0, keptCents: paidCents, percent: 0, hoursBefore: Math.floor(Math.max(hours, 0)), reason: 'tier' };
}
export function freeCancelQuote(paidCents, now, boardingTime, freeCancelUntil, cfg) {
    if (freeCancelUntil === null)
        return null;
    if (now < freeCancelUntil) {
        return { refundCents: paidCents, keptCents: 0, percent: 100, hoursBefore: hoursBeforeRounded(now, boardingTime), reason: 'free_window' };
    }
    return null;
}
function hoursBeforeRounded(now, boardingTime) {
    return Math.floor(Math.max(0, (boardingTime - now) / 3_600_000));
}
export function cancelQuote(paidCents, now, boardingTime, freeCancelUntil, cfg) {
    return freeCancelQuote(paidCents, now, boardingTime, freeCancelUntil, cfg) ?? refundTier(paidCents, now, boardingTime, cfg);
}
/** The free-cancel deadline a qualifying time change grants: new departure − 2 hours. */
export function freeCancelDeadline(newDeparture) {
    return newDeparture - 2 * 3_600_000;
}
/** Whether a departure move is big enough to open the free-cancel window. */
export function shiftQualifies(oldDeparture, newDeparture, cfg) {
    return Math.abs(newDeparture - oldDeparture) > cfg.freeCancelShiftMinutes * 60_000;
}
