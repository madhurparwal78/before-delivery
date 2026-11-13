// Every service URL, credential and timer, read once from the environment at start.
function required(name) {
    const value = process.env[name];
    if (value === undefined || value === "")
        throw new Error(`${name} is not set`);
    return value;
}
function seconds(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "")
        return fallback;
    if (!/^\d+$/.test(raw))
        throw new Error(`${name} must be a whole number of seconds`);
    return Number(raw);
}
export const config = {
    port: Number(process.env.APP_PUBLIC_PORT || "4173"),
    publicUrl: process.env.APP_PUBLIC_URL ? process.env.APP_PUBLIC_URL.replace(/\/+$/, "") : null,
    databaseUrl: required("DATABASE_URL"),
    s3: {
        endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
        region: required("S3_REGION"),
        bucket: required("S3_BUCKET"),
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    killbill: {
        url: required("KILLBILL_URL").replace(/\/+$/, ""),
        username: required("KILLBILL_USERNAME"),
        password: required("KILLBILL_PASSWORD"),
        apiKey: required("KILLBILL_API_KEY"),
        apiSecret: required("KILLBILL_API_SECRET"),
    },
    smtp: {
        host: required("SMTP_HOST"),
        port: Number(required("SMTP_PORT")),
        from: process.env.MAIL_FROM || "Gloamwork Studio <studio@gloamwork.test>",
    },
    mailpitUrl: required("MAILPIT_URL").replace(/\/+$/, ""),
    pocketbase: {
        url: required("POCKETBASE_URL").replace(/\/+$/, ""),
        email: required("POCKETBASE_ADMIN_EMAIL"),
        password: required("POCKETBASE_ADMIN_PASSWORD"),
    },
    amqpUrl: required("AMQP_URL"),
    gotenbergUrl: required("GOTENBERG_URL").replace(/\/+$/, ""),
    meilisearch: {
        url: required("MEILISEARCH_URL").replace(/\/+$/, ""),
        apiKey: required("MEILISEARCH_API_KEY"),
    },
    ntfy: {
        url: required("NTFY_URL").replace(/\/+$/, ""),
        username: required("NTFY_USERNAME"),
        password: required("NTFY_PASSWORD"),
    },
    timers: {
        signinCodeTtl: seconds("SIGNIN_CODE_TTL_SECONDS", 600),
        signinCodeWindow: seconds("SIGNIN_CODE_WINDOW_SECONDS", 900),
        reviewLinkTtl: seconds("REVIEW_LINK_TTL_SECONDS", 1_209_600),
        overdueAfter: seconds("OVERDUE_AFTER_SECONDS", 1_209_600),
        idempotencyKeyTtl: seconds("IDEMPOTENCY_KEY_TTL_SECONDS", 86_400),
    },
};
