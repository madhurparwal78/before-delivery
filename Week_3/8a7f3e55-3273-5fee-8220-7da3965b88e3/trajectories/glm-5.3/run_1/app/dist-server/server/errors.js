const STATUS_FOR = {
    unauthenticated: 401,
    invalid_credentials: 401,
    forbidden: 403,
    cross_origin: 403,
    access_ended: 403,
    not_found: 404,
    idempotency_in_progress: 409,
    invalid_transition: 409,
    seat_filled: 409,
    already_holding: 409,
    schedule_conflict: 409,
    not_qualified: 409,
    open_call_closed: 409,
    already_team: 409,
    quote_changed: 409,
    pending_sync: 409,
    week_closed: 409,
    total_mismatch: 409,
    rate_would_reprice: 409,
    link_expired: 410,
    payload_too_large: 413,
    unsupported_type: 415,
    validation: 422,
    idempotency_key_reused: 422,
    billing_unavailable: 503,
    storage_unavailable: 503,
};
export class ApiError extends Error {
    code;
    fields;
    extra;
    constructor(code, message, options = {}) {
        super(message);
        this.code = code;
        this.fields = options.fields;
        this.extra = options.extra ?? {};
    }
    status() {
        return STATUS_FOR[this.code];
    }
    body() {
        const out = { error: this.code, message: this.message };
        if (this.fields)
            out.fields = this.fields;
        for (const [key, value] of Object.entries(this.extra)) {
            if (value !== undefined)
                out[key] = value;
        }
        return out;
    }
}
export function validationError(fields) {
    const first = Object.values(fields)[0] ?? 'Check the highlighted fields.';
    return new ApiError('validation', first, { fields });
}
