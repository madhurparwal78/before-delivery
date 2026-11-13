/** Booking states and their legal moves — one place for the whole app. */
/** Every move the API may ask for, mapped to its outcome. */
export function bookingTransition(from, action) {
    const table = {
        held: { confirm: 'confirmed', release: 'expired', confirm_late: 'expired' },
        requested: { accept: 'confirmed', decline: 'declined', withdraw: 'withdrawn', expire: 'expired' },
        confirmed: { cancel_by_passenger: 'cancelled_by_passenger', cancel_by_driver: 'cancelled_by_driver', complete: 'completed' },
        completed: { reveal: 'rated' },
        rated: {},
        expired: {},
        declined: {},
        withdrawn: {},
        cancelled_by_passenger: {},
        cancelled_by_driver: {},
    };
    return { to: table[from][action] ?? null };
}
export const ACTIVE_HOLD_STATES = new Set(['held', 'requested']);
export const SEAT_HOLDING_STATES = new Set(['held', 'requested', 'confirmed']);
export const ALL_BOOKING_STATES = [
    'held', 'requested', 'confirmed', 'completed', 'rated',
    'expired', 'declined', 'withdrawn', 'cancelled_by_passenger', 'cancelled_by_driver',
];
