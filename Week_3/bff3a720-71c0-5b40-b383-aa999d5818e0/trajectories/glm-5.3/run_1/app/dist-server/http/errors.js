/**
 * One error shape for the whole API. `ApiError` carries the status, the code and
 * the published copy; nothing else answers a JSON error.
 */
const COPY = {
    unauthenticated: 'Sign in to continue.',
    not_found: 'We could not find that.',
    forbidden: 'You do not have access to this.',
    rate_limited: 'Too many requests. Try again later.',
    seat_taken: 'This seat was just taken. Choose another span or ride.',
    ride_changed: 'The driver changed this ride. Check the new times before booking.',
    edit_conflict: 'This ride was changed in another window. Reload to see the latest version.',
    request_expired: 'This request expired before you answered it.',
    already_decided: 'This was already decided.',
    booking_closed: 'Booking for this ride closed <minutes> minutes before departure.',
    hold_expired: 'Your seat hold ran out. Choose your span again.',
    already_rated: 'You have already rated this trip.',
    rating_not_open: 'You can rate this trip once it arrives.',
    rating_closed: 'The rating window for this trip has closed.',
    invalid_transition: 'This booking can no longer change that way.',
    idempotency_conflict: 'This request was already sent with different details.',
    payload_too_large: 'The request is too large.',
    unsupported_media_type: 'Send this request as JSON.',
    validation_failed: 'Check the highlighted fields.',
    price_out_of_range: 'Set a price between <low> and <high> for <km> km.',
    too_many_stopovers: 'A ride can have at most <max> stopovers.',
    insufficient_funds: 'Your wallet has <balance>. Add money to book this seat.',
    file_type: 'Upload a PNG, JPEG or PDF file.',
    file_too_large: 'The file must be <MB> MB or smaller.',
    code_invalid: 'That code is not right. Check the email and try again.',
    code_expired: 'This code has expired. Ask for a new one.',
    storage_unavailable: 'We could not store your file right now. Nothing was lost; try again in a moment.',
};
export function withPlaceholders(code, vars) {
    let copy = COPY[code];
    for (const [k, v] of Object.entries(vars))
        copy = copy.replaceAll(`<${k}>`, v);
    return copy;
}
export class ApiError extends Error {
    status;
    code;
    fields;
    extra;
    headers;
    constructor(status, code, message, fields, extra, headers) {
        super(message ?? COPY[code]);
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.extra = extra;
        this.headers = headers;
        this.name = 'ApiError';
    }
    body() {
        const out = { error: this.code, message: this.message };
        if (this.fields && Object.keys(this.fields).length > 0)
            out.fields = this.fields;
        if (this.extra)
            Object.assign(out, this.extra);
        return out;
    }
}
export function err(status, code, message, fields, headers) {
    return new ApiError(status, code, message, fields, undefined, headers);
}
export function forbiddenForRidePublish() {
    return err(403, 'forbidden', 'Your ID must be verified before you can offer a ride.');
}
export function rateLimited(retryAfterSeconds, kind, limit) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    const seconds = Math.max(1, Math.round(retryAfterSeconds));
    const message = kind === 'bookings'
        ? `You have made ${limit} booking requests in the last hour. Try again in ${minutes} minutes.`
        : kind === 'messages'
            ? `You are sending messages too fast. Try again in ${seconds} seconds.`
            : `Too many codes asked for. Try again in ${minutes} minutes.`;
    return new ApiError(429, 'rate_limited', message, undefined, undefined, { 'Retry-After': String(seconds) });
}
export function unauthenticated() { return err(401, 'unauthenticated'); }
export function notFound() { return err(404, 'not_found'); }
export function forbidden(message) { return err(403, 'forbidden', message); }
