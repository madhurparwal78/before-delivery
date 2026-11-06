// Every setting the server reads, taken from the environment once at start (brief: Configuration and secrets).
// Defaults are the published ones from the section that owns each rule.
function required(name) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "")
        throw new Error(`Missing required environment variable ${name}`);
    return value;
}
function integer(name, fallback, minimum = 1) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum)
        throw new Error(`${name} must be a whole number of at least ${minimum}`);
    return value;
}
function number(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name} must be a positive number`);
    return value;
}
const BUCKETS = ["sign_in", "hold", "payment", "upload", "vet"];
/** Published allowance defaults (brief: Business rules, Request allowances); `vet` has no per-user allowance. */
const ALLOWANCE_DEFAULTS = {
    sign_in: { user: { capacity: 10, refillPerMinute: 2 }, address: { capacity: 240, refillPerMinute: 120 } },
    hold: { user: { capacity: 60, refillPerMinute: 12 }, address: { capacity: 300, refillPerMinute: 120 } },
    payment: { user: { capacity: 20, refillPerMinute: 6 }, address: { capacity: 100, refillPerMinute: 30 } },
    upload: { user: { capacity: 200, refillPerMinute: 60 }, address: { capacity: 400, refillPerMinute: 120 } },
    vet: { address: { capacity: 60, refillPerMinute: 30 } },
};
function allowances() {
    const out = {
        sign_in: {},
        hold: {},
        payment: {},
        upload: {},
        vet: {},
    };
    for (const bucket of BUCKETS) {
        for (const scope of ["user", "address"]) {
            const size = ALLOWANCE_DEFAULTS[bucket][scope];
            if (!size)
                continue;
            const prefix = `RATE_${bucket.toUpperCase()}_${scope.toUpperCase()}`;
            out[bucket][scope] = {
                capacity: integer(`${prefix}_CAPACITY`, size.capacity),
                refillPerMinute: number(`${prefix}_REFILL_PER_MINUTE`, size.refillPerMinute),
            };
        }
    }
    return out;
}
function retryDays() {
    const raw = process.env.DUNNING_RETRY_DAYS;
    if (raw === undefined || raw.trim() === "")
        return [3, 5, 7];
    const days = raw.split(",").map((part) => Number(part.trim()));
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0)) {
        throw new Error("DUNNING_RETRY_DAYS must be a comma-separated list of whole days");
    }
    return days;
}
const clockOffset = () => {
    const raw = process.env.CLOCK_OFFSET_SECONDS;
    if (raw === undefined || raw.trim() === "")
        return 0;
    const value = Number(raw);
    if (!Number.isFinite(value))
        throw new Error("CLOCK_OFFSET_SECONDS must be a number of seconds");
    return value;
};
export const config = {
    port: integer("APP_PUBLIC_PORT", 4173),
    instanceLabel: process.env.INSTANCE_LABEL?.trim() || "primary",
    clockOffsetSeconds: clockOffset(),
    databaseUrl: required("DATABASE_URL"),
    s3: {
        endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
        region: required("S3_REGION"),
        bucket: required("S3_BUCKET"),
        forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 25), from: required("MAIL_FROM") },
    killbill: {
        url: required("KILLBILL_URL").replace(/\/+$/, ""),
        username: required("KILLBILL_USERNAME"),
        password: required("KILLBILL_PASSWORD"),
        apiKey: required("KILLBILL_API_KEY"),
        apiSecret: required("KILLBILL_API_SECRET"),
    },
    holdSeconds: integer("BOOKING_HOLD_SECONDS", 300),
    waitlistOfferSeconds: integer("WAITLIST_OFFER_SECONDS", 900),
    vetLinkTtlSeconds: integer("VET_LINK_TTL_SECONDS", 1_209_600),
    photoUrlTtlSeconds: integer("PHOTO_URL_TTL_SECONDS", 300),
    photoUrlKeyRotateSeconds: integer("PHOTO_URL_KEY_ROTATE_SECONDS", 86_400),
    uploadChunkBytes: integer("UPLOAD_CHUNK_BYTES", 1_000_000),
    uploadSessionSeconds: integer("UPLOAD_SESSION_SECONDS", 86_400),
    visitPhotoQuotaBytes: integer("VISIT_PHOTO_QUOTA_BYTES", 48_000_000),
    dunningRetryDays: retryDays(),
    dunningDaySeconds: integer("DUNNING_DAY_SECONDS", 86_400),
    jobLeaseSeconds: integer("JOB_LEASE_SECONDS", 30),
    jobMaxAttempts: integer("JOB_MAX_ATTEMPTS", 5),
    jobBackoffBaseSeconds: integer("JOB_BACKOFF_BASE_SECONDS", 5),
    jobBackoffMaxSeconds: integer("JOB_BACKOFF_MAX_SECONDS", 300),
    reminderScanSeconds: integer("REMINDER_SCAN_SECONDS", 300),
    alertOutstandingCents: integer("ALERT_OUTSTANDING_CENTS", 50_000, 0),
    idempotencyLeaseSeconds: integer("IDEMPOTENCY_LEASE_SECONDS", 30),
    shutdownGraceSeconds: integer("SHUTDOWN_GRACE_SECONDS", 10),
    sseHeartbeatSeconds: integer("SSE_HEARTBEAT_SECONDS", 15),
    sseRetentionEvents: integer("SSE_RETENTION_EVENTS", 1000),
    readyCheckTimeoutMs: integer("READY_CHECK_TIMEOUT_MS", 2000),
    importDefaultPassword: process.env.IMPORT_DEFAULT_PASSWORD || "hoofcare-2026",
    allowances: allowances(),
};
